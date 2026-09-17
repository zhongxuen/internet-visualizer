'use client';

import { MousePointerClick } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { TermText } from '@/components/glossary';
import { useDetail } from '@/components/prefs';
import { Badge, Disclosure, EmptyState, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import type { Annotation } from '@/core/sim/project';
import { describeDuration, describeSize, fibreDistanceKm } from '@/core/text/humanScale';
import { PLAIN_KINDS } from '@/core/text/kinds';
import type { NodeState, SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { LinkMedium, SimLink, SimNode, Topology } from '@/core/types/topology';
import { cn } from '@/lib/cn';

import { linkMediumToken } from './edges/media';
import { AddressList } from './nodes/AddressList';
import { nodeKindToken } from './nodes/kinds';
import { nodeStateToken } from './nodes/state';
import { PacketLayerStack } from './PacketLayerStack';
import type { CanvasSelection } from './types';

/**
 * "Details": everything about the one thing the user has clicked.
 *
 * The canvas can only ever say so much — a node card has room for a label, a role, and an
 * address or two, and a packet chip has room for a protocol name. This panel is where
 * the rest lives, and it is deliberately the *only* place that grows as scenarios get
 * richer, so the diagram stays readable no matter how much detail a module carries.
 *
 * Three things can be selected, and each answers a different question:
 *
 *   - a **node** — what is this machine, what is it doing right now, and what is it
 *     connected to (and, technically: its layer, its addresses, the scenario's detail)
 *   - a **link** — what kind of road is this and how long does a message take on it
 *   - a **PDU** — what the message is for, who sent it to whom, how big it is, and its
 *     envelopes, expandable down to individual header fields
 *
 * ## Two voices
 *
 * The top of the panel is plain (docs/implementation/uiux-spec.md §5.1): a role in one
 * line, a delay as a human scale, a packet by what it is for. Everything the panel showed
 * before the restructure sits unchanged beneath it, in a "Technical details" disclosure
 * that is open by default in Full detail and closed -- and unmounted -- in Simple.
 * Nothing technical was shortened to make room; it moved.
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
  /**
   * Every event in the run -- `SimResult.events`. Read only to say where a selected
   * packet travels from and to; without it, that sentence is left out.
   */
  events?: readonly SimEvent[];
  /** Move the selection — wired to the same setter the canvas uses. */
  onSelect?: (selection: CanvasSelection | null) => void;
  title?: ReactNode;
  /** Module-specific extras, appended below the standard detail. */
  children?: ReactNode;
  className?: string;
}

/**
 * A pinned note, with the plain sentence its event may carry. `projectAt` does not copy
 * `plain` onto `Annotation` yet; reading it optionally here means the panel shows it the
 * moment it does, and the technical text until then.
 */
type PinnedNote = Annotation & { plain?: string };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-fg-muted text-caption font-medium tracking-widest uppercase">
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
    <dl className="text-small grid grid-cols-[minmax(4.5rem,auto)_1fr] gap-x-3 gap-y-1">
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
        'border-border bg-surface hover:border-border-strong hover:bg-surface-overlay text-small min-h-target-floor flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
        focusRing,
      )}
    >
      {children}
    </button>
  );
}

/** A plain sentence, glossary words linked. */
function Plain({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn('text-fg-secondary text-small leading-snug', className)}>
      <TermText text={text} />
    </p>
  );
}

