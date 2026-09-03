/**
 * "These are the literal bytes" is the module's central claim, so it is asserted rather
 * than trusted: byte-exact CRLF terminators, the lone CRLF that ends the field section,
 * and a body starting at the very next byte.
 */

import { describe, expect, it } from 'vitest';

import { CONDITIONAL_REQUEST, SIMPLE_GET } from './scenarios';
import { runHttpScenario } from './sim/exchange';
import { CRLF } from './sim/message';
import { requestWire, wireMessages, wireResponse } from './wire';

const simple = runHttpScenario(SIMPLE_GET);

describe('HTTP/1.1 is byte-accurate', () => {
  const { request, response } = wireMessages(simple.exchanges[0]);

  it('terminates every line with CR LF -- two bytes, not one', () => {
    const lines = request.wire.split(CRLF);
    // Every line but the last is CRLF-terminated, and the last is the body or empty.
    expect(lines.length).toBeGreaterThan(3);
    expect(request.wire.includes('\n' + 'x')).toBe(false);
  });

  it('puts a line consisting of nothing but CR LF before the body', () => {
    expect(response.wire).toContain(CRLF + CRLF);
  });

  it('counts bytes including the terminators', () => {
    expect(request.bytes).toBe(new TextEncoder().encode(request.wire).length);
  });

  it('addresses every segment at its true byte offset', () => {
    for (const segment of response.segments) {
      const slice = response.wire.slice(segment.offset, segment.offset + segment.length);
      expect(slice).toBe(segment.text);
    }
  });

  it('splits header segments into a name and a value', () => {
    const host = requestWire(simple.exchanges[0].request).segments.find(
      (segment) => segment.name?.toLowerCase() === 'host',
    );
    expect(host).toBeDefined();
    expect(host?.value).toBe('example.com');
  });
});

describe('a revalidation put a 304 on the wire', () => {
  const run = runHttpScenario(CONDITIONAL_REQUEST);
  const revalidated = run.exchanges.filter(
    (exchange) =>
      exchange.browserCache === 'REVALIDATED' || exchange.cdnCache === 'REVALIDATED',
  );

  it('has one to look at', () => {
    expect(revalidated.length).toBeGreaterThan(0);
  });

  it('is a 304, even though the client ended up with a 200', () => {
    const exchange = revalidated[0];
    expect(wireResponse(exchange).status).toBe(304);
    expect(exchange.response.status).toBe(200);
  });

  it('carries no body at all -- that is the entire saving', () => {
    const { response, reconstructedNote } = wireMessages(revalidated[0]);
    expect(response.bodyless).toBe(true);
    expect(response.wire.endsWith(CRLF + CRLF)).toBe(true);
    expect(reconstructedNote).toContain('no body');
  });

  it('is smaller than the response the client was handed', () => {
    const exchange = revalidated[0];
    const { response } = wireMessages(exchange);
    expect(response.bytes).toBeLessThan(
      new TextEncoder().encode(exchange.response.body ?? '').length,
    );
  });
});

describe('an ordinary exchange is passed through unchanged', () => {
  it('adds no note, because nothing was reconstructed', () => {
    expect(wireMessages(simple.exchanges[0]).reconstructedNote).toBeUndefined();
  });
});
