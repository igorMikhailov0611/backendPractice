import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body of `POST /auth/register` (mentor's registration_requirements.md §1.3.1).
 * Unknown fields are rejected by the global ValidationPipe (forbidNonWhitelisted).
 */
export class RegisterDto {
  /**
   * "Перед сравнением и записью обрезаются крайние пробелы, буквы приводятся к нижнему регистру."
   * `user+tag@example.com` stays a separate address: no plus-stripping, no dot-removal.
   * @Transform runs before the validators, so they see the normalized value.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255) // matches users.email varchar(255)
  email: string;

  /**
   * "Крайние пробелы у пароля сохраняются." — no @Transform here on purpose.
   * Policy: 8+ characters, at least one letter of any alphabet and one digit,
   * and a maximum length so an attacker can't make us hash megabytes.
   */
  @IsString()
  @MinLength(8, {
    message: 'password must be at least 8 characters long',
  })
  @MaxLength(128, {
    message: 'password must be at most 128 characters long',
  })
  @Matches(/\p{L}/u, {
    message: 'password must contain at least one letter',
  })
  @Matches(/\p{Nd}/u, {
    message: 'password must contain at least one number',
  })
  password: string;
}
