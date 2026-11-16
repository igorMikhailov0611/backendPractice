import { PasswordHasher } from './password-hasher.service';

// The mentor's hash-demo, as tests. Real argon2 (no mocks): this IS the unit under test.
describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();
  const password = 'секрет12';
  let stored: string;

  beforeAll(async () => {
    stored = await hasher.hash(password);
  });

  it('produces an Argon2id string with our parameters, not the password', () => {
    expect(stored).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=4\$/);
    expect(stored).not.toContain(password);
  });

  it('gives a different hash for the same password (random salt)', async () => {
    expect(await hasher.hash(password)).not.toBe(stored);
  });

  it('verifies the original password', async () => {
    expect(await hasher.verify(stored, password)).toBe(true);
  });

  it('rejects a different password', async () => {
    expect(await hasher.verify(stored, 'секрет13')).toBe(false);
  });

  it('keeps surrounding spaces significant', async () => {
    expect(await hasher.verify(stored, ` ${password} `)).toBe(false);
  });

  it('uses the whole input: passwords differing only after byte 72 do not match', async () => {
    const prefix = 'a1'.repeat(40); // 80 bytes, past bcrypt's 72-byte cut-off
    const long = await hasher.hash(`${prefix}X`);

    expect(await hasher.verify(long, `${prefix}Y`)).toBe(false);
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    expect(await hasher.verify('not-a-hash', password)).toBe(false);
  });
});
