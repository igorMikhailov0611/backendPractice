/**
 * Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
 * TypeORM wraps driver errors in QueryFailedError; the original pg error (with `code`) is `driverError`.
 */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * True when `error` is a Postgres unique-constraint violation, e.g. two parallel
 * registrations with the same email where both passed the `findByEmail` check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (error instanceof Error && 'driverError' in error) {
    const { driverError } = error as { driverError?: { code?: string } };

    if (error instanceof Error && driverError?.code === PG_UNIQUE_VIOLATION) {
      return true;
    }
  }

  return false;
}
