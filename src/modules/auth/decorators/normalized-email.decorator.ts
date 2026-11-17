import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Email field shared by every registration DTO, so `POST /register` and `POST /register/resend`
 * normalize the same way: "Перед сравнением и записью обрезаются крайние пробелы, буквы приводятся
 * к нижнему регистру." `user+tag@example.com` stays a separate address: no plus-stripping, no dot-removal.
 *
 * @Transform runs before the validators, so they see the normalized value.
 */
export const NormalizedEmail = () =>
  applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim().toLowerCase() : value,
    ),
    IsEmail({}, { message: 'email must be a valid email address' }),
    MaxLength(255), // matches users.email varchar(255)
  );
