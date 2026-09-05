import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  CERT_EXPIRED,
  CERT_HOSTNAME_MISMATCH,
  CERT_UNTRUSTED_CA,
  TLS13_FRESH,
  TLS13_RESUMPTION,
} from '../scenarios';
import { runTlsScenario, type TlsScenario } from '../sim/connection';

import { CertificateChain } from './CertificateChain';

/**
 * Two phase-09 acceptance criteria live here: **all three certificate failure scenarios
 * break exactly one validation step and surface which one**, and the chain is rendered
 * leaf-first with the anchor named as coming from the trust store.
 *
 * `certificates.test.ts` already proves the verdicts are right. What this file proves is
 * that the panel does not quietly collapse five independent checks into one padlock — the
 * five rows are all present on every run, and the four that passed on a failing run are
 * still visibly green. That is the property the failure scenarios were designed to teach
 * and the one a summary view would destroy.
 */

function mount(scenario: TlsScenario) {
  const run = runTlsScenario(scenario);
  render(
    <CertificateChain
      store={scenario.store}
      {...(scenario.chain ? { chain: scenario.chain } : {})}
      {...(run.validation ? { validation: run.validation } : {})}
    />,
  );
  return run;
}

const checks = () =>
  within(
    screen.getByRole('heading', { name: /Five checks/ }).parentElement as HTMLElement,
  ).getAllByRole('listitem');

/** Each check row's title and verdict, in display order. */
function verdicts(): { title: string; passed: boolean }[] {
  return checks().map((row) => ({
    title: within(row).getByRole('button').textContent ?? '',
    passed: (within(row).getByRole('button').textContent ?? '').includes('pass'),
  }));
}

describe('a chain that validates', () => {
  it('shows all five checks passing, not a single verdict', () => {
    mount(TLS13_FRESH);

    const rows = verdicts();
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.passed)).toBe(true);
    expect(screen.getByText('trusted')).toBeInTheDocument();
  });

  it('draws the path leaf first and names the root as coming from the trust store', () => {
    mount(TLS13_FRESH);

    const path = within(
      screen.getByRole('heading', { name: /The path, leaf first/ })
        .parentElement as HTMLElement,
    ).getAllByRole('listitem');

    expect(path[0]!.textContent).toContain('Leaf — speaks for the hostname');
    expect(path.at(-1)!.textContent).toContain('Root — from your trust store');
    expect(
      screen.getByText(/came from your trust store, not from the wire/),
    ).toBeInTheDocument();
  });
});

/**
 * One row per failure scenario, naming the single step it is designed to break and the
 * browser error it produces. Anything that broke a second check would fail the length
 * assertion below, which is the whole point of the table.
 */
const FAILURES: readonly {
  scenario: TlsScenario;
  step: string;
  browserError: string;
}[] = [
  {
    scenario: CERT_UNTRUSTED_CA,
    step: 'Signature chains to a trusted root',
    browserError: 'NET::ERR_CERT_AUTHORITY_INVALID',
  },
  {
    scenario: CERT_EXPIRED,
    step: 'expired',
    browserError: 'NET::ERR_CERT_DATE_INVALID',
  },
  {
    scenario: CERT_HOSTNAME_MISMATCH,
    step: 'Hostname matches a SAN entry',
    browserError: 'NET::ERR_CERT_COMMON_NAME_INVALID',
  },
];

describe.each(FAILURES)('$scenario.id', ({ scenario, step, browserError }) => {
  it('fails exactly one of the five checks', () => {
    const run = mount(scenario);

    expect(run.validation?.failures).toHaveLength(1);
    expect(verdicts().filter((row) => !row.passed)).toHaveLength(1);
    expect(verdicts().filter((row) => row.passed)).toHaveLength(4);
  });

  it('names which check fired, in the row and in the browser warning', () => {
    mount(scenario);

    const failed = checks().filter(
      (row) => !(within(row).getByRole('button').textContent ?? '').includes('pass'),
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]!.textContent).toContain(step);

    const warning = screen.getByRole('heading', {
      name: /warning the browser would show/,
    }).parentElement as HTMLElement;
    expect(within(warning).getByText(browserError)).toBeInTheDocument();
  });

  it('names the TLS alert the failing check would send', () => {
    const run = mount(scenario);
    const alert = run.validation!.failures[0]!.alert!;

    expect(
      screen.getByText(new RegExp(`alert ${alert.name}\\(${alert.code}\\)`)),
    ).toBeInTheDocument();
  });
});

describe('the hostname check', () => {
  it('says the Common Name would have matched and is not consulted', async () => {
    const user = userEvent.setup();
    mount(CERT_HOSTNAME_MISMATCH);

    const failed = checks().find((row) =>
      row.textContent?.includes('Hostname matches a SAN entry'),
    )!;
    await user.click(within(failed).getByRole('button'));

    expect(
      within(failed).getByText(/removed the old Common Name fallback/),
    ).toBeInTheDocument();
    expect(within(failed).getByText(/RFC 9525 § 6\.3/)).toBeInTheDocument();
  });
});

describe('a resumed handshake', () => {
  it('presents no certificate, and says what authenticated instead', () => {
    mount(TLS13_RESUMPTION);

    expect(
      screen.queryByRole('heading', { name: /Five checks/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/authenticates with the pre-shared key from the ticket instead/),
    ).toBeInTheDocument();
  });
});
