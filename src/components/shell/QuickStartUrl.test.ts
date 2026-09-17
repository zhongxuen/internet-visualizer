import { describe, expect, it } from 'vitest';

import { checkQuickStart, quickStartHref } from './QuickStartUrl';

describe('checkQuickStart', () => {
  it.each([
    'example.com',
    '  example.com  ',
    'www.example.com/some/path?q=1',
    'https://example.com',
    'HTTP://Example.com:8080/',
    'http://localhost:3000',
  ])('accepts %s as a web address', (value) => {
    expect(checkQuickStart(value)).toEqual({ ok: true, href: quickStartHref(value) });
  });

  it.each([
    ['', /Type a web address first/],
    ['   ', /Type a web address first/],
    ['example', /doesn't look like a web address/],
    ['two words.com', /doesn't look like a web address/],
    ['.example.com', /doesn't look like a web address/],
    ['example..com', /doesn't look like a web address/],
    ['ftp://example.com', /Only website addresses/],
    ['javascript:alert(1)', /Only website addresses/],
    ['mailto:someone@example.com', /Only website addresses/],
  ])('rejects %j with a sentence saying why', (value, message) => {
    const check = checkQuickStart(value);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.error).toMatch(message);
  });

  it('points at the simulator with the trimmed address encoded as ?url=', () => {
    expect(quickStartHref(' https://example.com/a?x=1&y=2 ')).toBe(
      '/internet-simulator?url=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2',
    );
  });
});
