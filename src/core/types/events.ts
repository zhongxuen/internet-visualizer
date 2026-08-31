/**
 * Events -- the contract between networking logic and visualization.
 *
 * A simulation does not draw anything. It runs a protocol script on a virtual clock and
 * emits a sorted list of `SimEvent`s; a renderer reads that list and decides what to
 * animate. This one-way boundary is what makes the rule "visualization logic stays
 * separated from networking logic" mechanically true: protocol behaviour can be
 * unit-tested with no DOM, and one timeline component can drive every module.
 *
 * Every event carries `at`, a **virtual millisecond** timestamp -- never wall-clock
 * time. Playback maps virtual time onto real time through the speed control, which is
 * why the same code can show a TLS handshake at 0.1x and a DNS lookup at 4x.
 */

import type { PDU } from './pdu';

/**
 * A citation into the standards documents.
 *
 * Attached to teaching annotations so a learner can go from "the packet did this" to
 * the paragraph that says it must.
 */
export interface RfcRef {
  /** RFC number, e.g. `1034`. */
  rfc: number;
  /** Section within the RFC, e.g. `'4.3.2'`. Omit to cite the document as a whole. */
  section?: string;
  /** The RFC's title, e.g. `'Domain Names -- Concepts and Facilities'`. */
  title: string;
}

/** How busy a node is, drawn as its highlight state on the diagram. */
export type NodeState =
  /** Doing nothing; the default resting state. */
  | 'idle'
  /** Working on something that takes virtual time (a cache lookup, a signature check). */
  | 'processing'
  /** Currently the focus of the story -- the node the learner should be watching. */
  | 'active'
  /** Something went wrong here: a rejection, a timeout, a failed validation. */
  | 'error';

/** Severity of a log line, mirroring the usual console levels. */
export type LogLevel = 'info' | 'warn' | 'error';

/**
 * Everything a simulation can report.
 *
 * Emitted in non-decreasing `at` order. A renderer that understands only `phase` and
 * `transmit` can still show a usable animation; the rest add depth.
 */
export type SimEvent =
  /**
   * A named chapter of the story begins ("DNS resolution", "TCP handshake",
   * "TLS handshake", "HTTP request"). Phases are the boundaries the stepper jumps
   * between, so a module stays explorable by keyboard and under reduced motion.
   */
  | { kind: 'phase'; at: number; id: string; title: string; description: string }
  /**
   * A PDU is put on a link and travels to the far end. `at` is the moment the first bit
   * leaves; arrival is `at + durationMs`, which is propagation delay plus the time to
   * clock the PDU onto the wire.
   */
  | {
      kind: 'transmit';
      at: number;
      /** `PDU.id` of the thing being sent; the PDU itself came from `pdu-created`. */
      pduId: string;
      /** `SimNode.id` it leaves from. */
      from: string;
      /** `SimNode.id` it arrives at. */
      to: string;
      /** Virtual milliseconds in flight: propagation + serialization delay. */
      durationMs: number;
      /** `SimLink.id` being traversed -- must connect `from` and `to`. */
      linkId: string;
    }
  /** A node changes how it is behaving; drives the node's highlight on the diagram. */
  | {
      kind: 'node-state';
      at: number;
      nodeId: string;
      state: NodeState;
      /** Short reason for the change, e.g. `'cache miss'`. */
      note?: string;
    }
  /**
   * A PDU comes into existence at a node. Carries the PDU by value -- this is the one
   * event that introduces it; everything afterwards refers to it by `pduId`.
   */
  | { kind: 'pdu-created'; at: number; pdu: PDU; atNode: string }
  /**
   * A node changed a PDU in flight: a NAT rewriting the source address and port, a
   * router decrementing TTL and recomputing the checksum, a host encapsulating or
   * stripping a layer. `before` and `after` are both carried so the inspector can
   * diff them field by field and show exactly which bytes the hop touched.
   */
  | {
      kind: 'pdu-transform';
      at: number;
      /** Unchanged across the transform -- the same packet, altered. */
      pduId: string;
      before: PDU;
      after: PDU;
      atNode: string;
      /** Why it changed, e.g. `'TTL decremented by router'`. */
      reason: string;
    }
  /**
   * A PDU is discarded and goes no further: TTL expired, firewall policy, queue
   * overflow, failed checksum. The packet's story ends here.
   */
  | { kind: 'drop'; at: number; pduId: string; atNode: string; reason: string }
  /**
   * A teaching note pinned to something on screen. `targetId` is the id of whatever it
   * explains -- a node, a link, or a PDU.
   */
  | { kind: 'annotate'; at: number; targetId: string; text: string; reference?: RfcRef }
  /** A line for the event log: the running commentary beside the animation. */
  | { kind: 'log'; at: number; level: LogLevel; text: string };

/** The `kind` discriminator of any `SimEvent`, useful for filtering the timeline. */
export type SimEventKind = SimEvent['kind'];
