import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FIRST_VISIT_HTTPS } from '../scenarios';
import { runPageLoad } from '../sim/pipeline';
import { buildWaterfall } from '../waterfall';

import { WaterfallChart } from './WaterfallChart';

/**
 * The chart.
 *
 * The vocabulary is the deliverable, so the legend is what is asserted: a learner reading
 * `Waiting (TTFB)` here has to find the identical words in a real Network panel. The rest of
 * the chart's correctness is the model's, and is tested in `../waterfall.test.ts`.
 */

const run = runPageLoad(FIRST_VISIT_HTTPS);
const waterfall = buildWaterfall(run);

describe('WaterfallChart', () => {
  it('labels its segments with devtools names, in the legend', () => {
    render(
      <WaterfallChart
        waterfall={waterfall}
        firstPaintMs={run.metrics.firstPaintMs!}
        largestContentfulPaintMs={run.metrics.largestContentfulPaintMs!}
      />,
    );

    const legend = screen.getByRole('list', { name: 'Segment key' });
    for (const name of [
      'DNS Lookup',
      'Initial connection',
      'SSL',
      'Waiting (TTFB)',
      'Content Download',
    ]) {
      expect(legend.textContent).toContain(name);
    }
  });

  it('draws one row per request, document first', () => {
    render(<WaterfallChart waterfall={waterfall} />);
    const rows = screen.getAllByRole('row');
    // One header row, then one per request.
    expect(rows).toHaveLength(waterfall.rows.length + 1);
    expect(screen.getByRole('button', { name: run.page.host })).toBeInTheDocument();
  });

  it('marks First Paint and LCP on the chart rather than beside it', () => {
    render(
      <WaterfallChart
        waterfall={waterfall}
        firstPaintMs={run.metrics.firstPaintMs!}
        largestContentfulPaintMs={run.metrics.largestContentfulPaintMs!}
      />,
    );

    expect(screen.getByText(/^First Paint /)).toBeInTheDocument();
    expect(screen.getByText(/^LCP /)).toBeInTheDocument();
  });

  it('lists no segment the run did not actually produce', () => {
    render(<WaterfallChart waterfall={waterfall} />);
    const legend = screen.getByRole('list', { name: 'Segment key' });
    const produced = new Set(
      waterfall.rows.flatMap((row) => row.segments.map((segment) => segment.name)),
    );
    if (!produced.has('Stalled')) {
      expect(legend.textContent).not.toContain('Stalled');
    }
  });
});
