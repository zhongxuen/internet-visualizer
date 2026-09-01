'use client';

import { MousePointerClick } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge, EmptyState, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import type { Annotation } from '@/core/sim/project';
import type { NodeState } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { SimLink, SimNode, Topology } from '@/core/types/topology';
import { cn } from '@/lib/cn';

import { linkMediumToken } from './edges/media';
import { AddressList } from './nodes/AddressList';
import { nodeKindToken } from './nodes/kinds';
import { nodeStateToken } from './nodes/state';
import { PacketLayerStack } from './PacketLayerStack';
import type { CanvasSelection } from './types';

/**
 * The right-hand panel: everything about the one thing the user has clicked.
 *
 * The canvas can only ever say so much — a node card has room for a label, a role, and an
 * address or two, and a packet chip has room for a protocol name. The inspector is where
 * the rest lives, and it is deliberately the *only* place that grows as scenarios get
 * richer, so the diagram stays readable no matter how much detail a module carries.
 *
 * Three things can be selected, and each answers a different question:
 *
 *   - a **node** — what is this machine, what layer does it work at, what addresses does
 *     it answer to, what is it doing right now, and what is it connected to
 *   - a **link** — what kind of hop is this and what does it cost (its latency is the
 *     reason a packet on the canvas moves at the speed it does)
 *   - a **PDU** — the encapsulation stack, expandable down to individual header fields
 *
 * Everything shown is read from the domain model by value. Nothing is inferred and nothing
 * is invented: a field the scenario did not set simply does not appear.
 *
 * The panel is also a navigation surface — a node lists its links and a link names its
 * endpoints, both as buttons that move the selection — so a topology can be explored
 * entirely from here by keyboard, with no pointer and no canvas.
 */

