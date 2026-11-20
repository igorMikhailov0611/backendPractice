import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { HttpExceptionFilter } from './http-exception.filter';
import { createValidationPipe } from './validation.pipe';

/**
 * Global request/response plumbing. Registered via DI tokens (not app.useGlobal*()
 * in main.ts) so e2e tests that build the app from AppModule get the same behaviour.
 */
@Module({
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class HttpModule {}
