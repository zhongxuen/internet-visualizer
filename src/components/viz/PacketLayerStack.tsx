'use client';

import { ChevronRight, Mail } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { useDetail } from '@/components/prefs';
import { Badge } from '@/components/ui';
import type { PDU, ProtocolLayer } from '@/core/types/pdu';
import { cn } from '@/lib/cn';
import { layerTint } from '@/lib/theme';

import { HeaderTable } from './HeaderTable';

/**
 * Encapsulation, drawn as what it is: boxes inside boxes.
 *
 * `PDU.layers` is ordered outermost first, and so is this -- the Ethernet frame contains
 * the IPv4 packet contains the TCP segment contains the TLS record contains the HTTP
 * request, each one physically inside the previous. That nesting is the whole point: a
 * flat list of protocol names would say the same words while hiding the idea that a hop
 * strips one box off the front and leaves everything inside it untouched.
 *
 * Each layer expands into its `HeaderTable`, so the stack answers both questions a learner
 * has -- "what is wrapped around what" at a glance, and "what does this header actually
 * say" on demand. The outermost is open by default because it is the header the receiving
 * NIC reads first, and it is the one that changes at every hop.
 *
 * Each box is drawn as an envelope -- the product's one analogy for encapsulation
 * (docs/implementation/uiux-spec.md §5.1.1), "envelopes inside envelopes" -- with an
 * envelope icon, and in Simple detail it is called one: "Envelope 1", outermost first.
 * The protocol name stays on every box in both detail levels; it is the real term the
 * analogy is paired with.
 *
 * Collapsed layers are unmounted rather than hidden: nothing on screen that a reader
 * cannot reach, and no rendering of five header tables to show one.
 */

export interface PacketLayerStackProps {
  pdu: PDU;
  /**
   * Indices into `pdu.layers` to open initially. Defaults to `[0]` -- the outermost
   * header. Pass `[]` for a fully collapsed stack, or every index for a fully open one.
   */
  defaultExpanded?: readonly number[];
  className?: string;
}

interface LayerBoxProps {
  layer: ProtocolLayer;
  /** Position in the stack, 1-based, as printed on the box. */
  ordinal: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  panelId: string;
  full: boolean;
  /** The layer this one encapsulates, nested inside it. */
  children?: ReactNode;
}

function LayerBox({
  layer,
  ordinal,
  total,
  expanded,
  onToggle,
  panelId,
  full,
  children,
}: LayerBoxProps) {
  const innermost = ordinal === total;
  const fieldCount = layer.fields.length;

  return (
    <div
      data-layer={layer.layer}
      data-protocol={layer.protocol}
      className="rounded-lg border border-t-2 p-1.5"
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
        className="hover:bg-surface-overlay/60 min-h-target-floor flex w-full items-center gap-2 rounded-md px-1 py-1 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
        />
        <Mail aria-hidden="true" className="text-fg-muted size-3.5 shrink-0" />
        <span className="text-fg-secondary text-small">
          {full ? <span className="font-mono">{ordinal}</span> : `Envelope ${ordinal}`}
        </span>
        <Badge layer={layer.layer} className="text-caption px-1.5 py-0">
          {layer.protocol}
        </Badge>
        <span className="text-fg-muted text-caption ml-auto pr-1 whitespace-nowrap">
          {fieldCount === 1 ? '1 field' : `${fieldCount} fields`}
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
              <figcaption className="text-fg-muted text-caption tracking-wider uppercase">
                Payload
              </figcaption>
              <pre className="text-fg-secondary border-border/60 bg-surface text-caption mt-1 overflow-x-auto rounded-md border p-2 font-mono leading-snug whitespace-pre-wrap">
                {layer.payloadPreview}
              </pre>
            </figure>
          ) : null}
        </div>
      ) : null}

      {children ? (
        <div className="mt-1.5">{children}</div>
      ) : innermost ? (
        <p className="text-fg-muted text-small px-1 pt-1 pb-0.5">
          {full
            ? 'Innermost — nothing else is wrapped inside this.'
            : 'The innermost envelope: the message itself is inside.'}
        </p>
      ) : null}
    </div>
  );
}

export function PacketLayerStack({
  pdu,
  defaultExpanded = [0],
  className,
}: PacketLayerStackProps) {
  const full = useDetail() === 'full';
  const baseId = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(
    () => new Set(defaultExpanded),
  );

  const toggle = (index: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  if (pdu.layers.length === 0) {
    return (
      <p className={cn('text-fg-muted text-small', className)}>
        This PDU carries no protocol layers.
      </p>
    );
  }

  /*
    Built from the inside out so each box literally contains the next one in the JSX, the
    way the bytes contain each other on the wire. `reduceRight` walks the innermost layer
    first and hands it to the layer that encapsulates it.
  */
  const stack = pdu.layers.reduceRight<ReactNode>(
    (inner, layer, index) => (
      <LayerBox
        key={`${layer.protocol}-${index}`}
        layer={layer}
        ordinal={index + 1}
        total={pdu.layers.length}
        expanded={expanded.has(index)}
        onToggle={() => toggle(index)}
        panelId={`${baseId}-layer-${index}`}
        full={full}
      >
        {inner}
      </LayerBox>
    ),
    null,
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="text-fg-muted text-small leading-snug">
        {full
          ? 'Outermost header first — the order a receiving network card reads them, each one wrapped around everything below it.'
          : 'Envelopes inside envelopes, outermost first. Each one wraps everything inside it. Open one to read its label.'}
      </p>
      {stack}
    </div>
  );
}
