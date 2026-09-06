import { describe, expect, it } from 'vitest';

import { certificate, dnsName, DAY_MS, type CertificateChain } from './certificates';
import {
  buildTls12Handshake,
  TLS12_HANDSHAKE_TYPE_VALUES,
  tradeOffs,
  VERSION_COMPARISON,
  type Tls12Handshake,
} from './handshake12';
import { buildTls13Handshake } from './handshake13';

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
  ],
};

const FULL = buildTls12Handshake({ host: 'www.example.com', chain: CHAIN });

function ids(handshake: Tls12Handshake): string[] {
  return handshake.messages.map((message) => message.id);
}

function messageAt(handshake: Tls12Handshake, id: string) {
  return handshake.messages.find((message) => message.id === id)!;
}

describe('handshake types', () => {
  it('uses the RFC 5246 s 7.4 numbers', () => {
    expect(TLS12_HANDSHAKE_TYPE_VALUES.client_hello).toBe(1);
    expect(TLS12_HANDSHAKE_TYPE_VALUES.server_key_exchange).toBe(12);
    expect(TLS12_HANDSHAKE_TYPE_VALUES.server_hello_done).toBe(14);
    expect(TLS12_HANDSHAKE_TYPE_VALUES.client_key_exchange).toBe(16);
    expect(TLS12_HANDSHAKE_TYPE_VALUES.finished).toBe(20);
  });
});

describe('the full TLS 1.2 handshake', () => {
  it('sends the messages RFC 5246 s 7.3 shows, in order', () => {
    expect(ids(FULL)).toEqual([
      'client-hello',
      'server-hello',
      'certificate',
      'server-key-exchange',
      'server-hello-done',
      'client-key-exchange',
      'ccs-client',
      'client-finished',
      'ccs-server',
      'server-finished',
    ]);
  });

  it('costs two round trips before application data', () => {
    expect(FULL.roundTrips).toBe(2);
    expect(FULL.mode).toBe('full');
  });

  it('sends the certificate in plaintext', () => {
    const certificateMessage = messageAt(FULL, 'certificate');
    expect(certificateMessage.encryption).toBe('none');
    expect(certificateMessage.fields[0].visibleToObserver).toBe(true);
    expect(FULL.notes.some((note) => note.id === 'tls12-plaintext-certificate')).toBe(
      true,
    );
  });

  it('does not start encrypting until the client Finished', () => {
    expect(FULL.encryptionStartsAt).toBe('client-finished');
  });

  it('leaves everything up to ChangeCipherSpec in the clear', () => {
    const before = FULL.messages.slice(0, ids(FULL).indexOf('ccs-client') + 1);
    expect(before.every((message) => message.encryption === 'none')).toBe(true);
  });

  it('needs ServerKeyExchange because the client could not guess the group', () => {
    const ske = messageAt(FULL, 'server-key-exchange');
    expect(ske.fields[0].explain).toContain('removes a round trip');
  });

  it('sends ServerHelloDone, which TLS 1.3 has no equivalent of', () => {
    expect(messageAt(FULL, 'server-hello-done').fields[0].explain).toContain(
      'server Finished',
    );
  });

  it('is deterministic', () => {
    expect(buildTls12Handshake({ host: 'www.example.com', chain: CHAIN })).toEqual(FULL);
  });
});

describe('ChangeCipherSpec', () => {
  it('is its own record content type, and really does switch the keys', () => {
    const ccs = messageAt(FULL, 'ccs-client');
    expect(ccs.kind).toBe('change_cipher_spec');
    expect(ccs.fields[0].explain).toContain('own record content type (20)');
    expect(FULL.notes.some((note) => note.id === 'tls12-change-cipher-spec')).toBe(true);
  });

  it('marks the exact moment encryption begins', () => {
    const ccsIndex = ids(FULL).indexOf('ccs-client');
    const firstEncrypted = FULL.messages.findIndex(
      (message) => message.encryption !== 'none',
    );
    expect(firstEncrypted).toBe(ccsIndex + 1);
  });
});

describe('the abbreviated handshake', () => {
  const resumed = buildTls12Handshake({ host: 'www.example.com', resume: true });

  it('skips the certificate and the key exchange entirely', () => {
    expect(ids(resumed)).toEqual([
      'client-hello',
      'server-hello',
      'ccs-server',
      'server-finished',
      'ccs-client',
      'client-finished',
    ]);
  });

  it('costs one round trip -- the same as a fresh TLS 1.3 handshake', () => {
    expect(resumed.roundTrips).toBe(1);
    expect(
      buildTls13Handshake({ host: 'www.example.com', chain: CHAIN }).roundTrips,
    ).toBe(1);
    expect(resumed.notes.some((note) => note.id === 'tls12-abbreviated')).toBe(true);
  });

  it('notes that nothing is re-validated on resumption', () => {
    const note = resumed.notes.find((entry) => entry.id === 'tls12-abbreviated');
    expect(note?.body).toContain('revoked since the original handshake keeps working');
  });

  it('offers a session id by default and a ticket when asked', () => {
    const idField = messageAt(resumed, 'client-hello').fields.find(
      (entry) => entry.name === 'session_id',
    );
    expect(idField?.value).not.toBe('(empty)');

    const ticketed = buildTls12Handshake({
      host: 'www.example.com',
      resume: true,
      useSessionTicket: true,
    });
    expect(
      messageAt(ticketed, 'client-hello').fields.some(
        (entry) => entry.name === 'SessionTicket',
      ),
    ).toBe(true);
  });
});

