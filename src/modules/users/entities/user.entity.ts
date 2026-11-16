import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Lifecycle of an account (mentor's registration_requirements.md: `pending` or `active`).
 * - `pending`: registered with email confirmation ON, not confirmed yet. The email is already taken.
 * - `active`:  can log in.
 * More statuses (blocked, deleting, deleted from the spec) get added by a later migration.
 */
export enum UserStatus {
  Pending = 'pending',
  Active = 'active',
}

@Entity({ name: 'users' })
// Safety net in the database: the DTO normalizes emails, but if any code path ever forgets,
// `User@Example.com` must not slip in next to `user@example.com` and bypass the unique index.
@Check('CHK_users_email_normalized', `"email" = lower(btrim("email"))`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email: string;

  /** Argon2id hash string: algorithm, parameters, salt and hash in one value. Never the raw password. */
  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: UserStatus,
    enumName: 'user_status',
    default: UserStatus.Pending,
  })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
