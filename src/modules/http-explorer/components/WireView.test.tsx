import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CONDITIONAL_REQUEST, SIMPLE_GET } from '../scenarios';
import { runHttpScenario } from '../sim/exchange';
import type { CrlfDisplay, HttpVersion } from '../sim/message';
import { wireMessages, wireResponse } from '../wire';

import { WireView } from './WireView';

/**
 * The wire view is the component the module exists for, so these tests are about the two
 * things that make it worth having: that the blank line is drawn as a line rather than as
 * whitespace, and that the CRLF toggle shows the bytes rather than describing them.
 */

const run = runHttpScenario(SIMPLE_GET);
const exchange = run.exchanges[0];
const acceptValue =
  exchange.request.headers.find((field) => field.name === 'Accept')?.value ?? '';

function setup({
  version = 'HTTP/1.1' as HttpVersion,
  target = exchange,
}: { version?: HttpVersion; target?: typeof exchange } = {}) {
  const selections: ({ name: string; value: string } | null)[] = [];

  function Harness() {
    const [crlf, setCrlf] = useState<CrlfDisplay>('hidden');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const { request, response, reconstructedNote } = wireMessages(target);

    return (
      <WireView
        request={request}
        response={response}
        version={version}
        crlf={crlf}
        onCrlfChange={setCrlf}
        selectedId={selectedId}
        onSelectHeader={(next) => {
          selections.push(next ? { name: next.name, value: next.value } : null);
          setSelectedId(next?.id ?? null);
        }}
        requestMessage={target.request}
        responseMessage={wireResponse(target)}
        secure={false}
        {...(reconstructedNote ? { note: reconstructedNote } : {})}
      />
    );
  }

  render(<Harness />);
  return { selections, user: userEvent.setup() };
}

/**
 * A field line, by its exact text.
 *
 * By text rather than by accessible name: the name is computed from three spans and
 * normalises the space around the colon, which makes a regex on it a test of
 * dom-accessibility-api rather than of this component.
 */
function fieldLine(text: string): HTMLElement {
  const found = screen
    .getAllByRole('button')
    .find((button) => button.textContent === text);
  if (!found) throw new Error(`no field line reading "${text}"`);
  return found;
}

describe('the blank line', () => {
  /**
   * The single thing this component exists to put on screen. It is framing, not
   * formatting, and rendering it as a gap between two blocks would teach the opposite.
   */
  it('is drawn as a labelled line rather than as whitespace', () => {
    setup();

    expect(
      screen.getAllByText(/the blank line — everything above is fields/).length,
    ).toBeGreaterThan(0);
  });
});

describe('the CRLF toggle', () => {
  it('shows nothing by default, as a terminal would', () => {
    setup();

    // Exactly one: the toggle's own label. None in the message itself.
    expect(screen.getAllByText('\\r\\n')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('writes the terminators out when asked what the bytes are', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: '\\r\\n' }));

    // One per terminated line: the start-line, every field, and the blank line.
    expect(screen.getAllByText('\\r\\n').length).toBeGreaterThan(
      exchange.request.headers.length,
    );
  });

  it('offers the control pictures as one glyph per byte', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: '␍␊' }));

    expect(screen.getAllByText('␍␊').length).toBeGreaterThan(1);
  });
});

describe('per-header focus', () => {
  it('makes every field line activatable and reports what was picked', async () => {
    const { selections, user } = setup();

    await user.click(fieldLine('Host: example.com'));

    expect(selections.at(-1)).toEqual({ name: 'Host', value: 'example.com' });
  });

  it('selects on keyboard focus too, so tabbing through explains as it goes', async () => {
    const { selections, user } = setup();

    fieldLine('Host: example.com').focus();
    await user.keyboard('{Tab}');

    expect(selections.length).toBeGreaterThan(0);
    expect(selections.at(-1)).not.toBeNull();
  });

  it('marks the selected line pressed', async () => {
    const { user } = setup();
    const host = fieldLine('Host: example.com');

    await user.click(host);

    expect(host).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('a 304 on the wire', () => {
  const conditional = runHttpScenario(CONDITIONAL_REQUEST);
  const revalidated = conditional.exchanges.find(
    (candidate) =>
      candidate.browserCache === 'REVALIDATED' || candidate.cdnCache === 'REVALIDATED',
  );

  it('shows the 304 and says the body is missing', () => {
    expect(revalidated).toBeDefined();
    setup({ target: revalidated! });

    expect(screen.getByText(/Response · 304 Not Modified/)).toBeInTheDocument();
    expect(screen.getAllByText(/no body/).length).toBeGreaterThan(0);
  });

  it('explains that the client was handed something else', () => {
    setup({ target: revalidated! });

    expect(
      screen.getByText(/the bytes the page rendered never crossed it at all/),
    ).toBeInTheDocument();
  });
});

describe('HTTP/2 and HTTP/3 have no text to show', () => {
  it('draws frames instead, with a stream id', () => {
    setup({ version: 'HTTP/2' });

    expect(screen.getAllByText('HEADERS').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/stream=1/).length).toBeGreaterThan(0);
  });

  it('replaces Host with the :authority pseudo-header', () => {
    setup({ version: 'HTTP/2' });

    expect(screen.getAllByText(':authority').length).toBeGreaterThan(0);
    // Sending Host over HTTP/2 is forbidden (RFC 9113 §8.3.1), so it must not be drawn.
    expect(
      screen
        .getAllByRole('button')
        .find((button) => button.textContent?.startsWith('Host:')),
    ).toBeUndefined();
  });

  it('hides the CRLF toggle, because there are no line terminators', () => {
    setup({ version: 'HTTP/3' });

    expect(screen.queryByRole('button', { name: '\\r\\n' })).not.toBeInTheDocument();
  });

  it('says why the header block is smaller than the text one', () => {
    setup({ version: 'HTTP/2' });

    expect(
      screen.getAllByText(/is a table both ends keep in step, not a compressor/).length,
    ).toBeGreaterThan(0);
  });

  it('still explains a field when one is picked', async () => {
    const { selections, user } = setup({ version: 'HTTP/2' });

    await user.click(fieldLine('accept: ' + acceptValue));

    expect(selections.at(-1)?.name.toLowerCase()).toBe('accept');
  });
});

describe('safety', () => {
  it('makes no network request while rendering anything', () => {
    const spy = vi.fn(() => {
      throw new Error('the wire view must never make a network request');
    });
    vi.stubGlobal('fetch', spy);

    setup();
    setup({ version: 'HTTP/3' });

    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
