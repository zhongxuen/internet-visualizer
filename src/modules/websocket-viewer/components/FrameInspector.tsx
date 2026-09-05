'use client';

import { Badge, EmptyState, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { FrameRecord } from '../sim/exchange';
import {
  applyMask,
  explainMasking,
  LENGTH_ENCODINGS,
  type FrameField,
} from '../sim/frames';
import { toSpacedHex, utf8Text } from '../sim/digest';

/**
 * The frame, to the bit.
 *
 * Everything drawn here comes from `frameLayout` in `sim/frames.ts`: the bit offsets, the
 * widths, the binary, and the sentence explaining each field are facts about RFC 6455 and are
 * unit-tested without a DOM. This component decides only how to arrange them, which is the
 * boundary the whole project is built on.
 *
 * ## The diagram is drawn from the offsets, not from a picture
 *
 * The header is 2, 4, 6, 8, 10, or 14 bytes — never anything else, and never a fixed size.
 * Drawing it as a 32-bit-per-row grid whose cells are computed from `bitOffset` and `bits`
 * means the diagram cannot drift from the layout: a masked frame really does push the payload
 * four bytes to the right, and an unmasked one has no masking-key cell at all rather than an
 * empty one. A placeholder would misdraw the single thing this panel exists to get right.
 *
 * ## Both payload columns are shown
 *
 * A masked frame is shown twice: the application data, and the bytes that actually travel.
 * Seeing `hello` become four bytes of noise and come back is what makes masking concrete —
 * and seeing the masking key sitting in the clear four bytes ahead of the data it masks is
 * what stops anyone mistaking it for encryption.
 *
 * ## Why the direction paragraph is always present
 *
 * Client frames are always masked; server frames never are. It is the most surprising rule in
 * the specification and the one most often explained as "for security", which is not an
 * explanation. The real reason is a specific attack on a specific machine — a transparent
 * proxy that never understood the upgrade — and the *direction* follows from who the attacker
 * is, so the paragraph changes with the direction of the frame being inspected.
 */

export interface FrameInspectorProps {
  /** The frame to take apart. */
  record?: FrameRecord;
  className?: string;
}

/** Bits per row in the diagram, matching the RFC 6455 § 5.2 figure. */
const ROW_BITS = 32;

/** How much of a long payload to draw before saying "and so on". */
const MAX_PAYLOAD_BITS = ROW_BITS * 4;

interface Segment {
  readonly field: FrameField;
  /** Bit column within its row, 0-based. */
  readonly start: number;
  readonly span: number;
  readonly continued: boolean;
}

/**
 * Cut the fields into per-row segments.
 *
 * A 64-bit extended length crosses two rows and a long payload crosses many, so a field is not
 * one box — it is however many boxes it takes, with the later ones marked as continuations so
 * the label is not repeated four times.
 */
function rowsOf(fields: readonly FrameField[], totalBits: number): Segment[][] {
  const rows: Segment[][] = [];
  for (const field of fields) {
    const end = Math.min(field.bitOffset + field.bits, totalBits);
    let cursor = field.bitOffset;
    let first = true;
    while (cursor < end) {
      const row = Math.floor(cursor / ROW_BITS);
      const start = cursor % ROW_BITS;
      const span = Math.min(ROW_BITS - start, end - cursor);
      (rows[row] ??= []).push({ field, start, span, continued: !first });
      cursor += span;
      first = false;
    }
  }
  return rows;
}

function fieldTone(id: string): string {
  if (id === 'mask' || id === 'masking-key') return 'border-layer-session/60 bg-layer-session/15 text-layer-session';
  if (id === 'payload') return 'border-layer-application/60 bg-layer-application/15 text-layer-application';
  if (id.startsWith('rsv')) return 'border-border bg-surface text-fg-muted';
  if (id === 'length-field' || id === 'extended-length')
    return 'border-layer-transport/60 bg-layer-transport/15 text-layer-transport';
  return 'border-accent/60 bg-accent/12 text-accent';
}

function BitDiagram({ record }: { record: FrameRecord }) {
  const drawnBits =
    record.layout.headerBits + Math.min(record.layout.payloadBytes * 8, MAX_PAYLOAD_BITS);
  const totalRows = Math.ceil(drawnBits / ROW_BITS);
  const rows = rowsOf(record.layout.fields, drawnBits);
  const truncated = record.layout.payloadBytes * 8 > MAX_PAYLOAD_BITS;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        aria-hidden="true"
        className="text-fg-muted grid gap-px font-mono text-[0.5rem] tabular-nums"
        style={{ gridTemplateColumns: `2.75rem repeat(${ROW_BITS}, minmax(0, 1fr))` }}
      >
        <span />
        {Array.from({ length: ROW_BITS }, (_, bit) => (
          <span key={bit} className="text-center">
            {bit % 4 === 0 ? bit : ''}
          </span>
        ))}
      </div>

      {Array.from({ length: totalRows }, (_, row) => (
        <div
          key={row}
          className="grid items-stretch gap-px"
          style={{ gridTemplateColumns: `2.75rem repeat(${ROW_BITS}, minmax(0, 1fr))` }}
        >
          <span
            aria-hidden="true"
            className="text-fg-muted self-center pr-1 text-right font-mono text-[0.5625rem] tabular-nums"
          >
            {row * 4}
          </span>
          {(rows[row] ?? []).map((segment) => (
            <div
              key={`${segment.field.id}-${segment.start}`}
              className={cn(
                'min-w-0 truncate rounded-sm border px-1 py-1 text-center text-[0.5625rem] font-medium',
                fieldTone(segment.field.id),
              )}
              style={{ gridColumn: `${segment.start + 2} / span ${segment.span}` }}
              title={`${segment.field.name}: ${segment.field.value}`}
            >
              {segment.continued ? '' : segment.field.name}
            </div>
          ))}
        </div>
      ))}

      <p className="text-fg-muted text-[0.625rem] leading-relaxed">
        Each row is 32 bits, laid out as RFC 6455 § 5.2 draws it. The byte offset is in the
        gutter.{' '}
        {truncated ? 'The payload is cut off here; the whole of it is counted below. ' : ''}
        The header is {record.layout.headerBytes} bytes on this frame — never a fixed size, and
        never an odd number: the length extension is 0, 2, or 8 bytes and the mask is 0 or 4, so
        the only reachable header sizes are 2, 4, 6, 8, 10, and 14.
      </p>
    </div>
  );
}

