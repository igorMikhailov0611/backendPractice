import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { RegisterDto } from './register.dto';

/** Same steps as the global ValidationPipe: transform the plain body, then validate. */
const check = (body: Record<string, unknown>) => {
  const dto = plainToInstance(RegisterDto, body);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  return { dto, failed: errors.map((e) => e.property) };
};

const VALID = { email: 'user@example.com', password: 'secret12' };

describe('RegisterDto', () => {
  it('accepts a valid body', () => {
    expect(check(VALID).failed).toEqual([]);
  });

  it('rejects unknown fields', () => {
    expect(check({ ...VALID, role: 'admin' }).failed).toEqual(['role']);
  });

  describe('email', () => {
    it('trims and lowercases', () => {
      expect(check({ ...VALID, email: '  User@Example.COM ' }).dto.email).toBe(
        'user@example.com',
      );
    });

    it('keeps +tag as part of the address', () => {
      expect(check({ ...VALID, email: 'user+tag@example.com' }).dto.email).toBe(
        'user+tag@example.com',
      );
    });

    it.each([
      ['missing', undefined],
      ['not an email', 'not-an-email'],
      ['a number', 42],
      ['longer than 255', `${'a'.repeat(250)}@example.com`],
    ])('rejects %s', (_case, email) => {
      expect(check({ ...VALID, email }).failed).toEqual(['email']);
    });
  });

  describe('password policy', () => {
    it.each([
      ['8 chars, letters + digit', 'secret12'],
      ['Cyrillic letters (any alphabet)', 'секрет12'],
      ['Greek letters', 'αβγδεζη1'],
      ['exactly 128 chars', 'a1'.repeat(64)],
      ['spaces and symbols inside', 'my pass 1!'],
    ])('accepts %s', (_case, password) => {
      expect(check({ ...VALID, password }).failed).toEqual([]);
    });

    it.each([
      ['missing', undefined],
      ['not a string', 12345678],
      ['7 chars', 'secre12'],
      ['no digit', 'password'],
      ['no letter', '12345678'],
      ['only symbols and a digit', '!!!!!!!1'],
      ['129 chars (too long)', `${'a1'.repeat(64)}x`],
      ['a fraction instead of a digit', 'abcdefg½'],
      ['a Roman numeral instead of a digit', 'abcdefgⅫ'],
      ['a superscript instead of a digit', 'abcdefg²'],
    ])('rejects %s', (_case, password) => {
      expect(check({ ...VALID, password }).failed).toEqual(['password']);
    });

    it('accepts a decimal digit from another script', () => {
      expect(check({ ...VALID, password: 'абвгдеж٣' }).failed).toEqual([]);
    });

    it('accepts a line break inside the password', () => {
      expect(check({ ...VALID, password: 'pass\nword1' }).failed).toEqual([]);
    });

    it('explains each failed rule with a non-empty message', () => {
      const errors = validateSync(
        plainToInstance(RegisterDto, { ...VALID, password: '!!!!!!!!' }),
      );
      const messages = Object.values(errors[0].constraints ?? {});

      expect(messages.length).toBeGreaterThan(0);
      messages.forEach((m) => expect(m.trim()).not.toBe(''));
    });

    it('keeps leading and trailing spaces (not trimmed)', () => {
      expect(check({ ...VALID, password: ' secret12 ' }).dto.password).toBe(
        ' secret12 ',
      );
    });

    it('counts spaces toward the length but not as a letter or digit', () => {
      expect(check({ ...VALID, password: '      a1' }).failed).toEqual([]);
      expect(check({ ...VALID, password: '       1' }).failed).toEqual([
        'password',
      ]);
    });
  });
});
