import { QueryFailedError } from 'typeorm';

import { isUniqueViolation } from './postgres-errors';

/** What TypeORM throws when Postgres rejects a query: the pg error is kept as `driverError`. */
const queryFailed = (driverError: Record<string, unknown>) =>
  new QueryFailedError(
    'INSERT INTO "users" ...',
    [],
    Object.assign(new Error('pg error'), driverError),
  );

describe('isUniqueViolation', () => {
  it('is true for a QueryFailedError with Postgres code 23505', () => {
    expect(
      isUniqueViolation(
        queryFailed({
          code: '23505',
          constraint: 'UQ_97672ac88f789774dd47f7c8be3',
        }),
      ),
    ).toBe(true);
  });

  it('is false for other Postgres errors (e.g. 23514 check violation)', () => {
    expect(isUniqueViolation(queryFailed({ code: '23514' }))).toBe(false);
  });

  it('is false for a QueryFailedError without a code', () => {
    expect(isUniqueViolation(queryFailed({}))).toBe(false);
  });

  it('is false for a plain Error, even one with code 23505', () => {
    expect(
      isUniqueViolation(Object.assign(new Error('x'), { code: '23505' })),
    ).toBe(false);
  });

  it.each([undefined, null, '23505', 23505])(
    'is false for non-errors (%p) without throwing',
    (value) => {
      expect(isUniqueViolation(value)).toBe(false);
    },
  );
});
