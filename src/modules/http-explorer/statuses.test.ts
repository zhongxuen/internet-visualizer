/**
 * The table in `statuses.ts` is a claim about what the simulation does. This runs it.
 *
 * Every row is a promise the UI makes on a click, so every row is executed here and the
 * status it names is looked for among the exchanges the run actually produced. A row that
 * stops being true fails the build rather than sending a learner to a run with nothing in
 * it -- which is the failure mode a hand-written mapping has, and the reason to test it.
 */

import { describe, expect, it } from 'vitest';

import {
  builderScenario,
  DEFAULT_REQUEST_DRAFT,
  parseRequestDraft,
  type RequestDraft,
} from './builder';
import { getHttpScenario } from './scenarios';
import { runHttpScenario, type HttpScenario } from './sim/exchange';
import { statusSemantics } from './sim/semantics';
import { REACHABLE_STATUS_CODES, STATUS_SOURCES, type StatusSource } from './statuses';
import { wireResponse } from './wire';

/** The scenario a source names, however it names it. */
function scenarioFor(source: StatusSource): HttpScenario {
  if (source.kind === 'scenario') {
    const scenario = getHttpScenario(source.scenarioId);
    if (!scenario) throw new Error(`no scenario ${source.scenarioId}`);
    return scenario;
  }

  const draft: RequestDraft = { ...DEFAULT_REQUEST_DRAFT, ...source.draft };
  const parsed = parseRequestDraft(draft);
  if (!parsed.ok) throw new Error(`builder draft is invalid: ${parsed.error}`);
  return builderScenario(parsed.value);
}

describe('every reachable status is actually reachable', () => {
  for (const code of REACHABLE_STATUS_CODES) {
    const source = STATUS_SOURCES[code];

    it(`${code} comes out of ${source.kind === 'scenario' ? source.scenarioId : 'the builder'}`, () => {
      const run = runHttpScenario(scenarioFor(source));
      // The wire response, not the exchange's own: a revalidation puts a 304 on the
      // network and hands the client a complete 200, and the map promises the former.
      const produced = run.exchanges.map((exchange) => wireResponse(exchange).status);
      expect(produced).toContain(code);
    });
  }
});

describe('the table itself', () => {
  it('names only codes the status catalogue knows', () => {
    for (const code of REACHABLE_STATUS_CODES) {
      expect(statusSemantics(code), `${code} is not in STATUS_SEMANTICS`).toBeDefined();
    }
  });

  it('gives every entry a line of guidance, since the map prints one', () => {
    for (const code of REACHABLE_STATUS_CODES) {
      expect(STATUS_SOURCES[code].how.length).toBeGreaterThan(20);
    }
  });

  it('is sorted, because the map walks it in order', () => {
    expect(REACHABLE_STATUS_CODES).toEqual(
      [...REACHABLE_STATUS_CODES].sort((a, b) => a - b),
    );
  });
});
