'use client';

import type { ReactNode } from 'react';

import { useDetail } from '@/components/prefs';
import type { HeaderField } from '@/core/types/pdu';
import { cn } from '@/lib/cn';
import { layerColor, type LayerKey } from '@/lib/theme';

/**
 * One protocol header, field by field.
 *
 * This is where the animation meets the specification: the fields are the real ones from
 * the RFC, in wire order, with the width the standard gives them and one sentence saying
 * what each is for. A learner who has just watched a packet cross a router can open the
 * IPv4 header and see that the only thing that changed was an 8-bit number called TTL.
 *
 * Width is drawn as well as printed. The bar is scaled against the widest field in *this*
 * header, so a 32-bit address next to an 8-bit TTL shows the four-to-one relationship
 * that makes "why does IPv4 run out of addresses" a visible fact rather than a claim. It
 * is decoration only -- the bit count is always printed beside it, and the unit is spelled
 * out for screen readers.
 *
 * A field whose width the scenario does not state prints an em dash rather than a guess.
 *
 * Two voices (docs/implementation/uiux-spec.md §5.2): each field's note is printed as a
 * "What it's for" line in both detail levels, because it is the plain half of the row.
 * The width column -- bits, and the bar -- is Full detail only; a beginner meets the
 * field and its purpose before its size.
 */

export interface HeaderTableProps {
  /** The header's fields, in wire order. */
  fields: readonly HeaderField[];
  /** Colours the width bars. Omit for a neutral table. */
  layer?: LayerKey;
  /** Table caption; defaults to a note that the order is wire order. */
  caption?: ReactNode;
  className?: string;
}

function widthPercent(bits: number, widest: number): number {
  if (widest <= 0) return 0;
  return Math.max(4, Math.min(100, (bits / widest) * 100));
}

export function HeaderTable({ fields, layer, caption, className }: HeaderTableProps) {
  const full = useDetail() === 'full';

  if (fields.length === 0) {
    return (
      <p className={cn('text-fg-muted text-small', className)}>
        This header has no fields in the scenario.
      </p>
    );
  }

  const widest = Math.max(...fields.map((field) => field.bits ?? 0));
  const barColor = layer ? layerColor(layer) : 'var(--border-strong)';

  return (
    <table className={cn('text-small w-full border-collapse text-left', className)}>
      <caption className="text-fg-muted text-caption pb-2 text-left leading-snug">
        {caption ?? 'Fields in wire order — the order they appear in the packet.'}
      </caption>
      <thead>
        <tr className="text-fg-muted text-caption tracking-wider uppercase">
          <th scope="col" className="py-1 pr-3 font-medium">
            Field
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Value
          </th>
          {full ? (
            <th scope="col" className="py-1 font-medium">
              Width
            </th>
          ) : null}
        </tr>
      </thead>

      {/*
        One `<tbody>` per field rather than one `<tr>`: the teaching note needs the full
        width of the panel to be readable, and grouping its row with the field's own row
        keeps the pairing explicit for a screen reader and lets the rule between fields
        sit where a reader expects it.
      */}
      {fields.map((field, index) => (
        <tbody
          key={`${field.name}-${index}`}
          className="border-border/60 border-t align-top"
        >
          <tr>
            <th scope="row" className="text-fg-secondary py-1.5 pr-3 font-medium">
              {field.name}
            </th>
            <td className="text-fg py-1.5 pr-3 font-mono break-all">{field.value}</td>
            {full ? (
              <td className="py-1.5 whitespace-nowrap">
                {field.bits === undefined ? (
                  <span
                    className="text-fg-muted"
                    title="Width not stated by the scenario"
                  >
                    &mdash;
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="bg-border/40 block h-1.5 w-10 shrink-0 overflow-hidden rounded-full"
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${widthPercent(field.bits, widest)}%`,
                          backgroundColor: barColor,
                        }}
                      />
                    </span>
                    <span className="text-fg-muted text-caption font-mono">
                      {field.bits}
                      <span aria-hidden="true"> b</span>
                      <span className="sr-only"> bits</span>
                    </span>
                  </span>
                )}
              </td>
            ) : null}
          </tr>

          {field.note ? (
            <tr>
              <td
                colSpan={full ? 3 : 2}
                className="text-fg-muted text-small pb-2 leading-snug"
              >
                <span className="text-fg-secondary font-medium">
                  What it&rsquo;s for:{' '}
                </span>
                {field.note}
              </td>
            </tr>
          ) : null}
        </tbody>
      ))}
    </table>
  );
}
