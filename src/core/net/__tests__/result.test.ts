import { describe, expect, it } from 'vitest';
import { fail, isOk, ok, unwrap, unwrapOr, type ParseResult } from '../result';

describe('ParseResult', () => {
  it('is a plain object, so results compare structurally', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect(fail('nope')).toEqual({ ok: false, error: 'nope' });
    expect(ok(42)).toEqual(ok(42));
  });

  it('narrows through isOk', () => {
    const result: ParseResult<number> = ok(1);
    expect(isOk(result)).toBe(true);
    expect(isOk(fail<number>('nope'))).toBe(false);
  });

  it('falls back on rejection', () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(fail<number>('nope'), 0)).toBe(0);
  });

  it('unwraps a trusted value, and throws with context when there is not one', () => {
    expect(unwrap(ok('8.8.8.8'))).toBe('8.8.8.8');
    expect(() => unwrap(fail('octet out of range'), 'IP address "1.2.3.999"')).toThrow(
      'invalid IP address "1.2.3.999": octet out of range',
    );
    expect(() => unwrap(fail('bad'))).toThrow('invalid value: bad');
  });
});
