'use client';

import { useMemo, useState, type ReactNode } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  describeObject,
  originOf,
  type FieldExplanation,
  type FieldOrigin,
  type ShapeField,
} from '../shape';
import { parseJson, type JsonObject, type JsonValue } from '../sim/message';
import type { ResourceDefinition } from '../sim/rest';

/**
 * A response body, taken apart key by key.
 *
 * A pretty-printed JSON blob is not an explanation. Every API a learner integrates with
 * wraps its payload in an envelope somebody invented, reports errors in a shape somebody
 * else invented, and paginates with three keys from a fourth tradition -- and none of that is
 * written down where the body is. So each key here is annotated with what it means and, where
 * it matters, which specification says so.
 *
 * ## Why the body is parsed rather than passed in as an object
 *
 * The raw text is what arrived. Parsing it here means the panel shows the document that was
 * actually sent, byte for byte, and can say something useful when there is no document at
 * all -- which is the interesting case for a `204`, and the case a component handed a
 * pre-parsed object could not tell apart from an empty one.
 *
 * ## What "no body" means
 *
 * `204 No Content` carries nothing. Not `{}`, not `null`, not an empty string -- nothing, and
 * a client that calls `response.json()` on one gets an exception rather than a value. Saying
 * so plainly is worth a panel state of its own, because the alternative is rendering an empty
 * box that reads as a bug.
 */

export interface ResponseShapeProps {
  /** The body exactly as it arrived. `undefined` means there was none at all. */
  body: string | undefined;
  /** The resource whose own field definitions explain the leaves, when there is one. */
  resource?: ResourceDefinition;
  /** Panel heading. */
  title?: ReactNode;
  /** Right-aligned slot in the panel header -- a status badge, usually. */
  aside?: ReactNode;
  /** Shown above the tree: one line naming what this document is. */
  caption?: ReactNode;
  className?: string;
}

const ORIGIN_LABELS: Readonly<Record<FieldOrigin, string>> = {
  problem: 'RFC 9457 problem details',
  envelope: 'envelope convention',
  pagination: 'pagination',
  graphql: 'GraphQL response',
  oauth: 'OAuth 2.0 token response',
  webhook: 'webhook event',
  resource: 'this resource',
};

/**
 * Whether a key is specified anywhere, or is simply what everybody does.
 *
 * Worth marking. `detail` is in an RFC and `data` is not, and a learner who cannot tell which
 * is which will write an integration that treats a convention as a guarantee.
 */
const ORIGIN_TONES: Readonly<Record<FieldOrigin, 'accent' | 'neutral'>> = {
  problem: 'accent',
  envelope: 'neutral',
  pagination: 'neutral',
  graphql: 'accent',
  oauth: 'accent',
  webhook: 'neutral',
  resource: 'neutral',
};

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A scalar as it should be read: strings quoted, null visible, numbers bare. */
function renderScalar(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  return `${value}`;
}

/** The one-line summary a container gets instead of a value. */
function summarize(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  return `${Object.keys(value as JsonObject).length} fields`;
}

