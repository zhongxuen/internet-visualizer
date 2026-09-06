import { describe, expect, it } from 'vitest';

import { getCipherSuite, LEGACY_RECORD_VERSION, type CipherSuite } from './cipher';
import {
  alert,
  byteLength,
  CLOSE_NOTIFY,
  CONTENT_TYPE_VALUES,
  exceedsLimit,
  formatContentType,
  INNER_TYPE_BYTES,
  isProtected,
  makeRecord,
  MAX_CIPHERTEXT_LENGTH,
  MAX_PLAINTEXT_FRAGMENT,
  nonceFor,
  observerFacts,
  observerView,
  overheadRatio,
  RECORD_HEADER_BYTES,
  recordsForPlaintext,
  stillVisible,
  totalPayloadBytes,
  totalWireBytes,
  type ObserverContext,
} from './records';

const SUITE = getCipherSuite('TLS_AES_128_GCM_SHA256') as CipherSuite;
const CCM8 = getCipherSuite('TLS_AES_128_CCM_8_SHA256') as CipherSuite;

/** A minimal HTTP request, as `http-explorer` would have serialized it. */
const HTTP_REQUEST =
  'GET /index.html HTTP/1.1\r\nHost: www.example.com\r\nAccept: text/html\r\n\r\n';

describe('content types', () => {
  it('assigns the registered numbers from RFC 8446 s 5.1', () => {
    expect(CONTENT_TYPE_VALUES).toEqual({
      invalid: 0,
      change_cipher_spec: 20,
      alert: 21,
      handshake: 22,
      application_data: 23,
    });
  });

  it('formats them the way a dissector prints them', () => {
    expect(formatContentType('handshake')).toBe('handshake(22)');
    expect(formatContentType('application_data')).toBe('application_data(23)');
  });
});

describe('limits', () => {
  it('matches the RFC 8446 s 5.1 and s 5.2 bounds', () => {
    expect(RECORD_HEADER_BYTES).toBe(5);
    expect(MAX_PLAINTEXT_FRAGMENT).toBe(16_384);
    expect(MAX_CIPHERTEXT_LENGTH).toBe(16_384 + 256);
    expect(INNER_TYPE_BYTES).toBe(1);
  });

  it('flags an oversized record against the right bound', () => {
    const base = {
      id: 'big',
      from: 'client' as const,
      innerType: 'application_data' as const,
      label: 'big',
      version: 'TLS 1.3' as const,
      suite: SUITE,
      sequenceNumber: 0,
    };
    expect(
      exceedsLimit(
        makeRecord({
          ...base,
          protection: 'none',
          plaintextBytes: MAX_PLAINTEXT_FRAGMENT + 1,
        }),
      ),
    ).toBe(true);
    expect(
      exceedsLimit(
        makeRecord({
          ...base,
          protection: 'none',
          plaintextBytes: MAX_PLAINTEXT_FRAGMENT,
        }),
      ),
    ).toBe(false);
  });
});

describe('byteLength', () => {
  it('counts UTF-8 bytes, not code units', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('\r\n')).toBe(2);
    expect(byteLength('é')).toBe(2);
    expect(byteLength('😀')).toBe(4);
  });
});

