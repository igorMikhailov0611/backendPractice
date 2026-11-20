import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ConfirmRegistrationDto } from './confirm-registration.dto';

const errorsFor = (body: object) =>
  validateSync(plainToInstance(ConfirmRegistrationDto, body)).map(
    (e) => e.property,
  );

const attemptId = '3f2b8c1e-9d4a-4c6b-8e7f-1a2b3c4d5e6f';
const token = 'A'.repeat(43);

describe('ConfirmRegistrationDto', () => {
  it('accepts { attemptId, code }', () => {
    expect(errorsFor({ attemptId, code: '012345' })).toEqual([]);
  });

  it('accepts { token }', () => {
    expect(errorsFor({ token })).toEqual([]);
  });

  it('rejects an empty body', () => {
    expect(errorsFor({})).toEqual(['attemptId', 'code']);
  });

  it('rejects a token sent together with OTP fields', () => {
    expect(errorsFor({ token, attemptId, code: '012345' })).toContain('token');
    expect(errorsFor({ token, code: '012345' })).toContain('token');
  });

  it('rejects a code without attemptId', () => {
    expect(errorsFor({ code: '012345' })).toEqual(['attemptId']);
  });

  it.each(['12345', '1234567', '12345a', ' 123456', 123456])(
    'rejects code %p',
    (code) => {
      expect(errorsFor({ attemptId, code })).toEqual(['code']);
    },
  );

  it('rejects a non-uuid attemptId', () => {
    expect(errorsFor({ attemptId: '42', code: '012345' })).toEqual([
      'attemptId',
    ]);
  });

  it.each(['short', 'A'.repeat(44), `${'A'.repeat(42)}=`])(
    'rejects token %p',
    (bad) => {
      expect(errorsFor({ token: bad })).toEqual(['token']);
    },
  );
});
