import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User, UserStatus } from './entities/user.entity';

export type CreateUserData = Pick<User, 'email' | 'passwordHash' | 'status'>;

/**
 * Data access for the `users` table. Other modules go through this service
 * instead of injecting the repository themselves.
 *
 * Runs inside the caller's transaction automatically: typeorm-transactional
 * patches repositories, so a `@Transactional()` method in AuthModule that calls
 * `create()` gets the same DB transaction without passing anything around.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** `email` must already be normalized (trimmed + lowercased) by the DTO. */
  findByEmail(email: string): Promise<User | null> {
    return this.users.findOneBy({ email });
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  /** pending → active, after a successful registration confirmation. */
  async activate(id: string): Promise<void> {
    await this.users.update(id, { status: UserStatus.Active });
  }

  /**
   * Inserts a user. A duplicate email is NOT checked here: the unique constraint
   * throws a QueryFailedError with Postgres code 23505, and the caller maps it to 409.
   */
  create(data: CreateUserData): Promise<User> {
    return this.users.save(this.users.create(data));
  }
}
