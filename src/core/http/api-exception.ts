import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Machine-readable error codes from spec §1 "Standardized HTTP Status & Error Codes".
 * `internal_error` is ours: the spec has no 500 row, but unexpected crashes still need a code.
 */
export type ErrorCode =
  | 'bad_request'
  | 'invalid_session'
  | 'invalid_credentials'
  | 'permission_denied'
  | 'ownership_denied'
  | 'csrf_rejected'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limit_exceeded'
  | 'authorization_unavailable'
  | 'service_unavailable'
  | 'gateway_timeout'
  | 'internal_error';

/**
 * Throw this from services/controllers when the response needs a specific `code`.
 * Plain Nest exceptions (NotFoundException, ThrottlerException, …) still work —
 * the global filter derives a default code from their status.
 */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: string[],
  ) {
    super({ code, message, details }, status);
  }
}
