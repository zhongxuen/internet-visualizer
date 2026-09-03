'use client';

import { useId, type ReactNode } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  byteLength,
  hasTextWireFormat,
  type CrlfDisplay,
  type HttpMessage,
  type HttpVersion,
  type WireSegment,
} from '../sim/message';
import { compressedHeaderBytes, VERSION_PROFILES } from '../sim/versions';
import type { WireMessage } from '../wire';

/**
 * The literal bytes, and the toggle that makes them literal.
 *
 * This is the component the module exists for. An HTTP/1.1 message is text you can read
 * -- a start-line, some field lines, **a blank line**, and then the body -- and seeing
 * that once is worth more than any amount of prose about "the headers section". So the
 * blank line is not rendered as whitespace between two blocks: it is rendered as a line,
 * labelled, because it is a line, and it is the entire framing mechanism of the protocol.
 *
 * ## The CRLF toggle
 *
 * Three modes rather than a checkbox, because "hidden" and "shown" are answering two
 * different questions. Hidden is what a terminal shows you. `\r\n` is what the bytes are.
 * The control pictures are the same information at one glyph per byte, which is what you
 * want while reading a whole message rather than inspecting one line. A learner who has
 * seen `Host: example.com\r\n` stops thinking of a header as an entry in a map and starts
 * thinking of it as bytes -- which is the only frame in which chunked encoding, header
 * injection, and request smuggling make any sense at all.
 *
 * ## Per-header focus
 *
 * Every field line is a button. Focusing or clicking one selects it, and
 * `HeaderExplainer` beside it answers what the field is for. Buttons rather than
 * `tabIndex` on a `<span>` so the keyboard behaviour is the platform's and not a
 * reimplementation of it, and so a screen reader announces something activatable.
 *
 * ## HTTP/2 and HTTP/3
 *
 * There are no bytes of text to show, and pretending otherwise would teach the opposite
 * of the lesson. The same message is drawn as the frames it really is -- a HEADERS frame
 * carrying a compressed field block, then DATA frames -- with the stream id and the
 * compressed size beside the raw one. The contrast with the h1 view is the point, which
 * is why both are this component rather than two.
 */

export interface WireViewProps {
  /** The request and the response, as {@link WireMessage}s. */
  request: WireMessage;
  response: WireMessage;
  /** The protocol version, which decides whether there is text to show at all. */
  version: HttpVersion;
  /** How terminators are rendered. Owned by the parent so both halves agree. */
  crlf: CrlfDisplay;
  onCrlfChange: (display: CrlfDisplay) => void;
  /** The focused field, as `direction:index`. Owned by the parent, which explains it. */
  selectedId: string | null;
  onSelectHeader: (selection: { name: string; value: string; id: string } | null) => void;
  /** Set when the bytes below are not the bytes the client was handed. */
  note?: string;
  /** The messages themselves, for the frame view. Ignored for HTTP/1.1. */
  requestMessage: HttpMessage;
  responseMessage: HttpMessage;
  /** Whether the exchange was over TLS -- the `:scheme` pseudo-header needs to know. */
  secure: boolean;
  className?: string;
}

const CRLF_MODES: readonly { value: CrlfDisplay; label: string; hint: string }[] = [
  { value: 'hidden', label: 'Off', hint: 'What a terminal shows you.' },
  { value: 'escaped', label: '\\r\\n', hint: 'What the bytes actually are.' },
  { value: 'symbols', label: '␍␊', hint: 'The same thing, one glyph per byte.' },
];

const CRLF_MARKERS: Readonly<Record<CrlfDisplay, string>> = {
  hidden: '',
  escaped: '\\r\\n',
  symbols: '␍␊',
};

/** A stable id for one line, so selection survives a re-render of the same message. */
export function segmentId(direction: 'request' | 'response', index: number): string {
  return `${direction}:${index}`;
}

function SectionHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="border-border/60 bg-surface-raised flex items-center justify-between gap-2 border-b px-3 py-1.5">
      <span className="text-fg-secondary text-[0.625rem] font-medium tracking-widest uppercase">
        {children}
      </span>
      {aside}
    </div>
  );
}

