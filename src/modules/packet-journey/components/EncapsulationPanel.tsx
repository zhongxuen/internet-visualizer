'use client';

import { ChevronRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';

import { useReducedMotionSafe } from '@/components/motion';
import { Badge, Panel } from '@/components/ui';
import { HeaderTable } from '@/components/viz';
import { focusRing } from '@/components/ui/styles';
import type { ProtocolLayer } from '@/core/types/pdu';
import { cn } from '@/lib/cn';
import { layerTint } from '@/lib/theme';

import type { PacketFocus, PacketStatus } from '../ledger';

/**
 * The packet as it stands right now, layer by layer, following the playhead.
 *
 * `PacketLayerStack` (phase 04) draws one PDU held still, with each header physically
 * inside the last. This panel answers a different question -- *what is happening to the
 * packet at this instant* -- and that difference is why it is a module component rather
 * than a use of the shared one:
 *
 * - **It follows the current hop.** `focusAt` returns whatever most recently happened to
 *   a packet at virtual time `t`, so the stack here is the stack of the packet on screen,
 *   and it changes as the playhead moves without anything having to be told to update.
 * - **It animates the change.** A header being prepended at the sender and thrown away at
 *   the receiver are `pdu-transform` events that the engine emits precisely so they can
 *   be watched (`sim/journey.ts`, `deliverDatagram`). A layer arriving slides in from the
 *   outside; a stripped layer collapses out. That is the module's central image, and a
 *   stack that simply re-rendered with one fewer row would throw it away.
 * - **It is flat, not nested.** The shared stack nests each layer inside the one before
 *   it, which is truer to the bytes -- but an exit animation on a nested box takes its
 *   children with it, so stripping Ethernet would blink the whole packet out of
 *   existence. Indentation carries the containment instead, and each box prints the
 *   position it holds in the stack.
 *
 * Expanded headers are keyed by protocol rather than by position, so opening IPv4 keeps
 * it open as the packet moves and the TTL can be watched coming down hop by hop -- which
 * is the single most useful thing this panel can be pointed at.
 */

export interface EncapsulationPanelProps {
  /** The packet under the playhead, from `focusAt`. `undefined` before the run starts. */
  focus: PacketFocus | undefined;
  /** Node and link ids to display labels — `labelsFor(topology)`. */
  labels: Readonly<Record<string, string>>;
  className?: string;
}

/**
 * A layer's identity across hops.
 *
 * Not the position in the stack: the whole point is that a layer keeps its identity while
 * the stack around it changes, so that stripping Ethernet animates *Ethernet* out rather
 * than shuffling every row up by one. The protocol is part of the key because an ICMP
 * error carries two network-layer headers -- the router's message and a quotation of the
 * packet that provoked it.
 */
function layerKey(layer: string, protocol: string): string {
  return `${layer}:${protocol}`;
}

/** Headline for each state, in the vocabulary of the thing that just happened. */
const STATUS_COPY: Record<PacketStatus, { title: string; tone: string }> = {
  built: { title: 'Built', tone: 'text-fg-secondary' },
  encapsulated: { title: 'Header added', tone: 'text-state-ok' },
  stripped: { title: 'Header stripped', tone: 'text-layer-application' },
  rewritten: { title: 'Rewritten in place', tone: 'text-accent' },
  'in-flight': { title: 'On the wire', tone: 'text-accent' },
  arrived: { title: 'Arrived', tone: 'text-fg-secondary' },
  dropped: { title: 'Dropped', tone: 'text-state-error' },
};

/** Where the packet is, said the way a person would say it. */
function locate(focus: PacketFocus, labels: Readonly<Record<string, string>>): string {
  if (focus.status === 'in-flight' && focus.from && focus.to) {
    return `${labels[focus.from] ?? focus.from} → ${labels[focus.to] ?? focus.to}`;
  }
  if (focus.nodeId) return labels[focus.nodeId] ?? focus.nodeId;
  return '';
}

interface LayerRowProps {
  layer: ProtocolLayer;
  /** Position in the stack, 1-based, as printed on the box. */
  ordinal: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  panelId: string;
  durationSeconds: number;
}

function LayerRow({
  layer,
  ordinal,
  total,
  expanded,
  onToggle,
  panelId,
  durationSeconds,
}: LayerRowProps) {
  return (
    <motion.div
      layout
      // Outer headers come in from the left, the direction they are prepended from; the
      // collapse to zero height is what makes a stripped layer read as removed rather
      // than as a list that happens to be shorter.
      initial={{ opacity: 0, height: 0, x: -12 }}
      animate={{ opacity: 1, height: 'auto', x: 0 }}
      exit={{ opacity: 0, height: 0, x: -12 }}
      transition={{ duration: durationSeconds }}
      data-layer={layer.layer}
      data-protocol={layer.protocol}
      className="overflow-hidden"
      style={{ marginLeft: `${(ordinal - 1) * 0.5}rem` }}
    >
      <div
        className="rounded-lg border p-1.5"
        style={{
          borderColor: layerTint(layer.layer, 55),
          backgroundColor: layerTint(layer.layer, 7),
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className={cn(
            'hover:bg-surface-overlay/60 flex w-full items-center gap-2 rounded-md px-1 py-1 text-left',
            focusRing,
          )}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <span className="text-fg-muted font-mono text-[0.625rem]">
            {ordinal}
            <span className="sr-only"> of {total}</span>
          </span>
          <Badge layer={layer.layer} className="px-1.5 py-0 text-[0.6875rem]">
            {layer.protocol}
          </Badge>
          <span className="text-fg-muted ml-auto pr-1 text-[0.625rem] whitespace-nowrap">
            {layer.fields.length === 1 ? '1 field' : `${layer.fields.length} fields`}
          </span>
        </button>

        {expanded ? (
          <div id={panelId} className="px-1 pt-2 pb-1">
            <HeaderTable
              fields={layer.fields}
              layer={layer.layer}
              caption={`${layer.protocol} header — fields in wire order.`}
            />
            {layer.payloadPreview ? (
              <figure className="mt-2">
                <figcaption className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
                  Payload
                </figcaption>
                <pre className="text-fg-secondary border-border/60 bg-surface mt-1 overflow-x-auto rounded-md border p-2 font-mono text-[0.6875rem] leading-snug whitespace-pre-wrap">
                  {layer.payloadPreview}
                </pre>
              </figure>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

export function EncapsulationPanel({
  focus,
  labels,
  className,
}: EncapsulationPanelProps) {
  const baseId = useId();
  const { scale } = useReducedMotionSafe();
  // IPv4 open by default: the TTL, the checksum that follows it, and both addresses are
  // most of what a hop is allowed to touch, and they are all in this one header.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set([layerKey('network', 'IPv4')]),
  );

  const durationSeconds = scale(240) / 1000;

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  if (!focus) {
    return (
      <Panel title="Encapsulation" className={className}>
        <p className="text-fg-muted text-xs leading-relaxed">
          Nothing has been sent yet. Press play, or step forward, and the headers will be
          built here one at a time.
        </p>
      </Panel>
    );
  }

  const status = STATUS_COPY[focus.status];
  const where = locate(focus, labels);

  return (
    <Panel
      title="Encapsulation"
      aside={
        <span className="text-fg-muted font-mono text-[0.6875rem]">
          {focus.pdu.sizeBytes} B
        </span>
      }
      scroll
      className={className}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-fg font-mono text-xs break-words">{focus.pdu.summary}</p>
          <p className="text-[0.6875rem]">
            <span className={cn('font-medium', status.tone)}>{status.title}</span>
            {where ? <span className="text-fg-muted"> · {where}</span> : null}
          </p>
        </div>

        {focus.reason ? (
          <p
            className={cn(
              'border-border/60 bg-surface rounded-md border px-2 py-1.5 text-[0.6875rem] leading-snug',
              focus.status === 'dropped' ? 'text-state-error' : 'text-fg-secondary',
            )}
          >
            {focus.reason}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <AnimatePresence initial={false} mode="popLayout">
            {focus.pdu.layers.map((layer, index) => {
              const key = layerKey(layer.layer, layer.protocol);
              return (
                <LayerRow
                  key={key}
                  layer={layer}
                  ordinal={index + 1}
                  total={focus.pdu.layers.length}
                  expanded={expanded.has(key)}
                  onToggle={() => toggle(key)}
                  panelId={`${baseId}-${key}`}
                  durationSeconds={durationSeconds}
                />
              );
            })}
          </AnimatePresence>
        </div>

        <p className="text-fg-muted text-[0.6875rem] leading-snug">
          Outermost header first — the order a receiving network card reads them. Each hop
          throws away the frame at the top and builds a new one; everything below it
          crosses the whole path untouched.
        </p>
      </div>
    </Panel>
  );
}
