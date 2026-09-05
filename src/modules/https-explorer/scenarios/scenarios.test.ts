/**
 * The seven scenarios, and the properties they must all hold.
 *
 * The determinism test is the one everything else rests on. A run that came out slightly
 * different each time could not be linked to, screenshotted, diffed, or described in a
 * sentence a second reader would recognise -- and a TLS run has an obvious place for that
 * to go wrong quietly, since certificate validity is judged against a wall-clock instant.
 * If that instant were ever read from the machine rather than written down, `cert-expired`
 * would drift from teaching one failure to teaching none. So every scenario is run twice
 * and then ten times, and compared whole.
 *
 * The rest divides in two. First the properties every scenario shares: a coherent
 * topology, phases that tile the timeline, causally ordered events, a citation on every
 * note that makes a claim, and not one address that could belong to a real host. Then one
 * section per scenario for the specific thing it exists to teach -- because a suite that
 * only checked the shared invariants would pass just as happily on seven copies of the
 * same handshake.
 *
 * Two of those specific claims are the ones the phase doc singles out, and they are
 * asserted rather than trusted:
 *
 * - each `cert-*` scenario breaks **exactly one** of the five validation steps, and the
 *   three of them between them break three different ones;
 * - `tls13-resumption` states the 0-RTT replay caveat explicitly, naming replay and citing
 *   RFC 8446 s 8.
 */

import { describe, expect, it } from 'vitest';

import { classifyIp, ip } from '@/core/net/address';
import type { SimEvent } from '@/core/types/events';

import type { ValidationStepId } from '../sim/certificates';
import { decomposeSuite } from '../sim/cipher';
import {
  CLIENT_NODE,
  OBSERVER_NODE,
  SERVER_NODE,
  encryptionBeginsAt,
  readableRecords,
  runTlsScenario,
  stillVisibleFacts,
  type TlsRun,
  type TlsScenario,
} from '../sim/connection';
import { isProtected } from '../sim/records';

import {
  CERTIFICATE_FAILURE_SCENARIOS,
  CERT_EXPIRED,
  CERT_HOSTNAME_MISMATCH,
  CERT_UNTRUSTED_CA,
  DEFAULT_TLS_SCENARIO_ID,
  DOWNGRADE_BLOCKED,
  TLS12_FRESH,
  TLS13_FRESH,
  TLS13_RESUMPTION,
  TLS_SCENARIOS,
  getTlsScenario,
} from './index';

const CASES = TLS_SCENARIOS.map((scenario) => [scenario.id, scenario] as const);

/**
 * Documents no annotation may cite.
 *
 * RFC 2616 and the 723x series were superseded by 911x, and RFC 6125 by RFC 9525. Citing
 * a withdrawn document is worse than citing none: a learner who follows the link reads
 * rules that no longer hold, and the CN-fallback rule this module deliberately does not
 * implement is exactly one of them.
 */
const OBSOLETE_RFCS = [2616, 6125, 7230, 7231, 7232, 7233, 7234, 7235];

/** An opaque payload, rendered as hex byte pairs. Never the plaintext it stands in for. */
const OPAQUE_HEX = /^([0-9a-f]{2} )+[0-9a-f]{2}( \.\.\. \(\d+ bytes\))?$/;

function eventsOfKind<K extends SimEvent['kind']>(
  run: TlsRun,
  kind: K,
): Extract<SimEvent, { kind: K }>[] {
  return run.result.events.filter(
    (event): event is Extract<SimEvent, { kind: K }> => event.kind === kind,
  );
}

/** Every annotation's text, joined, for "does this run say the thing" assertions. */
function annotationText(run: TlsRun): string {
  return eventsOfKind(run, 'annotate')
    .map((event) => event.text)
    .join('\n');
}

/** The record labelled with this handshake message id, if it happened at all. */
function recordFor(run: TlsRun, messageId: string) {
  return run.wire.find((entry) => entry.record.id === `rec-${messageId}`);
}

