import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BINARY_FRAMES, HANDSHAKE_AND_CHAT } from '../scenarios';
import { runWebSocketScenario, type FrameRecord } from '../sim/exchange';

import { FrameInspector } from './FrameInspector';

/**
 * The bit-level view.
 *
 * The assertions here are about the two things a frame inspector can get wrong in a way that
 * teaches something false: showing a masking-key field on a frame that has none, and
 * explaining masking as if it were encryption or as if it applied in both directions.
 *
 * Everything else it draws comes from `frameLayout`, which is tested against RFC 6455's own
 * examples in `sim/frames.test.ts` -- so this file checks that the panel renders the layout it
 * was given rather than re-checking the layout.
 */

const chat = runWebSocketScenario(HANDSHAKE_AND_CHAT);
const binary = runWebSocketScenario(BINARY_FRAMES);

function frameFrom(run: ReturnType<typeof runWebSocketScenario>, from: 'client' | 'server') {
  const record = run.frames.find((each) => each.from === from);
  if (!record) throw new Error(`no ${from} frame in this run`);
  return record;
}

function byStep(step: string): FrameRecord {
  const record = binary.frames.find((each) => each.stepId === step);
  if (!record) throw new Error(`no frame for step ${step}`);
  return record;
}

describe('FrameInspector', () => {
  it('says so plainly when nothing is selected', () => {
    render(<FrameInspector />);
    expect(screen.getByText('No frame selected')).toBeInTheDocument();
  });

  it('shows the masking key on a client frame, and explains it by its threat', () => {
    render(<FrameInspector record={frameFrom(chat, 'client')} />);

    expect(screen.getByText('Client frames are always masked.')).toBeInTheDocument();
    expect(screen.getByText(/transparent proxy/)).toBeInTheDocument();
    // Not encryption -- the key travels in the frame, ahead of the bytes it masks.
    expect(screen.getAllByText(/not encryption/).length).toBeGreaterThan(0);
    // Once in the bit diagram and once in the field table -- the field really is there.
    expect(screen.getAllByText('Masking-key')).toHaveLength(2);
    expect(screen.getByText('On the wire')).toBeInTheDocument();
  });

  it('has no masking-key field at all on a server frame, not an empty one', () => {
    render(<FrameInspector record={frameFrom(chat, 'server')} />);

    expect(screen.getByText('Server frames are never masked.')).toBeInTheDocument();
    expect(screen.queryByText('Masking-key')).not.toBeInTheDocument();
    expect(screen.getAllByText(/must fail the connection/).length).toBeGreaterThan(0);
  });

  it('marks which of the three length encodings this frame uses', () => {
    render(<FrameInspector record={byStep('tiny-binary')} />);
    const encodings = screen.getByRole('region', { name: /payload length encodings/i });

    expect(within(encodings).getByText('7-bit')).toBeInTheDocument();
    expect(within(encodings).getByText('this frame')).toBeInTheDocument();
    // All three are listed, always -- the table is how a reader learns the header is not a
    // fixed size.
    expect(within(encodings).getByText('7+16')).toBeInTheDocument();
    expect(within(encodings).getByText('7+64')).toBeInTheDocument();
  });

  it('shows the 16-bit escape as an escape and not as a length', () => {
    render(<FrameInspector record={byStep('medium-binary')} />);

    expect(screen.getByText(/126 \(escape: the real length follows\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Extended payload length (16)')).toHaveLength(2);
  });

  it('reaches the 64-bit encoding, with the reserved sign bit explained', () => {
    render(<FrameInspector record={byStep('large-binary')} />);

    expect(screen.getAllByText('Extended payload length (64)')).toHaveLength(2);
    // Stated in the field's own explanation and again in the encoding table.
    expect(screen.getAllByText(/2\^63-1/).length).toBeGreaterThan(0);
  });

  it('prints the header and payload split that makes the frame cheap', () => {
    const record = frameFrom(chat, 'client');
    render(<FrameInspector record={record} />);

    expect(
      screen.getByText(
        `${record.headerBytes} + ${record.layout.payloadBytes} = ${record.wireBytes} B`,
      ),
    ).toBeInTheDocument();
  });
});
