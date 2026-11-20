import { DataSource } from 'typeorm';

import './test-env';

/**
 * Runs once before all e2e files: creates the test database if it doesn't exist yet.
 * Tables are created later by the app itself (POSTGRES_MIGRATIONS_RUN=true), with the real migrations.
 */
export default async function globalSetup(): Promise<void> {
  const name = process.env.POSTGRES_DB ?? '';

  // CREATE DATABASE can't take a $1 parameter, so the name goes into the SQL text: allow only safe names.
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`Refusing to use "${name}" as the e2e database`);
  }

  // Connect to the built-in `postgres` database: you can't create a database while connected to it.
  const admin = new DataSource({
    type: 'postgres',
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: 'postgres',
  });
  await admin.initialize();

  try {
    const existing: unknown[] = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (existing.length === 0) {
      await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.destroy();
  }
}