export interface InspectorProps {
  topology: Topology;
  /** What the canvas (or a packet chip) currently has selected. */
  selection: CanvasSelection | null;
  /** Every PDU the run has created, keyed by id — `SimResult.pdus`. */
  pdus?: Readonly<Record<string, PDU>>;
  /** Highlight state per node id, from `projectAt`; anything absent is `'idle'`. */
  nodeStates?: Readonly<Record<string, NodeState>>;
  /** Teaching notes currently pinned; only those targeting the selection are shown. */
  annotations?: readonly Annotation[];
  /** Move the selection — wired to the same setter the canvas uses. */
  onSelect?: (selection: CanvasSelection | null) => void;
  title?: ReactNode;
  /** Module-specific extras, appended below the standard detail. */
  children?: ReactNode;
  className?: string;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

interface Fact {
  label: string;
  value: ReactNode;
}

/** Label/value pairs as a real `<dl>`, so the pairing survives a screen reader. */
function Facts({ facts }: { facts: readonly Fact[] }) {
  if (facts.length === 0) return null;

  return (
    <dl className="grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-3 gap-y-1 text-xs">
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-fg-muted">{fact.label}</dt>
          <dd className="text-fg-secondary break-words">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A row that moves the selection somewhere else on the diagram. */
function SelectButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-border bg-surface hover:border-border-strong hover:bg-surface-overlay flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Notes the simulation pinned to this object, with their citation.
 *
 * The reference is what turns "the router decremented TTL" into something a learner can
 * check for themselves, so it is printed rather than tucked into a tooltip.
 */
function Notes({ annotations }: { annotations: readonly Annotation[] }) {
  if (annotations.length === 0) return null;

  return (
    <Section title="Notes">
      <ul className="flex flex-col gap-1.5">
        {annotations.map((annotation) => (
          <li
            key={annotation.id}
            className="border-accent/50 bg-surface text-fg-secondary rounded-md border-l-2 px-2 py-1.5 text-xs leading-snug"
          >
            {annotation.text}
            {annotation.reference ? (
              <span className="text-fg-muted mt-1 block text-[0.6875rem]">
                RFC {annotation.reference.rfc}
                {annotation.reference.section ? ` §${annotation.reference.section}` : ''}
                {' — '}
                {annotation.reference.title}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function NodeDetail({
  node,
  state,
  topology,
  onSelect,
}: {
  node: SimNode;
  state: NodeState;
  topology: Topology;
  onSelect?: (selection: CanvasSelection | null) => void;
}) {
  const kind = nodeKindToken(node.kind);
  const status = nodeStateToken(state);
  const KindIcon = kind.icon;
  const StatusIcon = status.icon;

  const labels = new Map(topology.nodes.map((entry) => [entry.id, entry.label]));
  const links = topology.links.filter(
    (link) => link.from === node.id || link.to === node.id,
  );

  const details = Object.entries(node.detail ?? {});

  return (
    <>
      <header className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="bg-surface-overlay text-fg-secondary border-border flex size-8 shrink-0 items-center justify-center rounded-md border"
        >
          <KindIcon className="size-4" strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-fg block text-sm font-medium break-words">
            {node.label}
          </span>
          <span className="text-fg-muted block text-[0.6875rem] tracking-wider uppercase">
            {kind.roleLabel}
          </span>
        </span>
        <span
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium',
            status.chip,
          )}
        >
          <StatusIcon aria-hidden="true" className="size-3" strokeWidth={2.25} />
          {status.label}
        </span>
      </header>

      <p className="text-fg-secondary text-xs leading-snug">{kind.description}</p>

      <Badge layer={kind.layer} className="w-fit px-1.5 py-0 text-[0.6875rem]">
        {kind.layerAction}
      </Badge>

      <Section title="Addresses">
        {node.ipv4 || node.ipv6 || node.mac ? (
          // `always`: a view may have hidden addressing on the canvas to keep the diagram
          // readable, but the inspector is one machine, opened deliberately -- it is not
          // what causes the overload that toggle exists to remove.
          <AddressList node={node} always className="text-xs" />
        ) : (
          <p className="text-fg-muted text-xs">
            The scenario gives this machine no addresses.
          </p>
        )}
      </Section>

      {details.length > 0 ? (
        <Section title="Detail">
          <Facts facts={details.map(([label, value]) => ({ label, value }))} />
        </Section>
      ) : null}

      {links.length > 0 ? (
        <Section title={links.length === 1 ? 'Link' : 'Links'}>
          <ul className="flex flex-col gap-1">
            {links.map((link) => {
              const otherId = link.from === node.id ? link.to : link.from;
              const medium = linkMediumToken(link.medium);
              const MediumIcon = medium?.icon;

              return (
                <li key={link.id}>
                  <SelectButton onClick={() => onSelect?.({ type: 'link', id: link.id })}>
                    {MediumIcon ? (
                      <MediumIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    ) : null}
                    <span className="text-fg-secondary min-w-0 flex-1 truncate">
                      {labels.get(otherId) ?? otherId}
                    </span>
                    <span className="text-fg-muted shrink-0 font-mono text-[0.6875rem]">
                      {link.latencyMs} ms
                    </span>
                  </SelectButton>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

function LinkDetail({
  link,
  topology,
  onSelect,
}: {
  link: SimLink;
  topology: Topology;
  onSelect?: (selection: CanvasSelection | null) => void;
}) {
  const labels = new Map(topology.nodes.map((entry) => [entry.id, entry.label]));
  const medium = linkMediumToken(link.medium);
  const fromLabel = labels.get(link.from) ?? link.from;
  const toLabel = labels.get(link.to) ?? link.to;

  return (
    <>
      <header className="flex flex-col gap-1">
        <span className="text-fg text-sm font-medium break-words">
          {fromLabel} &harr; {toLabel}
        </span>
        <span className="text-fg-muted text-[0.6875rem] tracking-wider uppercase">
          {medium ? medium.label : 'Link'}
        </span>
      </header>

      {medium ? (
        <p className="text-fg-secondary text-xs leading-snug">{medium.description}</p>
      ) : (
        <p className="text-fg-muted text-xs leading-snug">
          The scenario does not say what this hop physically is.
        </p>
      )}

      <Section title="Cost of the hop">
        <Facts
          facts={[
            { label: 'One way', value: `${link.latencyMs} ms` },
            // Printed as the arithmetic rather than as the answer: that a round trip is
            // twice the one-way latency is the thing being taught.
            {
              label: 'Round trip',
              value: `${link.latencyMs} × 2 = ${link.latencyMs * 2} ms`,
            },
            ...(link.bandwidthMbps === undefined
              ? []
              : [{ label: 'Bandwidth', value: `${link.bandwidthMbps} Mb/s` }]),
          ]}
        />
      </Section>

      <Section title="Endpoints">
        <ul className="flex flex-col gap-1">
          {[
            { id: link.from, label: fromLabel },
            { id: link.to, label: toLabel },
          ].map((end) => (
            <li key={end.id}>
              <SelectButton onClick={() => onSelect?.({ type: 'node', id: end.id })}>
                <span className="text-fg-secondary min-w-0 flex-1 truncate">
                  {end.label}
                </span>
              </SelectButton>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function PduDetail({ pdu }: { pdu: PDU }) {
  const outer = pdu.layers[0];
  const inner = pdu.layers[pdu.layers.length - 1];

  return (
    <>
      <header className="flex flex-col gap-1">
        <span className="text-fg font-mono text-sm break-words">{pdu.summary}</span>
        <span className="text-fg-muted text-[0.6875rem] tracking-wider uppercase">
          {outer && inner
            ? `${outer.protocol} carrying ${inner.protocol}`
            : 'Protocol data unit'}
        </span>
      </header>

      <Facts
        facts={[
          { label: 'Size', value: `${pdu.sizeBytes} bytes on the wire` },
          {
            label: 'Layers',
            value: pdu.layers.length === 1 ? '1 header' : `${pdu.layers.length} headers`,
          },
        ]}
      />

      <Section title="Encapsulation">
        <PacketLayerStack pdu={pdu} />
      </Section>
    </>
  );
}

/** What the panel header calls each kind of selection. */
const KIND_LABEL: Record<CanvasSelection['type'], string> = {
  node: 'Machine',
  link: 'Link',
  pdu: 'Packet',
};

export function Inspector({
  topology,
  selection,
  pdus,
  nodeStates,
  annotations,
  onSelect,
  title = 'Inspector',
  children,
  className,
}: InspectorProps) {
  const node =
    selection?.type === 'node'
      ? topology.nodes.find((entry) => entry.id === selection.id)
      : undefined;
  const link =
    selection?.type === 'link'
      ? topology.links.find((entry) => entry.id === selection.id)
      : undefined;
  const pdu = selection?.type === 'pdu' ? pdus?.[selection.id] : undefined;

  const found = node ?? link ?? pdu;
  const pinned = found
    ? (annotations ?? []).filter((note) => note.targetId === selection?.id)
    : [];

  return (
    <Panel
      title={title}
      aside={
        selection && found ? (
          <Badge tone="accent">{KIND_LABEL[selection.type]}</Badge>
        ) : null
      }
      scroll
      className={cn('min-h-0', className)}
    >
      {!selection ? (
        <EmptyState
          icon={<MousePointerClick className="size-6" />}
          title="Nothing selected"
          description="Choose a machine, a link, or a packet on the diagram — click it, or tab to it and press Enter."
          className="border-0 px-2 py-8"
        />
      ) : !found ? (
        <EmptyState
          title="No longer on the diagram"
          description="Whatever was selected is not part of this scenario any more."
          className="border-0 px-2 py-8"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {node ? (
            <NodeDetail
              node={node}
              state={nodeStates?.[node.id] ?? 'idle'}
              topology={topology}
              onSelect={onSelect}
            />
          ) : null}
          {link ? (
            <LinkDetail link={link} topology={topology} onSelect={onSelect} />
          ) : null}
          {pdu ? <PduDetail pdu={pdu} /> : null}

          <Notes annotations={pinned} />

          {children}
        </div>
      )}
    </Panel>
  );
}