describe('makeRecord -- byte accounting', () => {
  const base = {
    id: 'r',
    from: 'client' as const,
    innerType: 'application_data' as const,
    label: 'request',
    suite: SUITE,
    sequenceNumber: 0,
  };

  it('adds no overhead to an unprotected record', () => {
    const record = makeRecord({
      ...base,
      version: 'TLS 1.3',
      protection: 'none',
      plaintext: 'hello',
    });
    expect(record.expansionBytes).toBe(0);
    expect(record.length).toBe(5);
    expect(record.totalBytes).toBe(10);
    expect(record.ciphertext).toBeUndefined();
  });

  it('adds the AEAD tag and the inner type byte on TLS 1.3', () => {
    const record = makeRecord({
      ...base,
      version: 'TLS 1.3',
      protection: 'application',
      plaintext: 'hello',
    });
    // 5 plaintext + 1 inner type + 16 tag = 22, plus the 5-byte header = 27.
    expect(record.expansionBytes).toBe(17);
    expect(record.length).toBe(22);
    expect(record.totalBytes).toBe(27);
  });

  it('adds only the tag on TLS 1.2, which has no inner content type', () => {
    const record = makeRecord({
      ...base,
      version: 'TLS 1.2',
      protection: 'application',
      plaintext: 'hello',
    });
    expect(record.expansionBytes).toBe(16);
  });

  it('follows the suite tag length', () => {
    const record = makeRecord({
      ...base,
      version: 'TLS 1.3',
      protection: 'application',
      suite: CCM8,
      plaintext: 'hello',
    });
    expect(record.expansionBytes).toBe(9);
  });

  it('counts padding only on a protected record', () => {
    const padded = makeRecord({
      ...base,
      version: 'TLS 1.3',
      protection: 'application',
      plaintext: 'hi',
      paddingBytes: 100,
    });
    expect(padded.paddingBytes).toBe(100);
    expect(padded.length).toBe(2 + 100 + 17);

    const unprotected = makeRecord({
      ...base,
      version: 'TLS 1.3',
      protection: 'none',
      plaintext: 'hi',
      paddingBytes: 100,
    });
    expect(unprotected.paddingBytes).toBe(0);
  });

  it('stamps the legacy record version regardless of the real version', () => {
    const record = makeRecord({
      ...base,
      version: 'TLS 1.3',
      protection: 'none',
      plaintext: 'x',
    });
    expect(record.legacyVersion).toBe(LEGACY_RECORD_VERSION);
  });
});

describe('makeRecord -- the inner and outer content type', () => {
  const base = {
    id: 'r',
    from: 'server' as const,
    innerType: 'handshake' as const,
    label: 'Finished',
    suite: SUITE,
    sequenceNumber: 0,
    plaintextBytes: 36,
  };

  it('disguises a protected TLS 1.3 record as application_data', () => {
    const record = makeRecord({ ...base, version: 'TLS 1.3', protection: 'handshake' });
    expect(record.innerType).toBe('handshake');
    expect(record.outerType).toBe('application_data');
  });

  it('leaves the TLS 1.2 header honest even when the payload is encrypted', () => {
    const record = makeRecord({ ...base, version: 'TLS 1.2', protection: 'application' });
    expect(record.outerType).toBe('handshake');
  });

  it('keeps the real type when nothing is encrypted', () => {
    const record = makeRecord({ ...base, version: 'TLS 1.3', protection: 'none' });
    expect(record.outerType).toBe('handshake');
  });
});

describe('isProtected', () => {
  it('treats every level but none as encrypted', () => {
    expect(isProtected('none')).toBe(false);
    expect(isProtected('early-data')).toBe(true);
    expect(isProtected('handshake')).toBe(true);
    expect(isProtected('application')).toBe(true);
  });
});

