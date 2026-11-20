import {
  ArgumentsHost,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';

import { ApiException } from './api-exception';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();
  const reply = { status: jest.fn(), send: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  beforeEach(() => {
    reply.status.mockReset().mockReturnValue(reply);
    reply.send.mockReset();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  const sent = () => reply.send.mock.calls[0][0];

  it('uses the explicit code and details of an ApiException', () => {
    filter.catch(
      new ApiException(
        HttpStatus.BAD_REQUEST,
        'bad_request',
        'Validation failed',
        ['email must be an email'],
      ),
      host,
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(sent()).toEqual({
      statusCode: 400,
      code: 'bad_request',
      message: 'Validation failed',
      details: ['email must be an email'],
    });
  });

  it('derives a default code from the status of plain Nest exceptions', () => {
    filter.catch(new NotFoundException('Cannot GET /nope'), host);
    expect(sent()).toMatchObject({ statusCode: 404, code: 'not_found' });

    reply.send.mockReset();
    filter.catch(new ThrottlerException(), host);
    expect(sent()).toMatchObject({
      statusCode: 429,
      code: 'rate_limit_exceeded',
    });
  });

  it('masks the message of 5xx HttpExceptions', () => {
    filter.catch(
      new ServiceUnavailableException('smtp://secret-host down'),
      host,
    );

    expect(sent()).toEqual({
      statusCode: 503,
      code: 'service_unavailable',
      message: 'Internal server error',
    });
  });

  it('turns unknown errors into a generic 500 internal_error', () => {
    filter.catch(new Error('db password is hunter2'), host);

    expect(sent()).toEqual({
      statusCode: 500,
      code: 'internal_error',
      message: 'Internal server error',
    });
  });
});
