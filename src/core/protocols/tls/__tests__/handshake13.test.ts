import { describe, expect, it } from 'vitest';

import { certificate, dnsName, DAY_MS, type CertificateChain } from '../certificates';
import {
  buildTls13Handshake,
  cleartextMessages,
  detectDowngrade,
  DOWNGRADE_SENTINEL_TLS11,
  DOWNGRADE_SENTINEL_TLS12,
  groupIntoFlights,
  HANDSHAKE_TYPE_VALUES,
  HELLO_RETRY_REQUEST_RANDOM,
  messageById,
  observableFields,
  type HandshakeMessage,
  type Tls13Handshake,
} from '../handshake13';

const NOW = Date.UTC(2026, 5, 1);

const CHAIN: CertificateChain = {
  presented: [
    certificate({
      id: 'leaf',
      subject: { commonName: 'www.example.com' },
      issuer: { commonName: 'Example Intermediate R3' },
      notBefore: NOW - 30 * DAY_MS,
      notAfter: NOW + 60 * DAY_MS,
      subjectAltNames: [dnsName('www.example.com')],
      issuedBy: 'intermediate',
    }),
    certificate({
      id: 'intermediate',
      subject: { commonName: 'Example Intermediate R3' },
      issuer: { commonName: 'Example Root CA X1' },
      notBefore: NOW - 365 * DAY_MS,
      notAfter: NOW + 365 * DAY_MS,
      basicConstraints: { ca: true },
      issuedBy: 'root',
    }),
  ],
};

const FRESH = buildTls13Handshake({ host: 'www.example.com', chain: CHAIN });

/** Message ids in the order they appear. */
function ids(handshake: Tls13Handshake): string[] {
  return handshake.messages.map((message) => message.id);
}

function find(handshake: Tls13Handshake, id: string): HandshakeMessage {
  return messageById(handshake, id) as HandshakeMessage;
}

describe('handshake types', () => {
  it('uses the RFC 8446 s B.3 numbers', () => {
    expect(HANDSHAKE_TYPE_VALUES.client_hello).toBe(1);
    expect(HANDSHAKE_TYPE_VALUES.server_hello).toBe(2);
    expect(HANDSHAKE_TYPE_VALUES.new_session_ticket).toBe(4);
    expect(HANDSHAKE_TYPE_VALUES.end_of_early_data).toBe(5);
    expect(HANDSHAKE_TYPE_VALUES.encrypted_extensions).toBe(8);
    expect(HANDSHAKE_TYPE_VALUES.certificate).toBe(11);
    expect(HANDSHAKE_TYPE_VALUES.certificate_verify).toBe(15);
    expect(HANDSHAKE_TYPE_VALUES.finished).toBe(20);
    expect(HANDSHAKE_TYPE_VALUES.key_update).toBe(24);
  });
});

