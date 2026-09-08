import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DIAGNOSTIC_PATHS,
  LOOKUP_EXAMPLES,
  METHOD_NOTES,
  REGISTRATION_RECORDS,
  runLookup,
  runTraceroute,
  runRegistrationLookup,
  type ProbeMethod,
} from '@/modules/network-diagnostics';
import { EMBEDDABLE_MODULE_IDS, loadEmbeddableScenarios } from '@/modules/scenarios';
import type { RfcRef, SimEvent } from '@/core/types/events';

/**
 * `docs/ACCURACY.md` is checked against the product, not trusted.
 *
 * That file is the artifact the whole "these animations are accurate" claim rests on, and
 * a citation list maintained by hand rots the same way a hardcoded module list does: a
 * scenario picks up a new RFC, nobody remembers the doc, and a reviewer reading the tables
 * is reading last quarter's product. So the tables are asserted to be a superset of what
 * the simulations actually cite.
 *
 * It deliberately checks a *superset* rather than an exact match. `ACCURACY.md` also names
 * documents no `annotate` event cites -- RFC 5737 and RFC 2606 govern the fixtures rather
 * than any one moment in a run, and RFC 8484 describes a live operation, which by
 * definition emits no simulation events. Requiring equality would mean deleting true rows
 * to make a test pass.
 *
 * ## Why it runs the scenarios rather than grepping the source
 *
 * Because a citation attached to an event that no scenario ever reaches is not a claim the
 * product makes. Grepping `src/` would count the dead ones and let a reviewer believe the
 * coverage is wider than it is; running every scenario counts exactly what a user can be
 * shown. The catalogue comes from the same manifest `tests/determinism.test.ts` uses, so a
 * module that adds a scenario is covered here without an edit.
 */

// Resolved from the working directory rather than `import.meta.url`: this file runs in
// the jsdom project, where vite serves modules over http and `import.meta.url` is not a
// file URL. Vitest always runs from the project root.
const ACCURACY = readFileSync(join(process.cwd(), 'docs', 'ACCURACY.md'), 'utf8');

/** Every RFC number `docs/ACCURACY.md` names, in any of its tables or prose. */
const DOCUMENTED = new Set(
  [...ACCURACY.matchAll(/RFC (\d{3,4})/g)].map((match) => Number(match[1])),
);

/** One citation, and enough context for a failure to say where it came from. */
interface Citation {
  readonly where: string;
  readonly reference: RfcRef;
}

function citationsOf(where: string, events: readonly SimEvent[]): Citation[] {
  return events.flatMap((event) =>
    event.kind === 'annotate' && event.reference
      ? [{ where, reference: event.reference }]
      : [],
  );
}

/**
 * Top-level `await`, for the reason `determinism.test.ts` gives: every entry in the
 * manifest is an `import()`, and resolving them here lets the assertions below be plain
 * synchronous tests over one collected array.
 */
const CITATIONS: Citation[] = [];

for (const moduleId of EMBEDDABLE_MODULE_IDS) {
  const scenarios = (await loadEmbeddableScenarios(moduleId)) ?? [];
  for (const scenario of scenarios) {
    CITATIONS.push(
      ...citationsOf(`${moduleId}/${scenario.id}`, scenario.run().result.events),
    );
  }
}

// Network Diagnostics publishes no catalogue -- see `src/modules/scenarios.ts` -- so its
// Learn-mode runs are enumerated the same way the determinism guard enumerates them.
// `ping` is absent because it returns probes rather than a `SimResult` of annotations.
for (const path of DIAGNOSTIC_PATHS) {
  for (const method of Object.keys(METHOD_NOTES) as ProbeMethod[]) {
    CITATIONS.push(
      ...citationsOf(
        `network-diagnostics/traceroute/${method}/${path.id}`,
        runTraceroute(path, { method }).result.events,
      ),
    );
  }
}
for (const example of LOOKUP_EXAMPLES) {
  CITATIONS.push(
    ...citationsOf(
      `network-diagnostics/lookup/${example.name}`,
      runLookup(example).result.events,
    ),
  );
}
for (const record of REGISTRATION_RECORDS) {
  CITATIONS.push(
    ...citationsOf(
      `network-diagnostics/rdap/${record.id}`,
      runRegistrationLookup(record).result.events,
    ),
  );
}

const CITED = new Set(CITATIONS.map((citation) => citation.reference.rfc));

describe('RFC citations', () => {
  it('collected something to check', () => {
    // A sweep that quietly stopped finding citations would pass every assertion below.
    // The floors are well under the real figures (503 citations across 45 RFCs at the
    // time of writing, which is the number docs/ACCURACY.md quotes). Deliberately loose:
    // this guards against collecting nothing, and is not a second place to maintain a
    // count that every new scenario would change.
    expect(CITATIONS.length).toBeGreaterThan(100);
    expect(CITED.size).toBeGreaterThan(20);
  });

  it('every citation is well formed', () => {
    const malformed = CITATIONS.filter(
      ({ reference }) =>
        !Number.isInteger(reference.rfc) ||
        reference.rfc < 1 ||
        reference.title.trim() === '',
    ).map(({ where, reference }) => `${where}: ${JSON.stringify(reference)}`);

    expect(malformed, 'a citation is missing an RFC number or a title').toEqual([]);
  });

  it('names every cited RFC in docs/ACCURACY.md', () => {
    const undocumented = [...CITED]
      .filter((rfc) => !DOCUMENTED.has(rfc))
      .sort((a, b) => a - b)
      .map((rfc) => {
        const example = CITATIONS.find((citation) => citation.reference.rfc === rfc)!;
        return `RFC ${rfc} (${example.reference.title}) — cited by ${example.where}`;
      });

    expect(
      undocumented,
      'a simulation cites an RFC docs/ACCURACY.md does not list. Add it to the right table there.',
    ).toEqual([]);
  });
});