describe('session tickets on a full handshake', () => {
  const ticketed = buildTls12Handshake({
    host: 'www.example.com',
    chain: CHAIN,
    useSessionTicket: true,
  });

  it('sends NewSessionTicket before ChangeCipherSpec, so it crosses in the clear', () => {
    const ticket = messageAt(ticketed, 'new-session-ticket');
    expect(ticket.encryption).toBe('none');
    expect(ticket.fields[0].visibleToObserver).toBe(true);
    expect(ticket.fields[0].explain).toContain('under application keys');
  });
});

describe('static RSA key exchange', () => {
  const staticRsa = buildTls12Handshake({
    host: 'www.example.com',
    chain: CHAIN,
    suite: 'TLS_RSA_WITH_AES_128_GCM_SHA256',
  });

  it('sends no ServerKeyExchange -- there is no ephemeral value', () => {
    expect(ids(staticRsa)).not.toContain('server-key-exchange');
    expect(staticRsa.group).toBeUndefined();
  });

  it('sends the premaster secret encrypted to the certificate key', () => {
    const cke = messageAt(staticRsa, 'client-key-exchange');
    expect(cke.fields[0].name).toBe('encrypted_pre_master_secret');
    expect(cke.fields[0].explain).toContain('no forward secrecy');
  });

  it('warns about the lack of forward secrecy', () => {
    const note = staticRsa.notes.find((entry) => entry.id === 'tls12-no-forward-secrecy');
    expect(note?.level).toBe('warning');
    expect(note?.body).toContain('Heartbleed');
  });

  it('does not warn for an ECDHE suite', () => {
    expect(FULL.notes.some((note) => note.id === 'tls12-no-forward-secrecy')).toBe(false);
  });
});

describe('client certificates', () => {
  it('adds CertificateRequest only when asked, and marks it optional', () => {
    expect(ids(FULL)).not.toContain('certificate-request');
    const mutual = buildTls12Handshake({
      host: 'www.example.com',
      chain: CHAIN,
      requestClientCertificate: true,
    });
    const request = messageAt(mutual, 'certificate-request');
    expect(request.optional).toBe(true);
    expect(request.fields[0].explain).toContain('privacy leak');
  });
});

describe('the 1.2-versus-1.3 comparison', () => {
  it('leads with the round-trip and encryption-start rows', () => {
    expect(VERSION_COMPARISON[0].aspect).toContain('Round trips');
    expect(VERSION_COMPARISON[1].aspect).toContain('Where encryption begins');
  });

  it('cites a source for every row', () => {
    for (const row of VERSION_COMPARISON) {
      expect(row.reference.rfc, row.aspect).toBeGreaterThan(0);
      expect(row.tls12.length, row.aspect).toBeGreaterThan(0);
      expect(row.tls13.length, row.aspect).toBeGreaterThan(0);
    }
  });

  it('is honest that 0-RTT replay is a regression, not an improvement', () => {
    const rows = tradeOffs();
    expect(rows).toHaveLength(1);
    expect(rows[0].aspect).toContain('Replay');
    expect(rows[0].tls12).toContain('None');
  });

  it('matches what the two builders actually produce', () => {
    const thirteen = buildTls13Handshake({ host: 'www.example.com', chain: CHAIN });
    expect(FULL.roundTrips).toBe(2);
    expect(thirteen.roundTrips).toBe(1);
    expect(FULL.roundTrips).toBeGreaterThan(thirteen.roundTrips);

    // The certificate is in the clear in 1.2 and encrypted in 1.3 -- the row is not just
    // prose, it is what the models do.
    expect(messageAt(FULL, 'certificate').encryption).toBe('none');
    expect(
      thirteen.messages.find((message) => message.id === 'certificate')?.encryption,
    ).toBe('handshake');
  });

  it('shows TLS 1.3 finishing sooner on the same link', () => {
    const thirteen = buildTls13Handshake({ host: 'www.example.com', chain: CHAIN });
    expect(thirteen.applicationDataAt).toBeLessThan(FULL.applicationDataAt);
  });
});

describe('every message carries teaching material', () => {
  it('cites a source and summarises itself', () => {
    for (const message of FULL.messages) {
      expect(message.reference.rfc, message.id).toBeGreaterThan(0);
      expect(message.summary.length, message.id).toBeGreaterThan(20);
      expect(message.fields.length, message.id).toBeGreaterThan(0);
    }
  });

  it('explains every field', () => {
    for (const message of FULL.messages) {
      for (const entry of message.fields) {
        expect(entry.explain.length, `${message.id}.${entry.name}`).toBeGreaterThan(20);
      }
    }
  });
});
