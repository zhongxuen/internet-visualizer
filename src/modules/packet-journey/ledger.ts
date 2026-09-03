/**
 * Reading a finished journey back out of its event stream.
 *
 * `sim/journey.ts` emits `SimEvent`s and stops there -- it knows nothing about tables or
 * panels, and must not. This file is the other half of that boundary: two pure functions
 * that turn the stream into the two things the UI shows, with no React and no DOM, so
 * both can be tested directly.
 *
 * - {@link buildLedger} -- every layer-3 hop the run performed, as rows, each carrying
 *   what changed at it. This is `HopTable`'s content.
 * - {@link focusAt} -- the one packet the viewer is watching at virtual time `t`, as it
 *   stands at that instant. This is `EncapsulationPanel`'s content.
 *
 * ## Why a hop is not a transmit
 *
 * The engine emits one `transmit` per physical link, and a packet crossing
 * `laptop -> ap -> lan-switch -> router` produces three of them for **one hop**. An
 * access point and a switch forward by MAC address, never open the IP header, and change
 * nothing -- so a table with a row for each of them would show three rows with identical
 * TTLs and invite exactly the misconception this module exists to correct. A row is
 * therefore closed only when the packet reaches a machine that reads IP headers, and the
 * transparent devices it passed through on the way are recorded in `via`: still visible,
 * still on the path, and demonstrably responsible for nothing.
 *
 * ## Why the state is rebuilt rather than remembered
 *
 * Both functions replay the event list from the beginning. That is the same contract
 * `projectAt` keeps (`src/core/sim/project.ts`): the answer depends on `t` and the run
 * and on nothing else, so scrubbing backwards is exact and there is no accumulated state
 * to unwind. The ledger is built once per run and the focus once per frame, which is the
 * same linear pass the canvas already pays for.
 */

import type { SimResult } from '@/core/sim/result';
import type { LayerKey, PDU } from '@/core/types/pdu';
import type { Topology } from '@/core/types/topology';

// ---------------------------------------------------------------------------
// Reading fields back off a rendered packet
// ---------------------------------------------------------------------------

/**
 * One header field, by layer and by the name the RFC gives it.
 *
 * The names are the ones `sim/ethernet.ts`, `sim/ipv4.ts`, `sim/tcp.ts`, and `sim/udp.ts`
 * write, and the tests below pin them: if a header is renamed there, a column here goes
 * blank rather than wrong, and the test says so.
 */
function field(pdu: PDU, layer: LayerKey, name: string): string | undefined {
  const found = pdu.layers.find((entry) => entry.layer === layer);
  return found?.fields.find((entry) => entry.name === name)?.value;
}

/** The transport header, whichever transport it is. */
function port(pdu: PDU, name: 'Source Port' | 'Destination Port'): string | undefined {
  return field(pdu, 'transport', name);
}

/** `192.0.2.80:80`, or just the address when the packet carries no ports. */
function endpoint(ip: string | undefined, portValue: string | undefined): string {
  if (!ip) return '';
  return portValue ? `${ip}:${portValue}` : ip;
}

/** The addressing a hop table row prints, read off the packet as it crossed. */
export interface HopAddressing {
  readonly sourceMac: string;
  readonly destinationMac: string;
  readonly sourceIp: string;
  readonly destinationIp: string;
  readonly source: string;
  readonly destination: string;
  readonly ttl: string;
  readonly checksum: string;
}