function ExplanationText({ explanation }: { explanation: FieldExplanation }) {
  return (
    <div className="mt-1 flex flex-col gap-1">
      <p className="text-fg-secondary text-xs leading-relaxed">{explanation.what}</p>
      {explanation.detail ? (
        <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
          {explanation.detail}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={ORIGIN_TONES[explanation.origin]}>
          {ORIGIN_LABELS[explanation.origin]}
        </Badge>
        {explanation.reference ? (
          <span className="text-fg-muted font-mono text-[0.625rem]">
            RFC {explanation.reference.rfc}
            {explanation.reference.section ? ` §${explanation.reference.section}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  path,
  depth,
  expanded,
  onToggle,
  resource,
}: {
  field: ShapeField;
  path: string;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  resource?: ResourceDefinition;
}) {
  const container = typeof field.value === 'object' && field.value !== null;
  const open = expanded.has(path);
  const explained = field.explanation !== undefined;

  return (
    <li className="min-w-0">
      <div
        className={cn(
          'border-border/70 rounded-lg border px-2.5 py-1.5',
          explained ? 'bg-surface' : 'bg-surface/50',
        )}
      >
        {explained ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(path)}
            className={cn(
              'flex w-full items-baseline gap-2 rounded text-left',
              focusRing,
            )}
          >
            <span className="text-accent shrink-0 font-mono text-xs">{field.name}</span>
            <span className="text-fg-muted shrink-0 text-[0.625rem]">
              {open ? '▾' : '▸'}
            </span>
            <span className="text-fg min-w-0 flex-1 truncate font-mono text-xs">
              {container ? summarize(field.value) : renderScalar(field.value)}
            </span>
          </button>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-fg-secondary shrink-0 font-mono text-xs">
              {field.name}
            </span>
            <span className="text-fg min-w-0 flex-1 truncate font-mono text-xs">
              {container ? summarize(field.value) : renderScalar(field.value)}
            </span>
          </div>
        )}

        {open && field.explanation ? (
          <ExplanationText explanation={field.explanation} />
        ) : null}
      </div>

      {container ? (
        <ValueTree
          value={field.value}
          path={path}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          {...(resource ? { resource } : {})}
        />
      ) : null}
    </li>
  );
}

function ValueTree({
  value,
  path,
  depth,
  expanded,
  onToggle,
  resource,
}: {
  value: JsonValue;
  path: string;
  depth: number;
  expanded: ReadonlySet<string>;
  onToggle: (path: string) => void;
  resource?: ResourceDefinition;
}) {
  // Six levels is deeper than anything this module produces; the guard is here so a
  // pathological document from the console cannot lock the page up.
  if (depth > 6) return null;

  if (Array.isArray(value)) {
    return (
      <ol className="mt-1 ml-3 flex min-w-0 flex-col gap-1 border-l border-dashed border-[var(--border)] pl-3">
        {value.map((item, index) => (
          <li key={`${path}[${index}]`} className="min-w-0">
            <p className="text-fg-muted font-mono text-[0.625rem]">[{index}]</p>
            {typeof item === 'object' && item !== null ? (
              <ValueTree
                value={item}
                path={`${path}[${index}]`}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                {...(resource ? { resource } : {})}
              />
            ) : (
              <p className="text-fg font-mono text-xs">{renderScalar(item)}</p>
            )}
          </li>
        ))}
      </ol>
    );
  }

  if (!isObject(value)) return null;

  const fields = describeObject(value, {
    origin: originOf(value),
    ...(resource ? { resource } : {}),
  });

  return (
    <ul
      className={cn(
        'mt-1 flex min-w-0 flex-col gap-1',
        depth > 0 && 'ml-3 border-l border-dashed border-[var(--border)] pl-3',
      )}
    >
      {fields.map((field) => (
        <FieldRow
          key={`${path}.${field.name}`}
          field={field}
          path={`${path}.${field.name}`}
          depth={depth}
          expanded={expanded}
          onToggle={onToggle}
          {...(resource ? { resource } : {})}
        />
      ))}
    </ul>
  );
}

export function ResponseShape({
  body,
  resource,
  title = 'Response shape',
  aside,
  caption,
  className,
}: ResponseShapeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const parsed = useMemo(
    () => (body === undefined || body === '' ? undefined : parseJson(body)),
    [body],
  );

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <Panel title={title} aside={aside} scroll className={cn('min-w-0', className)}>
      <div className="flex min-w-0 flex-col gap-2">
        {caption ? (
          <p className="text-fg-secondary text-xs leading-relaxed">{caption}</p>
        ) : null}

        {parsed === undefined ? (
          <p className="text-fg-muted text-xs leading-relaxed">
            There is no body at all — not <code className="font-mono">{'{}'}</code>, not{' '}
            <code className="font-mono">null</code>, not an empty string. A{' '}
            <code className="font-mono">204</code> and a{' '}
            <code className="font-mono">HEAD</code> response are defined to carry nothing,
            so a client that calls <code className="font-mono">response.json()</code> on
            one gets an exception rather than a value.
          </p>
        ) : !parsed.ok ? (
          <p className="text-state-warn text-xs leading-relaxed">
            This body is not JSON: {parsed.error}
          </p>
        ) : (
          <>
            <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
              Keys with a coloured name are explained — open one. What is not explained is
              this resource&rsquo;s own data.
            </p>
            <ValueTree
              value={parsed.value}
              path="$"
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              {...(resource ? { resource } : {})}
            />
          </>
        )}
      </div>
    </Panel>
  );
}
