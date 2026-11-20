import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';

import { ApiException } from './api-exception';

const collectMessages = (errors: ValidationError[]): string[] =>
  errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...collectMessages(error.children ?? []),
  ]);

/**
 * Spec §1 "DTO Whitelisting": unknown fields are rejected, payloads are
 * transformed into DTO class instances (so @Transform normalization runs).
 */
export const createValidationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new ApiException(
        HttpStatus.BAD_REQUEST,
        'bad_request',
        'Validation failed',
        collectMessages(errors),
      ),
  });