function addressingOf(pdu: PDU): HopAddressing {
  const sourceIp = field(pdu, 'network', 'Source') ?? '';
  const destinationIp = field(pdu, 'network', 'Destination') ?? '';

  return {
    sourceMac: field(pdu, 'link', 'Source MAC') ?? '',
    destinationMac: field(pdu, 'link', 'Destination MAC') ?? '',
    sourceIp,
    destinationIp,
    source: endpoint(sourceIp, port(pdu, 'Source Port')),
    destination: endpoint(destinationIp, port(pdu, 'Destination Port')),
    ttl: field(pdu, 'network', 'TTL') ?? '',
    checksum: field(pdu, 'network', 'Header Checksum') ?? '',
  };
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * A thing that changed between one hop and the next.
 *
 * `kind` exists so the table can colour and group them; `text` is what a reader gets.
 * The set is closed on purpose -- these are the only things a correct forwarding path is
 * allowed to change, and a diff that produced anything else would be a bug in the engine
 * rather than a new badge here.
 */
export type HopChangeKind = 'mac' | 'address' | 'ttl' | 'checksum' | 'ports';

export interface HopChange {
  readonly kind: HopChangeKind;
  readonly text: string;
}

/** What a row is: a packet crossing a hop, or a packet's story ending. */
export type HopRowKind = 'crossing' | 'drop';

/** One line of the ledger. */
export interface HopRow {
  /** Stable key, derived from the event's index in the run. */
  readonly id: string;
  /** Position in *this packet's* journey, 1-based. */
  readonly hop: number;
  /** Virtual millisecond the packet left `from`. Clicking the row seeks here. */
  readonly at: number;
  /** Virtual millisecond it reached `to`; equal to `at` for a drop. */
  readonly arrivedAt: number;
  readonly kind: HopRowKind;
  readonly pduId: string;
  /** The packet-analyser summary as it read at this hop. */
  readonly summary: string;
  /** `SimNode.id` of the machine that sent it. */
  readonly from: string;
  /** `SimNode.id` of the next machine that reads IP headers. */
  readonly to: string;
  /** Layer-2 devices crossed on the way, which changed nothing. */
  readonly via: readonly string[];
  /** The last physical link of the hop, for labelling. */
  readonly linkId: string;
  /** Frame size on the wire. */
  readonly sizeBytes: number;
  readonly addressing: HopAddressing;
  /** What this machine changed before sending it on. Empty on the first hop. */
  readonly changes: readonly HopChange[];
  /** Why the packet was dropped. Only on a `'drop'` row. */
  readonly reason?: string;
}

/**
 * Everything the previous hop of one packet looked like, so the next can be diffed
 * against it.
 */
interface Crossing {
  readonly addressing: HopAddressing;
}

/** The hop being accumulated for one packet: where it started, and what it has crossed. */
interface Pending {
  from: string;
  at: number;
  via: string[];
}

/** True for a machine that forwards frames without reading the IP header. */
function transparentIds(topology: Topology): ReadonlySet<string> {
  return new Set(
    topology.nodes.filter((node) => node.kind === 'switch').map((node) => node.id),
  );
}

/**
 * What changed between two consecutive hops of the same packet.
 *
 * This is the module's central claim, computed rather than asserted: both MAC addresses
 * change at every router, the TTL comes down by one, the checksum follows it because it
 * covers the header, and neither IP address moves -- unless the machine was the NAT, in
 * which case exactly one of them does, along with the port beside it.
 */
function diffCrossings(before: HopAddressing, after: HopAddressing): HopChange[] {
  const changes: HopChange[] = [];

  if (
    before.sourceMac !== after.sourceMac ||
    before.destinationMac !== after.destinationMac
  ) {
    changes.push({
      kind: 'mac',
      text: `MAC ${after.sourceMac} → ${after.destinationMac}`,
    });
  }

  if (before.ttl !== after.ttl) {
    changes.push({ kind: 'ttl', text: `TTL ${before.ttl} → ${after.ttl}` });
  }

  if (before.checksum !== after.checksum) {
    changes.push({ kind: 'checksum', text: `Checksum recomputed → ${after.checksum}` });
  }

  // Printed with the port, because NAPT rewrites both halves of the endpoint and the
  // port is the half that makes one public address serve a houseful of machines.
  if (before.sourceIp !== after.sourceIp) {
    changes.push({
      kind: 'address',
      text: `NAT: source ${before.source} → ${after.source}`,
    });
  }

  if (before.destinationIp !== after.destinationIp) {
    changes.push({
      kind: 'address',
      text: `NAT: destination ${before.destination} → ${after.destination}`,
    });
  }

  if (before.source !== after.source && before.sourceIp === after.sourceIp) {
    changes.push({ kind: 'ports', text: `Source port → ${after.source}` });
  }

  if (
    before.destination !== after.destination &&
    before.destinationIp === after.destinationIp
  ) {
    changes.push({ kind: 'ports', text: `Destination port → ${after.destination}` });
  }

  return changes;
}

/**
 * Every layer-3 hop the run performed, in the order it performed them.
 *
 * Built once per run: it is a function of the event list and the topology and of nothing
 * else, so it does not need rebuilding when the playhead moves.
 */
export function buildLedger(result: SimResult, topology: Topology): HopRow[] {
  const transparent = transparentIds(topology);

  /** The current rendered state of each packet, folded forward from its events. */
  const packets: Record<string, PDU> = {};
  /** The previous hop of each packet, to diff the next one against. */
  const previous: Record<string, Crossing> = {};
  /** The hop each packet is part-way through, when it is crossing layer-2 devices. */
  const pending: Record<string, Pending> = {};
  const counts: Record<string, number> = {};
  const rows: HopRow[] = [];

  result.events.forEach((event, index) => {
    switch (event.kind) {
      case 'pdu-created':
        packets[event.pdu.id] = event.pdu;
        break;

      case 'pdu-transform':
        packets[event.pduId] = event.after;
        break;

      case 'transmit': {
        const packet = packets[event.pduId];
        if (!packet) break;

        const open = pending[event.pduId];
        const from = open?.from ?? event.from;
        const at = open?.at ?? event.at;
        const via = open?.via ?? [];

        if (transparent.has(event.to)) {
          // Still inside one hop: a switch forwarded the frame and changed nothing.
          pending[event.pduId] = { from, at, via: [...via, event.to] };
          break;
        }

        delete pending[event.pduId];
        const addressing = addressingOf(packet);
        const count = (counts[event.pduId] ?? 0) + 1;
        counts[event.pduId] = count;

        rows.push({
          id: `hop-${index}`,
          hop: count,
          at,
          arrivedAt: event.at + event.durationMs,
          kind: 'crossing',
          pduId: event.pduId,
          summary: packet.summary,
          from,
          to: event.to,
          via,
          linkId: event.linkId,
          sizeBytes: packet.sizeBytes,
          addressing,
          changes: previous[event.pduId]
            ? diffCrossings(previous[event.pduId].addressing, addressing)
            : [],
        });
        previous[event.pduId] = { addressing };
        break;
      }

      case 'drop': {
        const packet = packets[event.pduId];
        if (!packet) break;
        delete pending[event.pduId];
        const count = (counts[event.pduId] ?? 0) + 1;
        counts[event.pduId] = count;

        rows.push({
          id: `drop-${index}`,
          hop: count,
          at: event.at,
          arrivedAt: event.at,
          kind: 'drop',
          pduId: event.pduId,
          summary: packet.summary,
          from: event.atNode,
          to: event.atNode,
          via: [],
          linkId: '',
          sizeBytes: packet.sizeBytes,
          addressing: addressingOf(packet),
          changes: [],
          reason: event.reason,
        });
        break;
      }

      default:
        break;
    }
  });

  return rows;
}

/**
 * Index of the row the playhead is on, or `-1` before the first hop.
 *
 * The last row that has *started* wins, so the cursor holds its place while a packet is
 * being processed at a router rather than blanking between hops.
 */
export function currentRowIndex(rows: readonly HopRow[], virtualTime: number): number {
  let index = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].at <= virtualTime) index = i;
    else break;
  }
  return index;
}

