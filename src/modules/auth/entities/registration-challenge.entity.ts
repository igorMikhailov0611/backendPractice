import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '@/modules/users/entities/user.entity';

/** How the secret is delivered. Chosen by the server (REGISTRATION_CONFIRMATION_METHOD), never by the client. */
export enum ChallengeMethod {
  Otp = 'otp',
  MagicLink = 'magic_link',
}

/**
 * One email-confirmation attempt per pending user (mentor's registration_requirements.md,
 * table `registration_challenges`). Resend updates this same row in place.
 *
 * `expires_at` is NOT stored: it is always `last_sent_at + 10 min`, so it is computed in code.
 * Storing it would create a transitive dependency (the doc's 2NF note) that an UPDATE could break.
 */
@Entity({ name: 'registration_challenges' })
// Only magic-link tokens (32 random bytes) are looked up by hash, and only they are unique.
// OTP hashes must be allowed to repeat: two users can get the same 6-digit code.
@Index('UQ_registration_challenges_magic_link_secret', ['secretHash'], {
  unique: true,
  where: `"method" = 'magic_link'`,
})
// Database-side safety nets: a buggy counter or a raw (un-hashed) secret can't be saved.
@Check('CHK_registration_challenges_attempts', `"attempts" BETWEEN 0 AND 5`)
@Check(
  'CHK_registration_challenges_secret_hash',
  `"secret_hash" ~ '^[0-9a-f]{64}$'`,
)
export class RegistrationChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** One-to-one: TypeORM makes `user_id` unique, so a user has at most one challenge. */
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({
    type: 'enum',
    enum: ChallengeMethod,
    enumName: 'registration_challenge_method',
  })
  method: ChallengeMethod;

  /** HMAC-SHA256(code or token, LOGIN_CHALLENGE_HMAC_KEY) as hex: always 64 chars. Never the secret itself. */
  @Column({ name: 'secret_hash', type: 'char', length: 64 })
  secretHash: string;

  /** Wrong OTP inputs. The 5th wrong input consumes the challenge; resend resets it to 0. */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** When the email was last delivered. NULL = never delivered (SMTP failed): secret invalid, no resend cooldown. */
  @Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
  lastSentAt: Date | null;

  /** Set on successful confirmation or on the 5th wrong code. Resend clears it. */
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
