import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';

import { ApiException, ErrorCode } from './api-exception';

export interface ErrorBody {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: string[];
}

const DEFAULT_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'bad_request',
  [HttpStatus.UNAUTHORIZED]: 'invalid_session',
  [HttpStatus.FORBIDDEN]: 'permission_denied',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.CONFLICT]: 'conflict',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'payload_too_large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'unsupported_media_type',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limit_exceeded',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'service_unavailable',
  [HttpStatus.GATEWAY_TIMEOUT]: 'gateway_timeout',
};

/**
 * Turns every thrown error into the spec error shape `{ statusCode, code, message }`.
 * 5xx messages are always generic (spec §1 "Error Masking") — details go to the log only.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const body = this.toBody(exception);

    void reply.status(body.statusCode).send(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof ApiException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...(exception.details && { details: exception.details }),
      };
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();

      if (statusCode < 500) {
        return {
          statusCode,
          code: DEFAULT_CODES[statusCode] ?? 'bad_request',
          message: exception.message,
        };
      }
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    return {
      statusCode,
      code: DEFAULT_CODES[statusCode] ?? 'internal_error',
      message: 'Internal server error',
    };
  }
}
