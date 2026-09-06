import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FAILURE_DNS, FAILURE_TLS, FIRST_VISIT_HTTPS } from '../scenarios';
import { runPageLoad, stageOf, type PageLoadRun } from '../sim/pipeline';
import type { StageId } from '../sim/stage';

import { StageZoom } from './StageZoom';

/**
 * The zoom, and the handoff inside it.
 *
 * The acceptance criterion being guarded is "deep links from a stage into its dedicated
 * module carry the current input": the link has to point at the right module *and* carry the
 * host that is currently in the address bar, because a handoff that dropped the input would
 * send the learner to a default and lose the thread the module exists to hold.
 */

const cold = runPageLoad(FIRST_VISIT_HTTPS);

function renderZoom(run: PageLoadRun, id: StageId) {
  const onSeek = vi.fn();
  const onClose = vi.fn();
  render(
    <StageZoom
      run={run}
      stage={stageOf(run, id)!}
      url={run.state.url!}
      onSeek={onSeek}
      onClose={onClose}
    />,
  );
  return { onSeek, onClose };
}

describe('StageZoom', () => {
  it('names the stage, its cost, and its share of the run', () => {
    renderZoom(cold, 'dns');
    expect(screen.getByText('Stage: DNS')).toBeInTheDocument();
    expect(screen.getByText(/%$/)).toBeInTheDocument();
  });

  it('shows the facts the stage established, not a summary written for the panel', () => {
    renderZoom(cold, 'dns');
    expect(screen.getByText('Answer')).toBeInTheDocument();
    expect(screen.getByText('Queries sent')).toBeInTheDocument();
    expect(screen.getByText(cold.state.dns!.addresses.join(', '))).toBeInTheDocument();
  });

  it('offers the deep link into the dedicated module, carrying the host', () => {
    renderZoom(cold, 'dns');
    const link = screen.getByRole('link', { name: /Open in DNS Explorer/ });
    expect(link).toHaveAttribute(
      'href',
      `/dns-explorer?name=${cold.state.url!.host}&type=A&from=internet-simulator`,
    );
  });

  it('sends the TLS stage to the HTTPS Explorer and the TCP stage to Packet Journey', () => {
    renderZoom(cold, 'tls');
    expect(screen.getByRole('link', { name: /Open in HTTPS Explorer/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/https-explorer?host='),
    );
  });

  it('says plainly when a stage has nowhere to hand off to', () => {
    renderZoom(cold, 'url-parse');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(/No module of its own/)).toBeInTheDocument();
  });

  /**
   * A stage that never got a turn is the best lesson a failed run has, so it keeps its
   * panel and prints the pipeline's own sentence about why it was never reached, rather
   * than showing an empty box a learner would read as a rendering bug.
   */
  it('explains a stage that never ran instead of showing an empty panel', () => {
    const failed = runPageLoad(FAILURE_DNS);
    const stage = failed.stages.find((entry) => entry.status === 'not-reached')!;
    renderZoom(failed, stage.id);
    expect(screen.getByText('Never reached')).toBeInTheDocument();
    expect(screen.getByText(stage.skipReason!)).toBeInTheDocument();
  });

  it('shows the browser error code on the stage a failed run died in', () => {
    const failed = runPageLoad(FAILURE_TLS);
    renderZoom(failed, failed.failure!.stage);
    expect(screen.getByText('Run ended here')).toBeInTheDocument();
    expect(screen.getByText(failed.failure!.code)).toBeInTheDocument();
  });

  it('seeks the timeline from the stage start and from any line it wrote', () => {
    const { onSeek } = renderZoom(cold, 'dns');
    const stage = stageOf(cold, 'dns')!;

    fireEvent.click(screen.getByRole('button', { name: /Seek the timeline/ }));
    expect(onSeek).toHaveBeenCalledWith(stage.startMs);
  });
});
