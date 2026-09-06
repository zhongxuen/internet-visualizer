import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FAILURE_DNS, FAILURE_TLS, FIRST_VISIT_HTTPS } from '../scenarios';
import { runPageLoad } from '../sim/pipeline';

import { BrowserFrame } from './BrowserFrame';

/**
 * The viewport.
 *
 * What is being tested is the honesty of the frame: blank while blank is the truth, the name
 * of the file holding it blank while a render-blocking stylesheet is in flight, and the
 * browser's own error string when the run never got a page at all. A frame that showed a
 * spinner instead would pass no test here, because a spinner is what real browsers stopped
 * doing and what makes people believe a load is "in progress" on screen when it is not.
 */

const cold = runPageLoad(FIRST_VISIT_HTTPS);
const paint = cold.metrics.firstPaintMs!;
const lcp = cold.metrics.largestContentfulPaintMs!;

describe('BrowserFrame', () => {
  it('is blank before the document arrives', () => {
    render(<BrowserFrame run={cold} now={0} />);
    expect(screen.getByText('Nothing painted yet')).toBeInTheDocument();
    expect(screen.getByText('Blank')).toBeInTheDocument();
  });

  /**
   * The most useful performance lesson in the module: the HTML has arrived, the parser has
   * finished, and the frame is still empty because a stylesheet in the head blocks it.
   */
  it('stays blank after the HTML arrives, and names what is holding the frame', () => {
    render(<BrowserFrame run={cold} now={paint - 1} />);
    const blocking = cold.state.render!.blockedFirstPaintBy;
    expect(blocking.length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(blocking[0]!))).toBeInTheDocument();
  });

  it('paints at first paint, and completes at the largest contentful paint', () => {
    const { rerender } = render(<BrowserFrame run={cold} now={paint} />);
    expect(screen.getByText('First paint')).toBeInTheDocument();

    rerender(<BrowserFrame run={cold} now={lcp} />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText(/largest contentful element/)).toBeInTheDocument();
  });

  it('marks First Paint and LCP with their times', () => {
    render(<BrowserFrame run={cold} now={lcp} />);
    expect(screen.getByText(/^FP /)).toBeInTheDocument();
    expect(screen.getByText(/^LCP /)).toBeInTheDocument();
  });

  it('quotes the metrics a user would, including TTFB and total transfer', () => {
    render(<BrowserFrame run={cold} now={lcp} />);
    expect(screen.getByText('TTFB')).toBeInTheDocument();
    expect(screen.getByText('First Paint')).toBeInTheDocument();
    expect(screen.getByText('LCP')).toBeInTheDocument();
    expect(screen.getByText('Transferred')).toBeInTheDocument();
  });

  it('shows the browser error a failed run really ends in', () => {
    const failed = runPageLoad(FAILURE_DNS);
    render(<BrowserFrame run={failed} now={failed.result.durationMs} />);

    expect(screen.getAllByText('DNS_PROBE_FINISHED_NXDOMAIN').length).toBeGreaterThan(0);
    expect(screen.getByText(failed.failure!.title)).toBeInTheDocument();
    expect(screen.getByText(failed.failure!.explanation)).toBeInTheDocument();
  });

  it('never paints a page for a run that was refused at the handshake', () => {
    const failed = runPageLoad(FAILURE_TLS);
    render(<BrowserFrame run={failed} now={failed.result.durationMs} />);
    expect(screen.queryByText(/largest contentful element/)).not.toBeInTheDocument();
  });
});
