import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { ConfigService } from '@/core/config/config.service';
import { isUniqueViolation } from '@/core/database/postgres-errors';
import { ApiException } from '@/core/http/api-exception';
import { MailDeliveryError } from '@/modules/mail/mail-delivery.error';
import { MailService } from '@/modules/mail/mail.service';
import { User, UserStatus } from '@/modules/users/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';

import { ChallengeSecrets } from './challenge-secrets.service';
import {
  ConfirmationOutcome,
  decideConfirmation,
} from './confirmation-decision';
import { ConfirmRegistrationDto } from './dto/confirm-registration.dto';
import { ConfirmationRequiredDto } from './dto/confirmation-required.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisteredUserDto, toRegisteredUser } from './dto/registered-user.dto';
import {
  ChallengeMethod,
  RegistrationChallenge,
} from './entities/registration-challenge.entity';
import { PasswordHasher } from './password-hasher.service';
import {
  CHALLENGE_TTL_SECONDS,
  MAX_OTP_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
} from './registration.constants';

/** 409 for a taken email (mentor's doc §1.4: explicit 409 is the default). */
const emailTaken = () =>
  new ApiException(
    HttpStatus.CONFLICT,
    'conflict',
    'Email is already registered',
  );

/**
 * Every confirm failure except exhaustion gets this same answer (mentor's doc §1.3: "not found or already
 * consumed → the same answer as a wrong code"), so a client can't tell which check failed.
 */
const invalidConfirmation = () =>
  new ApiException(
    HttpStatus.BAD_REQUEST,
    'bad_request',
    'Invalid or expired confirmation code',
  );

/** 5 wrong OTP inputs: even the right code is refused now (mentor's doc §1.4 → 429). */
const attemptsExhausted = () =>
  new ApiException(
    HttpStatus.TOO_MANY_REQUESTS,
    'rate_limit_exceeded',
    'Too many attempts, request a new code',
  );

/** `RegisteredUserDto` → 201 Created, `ConfirmationRequiredDto` → 202 Accepted (the controller picks). */
export type RegistrationResult = RegisteredUserDto | ConfirmationRequiredDto;

