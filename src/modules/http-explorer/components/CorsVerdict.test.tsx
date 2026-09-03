import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CORS_PREFLIGHT, SIMPLE_GET } from '../scenarios';
import { runHttpScenario } from '../sim/exchange';

import { CorsVerdict } from './CorsVerdict';

/**
 * The acceptance criterion this component exists for: the CORS scenario must show the
 * request being sent and the *response* being blocked. Everything asserted here is that
 * distinction, because collapsing it is the misconception the module was written against.
 */

const cors = runHttpScenario(CORS_PREFLIGHT);
const blocked = cors.exchanges.find((exchange) => exchange.blockedFromPage);
const allowed = cors.exchanges.find(
  (exchange) => exchange.cors.crossOrigin && !exchange.blockedFromPage,
);

describe('a blocked cross-origin response', () => {
  it('has one in the CORS scenario to talk about', () => {
    expect(blocked).toBeDefined();
  });

  it('says the request was sent and the server ran it, before saying what was refused', () => {
    render(<CorsVerdict exchange={blocked!} />);

    const steps = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('The request was sent');
    expect(steps[1]).toContain('The server ran it');
    expect(steps[2]).toContain('The page was refused the answer');
  });

  it('states that the response arrived and that a side effect is not undone', () => {
    render(<CorsVerdict exchange={blocked!} />);

    expect(
      screen.getByText(/left the browser and crossed the network/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a blocked response does not undo a write/),
    ).toBeInTheDocument();
  });

  it('names it as a rule about reading rather than as server-side access control', () => {
    render(<CorsVerdict exchange={blocked!} />);

    expect(screen.getByText('response blocked')).toBeInTheDocument();
    expect(
      screen.getByText(/has never been, server-side\s+access control/),
    ).toBeInTheDocument();
  });
});

describe('a permitted cross-origin response', () => {
  it('marks the third step green and drops the correction', () => {
    expect(allowed).toBeDefined();
    render(<CorsVerdict exchange={allowed!} />);

    expect(screen.getByText('page may read it')).toBeInTheDocument();
    expect(screen.queryByText(/has never been, server-side/)).not.toBeInTheDocument();
  });

  it('marks a request that needed permission first', () => {
    const preflighted = cors.exchanges.find(
      (exchange) => exchange.cors.preflightRequired && exchange.kind === 'request',
    );
    expect(preflighted).toBeDefined();
    render(<CorsVerdict exchange={preflighted!} />);

    expect(screen.getByText('preflight required')).toBeInTheDocument();
  });
});

describe('a same-origin exchange', () => {
  it('renders nothing at all, because there is no verdict to give', () => {
    const { container } = render(
      <CorsVerdict exchange={runHttpScenario(SIMPLE_GET).exchanges[0]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
