/**
 * Turning a `SimEvent` into a line of the log.
 *
 * A pure function rather than a switch inside `EventLog`, for the usual reason: the
 * wording of "what just happened" is the teaching content, it is asserted in tests, and
 * it is reused wherever a module wants to caption something without mounting a log.
 *
 * Ids never reach the screen. A learner reads "Home router" and "echo.example.net", not
 * `router` and `echo`, so every description resolves ids through the labels the caller
 * built from the topology -- falling back to the id only when the scenario references a
 * machine it never declared, which is a bug worth being able to see.
 */

import type { SimEvent, SimEventKind } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';

/** How a log line is coloured and iconed. Never colour alone -- see `EventLog`. */
export type EventTone = 'info' | 'accent' | 'warn' | 'error';

export interface EventDescription {
  /** Virtual millisecond it happened. */
  at: number;
  kind: SimEventKind;
  /** The line itself. */
  text: string;
  tone: EventTone;
}

export interface EventContext {
  /** `SimNode.id` / `SimLink.id` to display label. */
  labels?: Readonly<Record<string, string>>;
  /** Every PDU in the run, so a hop can be described by its summary. */
  pdus?: Readonly<Record<string, PDU>>;
}

function labelOf(id: string, context: EventContext): string {
  return context.labels?.[id] ?? id;
}

function pduOf(id: string, context: EventContext): string {
  return context.pdus?.[id]?.summary ?? id;
}

const LOG_TONES: Record<'info' | 'warn' | 'error', EventTone> = {
  info: 'info',
  warn: 'warn',
  error: 'error',
};

/** One log line for one event. */
export function describeEvent(event: SimEvent, context: EventContext = {}) {
  const base = { at: event.at, kind: event.kind } as const;

  switch (event.kind) {
    case 'phase':
      return {
        ...base,
        tone: 'accent',
        text: `Phase: ${event.title}`,
      } satisfies EventDescription;

    case 'transmit':
      return {
        ...base,
        tone: 'info',
        text: `${labelOf(event.from, context)} -> ${labelOf(event.to, context)}: ${pduOf(event.pduId, context)}`,
      } satisfies EventDescription;

    case 'node-state':
      return {
        ...base,
        tone: event.state === 'error' ? 'error' : 'info',
        text: `${labelOf(event.nodeId, context)} is ${event.state}${event.note ? ` (${event.note})` : ''}`,
      } satisfies EventDescription;

    case 'pdu-created':
      return {
        ...base,
        tone: 'info',
        text: `${labelOf(event.atNode, context)} built ${event.pdu.summary}`,
      } satisfies EventDescription;

    case 'pdu-transform':
      return {
        ...base,
        tone: 'warn',
        text: `${labelOf(event.atNode, context)} rewrote ${pduOf(event.pduId, context)}: ${event.reason}`,
      } satisfies EventDescription;

    case 'drop':
      return {
        ...base,
        tone: 'error',
        text: `${labelOf(event.atNode, context)} dropped ${pduOf(event.pduId, context)}: ${event.reason}`,
      } satisfies EventDescription;

    case 'annotate':
      return {
        ...base,
        tone: 'accent',
        text: `${labelOf(event.targetId, context)}: ${event.text}`,
      } satisfies EventDescription;

    case 'log':
      return {
        ...base,
        tone: LOG_TONES[event.level],
        text: event.text,
      } satisfies EventDescription;
  }
}

/** Display labels for every node and link in a topology, keyed by id. */
export function labelsFor(topology: {
  nodes: readonly { id: string; label: string }[];
  links: readonly { id: string; from: string; to: string }[];
}): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const node of topology.nodes) labels[node.id] = node.label;
  for (const link of topology.links) {
    labels[link.id] = `${labels[link.from] ?? link.from} - ${labels[link.to] ?? link.to}`;
  }
  return labels;
}
