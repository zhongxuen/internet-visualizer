/**
 * Scenario topologies -- a `Topology` plus the teaching that goes with it.
 *
 * A bare `Topology` says what the machines are and how they are wired, which is enough
 * to draw a diagram but not enough to explain one. A `ScenarioTopology` adds the part a
 * learner actually reads: a two-or-three sentence note per machine, and a citation into
 * the document that says it must work that way.
 *
 * These live in `src/core` rather than inside a module for one hard reason and one soft
 * one. The hard reason: modules may not import each other (`eslint.config.mjs`), so a
 * topology that the network map draws and packet journey later animates traffic across
 * cannot live in either of them without being duplicated. The soft one: none of this is
 * a picture. It is addresses, latencies, and prose about protocols -- the same layer as
 * `types/topology.ts`, and testable with no DOM.
 *
 * Every address in every scenario comes from a range that is reserved for exactly this
 * purpose, so nothing here can be mistaken for -- or accidentally point at -- a real
 * host. See `./README.md` for the list.
 */

import type { Topology } from '../types/topology';

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

/**
 * The body that published a standard.
 *
 * `RfcRef` in `../types/events.ts` is deliberately RFC-only: it cites the paragraph a
 * *simulated protocol step* obeys, and those are all IETF documents. A topology has to
 * reach wider -- the reason a Wi-Fi hop is slower than a wired one is in IEEE 802.11,
 * and the reason a fibre hop costs what it does is in an ITU-T recommendation.
 */
export type StandardsBody = 'RFC' | 'IEEE' | 'ITU-T';

/** A pointer to the document that defines the behaviour a note describes. */
export interface StandardRef {
  body: StandardsBody;
  /** Document designation within the body: `'1918'`, `'802.1Q'`, `'G.984'`. */
  id: string;
  /** The document's own title, so the citation reads without following it. */
  title: string;
  /** Section within the document, e.g. `'2.2'`. Omit to cite the whole thing. */
  section?: string;
  /**
   * Where it can be read. Present for RFCs, which are free and permanently addressable;
   * absent for IEEE and ITU-T documents, which are not, so the UI prints the citation
   * as plain text rather than a link that would land on a paywall.
   */
  url?: string;
}

/** Cite an RFC. The URL is derived, so a citation cannot drift from its number. */
export function rfc(id: number, title: string, section?: string): StandardRef {
  const url = `https://www.rfc-editor.org/rfc/rfc${id}.html${
    section ? `#section-${section}` : ''
  }`;
  return section
    ? { body: 'RFC', id: String(id), title, section, url }
    : { body: 'RFC', id: String(id), title, url };
}

/** Cite an IEEE standard, e.g. `ieee('802.1Q', 'Bridges and Bridged Networks')`. */
export function ieee(id: string, title: string): StandardRef {
  return { body: 'IEEE', id, title };
}

/** Cite an ITU-T recommendation, e.g. `itu('G.984', '...')`. */
export function itu(id: string, title: string): StandardRef {
  return { body: 'ITU-T', id, title };
}

/** `'RFC 3022 §2.2'` -- the citation as a reader would write it. */
export function formatStandardRef(ref: StandardRef): string {
  const base = `${ref.body} ${ref.id}`;
  return ref.section ? `${base} \u00a7${ref.section}` : base;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

/**
 * What one machine or one hop is for, in two or three sentences.
 *
 * Kept beside the topology rather than inside `SimNode.detail` because `detail` is a
 * label/value grid -- facts, not prose -- and because a note carries a citation, which
 * a `Record<string, string>` has nowhere to put.
 */
export interface TeachingNote {
  /** The `SimNode.id` or `SimLink.id` this explains. */
  targetId: string;
  /** Two or three sentences. Written to be read on its own, out of order. */
  text: string;
  /** The standard that defines the behaviour, where one applies. */
  reference?: StandardRef;
}

/** A network to explore, with everything needed to explain it. */
export interface ScenarioTopology {
  /** Stable id, unique across all scenarios: `'home-lan'`, `'isp-path'`, ... */
  id: string;
  /** Short display name, e.g. `'Home LAN'`. */
  title: string;
  /** One or two sentences setting the scene, shown by the scenario picker. */
  summary: string;
  /** What a learner should walk away understanding, as short phrases. */
  teaches: readonly string[];
  /** The machines and the wires. */
  topology: Topology;
  /**
   * Notes for the nodes and links, in the order a guided walk-through should visit
   * them -- which is also the order `topology.nodes` declares them.
   */
  notes: readonly TeachingNote[];
}

/** The note explaining one node or link, if the scenario wrote one. */
export function noteFor(
  scenario: ScenarioTopology,
  targetId: string,
): TeachingNote | undefined {
  return scenario.notes.find((note) => note.targetId === targetId);
}
