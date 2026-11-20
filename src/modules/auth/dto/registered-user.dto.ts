import { ApiProperty } from '@nestjs/swagger';

import { User, UserStatus } from '@/modules/users/entities/user.entity';

/**
 * Response body of `POST /auth/register` (201) and `POST /auth/register/confirm` (200).
 * Mentor's registration_requirements.md §1.3: `id`, normalized `email`, `status`.
 * "Пароль, хеш и токены в ответ не входят."
 */
export class RegisteredUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'email', example: 'user@example.com' })
  email: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.Active })
  status: UserStatus;
}

export function toRegisteredUser(user: User): RegisteredUserDto {
  // Allowlist, not `const { passwordHash, ...rest } = user`: a column added to User later
  // stays out of the response until someone adds it here on purpose.
  return {
    id: user.id,
    email: user.email,
    status: user.status,
  };
}
