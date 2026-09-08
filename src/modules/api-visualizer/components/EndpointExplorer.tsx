'use client';

import { useState } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import type { HttpMethod } from '../sim/message';
import { allowedMethods, verbSemantics, type ResourceDefinition } from '../sim/rest';

/**
 * The mock API's surface, as nouns and the verbs that reach them.
 *
 * The shape of the list is the argument. Two paths per resource -- the collection and one
 * member of it -- and a different set of verbs on each, because they are different resources
 * that happen to share a prefix. `POST /articles` creates a member of the collection;
 * `POST /articles/1` is meaningless, and the explorer shows that by not offering it rather
 * than by explaining it.
 *
 * ## Why the two properties are on the chip
 *
 * Safe and idempotent are not trivia. They are the promises every intermediary is built on: a
 * browser prefetches safe requests, a proxy retries idempotent ones, a crawler follows links
 * assuming both. A `GET` handler that deletes a row is not a redefinition of `GET`; it is a
 * resource that four different pieces of software will break, and none of them will ask
 * first. So the two markers are on the chip itself, next to the verb, and not hidden behind a
 * hover.
 *
 * `POST` is the only method that is neither, which is worth noticing as a shape rather than
 * as a sentence -- it is why idempotency keys exist, and it is visible here as the one chip
 * with both markers off.
 */

export interface EndpointExplorerProps {
  resources: readonly ResourceDefinition[];
  /** Fired when a verb chip is activated -- the console uses it to prefill a request. */
  onSelect?: (choice: { method: HttpMethod; target: string }) => void;
  /** The path the console is currently pointed at, so the tree can mark it. */
  activeTarget?: string;
  className?: string;
}

/** An example member id, so the item path is something a learner can actually send. */
const EXAMPLE_ID = '1';

