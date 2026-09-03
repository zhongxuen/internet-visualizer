import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { runDnsScenario } from '../scenarios';
import { COLD_CACHE, NXDOMAIN } from '../scenarios';

import { RecordTable } from './RecordTable';

const cold = runDnsScenario(COLD_CACHE);
const missing = runDnsScenario(NXDOMAIN);

const steps = cold.resolutions[0].steps;

/** The root's reply: the referral the whole module exists to make visible. */
const referral = steps.find((step) => step.to.tier === 'root')?.response;
/** The authoritative server's reply: the first one that actually answers. */
const answer = steps.find((step) => step.outcome === 'answer')?.response;
/**
 * The authoritative server's negative reply, whose SOA is what licenses caching it. The
 * stub's own step also carries NXDOMAIN, but that is the resolver relaying the verdict --
 * only the server holding the zone is in a position to assert it, and only its reply
 * carries the SOA.
 */
const negative = missing.resolutions[0].steps.find(
  (step) => step.to.tier === 'authoritative' && step.outcome === 'nxdomain',
)?.response;

function section(name: string) {
  return within(screen.getByRole('table', { name: `${name} section` }));
}

describe('RecordTable', () => {
  it('shows all three sections, in wire order, even when one is empty', () => {
    if (!referral) throw new Error('the cold walk must be referred by the root');
    render(<RecordTable message={referral} title="Reply" />);

    const headings = screen
      .getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent);

    expect(headings).toEqual(['Question', 'Answer', 'Authority', 'Additional']);
  });

  /**
   * The misconception, on the message itself: a referral is an empty answer section plus
   * an authority section naming who to ask next. Hiding the empty box would hide the
   * fact.
   */
  it('says why the answer section of a referral is empty rather than omitting it', () => {
    if (!referral) throw new Error('the cold walk must be referred by the root');
    render(<RecordTable message={referral} title="Reply" />);

    expect(referral.answer).toHaveLength(0);
    expect(screen.getByText(/on a referral that is correct/)).toBeInTheDocument();
    expect(section('Authority').getAllByRole('row').length).toBeGreaterThan(1);
  });

  /** Glue: the addresses of the nameservers the referral just named. */
  it('puts the glue in the additional section', () => {
    if (!referral) throw new Error('the cold walk must be referred by the root');
    render(<RecordTable message={referral} title="Reply" />);

    const additional = section('Additional');
    expect(additional.getAllByText('A').length).toBeGreaterThan(0);
  });

  it('puts a real answer in the answer section', () => {
    if (!answer) throw new Error('the cold walk must end in an answer');
    render(<RecordTable message={answer} title="Reply" />);

    const rows = section('Answer').getAllByRole('row');
    expect(rows.length).toBeGreaterThan(1);
    expect(screen.getByText('NOERROR')).toBeInTheDocument();
  });

  /** The SOA in the authority section is the permission to remember the bad news. */
  it('shows NXDOMAIN with an empty answer and the SOA in authority', () => {
    if (!negative) throw new Error('the NXDOMAIN scenario must produce a negative reply');
    render(<RecordTable message={negative} title="Reply" />);

    expect(screen.getByText('NXDOMAIN')).toBeInTheDocument();
    expect(negative.answer).toHaveLength(0);
    expect(section('Authority').getAllByText('SOA').length).toBeGreaterThan(0);
  });

  it('prints the header fields a resolver matches a reply on', () => {
    if (!answer) throw new Error('the cold walk must end in an answer');
    render(<RecordTable message={answer} title="Reply" />);

    expect(screen.getByText('ID')).toBeInTheDocument();
    expect(screen.getByText(/^0x[0-9a-f]{4}$/)).toBeInTheDocument();
    expect(screen.getByText('Flags')).toBeInTheDocument();
    expect(screen.getByText(`${answer.sizeBytes} B`)).toBeInTheDocument();
    // The section counts, which is what actually distinguishes a referral from an answer.
    expect(
      screen.getByText(
        `${answer.answer.length}/${answer.authority.length}/${answer.additional.length}`,
      ),
    ).toBeInTheDocument();
  });

  /** A question has no RCODE, and badging one with NOERROR would be inventing a reply. */
  it('badges a query as a query rather than giving it an RCODE', () => {
    render(<RecordTable message={steps[0].query} title="Stub question" />);

    expect(screen.getByText('Query')).toBeInTheDocument();
    expect(screen.queryByText('NOERROR')).not.toBeInTheDocument();
  });

  it('shows the note it is given above the message', () => {
    render(<RecordTable message={steps[0].query} title="Query" note="A test note." />);

    expect(screen.getByText('A test note.')).toBeInTheDocument();
  });
});