describe('recordsForPlaintext -- wrapping HTTP bytes', () => {
  const records = recordsForPlaintext(HTTP_REQUEST, {
    from: 'client',
    version: 'TLS 1.3',
    suite: SUITE,
    idPrefix: 'req',
    label: 'HTTP request',
  });

  it('fits a small request in one record', () => {
    expect(records).toHaveLength(1);
    expect(records[0].label).toBe('HTTP request');
    expect(records[0].plaintext).toBe(HTTP_REQUEST);
  });

  it('accounts for the payload and the overhead separately', () => {
    const payload = byteLength(HTTP_REQUEST);
    expect(totalPayloadBytes(records)).toBe(payload);
    expect(totalWireBytes(records)).toBe(payload + RECORD_HEADER_BYTES + 17);
  });

  it('fragments anything over 2^14 bytes', () => {
    const big = 'x'.repeat(MAX_PLAINTEXT_FRAGMENT * 2 + 100);
    const many = recordsForPlaintext(big, {
      from: 'server',
      version: 'TLS 1.3',
      suite: SUITE,
      idPrefix: 'res',
      label: 'HTTP response',
    });
    expect(many).toHaveLength(3);
    expect(many[0].plaintextBytes).toBe(MAX_PLAINTEXT_FRAGMENT);
    expect(many[2].plaintextBytes).toBe(100);
    expect(many.every((record) => !exceedsLimit(record))).toBe(true);
    expect(many[0].label).toContain('fragment 1 of 3');
  });

  it('numbers records sequentially from the given start', () => {
    const numbered = recordsForPlaintext('x'.repeat(MAX_PLAINTEXT_FRAGMENT + 1), {
      from: 'client',
      version: 'TLS 1.3',
      suite: SUITE,
      idPrefix: 'seq',
      label: 'data',
      startSequence: 7,
    });
    expect(numbered.map((record) => record.sequenceNumber)).toEqual([7, 8]);
  });

  it('never splits a multi-byte character across records', () => {
    const text = '😀'.repeat(MAX_PLAINTEXT_FRAGMENT / 4 + 1);
    const split = recordsForPlaintext(text, {
      from: 'client',
      version: 'TLS 1.3',
      suite: SUITE,
      idPrefix: 'utf',
      label: 'data',
    });
    expect(split.map((record) => record.plaintext).join('')).toBe(text);
    expect(split.every((record) => record.plaintextBytes <= MAX_PLAINTEXT_FRAGMENT)).toBe(
      true,
    );
  });

  it('takes opaque bytes, not an HTTP type -- the record layer does not know what it carries', () => {
    const notHttp = recordsForPlaintext(' a websocket frame', {
      from: 'client',
      version: 'TLS 1.3',
      suite: SUITE,
      idPrefix: 'ws',
      label: 'WebSocket frame',
    });
    expect(notHttp).toHaveLength(1);
    expect(notHttp[0].innerType).toBe('application_data');
  });
});

describe('overheadRatio', () => {
  it('is substantial for one small record', () => {
    const small = recordsForPlaintext('hi', {
      from: 'client',
      version: 'TLS 1.3',
      suite: SUITE,
      idPrefix: 's',
      label: 'tiny',
    });
    expect(overheadRatio(small)).toBeGreaterThan(0.85);
  });

  it('rounds to nothing on bulk transfer', () => {
    const big = recordsForPlaintext('x'.repeat(MAX_PLAINTEXT_FRAGMENT), {
      from: 'server',
      version: 'TLS 1.3',
      suite: SUITE,
      idPrefix: 'b',
      label: 'bulk',
    });
    expect(overheadRatio(big)).toBeLessThan(0.002);
  });

  it('is zero for an empty run', () => {
    expect(overheadRatio([])).toBe(0);
  });
});

describe('nonceFor', () => {
  it('explains that the sequence number is never transmitted', () => {
    const record = recordsForPlaintext('x', {
      from: 'client',
      version: 'TLS 1.3',
      suite: SUITE,
      idPrefix: 'n',
      label: 'data',
      startSequence: 4,
    })[0];
    const nonce = nonceFor(record, 'PLACEHOLDER-iv-0000');
    expect(nonce.sequenceNumber).toBe(4);
    expect(nonce.formula).toContain('XOR');
    expect(nonce.explain).toContain('never transmitted');
  });
});

describe('observerView', () => {
  const base = {
    id: 'r',
    from: 'server' as const,
    innerType: 'handshake' as const,
    label: 'Certificate',
    suite: SUITE,
    sequenceNumber: 0,
    plaintextBytes: 2_600,
  };

  it('hides the payload but never the length', () => {
    const view = observerView(
      makeRecord({ ...base, version: 'TLS 1.3', protection: 'handshake' }),
    );
    expect(view.plaintext).toBeUndefined();
    expect(view.length).toBeGreaterThan(2_600);
    expect(view.payload).toContain('...');
  });

  it('reports a TLS 1.3 protected record as application_data and flags the header as dishonest', () => {
    const view = observerView(
      makeRecord({ ...base, version: 'TLS 1.3', protection: 'handshake' }),
    );
    expect(view.type).toBe('application_data(23)');
    expect(view.typeIsHonest).toBe(false);
  });

  it('reports a TLS 1.2 protected record with its real type', () => {
    const view = observerView(
      makeRecord({ ...base, version: 'TLS 1.2', protection: 'application' }),
    );
    expect(view.type).toBe('handshake(22)');
    expect(view.typeIsHonest).toBe(true);
  });

  it('shows the plaintext of an unprotected record', () => {
    const record = makeRecord({
      ...base,
      version: 'TLS 1.3',
      protection: 'none',
      plaintext: 'ClientHello',
      plaintextBytes: undefined,
    });
    const view = observerView(record);
    expect(view.plaintext).toBe('ClientHello');
    expect(view.typeIsHonest).toBe(true);
  });
});