describe('the fresh 1-RTT handshake', () => {
  it('sends the messages RFC 8446 s 2 shows, in order', () => {
    expect(ids(FRESH)).toEqual([
      'client-hello',
      'ccs-client-1',
      'server-hello',
      'ccs-server',
      'encrypted-extensions',
      'certificate',
      'certificate-verify',
      'server-finished',
      'client-finished',
      'new-session-ticket',
    ]);
  });

  it('costs one round trip before application data', () => {
    expect(FRESH.roundTrips).toBe(1);
    expect(FRESH.applicationDataAt).toBeGreaterThan(0);
  });

  it('starts encrypting at EncryptedExtensions, one message after ServerHello', () => {
    expect(FRESH.encryptionStartsAt).toBe('encrypted-extensions');
  });

  it('leaves only the two Hello messages in the clear', () => {
    const clear = cleartextMessages(FRESH)
      .filter((message) => message.kind !== 'change_cipher_spec')
      .map((message) => message.id);
    expect(clear).toEqual(['client-hello', 'server-hello']);
  });

  it('encrypts the certificate, unlike TLS 1.2', () => {
    expect(find(FRESH, 'certificate').encryption).toBe('handshake');
  });

  it('orders messages by time within their flights', () => {
    const times = FRESH.messages.map((message) => message.at);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('is deterministic', () => {
    expect(buildTls13Handshake({ host: 'www.example.com', chain: CHAIN })).toEqual(FRESH);
  });
});

describe('ClientHello', () => {
  const hello = find(FRESH, 'client-hello');

  it('carries supported_versions, which is what actually selects TLS 1.3', () => {
    const versions = hello.fields.find((entry) => entry.name === 'supported_versions');
    expect(versions?.value).toContain('TLS 1.3');
    expect(versions?.explain).toContain('not legacy_version');
  });

  it('freezes legacy_version at 0x0303', () => {
    expect(hello.fields.find((entry) => entry.name === 'legacy_version')?.value).toBe(
      '0x0303',
    );
  });

  it('sends the SNI hostname in the clear, and says why it has to be', () => {
    const sni = hello.fields.find((entry) => entry.name === 'server_name (SNI)');
    expect(sni?.value).toBe('www.example.com');
    expect(sni?.visibleToObserver).toBe(true);
    expect(sni?.explain).toContain('before any key exists');
  });

  it('guesses a key share, which is what makes the handshake 1-RTT', () => {
    const share = hello.fields.find((entry) => entry.name === 'key_share');
    expect(share?.value).toContain('x25519');
    expect(share?.explain).toContain('1-RTT');
  });

  it('has every field visible to an observer', () => {
    expect(hello.fields.every((entry) => entry.visibleToObserver)).toBe(true);
  });

  it('carries no pre_shared_key or early_data on a fresh handshake', () => {
    const names = hello.fields.map((entry) => entry.name);
    expect(names).not.toContain('pre_shared_key');
    expect(names).not.toContain('early_data');
  });
});

describe('the encrypted server flight', () => {
  it('hides every EncryptedExtensions field from an observer', () => {
    expect(
      find(FRESH, 'encrypted-extensions').fields.every(
        (entry) => !entry.visibleToObserver,
      ),
    ).toBe(true);
  });

  it('leaves the certificate record length visible even though the contents are not', () => {
    const fields = find(FRESH, 'certificate').fields;
    expect(
      fields.filter((entry) => entry.visibleToObserver).map((entry) => entry.name),
    ).toEqual(['record length']);
  });

  it('signs a context string plus the transcript hash in CertificateVerify', () => {
    const signature = find(FRESH, 'certificate-verify').fields.find(
      (entry) => entry.name === 'signature',
    );
    expect(signature?.value).toContain('64 spaces');
    expect(signature?.value).toContain('TLS 1.3, server CertificateVerify');
    expect(signature?.explain).toContain('replayed as a client signature');
  });

  it('describes Finished as a MAC over the whole transcript', () => {
    const verify = find(FRESH, 'server-finished').fields[0];
    expect(verify.value).toContain('Transcript-Hash');
    expect(verify.explain).toContain('finished_key');
  });

  it('names the certificate chain the server presented', () => {
    expect(find(FRESH, 'certificate').summary).toContain('www.example.com');
    expect(find(FRESH, 'certificate').summary).toContain('Example Intermediate R3');
  });
});

describe('middlebox compatibility mode', () => {
  it('emits ChangeCipherSpec records by default and explains they mean nothing', () => {
    const ccs = find(FRESH, 'ccs-server');
    expect(ccs.optional).toBe(true);
    expect(ccs.fields[0].explain).toContain('middleboxes');
    expect(FRESH.notes.some((note) => note.id === 'middlebox-compat')).toBe(true);
  });

  it('omits them when compatibility mode is off', () => {
    const bare = buildTls13Handshake({
      host: 'www.example.com',
      chain: CHAIN,
      middleboxCompatibility: false,
    });
    expect(ids(bare).some((id) => id.startsWith('ccs-'))).toBe(false);
    expect(bare.notes.some((note) => note.id === 'middlebox-compat')).toBe(false);
  });

  it('does not change where encryption begins', () => {
    const bare = buildTls13Handshake({
      host: 'www.example.com',
      chain: CHAIN,
      middleboxCompatibility: false,
    });
    expect(bare.encryptionStartsAt).toBe(FRESH.encryptionStartsAt);
  });
});

describe('PSK resumption without early data', () => {
  const resumed = buildTls13Handshake({ host: 'www.example.com', resume: true });

  it('sends no certificate -- the PSK authenticates instead', () => {
    expect(ids(resumed)).not.toContain('certificate');
    expect(ids(resumed)).not.toContain('certificate-verify');
    expect(resumed.notes.some((note) => note.id === 'psk-no-certificate')).toBe(true);
  });

  it('still costs one round trip', () => {
    expect(resumed.roundTrips).toBe(1);
    expect(resumed.mode).toBe('psk-1rtt');
  });

  it('offers a pre_shared_key with a binder', () => {
    const psk = find(resumed, 'client-hello').fields.find(
      (entry) => entry.name === 'pre_shared_key',
    );
    expect(psk?.value).toContain('binder');
    expect(psk?.explain).toContain('last in the ClientHello');
  });

  it('warns that no certificate is re-validated on resumption', () => {
    const note = resumed.notes.find((entry) => entry.id === 'psk-no-certificate');
    expect(note?.body).toContain('revoked certificate');
  });
});

describe('0-RTT', () => {
  const zero = buildTls13Handshake({
    host: 'www.example.com',
    resume: true,
    earlyData: true,
    earlyDataPayload: 'GET / HTTP/1.1\r\nHost: www.example.com\r\n\r\n',
  });

  it('sends application data in the first flight, at zero round trips', () => {
    expect(zero.mode).toBe('psk-0rtt');
    expect(zero.roundTrips).toBe(0);
    expect(zero.applicationDataAt).toBe(0);
  });

  it('encrypts before the server has said anything', () => {
    expect(zero.encryptionStartsAt).toBe('early-data');
    expect(find(zero, 'early-data').encryption).toBe('early-data');
    expect(find(zero, 'early-data').at).toBe(0);
    expect(find(zero, 'early-data').at).toBeLessThan(find(zero, 'server-hello').at);
  });

  it('sends EndOfEarlyData under handshake keys, not early-data keys', () => {
    const end = find(zero, 'end-of-early-data');
    expect(end.encryption).toBe('handshake');
    expect(end.fields[0].explain).toContain('cannot be forged by a replayer');
  });

  it('states the replay caveat explicitly, as a warning', () => {
    const note = zero.notes.find((entry) => entry.id === 'zero-rtt-replay');
    expect(note).toBeDefined();
    expect(note?.level).toBe('warning');
    expect(note?.body).toContain('replay');
    expect(note?.body).toContain('GET, never POST');
    expect(note?.reference).toEqual({
      rfc: 8446,
      section: '8',
      title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
    });
  });

  it('states that early data alone is not forward secret', () => {
    const note = zero.notes.find((entry) => entry.id === 'zero-rtt-forward-secrecy');
    expect(note?.level).toBe('warning');
    expect(note?.body).toContain('Only the early data');
  });

  it('lets the server signal acceptance in EncryptedExtensions', () => {
    const early = find(zero, 'encrypted-extensions').fields.find(
      (entry) => entry.name === 'early_data',
    );
    expect(early?.explain).toContain('rejected');
  });

  it('leaves the early-data record length visible to an observer', () => {
    const fields = find(zero, 'early-data').fields;
    expect(fields.find((entry) => entry.name === 'content')?.visibleToObserver).toBe(
      false,
    );
    expect(
      fields.find((entry) => entry.name === 'record length')?.visibleToObserver,
    ).toBe(true);
  });
});

describe('HelloRetryRequest', () => {
  const hrr = buildTls13Handshake({
    host: 'www.example.com',
    chain: CHAIN,
    helloRetryRequest: true,
  });

  it('costs a second round trip', () => {
    expect(hrr.mode).toBe('hello-retry-request');
    expect(hrr.roundTrips).toBe(2);
    expect(hrr.notes.some((note) => note.id === 'hrr-cost')).toBe(true);
  });

  it('sends a second ClientHello after the retry', () => {
    const order = ids(hrr);
    expect(order).toContain('hello-retry-request');
    expect(order.indexOf('hello-retry-request')).toBeLessThan(
      order.indexOf('client-hello-2'),
    );
    expect(order.indexOf('client-hello-2')).toBeLessThan(order.indexOf('server-hello'));
  });

  it('marks the retry with the fixed random from RFC 8446 s 4.1.3', () => {
    const random = find(hrr, 'hello-retry-request').fields.find(
      (entry) => entry.name === 'random',
    );
    expect(random?.value).toBe(HELLO_RETRY_REQUEST_RANDOM);
    expect(HELLO_RETRY_REQUEST_RANDOM).toHaveLength(64);
  });

  it('reuses the ServerHello message type rather than inventing one', () => {
    expect(find(hrr, 'hello-retry-request').kind).toBe('server_hello');
  });
});

describe('detectDowngrade', () => {
  it('uses the ASCII "DOWNGRD" sentinels from RFC 8446 s 4.1.3', () => {
    // 44 4F 57 4E 47 52 44 = "DOWNGRD", then the version byte.
    expect(DOWNGRADE_SENTINEL_TLS12).toBe('444F574E47524401');
    expect(DOWNGRADE_SENTINEL_TLS11).toBe('444F574E47524400');
    const ascii = Buffer.from(DOWNGRADE_SENTINEL_TLS12.slice(0, 14), 'hex').toString(
      'ascii',
    );
    expect(ascii).toBe('DOWNGRD');
  });

  it('detects a stripped TLS 1.3 offer', () => {
    const check = detectDowngrade(DOWNGRADE_SENTINEL_TLS12, true, 'TLS 1.2');
    expect(check.detected).toBe(true);
    expect(check.alert).toEqual({ name: 'illegal_parameter', code: 47 });
    expect(check.detail).toContain('removed the offer');
  });

  it('detects a downgrade to TLS 1.1 or below', () => {
    expect(detectDowngrade(DOWNGRADE_SENTINEL_TLS11, true, 'TLS 1.1').detected).toBe(
      true,
    );
  });

  it('does not fire when the client never offered TLS 1.3', () => {
    const check = detectDowngrade(DOWNGRADE_SENTINEL_TLS12, false, 'TLS 1.2');
    expect(check.detected).toBe(false);
    expect(check.alert).toBeUndefined();
    expect(check.detail).toContain('informational');
  });

  it('does not fire when no sentinel is present', () => {
    expect(detectDowngrade('0011223344556677', true, 'TLS 1.3').detected).toBe(false);
  });

  it('compares case-insensitively', () => {
    expect(
      detectDowngrade(DOWNGRADE_SENTINEL_TLS12.toLowerCase(), true, 'TLS 1.2').detected,
    ).toBe(true);
  });
});

describe('groupIntoFlights', () => {
  it('groups messages travelling together in one direction', () => {
    const flights = FRESH.flights;
    expect(flights.map((flight) => flight.number)).toEqual([1, 2, 3, 4]);
    expect(flights[0].from).toBe('client');
    expect(flights[1].from).toBe('server');
    expect(flights[1].messageIds).toContain('certificate');
  });

  it('gives each flight the earliest time in it', () => {
    for (const flight of FRESH.flights) {
      const times = flight.messageIds.map((id) => find(FRESH, id).at);
      expect(flight.at).toBe(Math.min(...times));
    }
  });

  it('sorts flights numerically', () => {
    const numbers = groupIntoFlights([
      { ...find(FRESH, 'client-finished'), flight: 3 },
      { ...find(FRESH, 'client-hello'), flight: 1 },
    ]).map((flight) => flight.number);
    expect(numbers).toEqual([1, 3]);
  });
});

describe('observableFields', () => {
  it('returns only what really crosses the wire in the clear', () => {
    const fields = observableFields(FRESH);
    expect(fields.every((entry) => entry.visibleToObserver)).toBe(true);
    expect(fields.some((entry) => entry.name === 'server_name (SNI)')).toBe(true);
    expect(fields.some((entry) => entry.name === 'certificate_list')).toBe(false);
  });
});

describe('every message carries teaching material', () => {
  it('cites an RFC section and summarises itself', () => {
    for (const message of FRESH.messages) {
      expect(message.reference.rfc, message.id).toBe(8446);
      expect(message.reference.section, message.id).toBeTruthy();
      expect(message.summary.length, message.id).toBeGreaterThan(20);
      expect(message.fields.length, message.id).toBeGreaterThan(0);
    }
  });

  it('explains every field', () => {
    for (const message of FRESH.messages) {
      for (const entry of message.fields) {
        expect(entry.explain.length, `${message.id}.${entry.name}`).toBeGreaterThan(20);
      }
    }
  });
});
