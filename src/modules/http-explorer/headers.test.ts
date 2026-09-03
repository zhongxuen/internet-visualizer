/**
 * The header catalogue is a set of claims about HTTP, so the tests are about whether the
 * claims are current and whether they cover what the module actually puts on screen.
 *
 * The first one is the acceptance criterion from the phase document, and it is the one
 * worth having a build fail over: RFC 2616 and the RFC 723x series are obsolete, and
 * most of what people still believe about HTTP that stopped being true in 2014 comes from
 * having read them.
 */

import { describe, expect, it } from 'vitest';

import { explainHeader, formatSpec, HEADER_EXPLANATIONS } from './headers';
import { HTTP_SCENARIOS } from './scenarios';
import { runHttpScenario } from './sim/exchange';

/** Every field name any scenario actually sends, in either direction. */
function fieldNamesInScenarios(): Set<string> {
  const names = new Set<string>();
  for (const scenario of HTTP_SCENARIOS) {
    for (const exchange of runHttpScenario(scenario).exchanges) {
      for (const field of exchange.request.headers) names.add(field.name.toLowerCase());
      for (const field of exchange.response.headers) names.add(field.name.toLowerCase());
    }
  }
  return names;
}

describe('the citations are current', () => {
  const OBSOLETE = [2616, 7230, 7231, 7232, 7233, 7234, 7235];

  it('cites no obsolete RFC', () => {
    for (const entry of HEADER_EXPLANATIONS) {
      if (entry.reference.kind !== 'rfc') continue;
      expect(
        OBSOLETE,
        `${entry.name} cites the obsolete RFC ${entry.reference.rfc}`,
      ).not.toContain(entry.reference.rfc);
    }
  });

  it('cites 9110-9114 for the core protocol fields', () => {
    const core = ['Host', 'Content-Length', 'Cache-Control', 'ETag', 'Location', 'Vary'];
    for (const name of core) {
      const entry = explainHeader(name);
      expect(entry, `${name} is not catalogued`).toBeDefined();
      expect(entry?.reference.kind).toBe('rfc');
      if (entry?.reference.kind !== 'rfc') continue;
      expect(entry.reference.rfc).toBeGreaterThanOrEqual(9110);
      expect(entry.reference.rfc).toBeLessThanOrEqual(9114);
    }
  });

  it('is honest about the fields no RFC defines', () => {
    const cors = explainHeader('Access-Control-Allow-Origin');
    expect(cors?.reference.kind).toBe('living');
    expect(formatSpec(cors!.reference)).toContain('WHATWG Fetch');

    const correlation = explainHeader('X-Request-Id');
    expect(correlation?.reference.kind).toBe('none');
    expect(formatSpec(correlation!.reference)).toBe('No specification');
  });
});

describe('the catalogue covers what the scenarios send', () => {
  it('has an entry for every field on the wire in any of the seven runs', () => {
    const missing = [...fieldNamesInScenarios()].filter(
      (name) => explainHeader(name) === undefined,
    );
    expect(missing, `uncatalogued fields: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('the entries themselves', () => {
  it('matches case-insensitively, since h2 and h3 lower-case every name', () => {
    expect(explainHeader('CONTENT-TYPE')).toBe(explainHeader('content-type'));
    expect(explainHeader('  Host  ')).toBe(explainHeader('host'));
  });

  it('has no duplicate names', () => {
    const names = HEADER_EXPLANATIONS.map((entry) => entry.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('says what each field does and who sets it', () => {
    for (const entry of HEADER_EXPLANATIONS) {
      expect(entry.what.length, `${entry.name} has no explanation`).toBeGreaterThan(20);
      expect(entry.setBy.length, `${entry.name} has no setter`).toBeGreaterThan(5);
    }
  });

  it('returns undefined rather than inventing an answer', () => {
    expect(explainHeader('X-Invented-By-Nobody')).toBeUndefined();
  });
});
