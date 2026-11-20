import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { ERROR_CODES, type ErrorCode } from './api-exception';
import type { ErrorBody } from './http-exception.filter';

/**
 * Documentation-only class for the error shape the global HttpExceptionFilter sends (spec §1).
 * `implements ErrorBody`: if the filter's shape changes, this stops compiling instead of lying in /docs.
 */
export class ErrorResponseDto implements ErrorBody {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    enum: ERROR_CODES,
    description:
      'Machine-readable error code. Clients branch on this, not on the message.',
    example: 'bad_request',
  })
  code: ErrorCode;

  @ApiProperty({ example: 'Invalid or expired confirmation code' })
  message: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Validation messages, one per failed rule (400 only).',
    example: ['email must be a valid email address'],
  })
  details?: string[];
}