function VerbChip({
  method,
  target,
  onSelect,
}: {
  method: HttpMethod;
  target: string;
  onSelect?: (choice: { method: HttpMethod; target: string }) => void;
}) {
  const semantics = verbSemantics(method);
  const neither = !semantics.safe && !semantics.idempotent;

  const chip = (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-[0.6875rem] font-semibold">{method}</span>
      <span aria-hidden="true" className="flex items-center gap-0.5 text-[0.5625rem]">
        <span
          className={
            semantics.safe ? 'text-state-ok' : 'text-fg-dim line-through decoration-1'
          }
        >
          S
        </span>
        <span
          className={
            semantics.idempotent ? 'text-accent' : 'text-fg-dim line-through decoration-1'
          }
        >
          I
        </span>
      </span>
    </span>
  );

  const label = `${method} ${target}. ${semantics.safe ? 'Safe' : 'Not safe'}, ${semantics.idempotent ? 'idempotent' : 'not idempotent'}. ${semantics.what} ${semantics.detail}`;

  if (!onSelect) {
    return (
      <li>
        <span
          title={label}
          className={cn(
            'border-border bg-surface text-fg-secondary inline-flex rounded-md border px-2 py-1',
            neither && 'border-state-warn/40',
          )}
        >
          {chip}
          <span className="sr-only">{label}</span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        title={label}
        onClick={() => onSelect({ method, target })}
        className={cn(
          'border-border bg-surface text-fg-secondary hover:border-border-strong hover:bg-surface-overlay hover:text-fg inline-flex rounded-md border px-2 py-1 transition-colors',
          focusRing,
          neither && 'border-state-warn/40',
        )}
      >
        {chip}
        <span className="sr-only">{label}</span>
      </button>
    </li>
  );
}

function PathRow({
  path,
  label,
  methods,
  active,
  onSelect,
}: {
  path: string;
  label: string;
  methods: readonly HttpMethod[];
  active: boolean;
  onSelect?: (choice: { method: HttpMethod; target: string }) => void;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-2.5 py-2',
        active ? 'border-accent/50 bg-accent/8' : 'border-border/70 bg-surface/50',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <code className="text-fg font-mono text-xs">{path}</code>
        <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
          {label}
        </span>
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-1">
        {methods.map((method) => (
          <VerbChip
            key={method}
            method={method}
            target={path}
            {...(onSelect ? { onSelect } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

function ResourceCard({
  resource,
  activeTarget,
  onSelect,
}: {
  resource: ResourceDefinition;
  activeTarget?: string;
  onSelect?: (choice: { method: HttpMethod; target: string }) => void;
}) {
  const [showFields, setShowFields] = useState(false);
  const itemPath = `${resource.collectionPath}/${EXAMPLE_ID}`;

  const collectionMethods = allowedMethods({
    kind: 'collection',
    resource,
    path: resource.collectionPath,
  });
  const itemMethods = allowedMethods({
    kind: 'item',
    resource,
    id: EXAMPLE_ID,
    path: itemPath,
  });

  return (
    <li className="border-border bg-surface-raised flex min-w-0 flex-col gap-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* `h3`, not `h4`: the nearest heading above this is the panel's `h2`. */}
        <h3 className="text-fg text-sm font-medium">{resource.name}</h3>
        {resource.asynchronousCreate ? (
          <Badge tone="pending">creates asynchronously — 202</Badge>
        ) : null}
      </div>
      <p className="text-fg-secondary text-xs leading-relaxed">{resource.summary}</p>

      <PathRow
        path={resource.collectionPath}
        label="collection"
        methods={collectionMethods}
        active={activeTarget === resource.collectionPath}
        {...(onSelect ? { onSelect } : {})}
      />
      <PathRow
        path={itemPath}
        label="one member"
        methods={itemMethods}
        active={activeTarget === itemPath}
        {...(onSelect ? { onSelect } : {})}
      />

      <button
        type="button"
        aria-expanded={showFields}
        onClick={() => setShowFields((open) => !open)}
        className={cn(
          'text-fg-muted hover:text-fg self-start rounded text-[0.6875rem] transition-colors',
          focusRing,
        )}
      >
        {showFields ? '▾' : '▸'} {resource.fields.length} fields
      </button>

      {showFields ? (
        <ul className="flex flex-col gap-1">
          {resource.fields.map((field) => (
            <li
              key={field.name}
              className="border-border/60 bg-surface rounded-lg border px-2.5 py-1.5"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <code className="text-accent font-mono text-xs">{field.name}</code>
                <span className="text-fg-muted font-mono text-[0.625rem]">
                  {field.type}
                </span>
                {field.required ? <Badge tone="neutral">required</Badge> : null}
                {field.serverOwned ? <Badge tone="warn">server-owned</Badge> : null}
              </div>
              <p className="text-fg-secondary mt-1 text-[0.6875rem] leading-relaxed">
                {field.what}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function EndpointExplorer({
  resources,
  onSelect,
  activeTarget,
  className,
}: EndpointExplorerProps) {
  return (
    <Panel
      title="Endpoints"
      aside={<Badge tone="ok">simulated</Badge>}
      scroll
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-fg-secondary text-xs leading-relaxed">
          Three resources, each reachable at two paths: the collection, and one member of
          it. They take different verbs because they are different resources that happen
          to share a prefix — <code className="font-mono">POST</code> to a collection
          creates a member, and <code className="font-mono">POST</code> to a member means
          nothing.
        </p>
        <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
          On each chip, <span className="text-state-ok font-mono">S</span> marks a{' '}
          <em>safe</em> method — one that changes nothing, so a prefetcher, a crawler, or
          a browser restoring tabs may perform it unbidden — and{' '}
          <span className="text-accent font-mono">I</span> marks an <em>idempotent</em>{' '}
          one, which a proxy or a retry library may repeat after a timeout.{' '}
          <code className="font-mono">POST</code> is the only method that is neither, and
          every idempotency key ever written exists because of that.
        </p>

        <ul className="flex min-w-0 flex-col gap-2">
          {resources.map((resource) => (
            <ResourceCard
              key={resource.name}
              resource={resource}
              {...(activeTarget ? { activeTarget } : {})}
              {...(onSelect ? { onSelect } : {})}
            />
          ))}
        </ul>
      </div>
    </Panel>
  );
}
