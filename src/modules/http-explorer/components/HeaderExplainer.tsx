'use client';

import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import {
  DIRECTION_LABELS,
  explainHeader,
  formatSpec,
  HEADER_EXPLANATIONS,
} from '../headers';

/**
 * What the field you are looking at is for.
 *
 * `WireView` makes every field line focusable; this is what answers it. The point of
 * having the two side by side is that a header stops being noise around the interesting
 * part of a message and becomes the interesting part -- a `Vary` you can see is a `Vary`
 * you might one day remember to send.
 *
 * ## Three things, in this order
 *
 * **What it does**, then **who set it**, then **the sharp edge**. Who set it comes second
 * because it is the answer people are most often wrong about: `Host`, `Cookie`, `Origin`,
 * and `Accept-Encoding` are all added by the browser rather than by the code that made
 * the request, which is exactly why the code cannot turn them off and why CSRF works.
 *
 * The citation is last and always present, including when it is an admission: three of
 * the fields the scenarios use are the WHATWG Fetch Standard's rather than an RFC's, and
 * one of them -- `X-Request-Id` -- is nobody's at all. Printing "No specification" is
 * more useful than quietly leaving the line off, because a field with no document behind
 * it behaves differently from one that has.
 */

export interface HeaderExplainerProps {
  /** The field name, as it appeared on the wire. Matching is case-insensitive. */
  name: string | null;
  /** Its value on this message, shown so the explanation is about something concrete. */
  value?: string;
  className?: string;
}

/** The value split into its parameters, since a comma-separated field reads as a list. */
function valueParts(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
        {label}
      </span>
      <p className="text-fg-secondary text-xs leading-relaxed">{children}</p>
    </div>
  );
}

export function HeaderExplainer({ name, value, className }: HeaderExplainerProps) {
  const entry = name ? explainHeader(name) : undefined;

  if (!name) {
    return (
      <Panel title="Header" className={cn('min-w-0', className)}>
        <p className="text-fg-muted text-xs leading-relaxed">
          Click or tab to any field line in the message beside this one and it will
          explain itself here — what it does, who put it there, and where it is defined.{' '}
          {HEADER_EXPLANATIONS.length} fields are catalogued.
        </p>
      </Panel>
    );
  }

  if (!entry) {
    return (
      <Panel
        title="Header"
        aside={<Badge tone="neutral">not catalogued</Badge>}
        className={cn('min-w-0', className)}
      >
        <p className="text-fg font-mono text-xs break-all">{name}</p>
        <p className="text-fg-muted mt-2 text-xs leading-relaxed">
          This module has no entry for {name}. That is a gap in{' '}
          <code className="font-mono">headers.ts</code> rather than a statement about the
          field — invented explanations would be worse than none.
        </p>
      </Panel>
    );
  }

  const parts = value ? valueParts(value) : [];

  return (
    <Panel
      title={entry.name}
      aside={<Badge tone="accent">{DIRECTION_LABELS[entry.direction]}</Badge>}
      scroll
      className={cn('max-h-[34rem] min-w-0', className)}
    >
      <div className="flex flex-col gap-3">
        {value !== undefined ? (
          <div className="border-border bg-surface rounded-lg border px-2 py-1.5">
            <p className="text-fg-secondary font-mono text-xs break-all">{value}</p>
            {parts.length > 1 ? (
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {parts.map((part, index) => (
                  <li key={`${part}-${index}`}>
                    <Badge tone="neutral">{part}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <Row label="What it does">{entry.what}</Row>
        <Row label="Who sets it">{entry.setBy}</Row>
        {entry.detail ? <Row label="The sharp edge">{entry.detail}</Row> : null}

        <div className="border-border/60 flex flex-wrap items-center gap-2 border-t pt-2">
          <Badge tone={entry.reference.kind === 'none' ? 'warn' : 'neutral'}>
            {formatSpec(entry.reference)}
          </Badge>
          <span className="text-fg-muted text-[0.6875rem]">
            {entry.reference.kind === 'none'
              ? entry.reference.note
              : entry.reference.title}
          </span>
        </div>
      </div>
    </Panel>
  );
}