/** One line of an HTTP/1.1 message. */
function Line({
  segment,
  id,
  crlf,
  selected,
  onSelect,
}: {
  segment: WireSegment;
  id: string;
  crlf: CrlfDisplay;
  selected: boolean;
  onSelect: () => void;
}) {
  const marker = segment.terminated ? CRLF_MARKERS[crlf] : '';

  const terminator = marker ? (
    <span aria-hidden="true" className="text-state-warn/70">
      {marker}
    </span>
  ) : null;

  if (segment.kind === 'blank') {
    return (
      <div className="border-state-warn/40 bg-state-warn/5 my-0.5 flex items-baseline gap-2 border-l-2 py-0.5 pl-2">
        <span className="font-mono text-xs">{terminator}</span>
        <span className="text-state-warn/90 text-[0.625rem] italic">
          the blank line — everything above is fields, everything below is body
        </span>
      </div>
    );
  }

  if (segment.kind === 'body') {
    return (
      <pre className="text-fg-secondary border-border/50 mt-1 overflow-x-auto border-l-2 py-0.5 pl-2 font-mono text-xs whitespace-pre">
        {segment.text}
      </pre>
    );
  }

  if (segment.kind === 'start-line') {
    return (
      <div className="text-accent px-2 py-0.5 font-mono text-xs font-medium break-all">
        {segment.text}
        {terminator}
      </div>
    );
  }

  return (
    <button
      type="button"
      id={id}
      aria-pressed={selected}
      onClick={onSelect}
      onFocus={onSelect}
      className={cn(
        'block w-full rounded px-2 py-0.5 text-left font-mono text-xs break-all transition-colors',
        focusRing,
        selected
          ? 'bg-accent/12 text-fg'
          : 'text-fg-secondary hover:bg-surface-overlay hover:text-fg',
      )}
    >
      <span className={cn(selected ? 'text-accent' : 'text-fg')}>{segment.name}</span>
      <span className="text-fg-muted">: </span>
      {segment.value}
      {terminator}
    </button>
  );
}

/** The text form: HTTP/1.1, and the only version that has one. */
function TextMessage({
  message,
  crlf,
  selectedId,
  onSelectHeader,
}: {
  message: WireMessage;
  crlf: CrlfDisplay;
  selectedId: string | null;
  onSelectHeader: WireViewProps['onSelectHeader'];
}) {
  return (
    <div className="py-1">
      {message.segments.map((segment, index) => {
        const id = segmentId(message.direction, index);
        return (
          <Line
            key={id}
            id={id}
            segment={segment}
            crlf={crlf}
            selected={selectedId === id}
            onSelect={() =>
              onSelectHeader(
                segment.kind === 'header' && segment.name
                  ? { name: segment.name, value: segment.value ?? '', id }
                  : null,
              )
            }
          />
        );
      })}
    </div>
  );
}

/** The pseudo-headers a binary version puts in front of the field block. */
function pseudoHeaders(message: HttpMessage, secure: boolean): [string, string][] {
  if ('method' in message) {
    return [
      [':method', message.method],
      [':scheme', secure ? 'https' : 'http'],
      [
        ':authority',
        message.headers.find((f) => f.name.toLowerCase() === 'host')?.value ?? '',
      ],
      [':path', message.target],
    ];
  }
  return [[':status', String(message.status)]];
}

/**
 * The frame form: HTTP/2 and HTTP/3.
 *
 * The differences worth seeing are all here at once. The start-line has become
 * pseudo-header fields, which is why `Host` disappears and `:authority` takes its place.
 * Field names are lower-case, because the binary versions require it rather than merely
 * tolerating it. There is no blank line, because there is nothing for one to delimit: the
 * frame header carries a length. And the field block is a fraction of its own size on the
 * second request, because HPACK and QPACK are shared tables rather than compressors --
 * the first request fills the table and every later one indexes into it.
 */
