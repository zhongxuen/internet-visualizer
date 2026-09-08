'use client';

import { useState } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  decomposeSuite,
  namedComponentCount,
  type CipherSuite,
  type SuiteComponent,
} from '@/core/protocols/tls/cipher';

/**
 * A suite name, taken apart.
 *
 * `TLS_AES_128_GCM_SHA256` is four words of jargon most people read as one opaque blob,
 * and the most useful thing to notice about it is what is *missing*: there is no `ECDHE`
 * and no `RSA` in it. TLS 1.3 took both decisions out of the suite and put them in
 * extensions, which is why five suites replaced several hundred.
 *
 * So the four rows are always drawn, in the same order, for both versions. A TLS 1.3
 * suite renders two of them greyed with the extension that now carries the decision --
 * rather than rendering a shorter list, which would read as "this version has less to
 * say" instead of "this decision moved". `decomposeSuite` guarantees the four-row shape;
 * this component only draws it.
 *
 * ## Highlighting
 *
 * The name at the top is segmented by scanning for each row's `token` in order, so
 * hovering or focusing a row lights up the exact substring it explains. Segments are
 * derived from the name rather than reassembled from the parts, so a suite whose
 * registered name does not decompose cleanly degrades to a plain name rather than to a
 * wrong one.
 */

export interface CipherSuiteBreakdownProps {
  suite: CipherSuite;
  /**
   * The other version's suite, named underneath as the thing the row count is a claim
   * about. Omit to draw the negotiated suite alone.
   */
  compareWith?: CipherSuite;
  className?: string;
}

/** One piece of the rendered name: either a matched token or the glue between tokens. */
export interface NameSegment {
  readonly text: string;
  /** Index into the component list, or `null` for separators and unmatched text. */
  readonly component: number | null;
}

/**
 * Split a suite name into segments, one per component token.
 *
 * A left-to-right scan rather than a regex: tokens contain underscores (`AES_128_GCM`),
 * appear in name order, and may be absent (TLS 1.3 has no key-exchange token), so
 * position is the only reliable way to attribute a substring to a row.
 */
export function segmentSuiteName(
  name: string,
  components: readonly SuiteComponent[],
): readonly NameSegment[] {
  const segments: NameSegment[] = [];
  let cursor = 0;

  components.forEach((component, index) => {
    if (!component.token) return;
    const found = name.indexOf(component.token, cursor);
    if (found < 0) return;
    if (found > cursor) {
      segments.push({ text: name.slice(cursor, found), component: null });
    }
    segments.push({ text: component.token, component: index });
    cursor = found + component.token.length;
  });

  if (cursor < name.length) segments.push({ text: name.slice(cursor), component: null });
  return segments;
}

function ComponentRow({
  component,
  index,
  active,
  onActivate,
}: {
  component: SuiteComponent;
  index: number;
  active: boolean;
  onActivate: (index: number | null) => void;
}) {
  const moved = component.movedOutOfSuiteName;

  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onActivate(active ? null : index)}
        onMouseEnter={() => onActivate(index)}
        onFocus={() => onActivate(index)}
        className={cn(
          'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
          focusRing,
          active
            ? 'border-accent/60 bg-accent/10'
            : 'border-border bg-surface hover:border-border-strong',
          moved && !active && 'state-dim',
        )}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
            {component.role}
          </span>
          {component.token ? (
            <span
              className={cn(
                'font-mono text-[0.6875rem]',
                active ? 'text-accent' : 'text-fg-secondary',
              )}
            >
              {component.token}
            </span>
          ) : (
            <Badge tone="neutral">not in the name</Badge>
          )}
        </span>

        <span className="text-fg mt-0.5 block text-xs leading-snug">
          {component.value}
        </span>
        <span className="text-fg-muted mt-1 block text-[0.625rem] leading-snug">
          {component.explain}
        </span>

        {component.negotiatedBy ? (
          <span className="text-fg-secondary mt-1 block font-mono text-[0.5625rem] leading-snug">
            negotiated instead by {component.negotiatedBy}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function CipherSuiteBreakdown({
  suite,
  compareWith,
  className,
}: CipherSuiteBreakdownProps) {
  const [active, setActive] = useState<number | null>(null);
  const components = decomposeSuite(suite);
  const segments = segmentSuiteName(suite.name, components);
  const named = namedComponentCount(suite.version);

  return (
    <Panel
      title="Cipher suite, decomposed"
      aside={
        <Badge tone={suite.recommended ? 'ok' : 'error'}>
          {suite.recommended ? 'recommended' : 'no longer acceptable'}
        </Badge>
      }
      className={className}
    >
      <div className="flex flex-col gap-3">
        <p className="bg-surface border-border overflow-x-auto rounded-lg border px-2.5 py-2 font-mono text-xs whitespace-nowrap">
          {segments.map((segment, index) => (
            <span
              key={`${segment.text}-${index}`}
              className={cn(
                segment.component === null && 'text-fg-muted',
                segment.component !== null &&
                  (components[segment.component]?.movedOutOfSuiteName
                    ? 'text-fg-muted'
                    : 'text-fg'),
                segment.component !== null &&
                  segment.component === active &&
                  'text-accent',
              )}
            >
              {segment.text}
            </span>
          ))}
          <span className="text-fg-muted"> · {suite.codePoint}</span>
        </p>

        <p className="text-fg-secondary text-[0.6875rem] leading-snug">
          {suite.version} spells out <strong className="text-fg">{named}</strong> of the
          four decisions in the name.{' '}
          {suite.version === 'TLS 1.3'
            ? 'Key exchange and authentication moved into extensions, so the name now says only how records are protected and which hash the key schedule runs on. That is why TLS 1.3 has five suites and TLS 1.2 has several hundred.'
            : 'Key exchange and authentication are baked into the name, so every combination needs its own registered suite — and a server offering the wrong one for its certificate simply fails to negotiate.'}
        </p>

        <ul className="flex flex-col gap-1.5">
          {components.map((component, index) => (
            <ComponentRow
              key={component.role}
              component={component}
              index={index}
              active={active === index}
              onActivate={setActive}
            />
          ))}
        </ul>

        <dl className="border-border/60 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2">
          <div>
            <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
              Forward secrecy
            </dt>
            <dd
              className={cn(
                'font-mono text-[0.6875rem]',
                suite.forwardSecrecy ? 'text-state-ok' : 'text-state-error',
              )}
            >
              {suite.forwardSecrecy ? 'yes' : 'no'}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">
              Per-record overhead
            </dt>
            <dd className="text-fg-secondary font-mono text-[0.6875rem]">
              {suite.tagBytes}-byte tag · {suite.ivBytes}-byte IV
            </dd>
          </div>
        </dl>

        <p className="text-fg-muted text-[0.625rem] leading-snug">{suite.note}</p>

        {compareWith ? (
          <p className="border-border/60 text-fg-muted border-t pt-2 text-[0.625rem] leading-snug">
            <span className="text-fg-secondary font-mono">{compareWith.name}</span> is the{' '}
            {compareWith.version} suite this run is compared against —{' '}
            {namedComponentCount(compareWith.version)} components named, and{' '}
            {compareWith.forwardSecrecy
              ? 'forward secrecy either way.'
              : 'no forward secrecy at all.'}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