function FieldTable({ record }: { record: FrameRecord }) {
  return (
    <table className="w-full border-collapse text-left text-xs">
      <caption className="text-fg-muted pb-2 text-left text-[0.6875rem] leading-snug">
        Fields in wire order, with the bit each one starts at.
      </caption>
      <thead>
        <tr className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
          <th scope="col" className="py-1 pr-3 font-medium">
            Bit
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Field
          </th>
          <th scope="col" className="py-1 font-medium">
            Value
          </th>
        </tr>
      </thead>
      <tbody>
        {record.layout.fields.map((field) => (
          <tr key={field.id} className="border-border/60 border-t align-top">
            <td className="text-fg-muted py-2 pr-3 font-mono text-[0.6875rem] tabular-nums whitespace-nowrap">
              {field.bitOffset}
              <span className="text-fg-muted/70"> +{field.bits}</span>
            </td>
            <td className="py-2 pr-3">
              <span className="text-fg font-medium">{field.name}</span>
              <p className="text-fg-muted mt-1 text-[0.6875rem] leading-relaxed">
                {field.explain}
              </p>
              <p className="text-fg-muted mt-1 text-[0.625rem]">
                RFC {field.reference.rfc}
                {field.reference.section ? ` § ${field.reference.section}` : ''}
              </p>
            </td>
            <td className="py-2">
              <code className="text-fg-secondary font-mono text-[0.6875rem] break-all">
                {field.value}
              </code>
              {field.binary ? (
                <code className="text-accent mt-1 block font-mono text-[0.6875rem]">
                  {field.binary}
                </code>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LengthEncodings({ record }: { record: FrameRecord }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-3">
      {LENGTH_ENCODINGS.map((info) => {
        const active = info.encoding === record.layout.lengthEncoding;
        return (
          <li
            key={info.encoding}
            className={cn(
              'rounded-lg border px-3 py-2',
              active ? 'border-accent/60 bg-accent/10' : 'border-border bg-surface opacity-70',
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <code className="text-fg font-mono text-[0.6875rem]">{info.encoding}</code>
              {active ? <Badge tone="accent">this frame</Badge> : null}
            </div>
            <p className="text-fg-secondary mt-1 text-[0.6875rem]">{info.range}</p>
            <p className="text-fg-muted mt-1 text-[0.625rem] leading-relaxed">
              7-bit field holds {info.field}. Header: {info.headerBytes}.
            </p>
            <p className="text-fg-muted mt-1 text-[0.625rem] leading-relaxed">{info.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Masking({ record }: { record: FrameRecord }) {
  const explanation = explainMasking(record.direction);
  const key = record.frame.maskingKey;
  const preview = record.frame.payload.slice(0, 16);
  const masked = key === undefined ? undefined : applyMask(preview, key);

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border px-3 py-2.5',
        record.frame.masked
          ? 'border-layer-session/50 bg-layer-session/10'
          : 'border-border bg-surface',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-fg text-xs font-medium">{explanation.headline}</h4>
        <Badge tone={explanation.required ? 'accent' : 'neutral'}>
          {explanation.required ? 'required' : 'forbidden'}
        </Badge>
      </div>
      <p className="text-fg-secondary text-[0.6875rem] leading-relaxed">
        {explanation.detail}
      </p>

      {key !== undefined && masked !== undefined ? (
        <dl className="flex flex-col gap-1 text-[0.6875rem]">
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-fg-muted w-28 shrink-0">Masking key</dt>
            <dd className="text-fg font-mono break-all">{toSpacedHex(Uint8Array.from(key))}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-fg-muted w-28 shrink-0">Application data</dt>
            <dd className="text-fg-secondary font-mono break-all">
              {toSpacedHex(preview)}
              {record.frame.payload.length > preview.length ? ' …' : ''}
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-fg-muted w-28 shrink-0">On the wire</dt>
            <dd className="text-layer-session font-mono break-all">
              {toSpacedHex(masked)}
              {record.frame.payload.length > preview.length ? ' …' : ''}
            </dd>
          </div>
          <p className="text-fg-muted mt-1 leading-relaxed">
            <code>transformed[i] = original[i] XOR key[i mod 4]</code> — its own inverse, which
            is why one routine serves both ends. It is not encryption: the key is in the clear,
            four bytes ahead of the data it masks.
          </p>
        </dl>
      ) : null}
    </div>
  );
}

export function FrameInspector({ record, className }: FrameInspectorProps) {
  if (record === undefined) {
    return (
      <Panel title="Frame inspector" className={cn('min-w-0', className)}>
        <EmptyState
          title="No frame selected"
          description="Pick a frame from the message stream to take its header apart bit by bit."
        />
      </Panel>
    );
  }

  const text =
    record.frame.opcode === 'text' || record.frame.opcode === 'continuation'
      ? utf8Text(record.frame.payload)
      : undefined;

  return (
    <Panel
      title="Frame inspector"
      aside={
        <>
          <Badge tone={record.frame.masked ? 'accent' : 'neutral'}>
            {record.frame.masked ? 'masked' : 'unmasked'}
          </Badge>
          <Badge tone="neutral">
            {record.headerBytes} + {record.layout.payloadBytes} = {record.wireBytes} B
          </Badge>
        </>
      }
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-fg text-sm font-medium">{record.title}</h3>
            <Badge tone="neutral">
              {record.from === 'client' ? 'client → server' : 'server → client'}
            </Badge>
            {record.automatic ? <Badge tone="accent">protocol obligation</Badge> : null}
            {record.delivered ? null : <Badge tone="error">never arrived</Badge>}
          </div>
          <p className="text-fg-secondary text-xs leading-relaxed">{record.why}</p>
          {record.notes.map((note) => (
            <p key={note} className="text-fg-muted text-[0.6875rem] leading-relaxed">
              {note}
            </p>
          ))}
        </div>

        <BitDiagram record={record} />

        <div className="border-border bg-surface rounded-lg border px-3 py-2">
          <h4 className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
            The bytes on the wire
          </h4>
          <code className="text-fg-secondary mt-1 block font-mono text-[0.6875rem] leading-relaxed break-all">
            {record.wireHex}
          </code>
          {text === undefined ? null : (
            <p className="text-fg-muted mt-1 text-[0.6875rem] leading-relaxed">
              Payload as text: <span className="text-fg-secondary">{text}</span>
            </p>
          )}
          <p className="text-fg-muted mt-1 text-[0.625rem] leading-relaxed">
            {record.layout.headerBytes} bytes of header for{' '}
            {record.layout.payloadBytes} of payload —{' '}
            {Math.round(record.layout.overheadRatio * 100)}% overhead. The equivalent HTTP
            request would have cost several hundred bytes of field lines and needed a reply.
          </p>
        </div>

        <Masking record={record} />

        <section aria-label="Payload length encodings" className="flex flex-col gap-2">
          <h4 className="text-fg-secondary text-xs font-medium tracking-widest uppercase">
            The three length encodings
          </h4>
          <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
            And the encoding must be the <em>minimal</em> one. A 100-byte payload sent with the
            16-bit escape is a protocol error, not merely wasteful — two legal spellings of one
            frame is how two parsers come to disagree about where the next frame starts.
          </p>
          <LengthEncodings record={record} />
        </section>

        <FieldTable record={record} />
      </div>
    </Panel>
  );
}
