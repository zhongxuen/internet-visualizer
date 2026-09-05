import { describe, expect, it } from 'vitest';

import { getCipherSuite, type CipherSuite } from './cipher';
import {
  buildKeySchedule,
  buildTls12KeySchedule,
  dheExchange,
  getGroup,
  knowledgeOf,
  NAMED_GROUPS,
  observerLosesTrackAt,
  PLACEHOLDER_NOTICE,
  secretByName,
  TOY_CLIENT_PRIVATE,
  TOY_DH_GROUP,
  TOY_SERVER_PRIVATE,
  toyDhIllustration,
  toySide,
  trafficKeysFrom,
} from './keyschedule';
import { PLACEHOLDER_PREFIX } from './placeholder';

const SUITE = getCipherSuite('TLS_AES_128_GCM_SHA256') as CipherSuite;
const SHA384 = getCipherSuite('TLS_AES_256_GCM_SHA384') as CipherSuite;

describe('the toy Diffie-Hellman illustration', () => {
  const toy = toyDhIllustration();

  it('has both sides arrive at the same number', () => {
    expect(toy.clientComputes).toBe(toy.serverComputes);
    expect(toy.agree).toBe(true);
  });

  it('computes the public values correctly', () => {
    // 5^6 mod 23 = 8, and 5^15 mod 23 = 19. Checkable by hand, which is the point.
    expect(toySide(TOY_CLIENT_PRIVATE).publicValue).toBe(8);
    expect(toySide(TOY_SERVER_PRIVATE).publicValue).toBe(19);
  });

  it('agrees for every pair of exponents, because (g^a)^b = (g^b)^a', () => {
    for (let a = 1; a < TOY_DH_GROUP.p; a += 1) {
      for (let b = 1; b < TOY_DH_GROUP.p; b += 1) {
        const run = toyDhIllustration(a, b);
        expect(run.clientComputes).toBe(run.serverComputes);
      }
    }
  });

  it('states plainly that it is not secure', () => {
    expect(toy.caveat).toContain('by hand');
    expect(toy.caveat).toContain('not because it protects anything');
    expect(TOY_DH_GROUP.p).toBeLessThan(256);
  });

  it('reveals the arithmetic one line at a time', () => {
    expect(toy.lines).toHaveLength(6);
    expect(toy.lines[toy.lines.length - 1]).toContain('neither exponent');
  });
});

describe('dheExchange', () => {
  const exchange = dheExchange('x25519', 'test');

  it('sends both public shares and keeps the secret unsent', () => {
    expect(exchange.clientShare).toContain('public');
    expect(exchange.serverShare).toContain('public');
    expect(exchange.observerHolds.join(' ')).toContain('clear');
  });

  it('tells the observer what it holds and why that is not enough', () => {
    expect(exchange.observerHolds).toHaveLength(3);
    expect(exchange.whyObserverFails).toContain('Diffie-Hellman problem');
  });

  it('is deterministic, and distinct per connection label', () => {
    expect(dheExchange('x25519', 'a')).toEqual(dheExchange('x25519', 'a'));
    expect(dheExchange('x25519', 'a').sharedSecret).not.toBe(
      dheExchange('x25519', 'b').sharedSecret,
    );
  });

  it('carries the right share size for the group', () => {
    expect(dheExchange('x25519', 'x').group.shareBytes).toBe(32);
    expect(dheExchange('ffdhe2048', 'x').group.shareBytes).toBe(256);
  });
});

describe('NAMED_GROUPS', () => {
  it('leads with X25519, which is what clients guess', () => {
    expect(NAMED_GROUPS[0].name).toBe('x25519');
  });

  it('shows the size argument for elliptic curves', () => {
    expect(getGroup('ffdhe2048').shareBytes).toBeGreaterThan(
      getGroup('x25519').shareBytes * 4,
    );
  });
});