// ---------------------------------------------------------------------------
// The packet under the playhead
// ---------------------------------------------------------------------------

/**
 * What just happened to the packet on screen.
 *
 * `'encapsulated'` and `'stripped'` are the two the `EncapsulationPanel` is really for:
 * they are emitted when the layer count goes up or down, which is the moment a header is
 * prepended at the sender or thrown away at the receiver.
 */
export type PacketStatus =
  | 'built'
  | 'encapsulated'
  | 'stripped'
  | 'rewritten'
  | 'in-flight'
  | 'arrived'
  | 'dropped';

/** The packet the viewer is watching, as it stands at one virtual instant. */
export interface PacketFocus {
  /** The packet, with the layers it has right now. */
  readonly pdu: PDU;
  /** Virtual millisecond of the event that put it in this state. */
  readonly at: number;
  readonly status: PacketStatus;
  /** The machine it is at. Absent while it is on a wire. */
  readonly nodeId?: string;
  /** The wire it is on, and the direction. Absent while it is at a machine. */
  readonly linkId?: string;
  readonly from?: string;
  readonly to?: string;
  /** The engine's own sentence about what just changed, when something did. */
  readonly reason?: string;
}

/**
 * The packet under the playhead at `t`, or `undefined` before the run has built one.
 *
 * "Under the playhead" is the most recent thing that happened to *any* packet: the run
 * follows one datagram at a time, so the newest packet event is the one the viewer is
 * watching. That is what makes the panel follow the current hop for free -- including
 * across a fragmentation, where each piece becomes the focus in turn as it leaves.
 *
 * A packet that has finished crossing a link is reported as `'arrived'` at the far end
 * rather than still in flight, so the panel does not claim a packet is on a wire during
 * the milliseconds a router spends thinking about it.
 */
export function focusAt(result: SimResult, t: number): PacketFocus | undefined {
  const now = Number.isFinite(t) ? Math.max(0, t) : 0;
  const packets: Record<string, PDU> = {};
  let focus: PacketFocus | undefined;

  for (const event of result.events) {
    if (event.at > now) break;

    switch (event.kind) {
      case 'pdu-created':
        packets[event.pdu.id] = event.pdu;
        focus = { pdu: event.pdu, at: event.at, status: 'built', nodeId: event.atNode };
        break;

      case 'pdu-transform': {
        packets[event.pduId] = event.after;
        const before = event.before.layers.length;
        const after = event.after.layers.length;
        focus = {
          pdu: event.after,
          at: event.at,
          status:
            after > before ? 'encapsulated' : after < before ? 'stripped' : 'rewritten',
          nodeId: event.atNode,
          reason: event.reason,
        };
        break;
      }

      case 'transmit': {
        const pdu = packets[event.pduId];
        if (!pdu) break;
        const landed = now >= event.at + event.durationMs;
        focus = landed
          ? { pdu, at: event.at + event.durationMs, status: 'arrived', nodeId: event.to }
          : {
              pdu,
              at: event.at,
              status: 'in-flight',
              linkId: event.linkId,
              from: event.from,
              to: event.to,
            };
        break;
      }

      case 'drop': {
        const pdu = packets[event.pduId];
        if (!pdu) break;
        focus = {
          pdu,
          at: event.at,
          status: 'dropped',
          nodeId: event.atNode,
          reason: event.reason,
        };
        break;
      }

      default:
        break;
    }
  }

  return focus;
}
