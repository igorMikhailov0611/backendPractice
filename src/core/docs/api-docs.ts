import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ConfigService } from '@/core/config/config.service';

/**
 * OpenAPI description of the API (mentor's doc §1.6 "описание API"):
 * - Swagger UI:        GET /docs
 * - raw OpenAPI JSON:  GET /docs-json (import it into Postman / Insomnia, or generate a typed client)
 *
 * Served only when API_DOCS_ENABLED=true. Swagger UI is static files, which on Fastify are served by
 * @fastify/static; these routes are a Fastify plugin, not Nest controllers, so Nest guards don't run on them.
 */
export function setupApiDocs(
  app: NestFastifyApplication,
  config: ConfigService,
): void {
  // ConfigService.get() is typed as string; Joi has already turned "true"/"false" into a boolean.
  if (String(config.get('API_DOCS_ENABLED')) !== 'true') {
    return;
  }

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Backend Practice API')
      .setDescription(
        'Auth, users, RBAC & file transformation service. ' +
          'Every error has the shape `{ statusCode, code, message, details? }`.',
      )
      .setVersion('1.0')
      .build(),
  );

  SwaggerModule.setup('docs', app, document);
}