describe('observerFacts -- what HTTPS does not hide', () => {
  const records = recordsForPlaintext(HTTP_REQUEST, {
    from: 'client',
    version: 'TLS 1.3',
    suite: SUITE,
    idPrefix: 'req',
    label: 'HTTP request',
  });

  const tls13Context: ObserverContext = {
    version: 'TLS 1.3',
    serverIp: '192.0.2.10',
    sni: 'www.example.com',
    alpn: 'h2',
    suite: SUITE.name,
  };

  it('keeps the destination address visible', () => {
    const fact = observerFacts(records, tls13Context).find(
      (entry) => entry.label === 'Destination IP address',
    );
    expect(fact?.visible).toBe(true);
    expect(fact?.value).toBe('192.0.2.10');
  });

  it('keeps the SNI hostname visible without ECH', () => {
    const fact = observerFacts(records, tls13Context).find((entry) =>
      entry.label.startsWith('Hostname'),
    );
    expect(fact?.visible).toBe(true);
    expect(fact?.value).toBe('www.example.com');
  });

  it('hides the SNI when Encrypted Client Hello is used', () => {
    const fact = observerFacts(records, { ...tls13Context, echUsed: true }).find(
      (entry) => entry.label.startsWith('Hostname'),
    );
    expect(fact?.visible).toBe(false);
    expect(fact?.value).toContain('Encrypted Client Hello');
  });

  it('keeps timing and sizes visible, always', () => {
    const facts = observerFacts(records, tls13Context);
    expect(facts.find((entry) => entry.label.startsWith('Timing'))?.visible).toBe(true);
    expect(facts.find((entry) => entry.label === 'Sizes')?.visible).toBe(true);
  });

  it('hides the URL, headers, cookies, and body', () => {
    const fact = observerFacts(records, tls13Context).find((entry) =>
      entry.label.startsWith('URL path'),
    );
    expect(fact?.visible).toBe(false);
  });

  it('hides the certificate and ALPN on TLS 1.3 and exposes both on TLS 1.2', () => {
    const thirteen = observerFacts(records, tls13Context);
    const twelve = observerFacts(records, { ...tls13Context, version: 'TLS 1.2' });

    const certOf = (facts: typeof thirteen) =>
      facts.find((entry) => entry.label.startsWith('Server certificate'))?.visible;
    const alpnOf = (facts: typeof thirteen) =>
      facts.find((entry) => entry.label.startsWith('ALPN'))?.visible;
    const typeOf = (facts: typeof thirteen) =>
      facts.find((entry) => entry.label.startsWith('Which kind'))?.visible;

    expect(certOf(thirteen)).toBe(false);
    expect(certOf(twelve)).toBe(true);
    expect(alpnOf(thirteen)).toBe(false);
    expect(alpnOf(twelve)).toBe(true);
    expect(typeOf(thirteen)).toBe(false);
    expect(typeOf(twelve)).toBe(true);
  });

  it('leaves TLS 1.2 with strictly more visible than TLS 1.3', () => {
    const thirteen = stillVisible(records, tls13Context).length;
    const twelve = stillVisible(records, { ...tls13Context, version: 'TLS 1.2' }).length;
    expect(twelve).toBeGreaterThan(thirteen);
  });

  it('gives every fact a detail worth reading', () => {
    for (const fact of observerFacts(records, tls13Context)) {
      expect(fact.detail.length, fact.label).toBeGreaterThan(40);
    }
  });
});

describe('alerts', () => {
  it('defaults to fatal, as TLS 1.3 requires for everything but closure', () => {
    expect(alert('unknown_ca', 48, 'x').level).toBe('fatal');
  });

  it('makes close_notify a warning and explains the truncation attack', () => {
    expect(CLOSE_NOTIFY.level).toBe('warning');
    expect(CLOSE_NOTIFY.code).toBe(0);
    expect(CLOSE_NOTIFY.explain).toContain('truncation');
  });
});