// ---------------------------------------------------------------------------
// Determinism -- the property everything else depends on
// ---------------------------------------------------------------------------

describe.each(CASES)('%s is deterministic', (_id, scenario: TlsScenario) => {
  it('produces a deep-equal run the second time', () => {
    expect(runTlsScenario(scenario)).toEqual(runTlsScenario(scenario));
  });

  it('produces the same run ten times', () => {
    const first = runTlsScenario(scenario);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(runTlsScenario(scenario)).toEqual(first);
    }
  });

  it('does not depend on the wall clock', () => {
    // The only wall-clock instant in the module is `validateAt`, and it is a written-down
    // constant. If anything ever reached for `Date.now()`, the placeholder values and the
    // validity verdicts would be the first things to drift.
    const before = runTlsScenario(scenario);
    const after = runTlsScenario({ ...scenario });
    expect(after.result).toEqual(before.result);
    expect(after.validation).toEqual(before.validation);
  });
});

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

describe('the catalogue', () => {
  it('offers the seven scenarios the phase doc asks for', () => {
    expect(TLS_SCENARIOS).toHaveLength(7);
    expect(TLS_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'tls13-fresh',
      'tls13-resumption',
      'tls12-fresh',
      'cert-expired',
      'cert-hostname-mismatch',
      'cert-untrusted-ca',
      'downgrade-blocked',
    ]);
  });

  it('has a unique id, a title, a summary, and something to teach for each', () => {
    const ids = new Set(TLS_SCENARIOS.map((scenario) => scenario.id));
    expect(ids.size).toBe(TLS_SCENARIOS.length);

    for (const scenario of TLS_SCENARIOS) {
      expect(scenario.title.length).toBeGreaterThan(0);
      expect(scenario.summary.length).toBeGreaterThan(40);
      expect(scenario.teaches.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('resolves ids, and only its own', () => {
    for (const scenario of TLS_SCENARIOS) {
      expect(getTlsScenario(scenario.id)).toBe(scenario);
    }
    expect(getTlsScenario('tls11-fresh')).toBeUndefined();
    expect(getTlsScenario(DEFAULT_TLS_SCENARIO_ID)).toBe(TLS13_FRESH);
  });
});

// ---------------------------------------------------------------------------
// Properties every run holds
// ---------------------------------------------------------------------------

describe.each(CASES)('%s holds the shared invariants', (_id, scenario: TlsScenario) => {
  const run = runTlsScenario(scenario);

  it('draws a coherent topology: client, on-path observer, server', () => {
    const ids = run.topology.nodes.map((node) => node.id);
    expect(ids).toEqual([CLIENT_NODE, OBSERVER_NODE, SERVER_NODE]);
    expect(new Set(ids).size).toBe(ids.length);

    for (const link of run.topology.links) {
      expect(ids).toContain(link.from);
      expect(ids).toContain(link.to);
      expect(link.latencyMs).toBeGreaterThan(0);
    }
  });

  it('uses only addresses reserved for documentation', () => {
    // Nothing here is ever contacted, and the addresses are chosen so that this would
    // still be true if something one day tried.
    for (const node of run.topology.nodes) {
      if (node.ipv4) expect(classifyIp(ip(node.ipv4))).toBe('documentation');
      if (node.ipv6) expect(classifyIp(ip(node.ipv6))).toBe('documentation');
    }
  });

  it('emits events in non-decreasing time, all within the run', () => {
    let previous = -Infinity;
    for (const event of run.result.events) {
      expect(event.at).toBeGreaterThanOrEqual(previous);
      expect(event.at).toBeLessThanOrEqual(run.result.durationMs);
      previous = event.at;
    }
  });

  it('tiles the timeline with phases that have somewhere to live', () => {
    const { phases, durationMs } = run.result;
    expect(phases.length).toBeGreaterThanOrEqual(3);
    expect(phases[0].startMs).toBe(0);

    for (const [index, phase] of phases.entries()) {
      expect(phase.endMs).toBeGreaterThan(phase.startMs);
      expect(phase.description.length).toBeGreaterThan(20);
      const next = phases[index + 1];
      if (next) expect(phase.endMs).toBe(next.startMs);
      else expect(phase.endMs).toBe(durationMs);
    }
  });

  it('files every record under the chapter that was current when it was sent', () => {
    const phases = new Map(run.result.phases.map((phase) => [phase.id, phase]));
    for (const entry of run.wire) {
      const phase = phases.get(entry.phase);
      expect(phase).toBeDefined();
      expect(entry.at).toBeGreaterThanOrEqual(phase?.startMs ?? Infinity);
      expect(entry.at).toBeLessThan(phase?.endMs ?? -Infinity);
    }
  });

  it('checks the certificate before answering, never after', () => {
    // The client must have validated the chain before it sends anything of its own that
    // depends on trusting it -- its Finished, its key share, or a request.
    const validated = run.result.phases.find(
      (phase) => phase.id === 'certificate-validation',
    );
    if (!validated) return;

    const later = run.wire.filter(
      (entry) => entry.record.from === 'client' && entry.at > validated.startMs,
    );
    const earlier = run.wire.filter(
      (entry) => entry.record.from === 'client' && entry.at <= validated.startMs,
    );
    // Everything the client sent before validating was part of opening the connection.
    for (const entry of earlier) {
      expect(entry.message).toBeDefined();
      expect(entry.message?.flight).toBe(1);
    }
    expect(later.length).toBeGreaterThan(0);
  });

  it('never animates a packet it has not introduced', () => {
    const created = new Map<string, number>();
    for (const event of run.result.events) {
      if (event.kind === 'pdu-created') created.set(event.pdu.id, event.at);
      if (event.kind === 'transmit') {
        expect(created.has(event.pduId)).toBe(true);
        expect(run.result.pdus[event.pduId]).toBeDefined();
      }
    }
    expect(created.size).toBe(Object.keys(run.result.pdus).length);
  });

  it('routes every transmission across a link that connects its two ends', () => {
    const links = new Map(run.topology.links.map((link) => [link.id, link]));
    for (const event of eventsOfKind(run, 'transmit')) {
      const link = links.get(event.linkId);
      expect(link).toBeDefined();
      expect([link?.from, link?.to]).toContain(event.from);
      expect([link?.from, link?.to]).toContain(event.to);
    }
  });

  it('sends every record past the observer, in both halves of the path', () => {
    // The observer is not a decoration: it is on the path, so every record crosses it.
    const transmits = eventsOfKind(run, 'transmit');
    expect(transmits).toHaveLength(run.wire.length * 2);
    for (const event of transmits) {
      expect([event.from, event.to]).toContain(OBSERVER_NODE);
    }
  });

  it('pins every annotation to something that exists', () => {
    const targets = new Set([
      ...run.topology.nodes.map((node) => node.id),
      ...run.topology.links.map((link) => link.id),
      ...Object.keys(run.result.pdus),
    ]);
    const annotations = eventsOfKind(run, 'annotate');
    expect(annotations.length).toBeGreaterThan(5);
    for (const event of annotations) {
      expect(targets).toContain(event.targetId);
      expect(event.text.length).toBeGreaterThan(30);
    }
  });

  it('cites a real document wherever it cites one at all', () => {
    for (const event of eventsOfKind(run, 'annotate')) {
      if (!event.reference) continue;
      expect(event.reference.rfc).toBeGreaterThan(0);
      expect(event.reference.title.length).toBeGreaterThan(0);
      expect(OBSOLETE_RFCS).not.toContain(event.reference.rfc);
    }
  });

  it('cites RFC 8446 by section wherever TLS 1.3 is the claim', () => {
    const tls13 = eventsOfKind(run, 'annotate').filter(
      (event) => event.reference?.rfc === 8446,
    );
    expect(tls13.length).toBeGreaterThan(0);
    for (const event of tls13) {
      expect(event.reference?.section).toBeTruthy();
    }
  });

  it('gives every scenario note a citation', () => {
    for (const note of scenario.notes ?? []) {
      expect(note.reference).toBeDefined();
      expect(note.reference?.section).toBeTruthy();
    }
  });

  it('wraps the whole conversation in records, and counts the wire honestly', () => {
    expect(run.wire.length).toBeGreaterThan(0);
    expect(run.observed).toHaveLength(run.wire.length);
    expect(run.wireBytes).toBe(
      run.wire.reduce((sum, entry) => sum + entry.record.totalBytes, 0),
    );

    for (const entry of run.wire) {
      // Framing is never free, and a protected record is longer than what it carries.
      expect(entry.record.totalBytes).toBeGreaterThan(entry.record.plaintextBytes);
    }
  });

  it('shows an observer the lengths and never the contents of a protected record', () => {
    for (const [index, view] of run.observed.entries()) {
      const record = run.wire[index].record;
      expect(view.length).toBe(record.length);
      if (isProtected(record.protection)) {
        expect(view.plaintext).toBeUndefined();
        expect(view.payload).toMatch(OPAQUE_HEX);
        if (record.plaintext) expect(view.payload).not.toContain(record.plaintext);
      }
    }
  });

  it('tells an observer the destination, the hostname, the timing, and the sizes', () => {
    // The honest half of the overlay. A learner who comes away thinking HTTPS makes them
    // anonymous has learned something worse than nothing.
    const visible = stillVisibleFacts(run).map((fact) => fact.label);
    expect(visible).toContain('Destination IP address');
    expect(visible).toContain('Hostname (SNI)');
    expect(visible).toContain('Timing and traffic pattern');
    expect(visible).toContain('Sizes');

    const hidden = run.observerFacts.filter((fact) => !fact.visible);
    expect(hidden.map((fact) => fact.label)).toContain(
      'URL path, headers, cookies, and body',
    );
  });
});

// ---------------------------------------------------------------------------
// 1 -- tls13-fresh
// ---------------------------------------------------------------------------

describe('tls13-fresh', () => {
  const run = runTlsScenario(TLS13_FRESH);

  it('puts exactly two handshake messages in the clear', () => {
    const readable = readableRecords(run).filter(
      (entry) => entry.message && entry.message.kind !== 'change_cipher_spec',
    );
    expect(readable.map((entry) => entry.message?.id)).toEqual([
      'client-hello',
      'server-hello',
    ]);
  });

  it('starts encrypting on the record after ServerHello', () => {
    const first = encryptionBeginsAt(run);
    expect(first?.record.id).toBe('rec-encrypted-extensions');
    expect(first?.record.protection).toBe('handshake');

    const serverHello = recordFor(run, 'server-hello');
    expect(serverHello?.at).toBeLessThanOrEqual(first?.at ?? Infinity);
  });

  it('hides the certificate from the path', () => {
    const certificate = recordFor(run, 'certificate');
    expect(certificate?.record.protection).toBe('handshake');
    expect(certificate?.record.outerType).toBe('application_data');
    expect(certificate?.record.plaintext).toBeUndefined();

    const facts = run.observerFacts;
    expect(
      facts.find((fact) => fact.label === 'Server certificate and identity')?.visible,
    ).toBe(false);
    expect(
      facts.find((fact) => fact.label === 'ALPN protocol (h2 / http/1.1)')?.visible,
    ).toBe(false);
  });

  it('passes all five certificate checks', () => {
    expect(run.validation?.trusted).toBe(true);
    expect(run.validation?.steps).toHaveLength(5);
    expect(run.validation?.failures).toHaveLength(0);
    expect(run.validation?.anchor?.id).toBe('root');
    expect(run.abort).toBeUndefined();
  });

  it('costs one round trip and carries the exchange it was opened for', () => {
    expect(run.handshake.roundTrips).toBe(1);
    expect(run.requestRecords.length).toBeGreaterThan(0);
    expect(run.responseRecords.length).toBeGreaterThan(0);
    expect(run.requestRecords[0].plaintext).toContain('GET /account/orders');
    expect(run.responseRecords[0].plaintext).toContain('200 OK');
  });
});

// ---------------------------------------------------------------------------
// 2 -- tls13-resumption, and the caveat that has to travel with it
// ---------------------------------------------------------------------------

describe('tls13-resumption', () => {
  const run = runTlsScenario(TLS13_RESUMPTION);

  it('states the 0-RTT replay caveat explicitly, citing RFC 8446 s 8', () => {
    // The phase doc is emphatic about this one: omitting it teaches something dangerous.
    const replay = eventsOfKind(run, 'annotate').filter((event) =>
      /replay/i.test(event.text),
    );
    expect(replay.length).toBeGreaterThan(0);

    const cited = replay.filter(
      (event) => event.reference?.rfc === 8446 && event.reference.section === '8',
    );
    expect(cited.length).toBeGreaterThan(0);

    const text = cited.map((event) => event.text).join('\n');
    expect(text).toMatch(/record/i);
    expect(text).toMatch(/again|second time|more than once/i);
  });

  it('says early data is not forward secret, which is the other caveat', () => {
    expect(annotationText(run)).toMatch(/not forward secret/i);
  });

  it('only puts a request in early data that is safe to run twice', () => {
    expect(TLS13_RESUMPTION.request.startsWith('GET ')).toBe(true);
    expect(TLS13_RESUMPTION.request).not.toMatch(/^POST /);
  });

  it('sends the request in the first flight, under early-data keys', () => {
    const early = recordFor(run, 'early-data');
    expect(early).toBeDefined();
    expect(early?.at).toBe(0);
    expect(early?.record.protection).toBe('early-data');
    expect(early?.record.innerType).toBe('application_data');
    expect(early?.record.plaintext).toContain('GET /account/orders');
    expect(run.requestRecords).toContain(early?.record);
  });

  it('presents no certificate at all, and so validates none', () => {
    expect(run.messages.some((message) => message.kind === 'certificate')).toBe(false);
    expect(run.validation).toBeUndefined();
    expect(run.result.phases.map((phase) => phase.id)).not.toContain(
      'certificate-validation',
    );
  });

  it('costs no round trip before the request goes out', () => {
    expect(run.handshake.roundTrips).toBe(0);
    expect(run.handshake.applicationDataAt).toBe(0);
    // And the server answers before the client has finished its own half.
    const response = run.wire.find((entry) => entry.record.id.startsWith('resp-'));
    const clientFinished = recordFor(run, 'client-finished');
    expect(response?.at).toBeLessThan(clientFinished?.at ?? 0);
  });
});

// ---------------------------------------------------------------------------
// 3 -- tls12-fresh, the comparison
// ---------------------------------------------------------------------------

describe('tls12-fresh', () => {
  const run = runTlsScenario(TLS12_FRESH);
  const thirteen = runTlsScenario(TLS13_FRESH);

  it('costs one more round trip than TLS 1.3 on the same path', () => {
    expect(run.handshake.roundTrips).toBe(2);
    expect(thirteen.handshake.roundTrips).toBe(1);
    expect(run.handshake.applicationDataAt).toBeGreaterThan(
      thirteen.handshake.applicationDataAt,
    );
  });

  it('broadcasts the certificate chain in plaintext', () => {
    const certificate = recordFor(run, 'certificate');
    expect(certificate?.record.protection).toBe('none');
    expect(certificate?.record.outerType).toBe('handshake');

    expect(
      run.observerFacts.find((fact) => fact.label === 'Server certificate and identity')
        ?.visible,
    ).toBe(true);
  });

  it('starts encrypting only after an explicit ChangeCipherSpec', () => {
    const ccs = run.messages.filter((message) => message.kind === 'change_cipher_spec');
    expect(ccs.length).toBeGreaterThan(0);

    const first = encryptionBeginsAt(run);
    expect(first).toBeDefined();
    // A whole round trip later than the 1.3 run, which encrypts from message three.
    const firstThirteen = encryptionBeginsAt(thirteen);
    expect(first?.at).toBeGreaterThan(firstThirteen?.at ?? 0);
  });

  it('leaks the record content type even once records are encrypted', () => {
    const encrypted = run.wire.filter((entry) => isProtected(entry.record.protection));
    expect(encrypted.length).toBeGreaterThan(0);
    for (const entry of encrypted) {
      expect(entry.record.outerType).toBe(entry.record.innerType);
    }
    expect(
      run.observerFacts.find(
        (fact) => fact.label === 'Which kind of message each record holds',
      )?.visible,
    ).toBe(true);
  });

  it('names four components in its suite where TLS 1.3 names two', () => {
    const twelve = decomposeSuite(run.suite).filter(
      (component) => !component.movedOutOfSuiteName,
    );
    const thirteenParts = decomposeSuite(thirteen.suite).filter(
      (component) => !component.movedOutOfSuiteName,
    );
    expect(twelve.length).toBeGreaterThan(thirteenParts.length);
    expect(run.suite.keyExchange).toBe('ECDHE');
    expect(run.suite.forwardSecrecy).toBe(true);
  });

  it('explains forward secrecy where the choice still existed', () => {
    expect(annotationText(run)).toMatch(/forward secret/i);
  });
});

// ---------------------------------------------------------------------------
// 4-6 -- one broken check each
// ---------------------------------------------------------------------------

const FAILURE_CASES: readonly (readonly [
  string,
  TlsScenario,
  ValidationStepId,
  string,
])[] = [
  ['cert-expired', CERT_EXPIRED, 'validity-period', 'NET::ERR_CERT_DATE_INVALID'],
  [
    'cert-hostname-mismatch',
    CERT_HOSTNAME_MISMATCH,
    'hostname',
    'NET::ERR_CERT_COMMON_NAME_INVALID',
  ],
  [
    'cert-untrusted-ca',
    CERT_UNTRUSTED_CA,
    'chain-of-trust',
    'NET::ERR_CERT_AUTHORITY_INVALID',
  ],
];

describe.each(FAILURE_CASES)(
  '%s breaks exactly one validation step',
  (_id, scenario, expectedStep, browserError) => {
    const run = runTlsScenario(scenario);

    it('fails that step and no other', () => {
      const validation = run.validation;
      expect(validation).toBeDefined();
      expect(validation?.steps).toHaveLength(5);
      expect(validation?.failures.map((step) => step.id)).toEqual([expectedStep]);
      expect(validation?.trusted).toBe(false);
    });

    it('keeps the other four verdicts, so it is clear which promise broke', () => {
      const passed = run.validation?.steps.filter((step) => step.passed) ?? [];
      expect(passed).toHaveLength(4);
      for (const step of passed) {
        expect(step.detail.length).toBeGreaterThan(20);
      }
    });

    it('surfaces the browser error and something a person could read', () => {
      const failure = run.validation?.failures[0];
      expect(failure?.browserError).toBe(browserError);
      expect(failure?.userFacing?.length ?? 0).toBeGreaterThan(20);
      expect(run.abort?.browserError).toBe(browserError);
      expect(run.abort?.reason).toBe('certificate');
    });

    it('tears the connection down instead of exchanging anything', () => {
      expect(run.abort).toBeDefined();
      expect(run.requestRecords).toHaveLength(0);
      expect(run.responseRecords).toHaveLength(0);
      expect(run.messages.some((message) => message.id === 'client-finished')).toBe(
        false,
      );
      expect(run.result.phases.map((phase) => phase.id)).toContain('abort');
      expect(run.result.phases.map((phase) => phase.id)).not.toContain(
        'application-data',
      );
    });

    it('sends a fatal alert as the last thing on the wire', () => {
      const last = run.wire[run.wire.length - 1];
      expect(last.record.innerType).toBe('alert');
      expect(last.record.from).toBe('client');
      expect(run.abort?.alert.level).toBe('fatal');
      expect(run.abort?.alert.code).toBe(run.validation?.failures[0]?.alert?.code);
    });

    it('marks the client as failed on the diagram', () => {
      const errors = eventsOfKind(run, 'node-state').filter(
        (event) => event.state === 'error',
      );
      expect(errors.map((event) => event.nodeId)).toContain(CLIENT_NODE);
    });
  },
);

describe('the three certificate failures between them', () => {
  it('break three different checks', () => {
    const broken = CERTIFICATE_FAILURE_SCENARIOS.map(
      (scenario) => runTlsScenario(scenario).validation?.failures[0]?.id,
    );
    expect(new Set(broken).size).toBe(3);
    expect(broken).toEqual(['chain-of-trust', 'validity-period', 'hostname']);
  });

  it('are each one edited field away from a chain that passes', () => {
    // The good chain is the control: if it did not pass, "exactly one failure" would
    // prove nothing about the failures.
    expect(runTlsScenario(TLS13_FRESH).validation?.trusted).toBe(true);
  });

  it('never fall back to the Common Name to rescue a hostname match', () => {
    const run = runTlsScenario(CERT_HOSTNAME_MISMATCH);
    const leaf = CERT_HOSTNAME_MISMATCH.chain?.presented[0];
    // The trap: the CN is exactly the name that was asked for, and is not consulted.
    expect(leaf?.subject.commonName).toBe(CERT_HOSTNAME_MISMATCH.host);
    expect(run.validation?.failures[0]?.id).toBe('hostname');
    expect(run.validation?.failures[0]?.reference.rfc).toBe(9525);
  });
});

// ---------------------------------------------------------------------------
// 7 -- downgrade-blocked
// ---------------------------------------------------------------------------

describe('downgrade-blocked', () => {
  const run = runTlsScenario(DOWNGRADE_BLOCKED);

  it('detects the sentinel and names it', () => {
    expect(run.downgrade?.detected).toBe(true);
    expect(run.downgrade?.sentinel).toBe('444F574E47524401');
    expect(run.downgrade?.alert).toEqual({ name: 'illegal_parameter', code: 47 });
  });

  it('aborts at ServerHello, before the certificate ever arrives', () => {
    expect(run.abort?.reason).toBe('downgrade');
    expect(run.abort?.afterMessageId).toBe('server-hello');
    expect(run.messages.map((message) => message.id)).toEqual([
      'client-hello',
      'server-hello',
    ]);
    expect(run.messages.some((message) => message.kind === 'certificate')).toBe(false);
  });

  it('is the shortest of the seven runs', () => {
    const others = TLS_SCENARIOS.filter(
      (scenario) => scenario.id !== 'downgrade-blocked',
    );
    for (const scenario of others) {
      expect(run.result.durationMs).toBeLessThan(
        runTlsScenario(scenario).result.durationMs,
      );
    }
  });

  it('sends its alert in the clear, because no key exists yet', () => {
    const last = run.wire[run.wire.length - 1];
    expect(last.record.innerType).toBe('alert');
    expect(last.record.protection).toBe('none');
  });

  it('explains why the sentinel cannot simply be stripped', () => {
    expect(annotationText(run)).toMatch(/transcript/i);
    expect(annotationText(run)).toMatch(/DOWNGRD/);
  });

  it('exchanges nothing', () => {
    expect(run.requestRecords).toHaveLength(0);
    expect(run.responseRecords).toHaveLength(0);
  });
});