describe('buildKeySchedule -- a full 1-RTT handshake', () => {
  const schedule = buildKeySchedule({ suite: SUITE, group: 'x25519', label: 'fresh' });

  it('runs the three extraction stages in RFC 8446 s 7.1 order', () => {
    const ids = schedule.steps.map((step) => step.id);
    expect(ids.indexOf('early-secret')).toBeLessThan(ids.indexOf('handshake-secret'));
    expect(ids.indexOf('handshake-secret')).toBeLessThan(ids.indexOf('master-secret'));
  });

  it('derives every secret RFC 8446 s 7.1 names', () => {
    for (const name of [
      'Early Secret',
      'Handshake Secret',
      'Master Secret',
      'client_handshake_traffic_secret',
      'server_handshake_traffic_secret',
      'client_application_traffic_secret_0',
      'server_application_traffic_secret_0',
      'exporter_master_secret',
      'resumption_master_secret',
    ]) {
      expect(secretByName(schedule, name), name).toBeDefined();
    }
  });

  it('uses the RFC label strings', () => {
    expect(secretByName(schedule, 'client_handshake_traffic_secret')?.label).toBe(
      'c hs traffic',
    );
    expect(secretByName(schedule, 'server_application_traffic_secret_0')?.label).toBe(
      's ap traffic',
    );
    expect(secretByName(schedule, 'resumption_master_secret')?.label).toBe('res master');
  });

  it('binds each secret to the transcript RFC 8446 s 7.1 specifies', () => {
    expect(secretByName(schedule, 'client_handshake_traffic_secret')?.transcript).toBe(
      'ClientHello..ServerHello',
    );
    expect(
      secretByName(schedule, 'client_application_traffic_secret_0')?.transcript,
    ).toBe('ClientHello..server Finished');
    // The resumption secret alone runs through the *client* Finished.
    expect(secretByName(schedule, 'resumption_master_secret')?.transcript).toBe(
      'ClientHello..client Finished',
    );
  });

  it('widens every secret to the negotiated hash', () => {
    expect(schedule.secrets.every((entry) => entry.bytes === 32)).toBe(true);
    const wide = buildKeySchedule({ suite: SHA384, group: 'x25519' });
    expect(wide.secrets.every((entry) => entry.bytes === 48)).toBe(true);
  });

  it('has no PSK and no early data', () => {
    expect(schedule.usedPsk).toBe(false);
    expect(schedule.usedEarlyData).toBe(false);
    expect(schedule.steps.some((step) => step.id === 'early-traffic')).toBe(false);
  });

  it('includes the key exchange step when a group is supplied', () => {
    expect(schedule.exchange).toBeDefined();
    expect(schedule.steps.some((step) => step.id === 'dhe')).toBe(true);
  });

  it('is deterministic', () => {
    expect(buildKeySchedule({ suite: SUITE, group: 'x25519', label: 'fresh' })).toEqual(
      schedule,
    );
  });
});

describe('the observer column', () => {
  const schedule = buildKeySchedule({ suite: SUITE, group: 'x25519' });

  it('is never empty -- an eavesdropper always knows something', () => {
    for (const step of schedule.steps) {
      expect(knowledgeOf(step, 'observer').length, step.id).toBeGreaterThan(0);
    }
  });

  it('loses the thread at the Handshake Secret, one flight into the conversation', () => {
    expect(observerLosesTrackAt(schedule)?.id).toBe('handshake-secret');
  });

  it('still knows the SNI hostname and both key shares after encryption starts', () => {
    const step = schedule.steps.find((entry) => entry.id === 'handshake-traffic');
    expect(step?.observerKnows.join(' ')).toContain('SNI hostname');
  });

  it('is honest that timing and sizes survive into the application phase', () => {
    const step = schedule.steps.find((entry) => entry.id === 'application-traffic');
    expect(step?.observerKnows.join(' ')).toContain(
      'How much, in which direction, and when',
    );
  });

  it('gives the client and server the same secrets at each derivation step', () => {
    for (const step of schedule.steps) {
      if (!step.output) continue;
      const client = knowledgeOf(step, 'client').join(' ');
      const server = knowledgeOf(step, 'server').join(' ');
      expect(client.length, step.id).toBeGreaterThan(0);
      expect(server.length, step.id).toBeGreaterThan(0);
    }
  });
});

describe('buildKeySchedule -- resumption and 0-RTT', () => {
  const resumed = buildKeySchedule({
    suite: SUITE,
    group: 'x25519',
    psk: true,
    label: 'psk',
  });
  const zeroRtt = buildKeySchedule({
    suite: SUITE,
    group: 'x25519',
    psk: true,
    earlyData: true,
    label: '0rtt',
  });

  it('seeds the Early Secret from the PSK when resuming', () => {
    expect(resumed.usedPsk).toBe(true);
    const step = resumed.steps.find((entry) => entry.id === 'early-secret');
    expect(step?.explain).toContain('pre-shared key');
    expect(step?.clientKnows.join(' ')).toContain('PSK');
  });

  it('adds client_early_traffic_secret only when early data is sent', () => {
    expect(resumed.steps.some((step) => step.id === 'early-traffic')).toBe(false);
    expect(zeroRtt.steps.some((step) => step.id === 'early-traffic')).toBe(true);
    expect(secretByName(zeroRtt, 'client_early_traffic_secret')?.label).toBe(
      'c e traffic',
    );
  });

  it('states the replay caveat at the step that creates the risk', () => {
    const step = zeroRtt.steps.find((entry) => entry.id === 'early-traffic');
    expect(step?.explain).toContain('replay');
    expect(step?.observerKnows.join(' ')).toContain('twice');
  });

  it('still runs a fresh key exchange, so everything after early data is forward secret', () => {
    expect(zeroRtt.exchange).toBeDefined();
    expect(zeroRtt.steps.some((step) => step.id === 'dhe')).toBe(true);
  });

  it('warns that a PSK-only resumption has no forward secrecy', () => {
    const pskOnly = buildKeySchedule({ suite: SUITE, psk: true });
    expect(pskOnly.exchange).toBeUndefined();
    const step = pskOnly.steps.find((entry) => entry.id === 'handshake-secret');
    expect(step?.explain).toContain('no forward secrecy');
    expect(step?.observerKnows.join(' ')).toContain('retroactively');
  });
});

