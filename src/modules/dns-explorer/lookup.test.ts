import { describe, expect, it } from 'vitest';

import { runDnsScenario } from './scenarios';
import {
  coverageFor,
  DEFAULT_DRAFT,
  hostnameFromInput,
  lookupScenario,
  parseLookup,
  reversePtrName,
  simulatedZoneFor,
  type LookupDraft,
} from './lookup';

const draft = (patch: Partial<LookupDraft> = {}): LookupDraft => ({
  ...DEFAULT_DRAFT,
  ...patch,
});

describe('hostnameFromInput', () => {
  it('normalises case, whitespace, and the trailing dot', () => {
    expect(hostnameFromInput('  Example.COM.  ')).toBe('example.com');
  });

  it('takes the host out of a pasted URL', () => {
    expect(hostnameFromInput('https://www.example.com/a/b?c=1#d')).toBe(
      'www.example.com',
    );
  });

  it('takes the domain out of a pasted email address', () => {
    expect(hostnameFromInput('someone@example.com')).toBe('example.com');
  });

  it('drops a port', () => {
    expect(hostnameFromInput('example.com:8443')).toBe('example.com');
  });
});

describe('parseLookup', () => {
  it('accepts a name the fixtures know, normalised', () => {
    const result = parseLookup(draft({ name: ' WWW.Example.com. ' }));

    expect(result).toEqual({
      ok: true,
      value: { ...DEFAULT_DRAFT, name: 'www.example.com' },
    });
  });

  it('accepts a name the fixtures have never heard of — validity is not existence', () => {
    const result = parseLookup(draft({ name: 'nothing-here.example.invalid' }));

    expect(result.ok).toBe(true);
  });

  it('rejects an empty field with something to do about it', () => {
    const result = parseLookup(draft({ name: '   ' }));

    expect(result).toEqual({
      ok: false,
      error: 'Type a domain name, or pick one of the examples below.',
    });
  });

  it('rejects a label the DNS could not carry, and says which', () => {
    const result = parseLookup(draft({ name: 'not a host.example.com' }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toContain('not a host');
  });

  it('rejects two dots in a row', () => {
    const result = parseLookup(draft({ name: 'example..com' }));

    expect(result.ok).toBe(false);
  });

  it('rejects a record type this module does not serve', () => {
    const result = parseLookup(draft({ name: 'example.com', type: 'RRSIG' as never }));

    expect(result.ok).toBe(false);
  });

  it('rejects a transport that is not one of the four', () => {
    const result = parseLookup(
      draft({ name: 'example.com', transport: 'carrier-pigeon' as never }),
    );

    expect(result.ok).toBe(false);
  });
});

describe('reversePtrName', () => {
  it('writes an address backwards under in-addr.arpa', () => {
    expect(reversePtrName('203.0.113.20')).toBe('20.113.0.203.in-addr.arpa');
  });

  it('is undefined for anything that is not an IPv4 address', () => {
    expect(reversePtrName('example.com')).toBeUndefined();
  });
});

describe('simulatedZoneFor', () => {
  it('finds the deepest bundled zone enclosing a name', () => {
    expect(simulatedZoneFor('www.example.com')?.origin).toBe('example.com');
  });

  it('falls back to the enclosing TLD when nothing below it is bundled', () => {
    expect(simulatedZoneFor('unknown-name.com')?.origin).toBe('com');
  });

  it('falls back to the root when even the TLD is not bundled', () => {
    expect(simulatedZoneFor('somewhere.example-tld')?.origin).toBe('');
  });
});

describe('coverageFor', () => {
  it('reports a bundled name as covered, naming its zone', () => {
    const coverage = coverageFor('www.example.com');

    expect(coverage.known).toBe(true);
    expect(coverage.zone?.origin).toBe('example.com');
    expect(coverage.note).toContain('example.com.');
  });

  /**
   * The whole point of the note. A learner typing a real domain must not read the
   * fixtures' silence as a statement about the Internet.
   */
  it('says plainly that an unknown name is answered by the simulation, not the Internet', () => {
    const coverage = coverageFor('google.com');

    expect(coverage.known).toBe(false);
    expect(coverage.note).toContain('NXDOMAIN');
    expect(coverage.note).toContain('nothing was asked of a real nameserver');
  });

  it('blames the root when the top-level domain itself is not bundled', () => {
    expect(coverageFor('example.test').note).toContain('simulated root');
  });
});

describe('lookupScenario', () => {
  const valid = (patch: Partial<LookupDraft> = {}) => {
    const result = parseLookup(draft(patch));
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  it('asks once when the cache is cold', () => {
    expect(lookupScenario(valid({ cache: 'cold' })).lookups).toHaveLength(1);
  });

  /** Warm is demonstrated rather than asserted: the first ask fills the cache. */
  it('asks twice when the cache is warm, and the second ask is free', () => {
    const run = runDnsScenario(lookupScenario(valid({ cache: 'warm' })));

    expect(run.resolutions).toHaveLength(2);
    expect(run.resolutions[0].servedFromCache).toBe(false);
    expect(run.resolutions[1].servedFromCache).toBe(true);
    expect(run.resolutions[1].usedRootOrTld).toBe(false);
    expect(run.resolutions[1].elapsedMs).toBeLessThan(run.resolutions[0].elapsedMs);
  });

  it('resolves an unknown name against the fixtures rather than failing to run', () => {
    const run = runDnsScenario(lookupScenario(valid({ name: 'google.com' })));

    expect(run.resolutions[0].rcode).toBe('NXDOMAIN');
    expect(run.result.events.length).toBeGreaterThan(0);
  });

  it('is deterministic: the same lookup twice is the same run', () => {
    const first = runDnsScenario(lookupScenario(valid()));
    const second = runDnsScenario(lookupScenario(valid()));

    expect(first.result).toEqual(second.result);
  });

  it('puts every knob in the seed, so two different runs cannot collide', () => {
    const cold = lookupScenario(valid({ cache: 'cold' }));
    const warm = lookupScenario(valid({ cache: 'warm' }));

    expect(cold.seed).not.toBe(warm.seed);
  });
});
