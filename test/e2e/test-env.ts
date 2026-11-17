import { config } from 'dotenv';

/**
 * Runs before every e2e file (jest `setupFiles`) and in `globalSetup`, BEFORE AppModule is imported.
 * @nestjs/config gives real environment variables priority over .env, so whatever we set here wins.
 *
 * Idempotent: `globalSetup` and each test file both run it.
 */
config(); // .env → process.env (values that are already set are kept)

const devDatabase = process.env.POSTGRES_DB ?? 'backend_practice';

// Never the dev database: e2e tests TRUNCATE tables between tests.
process.env.POSTGRES_DB = devDatabase.endsWith('_test')
  ? devDatabase
  : `${devDatabase}_test`;

// The schema comes from the real migrations, applied when the app boots.
process.env.POSTGRES_MIGRATIONS_RUN = 'true';

// All requests come from one IP (app.inject → 127.0.0.1). Rate limits are not what these tests check.
process.env.THROTTLE_GLOBAL_LIMIT = '1000';
process.env.REGISTRATION_RATE_LIMIT = '1000';

process.env.API_DOCS_ENABLED = 'false';
