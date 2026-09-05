import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TLS12_FRESH, TLS13_FRESH, TLS13_RESUMPTION } from '../scenarios';
import { runTlsScenario } from '../sim/connection';
import { observerLosesTrackAt } from '../sim/keyschedule';
import { PLACEHOLDER_PREFIX } from '../sim/placeholder';

import { KeyScheduleDiagram } from './KeyScheduleDiagram';

/**
 * The phase-09 acceptance criterion: **the key schedule shows client, server and observer
 * knowledge at each step, with placeholder values clearly labelled as not-real-crypto.**
 *
 * The second half is not decoration. A diagram that showed convincing-looking hex would
 * be teaching that this page did cryptography, which it did not — so the notice is
 * asserted to be on screen, and every rendered value is asserted to carry the
 * `PLACEHOLDER` stamp that makes it unmistakable.
 */

const tls13 = runTlsScenario(TLS13_FRESH).keySchedule;
const tls12 = runTlsScenario(TLS12_FRESH).keySchedule;
const resumed = runTlsScenario(TLS13_RESUMPTION).keySchedule;

/** The step rows themselves, not the knowledge bullets nested inside them. */
const stepRows = () =>
  [
    ...screen.getByRole('list', { name: 'Key derivation steps' }).children,
  ] as HTMLElement[];

describe('the three columns', () => {
  it('gives every step a client, a server and an observer cell', () => {
    render(<KeyScheduleDiagram schedule={tls13} />);

    const steps = stepRows();
    expect(steps).toHaveLength(tls13.steps.length);

    for (const [index, step] of steps.entries()) {
      const model = tls13.steps[index]!;
      // One string can appear in more than one column -- that two parties know the same
      // thing is exactly what the early steps are saying -- so presence, not uniqueness.
      for (const known of [
        ...model.clientKnows,
        ...model.serverKnows,
        ...model.observerKnows,
      ]) {
        expect(within(step).getAllByText(known).length).toBeGreaterThan(0);
      }
    }
  });

  it('marks the step at which the observer stops being able to follow', () => {
    render(<KeyScheduleDiagram schedule={tls13} />);

    const cutoff = observerLosesTrackAt(tls13)!;
    expect(cutoff.id).toBe('handshake-secret');

    const index = tls13.steps.findIndex((step) => step.id === cutoff.id);
    expect(stepRows()[index]!.textContent).toContain('The observer stops here');
  });

  it('puts the TLS 1.2 cutoff a stage later, at the key block', () => {
    render(<KeyScheduleDiagram schedule={tls12} />);

    const cutoff = observerLosesTrackAt(tls12)!;
    expect(cutoff.id).toBe('tls12-key-block');

    const index = tls12.steps.findIndex((step) => step.id === cutoff.id);
    expect(stepRows()[index]!.textContent).toContain('The observer stops here');
  });
});

describe('honesty about the values', () => {
  it('prints the not-real-cryptography notice', () => {
    render(<KeyScheduleDiagram schedule={tls13} />);

    expect(screen.getByText(tls13.notice)).toBeInTheDocument();
    expect(tls13.notice).toMatch(/Not real cryptography/);
  });

  it('stamps every secret it renders as a placeholder', async () => {
    const user = userEvent.setup();
    render(<KeyScheduleDiagram schedule={tls13} />);

    const withOutput = tls13.steps.find((step) => step.output)!;
    const index = tls13.steps.indexOf(withOutput);
    const row = stepRows()[index]!;

    await user.click(within(row).getAllByRole('button')[0]!);

    expect(within(row).getByText(withOutput.output!.value)).toBeInTheDocument();
    expect(withOutput.output!.value).toContain(PLACEHOLDER_PREFIX);
  });

  it('says the toy arithmetic is breakable by hand', () => {
    render(<KeyScheduleDiagram schedule={tls13} />);

    expect(screen.getByText(tls13.exchange!.illustration.caveat)).toBeInTheDocument();
    expect(screen.getByText(tls13.exchange!.whyObserverFails)).toBeInTheDocument();
  });
});

describe('resumption', () => {
  it('says a pre-shared key seeded the schedule and 0-RTT keys were used', () => {
    render(<KeyScheduleDiagram schedule={resumed} />);

    expect(resumed.usedPsk).toBe(true);
    expect(resumed.usedEarlyData).toBe(true);
    expect(screen.getByText('resumed (PSK)')).toBeInTheDocument();
    expect(screen.getByText('0-RTT')).toBeInTheDocument();
  });

  it('still runs a fresh key exchange, which is what keeps forward secrecy after the early data', () => {
    render(<KeyScheduleDiagram schedule={resumed} />);

    expect(resumed.exchange).toBeDefined();
    expect(resumed.steps.some((step) => step.id === 'dhe')).toBe(true);
  });
});