function FrameMessage({
  message,
  version,
  secure,
  streamId,
  selectedId,
  direction,
  onSelectHeader,
}: {
  message: HttpMessage;
  version: HttpVersion;
  secure: boolean;
  streamId: number;
  selectedId: string | null;
  direction: 'request' | 'response';
  onSelectHeader: WireViewProps['onSelectHeader'];
}) {
  const profile = VERSION_PROFILES[version];
  const rawHeaderBytes = byteLength(
    message.headers.map((field) => `${field.name}: ${field.value}\r\n`).join(''),
  );
  const firstPass = compressedHeaderBytes(version, 0, rawHeaderBytes);
  const repeat = compressedHeaderBytes(version, 1, rawHeaderBytes);
  const bodyBytes = byteLength(message.body ?? '');

  return (
    <div className="flex flex-col gap-2 px-2 py-2">
      <div className="border-accent/30 bg-accent/5 rounded border px-2 py-1.5">
        <div className="flex flex-wrap items-baseline gap-2 font-mono text-[0.6875rem]">
          <span className="text-accent font-medium">HEADERS</span>
          <span className="text-fg-muted">stream={streamId}</span>
          <span className="text-fg-muted">
            flags=END_HEADERS{bodyBytes === 0 ? ' | END_STREAM' : ''}
          </span>
          <span className="text-fg-muted">
            {profile.headerCompression} {firstPass} B on this connection
          </span>
        </div>
        <div className="mt-1.5">
          {pseudoHeaders(message, secure).map(([name, value]) => (
            <div key={name} className="px-1 py-0.5 font-mono text-xs break-all">
              <span className="text-state-pending">{name}</span>
              <span className="text-fg-muted">: </span>
              <span className="text-fg-secondary">{value}</span>
            </div>
          ))}
          {message.headers.map((field, index) => {
            // The Host field has become :authority above; showing it twice would be a
            // lie about the wire, and h2 forbids sending it (RFC 9113 s8.3.1).
            if (field.name.toLowerCase() === 'host') return null;
            const id = segmentId(direction, index);
            const selected = selectedId === id;

            return (
              <button
                key={id}
                type="button"
                id={id}
                aria-pressed={selected}
                onClick={() =>
                  onSelectHeader({ name: field.name, value: field.value, id })
                }
                onFocus={() =>
                  onSelectHeader({ name: field.name, value: field.value, id })
                }
                className={cn(
                  'block w-full rounded px-1 py-0.5 text-left font-mono text-xs break-all transition-colors',
                  focusRing,
                  selected
                    ? 'bg-accent/15 text-fg'
                    : 'text-fg-secondary hover:bg-surface-overlay hover:text-fg',
                )}
              >
                <span className={cn(selected ? 'text-accent' : 'text-fg')}>
                  {field.name.toLowerCase()}
                </span>
                <span className="text-fg-muted">: </span>
                {field.value}
              </button>
            );
          })}
        </div>
      </div>

      {bodyBytes > 0 ? (
        <div className="border-border bg-surface rounded border px-2 py-1.5">
          <div className="flex flex-wrap items-baseline gap-2 font-mono text-[0.6875rem]">
            <span className="text-fg font-medium">DATA</span>
            <span className="text-fg-muted">stream={streamId}</span>
            <span className="text-fg-muted">flags=END_STREAM</span>
            <span className="text-fg-muted">{bodyBytes} B</span>
          </div>
          <pre className="text-fg-secondary mt-1 max-h-40 overflow-auto font-mono text-xs whitespace-pre">
            {message.body}
          </pre>
        </div>
      ) : null}

      <p className="text-fg-muted text-[0.625rem] leading-snug">
        No blank line and no CRLF: the frame header carries a length, so there is nothing
        for a delimiter to do. Field names are lower-case because {version} requires it.
        The same fields cost {rawHeaderBytes} B as HTTP/1.1 text, {firstPass} B here on
        the first request, and about {repeat} B on every later one —{' '}
        {profile.headerCompression} is a table both ends keep in step, not a compressor.
      </p>
    </div>
  );
}

export function WireView({
  request,
  response,
  version,
  crlf,
  onCrlfChange,
  selectedId,
  onSelectHeader,
  note,
  requestMessage,
  responseMessage,
  secure,
  className,
}: WireViewProps) {
  const groupId = useId();
  const isText = hasTextWireFormat(version);

  return (
    <Panel
      title="On the wire"
      aside={
        <div className="flex items-center gap-2">
          <Badge tone="neutral">{version}</Badge>
          {isText ? (
            <div
              role="group"
              aria-labelledby={groupId}
              className="flex items-center gap-1"
            >
              <span id={groupId} className="text-fg-muted text-[0.625rem]">
                CRLF
              </span>
              {CRLF_MODES.map((mode) => {
                const active = crlf === mode.value;
                return (
                  <button
                    key={mode.value}
                    type="button"
                    aria-pressed={active}
                    title={mode.hint}
                    onClick={() => onCrlfChange(mode.value)}
                    className={cn(
                      'rounded-md border px-1.5 py-0.5 font-mono text-[0.625rem] transition-colors',
                      focusRing,
                      active
                        ? 'border-accent/60 bg-accent/12 text-fg'
                        : 'border-border bg-surface text-fg-secondary hover:border-border-strong',
                    )}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      }
      flush
      scroll
      className={cn('max-h-[34rem]', className)}
    >
      {note ? (
        <p className="border-state-warn/30 bg-state-warn/5 text-fg-secondary border-b px-3 py-2 text-[0.6875rem] leading-snug">
          {note}
        </p>
      ) : null}

      <SectionHeading
        aside={
          <span className="text-fg-muted font-mono text-[0.625rem]">
            {request.bytes} B
          </span>
        }
      >
        Request · {request.label}
      </SectionHeading>
      {isText ? (
        <TextMessage
          message={request}
          crlf={crlf}
          selectedId={selectedId}
          onSelectHeader={onSelectHeader}
        />
      ) : (
        <FrameMessage
          message={requestMessage}
          version={version}
          secure={secure}
          streamId={1}
          direction="request"
          selectedId={selectedId}
          onSelectHeader={onSelectHeader}
        />
      )}

      <SectionHeading
        aside={
          <span className="text-fg-muted font-mono text-[0.625rem]">
            {response.bytes} B{response.bodyless ? ' · no body' : ''}
          </span>
        }
      >
        Response · {response.label}
      </SectionHeading>
      {isText ? (
        <TextMessage
          message={response}
          crlf={crlf}
          selectedId={selectedId}
          onSelectHeader={onSelectHeader}
        />
      ) : (
        <FrameMessage
          message={responseMessage}
          version={version}
          secure={secure}
          streamId={1}
          direction="response"
          selectedId={selectedId}
          onSelectHeader={onSelectHeader}
        />
      )}
    </Panel>
  );
}