describe('trafficKeysFrom', () => {
  it('expands a key and an IV at the suite widths', () => {
    const secret = secretByName(
      buildKeySchedule({ suite: SUITE, group: 'x25519' }),
      'client_application_traffic_secret_0',
    );
    const keys = trafficKeysFrom(secret!, SUITE, 'client');
    expect(keys.keyBytes).toBe(16);
    expect(keys.ivBytes).toBe(12);
    expect(keys.whoWrites).toBe('client');
  });

  it('produces a wider key for a 256-bit suite', () => {
    const secret = secretByName(
      buildKeySchedule({ suite: SHA384, group: 'x25519' }),
      'server_application_traffic_secret_0',
    );
    expect(trafficKeysFrom(secret!, SHA384, 'server').keyBytes).toBe(32);
  });
});

describe('buildTls12KeySchedule', () => {
  const ecdhe = buildTls12KeySchedule(
    getCipherSuite('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256') as CipherSuite,
  );
  const staticRsa = buildTls12KeySchedule(
    getCipherSuite('TLS_RSA_WITH_AES_128_GCM_SHA256') as CipherSuite,
  );

  it('produces a 48-byte master secret whatever the hash', () => {
    expect(secretByName(ecdhe, 'master_secret')?.bytes).toBe(48);
  });

  it('records that the master secret is not bound to the transcript', () => {
    const master = secretByName(ecdhe, 'master_secret');
    expect(master?.transcript).toContain('NOT the transcript');
    expect(master?.purpose).toContain('extended_master_secret');
  });

  it('loses the thread only at the key block -- a round trip later than TLS 1.3', () => {
    expect(observerLosesTrackAt(ecdhe)?.id).toBe('tls12-key-block');
  });

  it('shows the observer reading the certificate in plaintext', () => {
    const step = ecdhe.steps.find((entry) => entry.id === 'tls12-key-block');
    expect(step?.observerKnows.join(' ')).toContain('plaintext');
  });

  it('describes static RSA as key transport with no ephemeral value', () => {
    const premaster = secretByName(staticRsa, 'pre_master_secret');
    expect(premaster?.derivation).toContain('RSA-encrypt');
    expect(premaster?.purpose).toContain('decrypts every recorded session');
  });

  it('tells the observer that a recorded static-RSA session becomes readable later', () => {
    const step = staticRsa.steps.find((entry) => entry.id === 'tls12-premaster');
    expect(step?.observerKnows.join(' ')).toContain('server private key leaks');
  });

  it('is deterministic', () => {
    expect(
      buildTls12KeySchedule(
        getCipherSuite('TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256') as CipherSuite,
      ),
    ).toEqual(ecdhe);
  });
});

describe('the placeholder discipline', () => {
  it('labels every secret so it cannot be mistaken for a real key', () => {
    const schedule = buildKeySchedule({ suite: SUITE, group: 'x25519' });
    for (const entry of schedule.secrets) {
      expect(entry.value, entry.name).toContain(PLACEHOLDER_PREFIX);
    }
  });

  it('carries the not-real-crypto notice on every schedule', () => {
    expect(buildKeySchedule({ suite: SUITE }).notice).toBe(PLACEHOLDER_NOTICE);
    expect(buildTls12KeySchedule(SUITE).notice).toBe(PLACEHOLDER_NOTICE);
    expect(PLACEHOLDER_NOTICE).toContain('Not real cryptography');
  });

  it('labels the public key shares differently from the secrets', () => {
    const exchange = dheExchange('x25519', 'label-check');
    expect(exchange.clientShare).toContain('public');
    expect(exchange.sharedSecret).not.toContain('public');
  });
});