/** The plain half of the notes: the `plain` sentence where there is one. */
function PlainNotes({ annotations }: { annotations: readonly PinnedNote[] }) {
  if (annotations.length === 0) return null;

  return (
    <ul className="flex flex-col gap-1.5">
      {annotations.map((annotation) => (
        <li
          key={annotation.id}
          className="border-accent/50 bg-surface text-fg-secondary text-small rounded-md border-l-2 px-2 py-1.5 leading-snug"
        >
          <TermText text={annotation.plain ?? annotation.text} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Notes the simulation pinned to this object, with their citation.
 *
 * The reference is what turns "the router decremented TTL" into something a learner can
 * check for themselves, so it is printed rather than tucked into a tooltip.
 */
function Notes({ annotations }: { annotations: readonly PinnedNote[] }) {
  if (annotations.length === 0) return null;

  return (
    <Section title="Notes">
      <ul className="flex flex-col gap-1.5">
        {annotations.map((annotation) => (
          <li
            key={annotation.id}
            className="border-accent/50 bg-surface text-fg-secondary text-small rounded-md border-l-2 px-2 py-1.5 leading-snug"
          >
            {annotation.text}
            {annotation.reference ? (
              <span className="text-fg-muted text-caption mt-1 block">
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

/** What a machine in each state is doing, following the chip's own word. */
const DOING: Record<NodeState, string> = {
  idle: 'nothing to do at this moment.',
  processing: 'busy with a lookup, a check or a decision.',
  active: 'this is where the story is happening now.',
  error: 'something failed here.',
};

/** Each road, in plain words. The technical label and description stay in the disclosure. */
const PLAIN_MEDIUM: Record<LinkMedium, string> = {
  ethernet: 'A copper cable (Ethernet), the usual wire inside a building.',
  wifi: 'Wi-Fi: radio waves through the air, with no cable.',
  fiber: 'A fibre-optic cable, carrying pulses of light through glass.',
  cellular: 'A mobile phone signal (cellular) to a nearby mast.',
};

function roleLine(node: SimNode): string {
  const kind = PLAIN_KINDS[node.kind];
  const role = node.plainRole ?? kind.plainRole;
  // A node's own role was written for that node; the kind's analogy may not fit it.
  return !node.plainRole && kind.analogy ? `${role}, like ${kind.analogy}.` : `${role}.`;
}

function PlainNode({
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

  return (
    <>
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="bg-surface-overlay text-fg-secondary border-border flex size-12 shrink-0 items-center justify-center rounded-lg border"
        >
          <KindIcon className="size-7" strokeWidth={1.5} />
        </span>
        <span className="text-fg min-w-0 flex-1 text-base font-medium break-words">
          {node.label}
        </span>
      </header>

      <Plain text={roleLine(node)} />

      <p className="text-fg-secondary text-small flex items-start gap-1.5 leading-snug">
        <span
          className={cn(
            'text-caption flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
            status.chip,
          )}
        >
          <StatusIcon aria-hidden="true" className="size-3" strokeWidth={2.25} />
          {status.label}
        </span>
        <span>
          <span className="sr-only">Right now: </span>
          {DOING[state]}
        </span>
      </p>

      {links.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {links.map((link) => {
            const otherId = link.from === node.id ? link.to : link.from;
            return (
              <li key={link.id}>
                <SelectButton onClick={() => onSelect?.({ type: 'link', id: link.id })}>
                  <span className="text-fg-secondary min-w-0 flex-1">
                    Connected to {labels.get(otherId) ?? otherId}, about {link.latencyMs}{' '}
                    ms away ({describeDuration(link.latencyMs)})
                  </span>
                </SelectButton>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

function NodeDetail({
  node,
  state,
  topology,
}: {
  node: SimNode;
  state: NodeState;
  topology: Topology;
}) {
  const kind = nodeKindToken(node.kind);
  const status = nodeStateToken(state);
  const StatusIcon = status.icon;

  const labels = new Map(topology.nodes.map((entry) => [entry.id, entry.label]));
  const links = topology.links.filter(
    (link) => link.from === node.id || link.to === node.id,
  );

  const details = Object.entries(node.detail ?? {});

  return (
    <>
      <header className="flex items-start gap-2">
        <span className="text-fg-muted text-caption min-w-0 flex-1 tracking-wider uppercase">
          {kind.roleLabel}
        </span>
        <span
          className={cn(
            'text-caption flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium',
            status.chip,
          )}
        >
          <StatusIcon aria-hidden="true" className="size-3" strokeWidth={2.25} />
          {status.label}
        </span>
      </header>

      <p className="text-fg-secondary text-small leading-snug">{kind.description}</p>

      <Badge layer={kind.layer} className="text-caption w-fit px-1.5 py-0">
        {kind.layerAction}
      </Badge>

      <Section title="Addresses">
        {node.ipv4 || node.ipv6 || node.mac ? (
          // `always`: a view may have hidden addressing on the canvas to keep the diagram
          // readable, but the inspector is one machine, opened deliberately -- it is not
          // what causes the overload that toggle exists to remove.
          <AddressList node={node} always className="text-small" />
        ) : (
          <p className="text-fg-muted text-small">
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
                <li
                  key={link.id}
                  className="text-small flex items-center gap-2 px-2 py-0.5"
                >
                  {MediumIcon ? (
                    <MediumIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  ) : null}
                  <span className="text-fg-secondary min-w-0 flex-1 truncate">
                    {labels.get(otherId) ?? otherId}
                  </span>
                  <span className="text-fg-muted text-caption shrink-0 font-mono">
                    {link.latencyMs} ms
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

function PlainLink({
  link,
  topology,
  onSelect,
}: {
  link: SimLink;
  topology: Topology;
  onSelect?: (selection: CanvasSelection | null) => void;
}) {
  const labels = new Map(topology.nodes.map((entry) => [entry.id, entry.label]));
  const ends = [
    { id: link.from, label: labels.get(link.from) ?? link.from },
    { id: link.to, label: labels.get(link.to) ?? link.to },
  ];

  return (
    <>
      <header className="text-fg text-base font-medium break-words">
        {ends[0]!.label} &harr; {ends[1]!.label}
      </header>

      <Plain
        text={
          link.medium
            ? PLAIN_MEDIUM[link.medium]
            : "The story doesn't say what kind of connection this is."
        }
      />

      <p className="text-fg-secondary text-small leading-snug">
        A message takes {link.latencyMs} ms to cross it:{' '}
        {describeDuration(link.latencyMs)}.
        {link.medium === 'fiber' ? (
          <> That much delay stands for {fibreDistanceKm(link.latencyMs)}.</>
        ) : null}
      </p>

      <ul className="flex flex-col gap-1">
        {ends.map((end) => (
          <li key={end.id}>
            <SelectButton onClick={() => onSelect?.({ type: 'node', id: end.id })}>
              <span className="text-fg-secondary min-w-0 flex-1 truncate">
                {end.label}
              </span>
            </SelectButton>
          </li>
        ))}
      </ul>
    </>
  );
}

function LinkDetail({ link, topology }: { link: SimLink; topology: Topology }) {
  const labels = new Map(topology.nodes.map((entry) => [entry.id, entry.label]));
  const medium = linkMediumToken(link.medium);

  return (
    <>
      <span className="text-fg-muted text-caption tracking-wider uppercase">
        {medium ? medium.label : 'Link'}
      </span>

      {medium ? (
        <p className="text-fg-secondary text-small leading-snug">{medium.description}</p>
      ) : (
        <p className="text-fg-muted text-small leading-snug">
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
        <Facts
          facts={[
            { label: 'From', value: labels.get(link.from) ?? link.from },
            { label: 'To', value: labels.get(link.to) ?? link.to },
          ]}
        />
      </Section>
    </>
  );
}

/** Where a packet starts and ends, by name: its first hop's sender, its last hop's receiver. */
function routeOf(
  pduId: string,
  events: readonly SimEvent[] | undefined,
  topology: Topology,
): { from: string; to: string } | null {
  if (!events) return null;
  let from: string | undefined;
  let to: string | undefined;
  for (const event of events) {
    if (event.kind !== 'transmit' || event.pduId !== pduId) continue;
    from ??= event.from;
    to = event.to;
  }
  if (from === undefined || to === undefined) return null;
  const label = (id: string) =>
    topology.nodes.find((node) => node.id === id)?.label ?? id;
  return { from: label(from), to: label(to) };
}

function PlainPdu({
  pdu,
  events,
  topology,
}: {
  pdu: PDU;
  events?: readonly SimEvent[];
  topology: Topology;
}) {
  const route = routeOf(pdu.id, events, topology);

  return (
    <>
      <header className="text-fg text-base font-medium break-words">
        {pdu.plainLabel ?? pdu.summary}
      </header>

      {route ? (
        <p className="text-fg-secondary text-small leading-snug">
          From {route.from} to {route.to}.
        </p>
      ) : null}

      <p className="text-fg-secondary text-small leading-snug">
        Size: {describeSize(pdu.sizeBytes)}.
      </p>

      <PacketLayerStack pdu={pdu} defaultExpanded={[]} />
    </>
  );
}

function PduDetail({ pdu }: { pdu: PDU }) {
  const outer = pdu.layers[0];
  const inner = pdu.layers[pdu.layers.length - 1];

  return (
    <>
      <header className="flex flex-col gap-1">
        <span className="text-fg text-small font-mono break-words">{pdu.summary}</span>
        <span className="text-fg-muted text-caption tracking-wider uppercase">
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

/*
 * Memoized because the view around it re-renders on every animation frame while the
 * playhead moves, and every prop reaching it is identity-stable between events -- see
 * `useVisibleState`, which is what makes that true. Without this, a frame that changes
 * nothing here still costs a full render of it.
 */
export const Inspector = memo(function Inspector({
  topology,
  selection,
  pdus,
  nodeStates,
  annotations,
  events,
  onSelect,
  title = 'Details',
  children,
  className,
}: InspectorProps) {
  const detail = useDetail();

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
  const pinned: readonly PinnedNote[] = found
    ? (annotations ?? []).filter((note) => note.targetId === selection?.id)
    : [];
  const state = node ? (nodeStates?.[node.id] ?? 'idle') : 'idle';

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
          description="Click anything on the map (a device, a cable, or a moving message) to see what it is."
          className="border-0 px-2 py-8"
        />
      ) : !found ? (
        <EmptyState
          title="No longer on the map"
          description="Whatever was selected is not part of this story any more."
          className="border-0 px-2 py-8"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {node ? (
            <PlainNode
              node={node}
              state={state}
              topology={topology}
              onSelect={onSelect}
            />
          ) : null}
          {link ? (
            <PlainLink link={link} topology={topology} onSelect={onSelect} />
          ) : null}
          {pdu ? <PlainPdu pdu={pdu} events={events} topology={topology} /> : null}

          <PlainNotes annotations={pinned} />

          {/*
            Keyed on the detail level so switching it re-applies the default: open in
            Full detail, closed in Simple. `lazy`, because Simple unmounts what it hides
            (uiux-spec.md §5.2).
          */}
          <Disclosure
            key={detail}
            summary="Technical details"
            defaultOpen={detail === 'full'}
            lazy
            summaryClassName="text-small"
            contentClassName="flex flex-col gap-3"
          >
            {node ? <NodeDetail node={node} state={state} topology={topology} /> : null}
            {link ? <LinkDetail link={link} topology={topology} /> : null}
            {pdu ? <PduDetail pdu={pdu} /> : null}

            <Notes annotations={pinned} />
          </Disclosure>

          {children}
        </div>
      )}
    </Panel>
  );
});