/** Registration flow (mentor's registration_requirements.md §1.3). */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly users: UsersService,
    @InjectRepository(RegistrationChallenge)
    private readonly challenges: Repository<RegistrationChallenge>,
    private readonly hasher: PasswordHasher,
    private readonly secrets: ChallengeSecrets,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * No session is created in either mode: logging in is a separate step (mentor's doc §1.2).
   * - Confirmation OFF: an `active` user, `{ id, email, status }`.
   * - Confirmation ON: a `pending` user + challenge, an email, `{ confirmationRequired, attemptId, … }`.
   */
  async register(dto: RegisterDto): Promise<RegistrationResult> {
    // Fast path for the common case, also for a `pending` email. Not enough on its own: see insertOrConflict.
    if (await this.users.findByEmail(dto.email)) {
      this.logger.log('registration.failed reason=email_taken');
      throw emailTaken();
    }

    const passwordHash = await this.hasher.hash(dto.password);

    return this.confirmationEnabled()
      ? this.registerPending(dto.email, passwordHash)
      : this.registerActive(dto.email, passwordHash);
  }

  private async registerActive(
    email: string,
    passwordHash: string,
  ): Promise<RegisteredUserDto> {
    const user = await this.insertOrConflict(() =>
      this.users.create({ email, passwordHash, status: UserStatus.Active }),
    );
    this.logger.log(`registration.created userId=${user.id} status=active`);

    return toRegisteredUser(user);
  }

  private async registerPending(
    email: string,
    passwordHash: string,
  ): Promise<ConfirmationRequiredDto> {
    const method = this.confirmationMethod();
    const secret =
      method === ChallengeMethod.Otp
        ? this.secrets.generateOtp()
        : this.secrets.generateMagicToken();

    // Step 1: both rows or neither. Committed before the email goes out.
    const { user, challenge } = await this.insertOrConflict(() =>
      this.createPendingUser(email, passwordHash, method, secret),
    );
    this.logger.log(
      `registration.created userId=${user.id} status=pending method=${method}`,
    );

    // Step 2: outside the transaction. An email can't be rolled back, and SMTP can be slow.
    try {
      await this.sendSecret(email, method, secret);
    } catch (error) {
      if (!(error instanceof MailDeliveryError)) {
        throw error;
      }

      this.logger.warn(
        `registration.failed reason=email_service_unavailable challengeId=${challenge.id}`,
      );

      await this.challenges
        .update(challenge.id, { lastSentAt: null })
        .catch(() =>
          this.logger.error(
            `registration.reset_last_sent_failed challengeId=${challenge.id}`,
          ),
        );

      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'service_unavailable',
        'Email service is unavailable',
      );
    }

    this.logger.log(`registration.email_sent challengeId=${challenge.id}`);

    return {
      confirmationRequired: true,
      method,
      attemptId: challenge.id,
      expiresInSeconds: CHALLENGE_TTL_SECONDS,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  /**
   * One transaction: if the challenge insert fails, the pending user is rolled back too, so we never
   * leave a `pending` user that can't be confirmed. Repositories join the transaction automatically.
   *
   * `last_sent_at = now` is set before sending: that's what "the secret is live" means for confirm,
   * and it starts the resend cooldown. If sending fails, the caller resets it to NULL.
   */
  @Transactional()
  private async createPendingUser(
    email: string,
    passwordHash: string,
    method: ChallengeMethod,
    secret: string,
  ): Promise<{ user: User; challenge: RegistrationChallenge }> {
    const user = await this.users.create({
      email,
      passwordHash,
      status: UserStatus.Pending,
    });
    const challenge = await this.challenges.save(
      this.challenges.create({
        userId: user.id,
        method,
        secretHash: this.secrets.hmac(secret),
        lastSentAt: new Date(),
      }),
    );

    return { user, challenge };
  }

  /**
   * `POST /auth/register/confirm`. Works whether the flag is on or off now: it only affects new registrations.
   *
   * The DB work runs in `confirmLocked` and is COMMITTED before we throw. Throwing inside the transaction
   * would roll back `attempts++`, and the 5-input limit would never be reached.
   */
  async confirm(dto: ConfirmRegistrationDto): Promise<RegisteredUserDto> {
    const { outcome, user, challengeId } = await this.confirmLocked(dto);

    if (outcome === 'match' && user) {
      this.logger.log(
        `registration.confirmed userId=${user.id} challengeId=${challengeId}`,
      );
      return toRegisteredUser(user);
    }

    this.logger.log(
      `registration.confirm_failed reason=${outcome} challengeId=${challengeId ?? '-'}`,
    );
    throw outcome === 'exhausted' ? attemptsExhausted() : invalidConfirmation();
  }

  /**
   * One transaction holding a row lock on the challenge (SELECT … FOR UPDATE): parallel requests for the
   * same challenge wait for each other, so N parallel guesses can't all read `attempts = 0`.
   */
  @Transactional()
  private async confirmLocked(dto: ConfirmRegistrationDto): Promise<{
    outcome: ConfirmationOutcome;
    user?: User;
    challengeId?: string;
  }> {
    const challenge = await this.lockChallenge(dto);
    const user = challenge ? await this.users.findById(challenge.userId) : null;
    const now = new Date();

    const outcome = decideConfirmation({
      challenge,
      userStatus: user?.status ?? null,
      secretMatches:
        challenge !== null &&
        this.secrets.matches(dto.token ?? dto.code ?? '', challenge.secretHash),
      now,
    });

    if (outcome === 'mismatch' && challenge) {
      challenge.attempts += 1;
      if (challenge.attempts >= MAX_OTP_ATTEMPTS) {
        challenge.consumedAt = now; // the 5th wrong input consumes the challenge
      }
      await this.challenges.save(challenge);
    }

    if (outcome === 'match' && challenge && user) {
      challenge.consumedAt = now;
      await this.challenges.save(challenge);
      await this.users.activate(user.id);
      user.status = UserStatus.Active;
    }

    return { outcome, user: user ?? undefined, challengeId: challenge?.id };
  }

  /**
   * OTP: by id. Magic link: by HMAC(token), since the token carries no id.
   * The method is part of the lookup, so an OTP attemptId can't be confirmed with a token and vice versa.
   */
  private lockChallenge(
    dto: ConfirmRegistrationDto,
  ): Promise<RegistrationChallenge | null> {
    const where =
      dto.token !== undefined
        ? {
            secretHash: this.secrets.hmac(dto.token),
            method: ChallengeMethod.MagicLink,
          }
        : { id: dto.attemptId, method: ChallengeMethod.Otp };

    return this.challenges.findOne({
      where,
      lock: { mode: 'pessimistic_write' },
    });
  }

  private sendSecret(
    email: string,
    method: ChallengeMethod,
    secret: string,
  ): Promise<void> {
    return method === ChallengeMethod.Otp
      ? this.mail.sendRegistrationOtp(email, secret)
      : this.mail.sendRegistrationMagicLink(email, secret);
  }

  /** A parallel request inserted the same email between our check and our insert → 23505 → 409. */
  private async insertOrConflict<T>(insert: () => Promise<T>): Promise<T> {
    try {
      return await insert();
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.log('registration.failed reason=email_taken_race');
        throw emailTaken();
      }
      throw error;
    }
  }

  private confirmationEnabled(): boolean {
    // ConfigService.get() is typed as string; Joi has already turned "true"/"false" into a boolean.
    return (
      String(this.config.get('REGISTRATION_EMAIL_CONFIRMATION_ENABLED')) ===
      'true'
    );
  }

  /** Joi allows only 'otp' | 'magic_link', the same values as the enum. */
  private confirmationMethod(): ChallengeMethod {
    return this.config.get(
      'REGISTRATION_CONFIRMATION_METHOD',
    ) as ChallengeMethod;
  }
}
