import { describe, expect, it } from 'vitest';

import {
  describeStatus,
  formatRdap,
  formatWhois,
  getRecord,
  rdapBody,
  runRegistrationLookup,
  DOC_NETWORK,
  EPP_STATUS_CODES,
  EXAMPLE_COM,
  EXAMPLE_NET,
  EXAMPLE_ORG,
  RDAP_FIELD_NOTES,
  REGISTRATION_RECORDS,
  UNREGISTERED,
  WHOIS_VS_RDAP,
} from './whois';

describe('EPP status codes', () => {
  it('says who set each one, because that decides whether it can be removed', () => {
    expect(EPP_STATUS_CODES.clientTransferProhibited?.setBy).toBe('client');
    expect(EPP_STATUS_CODES.serverTransferProhibited?.setBy).toBe('server');
  });

  /** The status a DNS investigation should reach for, and the reason this tool is here. */
  it('explains that clientHold removes a domain from the zone', () => {
    const status = describeStatus('clientHold');
    expect(status.meaning).toContain('remove this domain from the zone');
    expect(status.consequence).toContain('stops resolving');
  });

  it('falls back rather than throwing on a code the fixtures do not cover', () => {
    const status = describeStatus('someFutureStatus');
    expect(status.code).toBe('someFutureStatus');
    expect(status.meaning).toContain('not covered');
  });
});

describe('the fixtures', () => {
  it('cover a healthy domain, a new one, an expired one, an address block, and a gap', () => {
    expect(REGISTRATION_RECORDS.map((record) => record.id)).toEqual([
      'example-com',
      'example-net',
      'example-org',
      'doc-network',
      'unregistered',
    ]);
    expect(getRecord('example-com')).toBe(EXAMPLE_COM);
    expect(getRecord('nope')).toBeUndefined();
  });

  it('use only names and addresses reserved for documentation', () => {
    for (const record of REGISTRATION_RECORDS) {
      if (record.kind === 'domain') {
        expect(record.target).toMatch(/\.(com|net|org|example)$/);
        expect(record.target.split('.')[0]).toMatch(
          /^(example|notregistered|internal|retired|status|app|assets)$/,
        );
      }
      for (const ns of record.nameservers) {
        for (const address of ns.addresses ?? []) {
          expect(address).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
        }
      }
    }
  });

  it('gives the in-zone nameserver glue and the out-of-zone one none', () => {
    const [inZone, outOfZone] = EXAMPLE_COM.nameservers;
    expect(inZone?.host.endsWith('example.com')).toBe(true);
    expect(inZone?.addresses).toBeDefined();
    expect(outOfZone?.addresses).toBeUndefined();
  });

  it('distinguishes a redacted registrant from a privacy proxy', () => {
    const redacted = EXAMPLE_COM.entities.find((e) => e.role === 'registrant');
    const proxy = EXAMPLE_NET.entities.find((e) => e.role === 'registrant');
    expect(redacted?.redacted).toBe(true);
    expect(proxy?.redacted).toBe(false);
    expect(proxy?.organization).toContain('Proxy');
  });

  it('publishes an abuse contact even where everything else is withheld', () => {
    for (const record of REGISTRATION_RECORDS.filter((entry) => entry.found)) {
      expect(record.entities.some((entity) => entity.role === 'abuse')).toBe(true);
    }
  });
});

describe('the WHOIS presentation', () => {
  it('is free text with no schema, which is the argument against it', () => {
    const lines = formatWhois(EXAMPLE_COM);
    expect(lines[0]).toBe('Domain Name: EXAMPLE.COM');
    expect(lines.some((line) => line.startsWith('Domain Status: clientHold'))).toBe(
      false,
    );
    expect(lines.filter((line) => line.startsWith('Name Server:'))).toHaveLength(2);
  });

  it('says "No match" for a name nobody registered', () => {
    expect(formatWhois(UNREGISTERED)[0]).toContain('No match');
  });

  it('uses an entirely different layout for an address block', () => {
    const lines = formatWhois(DOC_NETWORK);
    expect(lines[0]).toContain('NetRange');
    expect(lines.some((line) => line.startsWith('Domain Name'))).toBe(false);
  });
});

describe('the RDAP presentation', () => {
  it('produces an object with the RFC 9083 key names', () => {
    const body = rdapBody(EXAMPLE_COM) as Record<string, unknown>;
    expect(body.objectClassName).toBe('domain');
    expect(body.ldhName).toBe('example.com');
    expect(body.rdapConformance).toEqual(['rdap_level_0']);
    expect(body.secureDNS).toEqual({ delegationSigned: true });
    expect(Array.isArray(body.events)).toBe(true);
  });

  it('uses the same key names for an address block, with an ip network class', () => {
    const body = rdapBody(DOC_NETWORK) as Record<string, unknown>;
    expect(body.objectClassName).toBe('ip network');
    expect(body.startAddress).toBe('203.0.113.0');
    // The parts that are common really are common: same keys, same shapes.
    expect(body.status).toEqual(['ok']);
    expect(Array.isArray(body.entities)).toBe(true);
  });

  it('marks a redacted entity with a remark rather than dropping it', () => {
    const body = rdapBody(EXAMPLE_COM) as { entities: { remarks?: unknown[] }[] };
    expect(body.entities[0]?.remarks).toBeDefined();
  });

  it('answers a missing registration with a structured 404 body', () => {
    const body = rdapBody(UNREGISTERED) as Record<string, unknown>;
    expect(body.errorCode).toBe(404);
    expect(formatRdap(UNREGISTERED).join('\n')).toContain('"errorCode": 404');
  });

  it('is valid JSON when formatted', () => {
    for (const record of REGISTRATION_RECORDS) {
      expect(() => JSON.parse(formatRdap(record).join('\n'))).not.toThrow();
    }
  });
});

describe('running a registration lookup', () => {
  it('is deterministic and needs no seed, because a registry read is not variable', () => {
    expect(runRegistrationLookup(EXAMPLE_COM)).toEqual(
      runRegistrationLookup(EXAMPLE_COM),
    );
  });

  it('makes exactly two RDAP requests: bootstrap, then the registry it named', () => {
    const run = runRegistrationLookup(EXAMPLE_COM);
    expect(run.requests).toHaveLength(2);
    expect(run.requests[0]?.url).toContain('bootstrap');
    expect(run.requests[1]?.url).toBe(
      `${EXAMPLE_COM.registry.rdapBase}domain/example.com`,
    );
    expect(run.requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('asks the address bootstrap file when the target is a block', () => {
    const run = runRegistrationLookup(DOC_NETWORK);
    expect(run.requests[0]?.url).toContain('ipv4.json');
    expect(run.requests[1]?.url).toContain('/ip/203.0.113.0/24');
  });

  it('returns 200 for a record that exists and 404 for one that does not', () => {
    expect(runRegistrationLookup(EXAMPLE_COM).httpStatus).toBe(200);
    expect(runRegistrationLookup(UNREGISTERED).httpStatus).toBe(404);
  });

  it('walks the same four phases every time', () => {
    for (const record of REGISTRATION_RECORDS) {
      const run = runRegistrationLookup(record);
      expect(run.result.phases.map((phase) => phase.id)).toEqual([
        'whois',
        'bootstrap',
        'registry',
        'reading',
      ]);
    }
  });

  it('shows the legacy query going out over port 43 in the clear', () => {
    const run = runRegistrationLookup(EXAMPLE_COM);
    const query = run.result.pdus['whois-query'];
    expect(query?.layers[0]?.fields[0]?.value).toBe('43');
    expect(query?.layers.some((layer) => layer.protocol === 'TLS')).toBe(false);
  });

  it('shows the RDAP requests wrapped in TLS', () => {
    const run = runRegistrationLookup(EXAMPLE_COM);
    expect(run.result.pdus['registry-request']?.layers[0]?.protocol).toBe('TLS');
  });

  it('produces sorted events that only name declared nodes and links', () => {
    for (const record of REGISTRATION_RECORDS) {
      const run = runRegistrationLookup(record);
      const ids = new Set(run.topology.nodes.map((node) => node.id));
      const links = new Set(run.topology.links.map((link) => link.id));
      const times = run.result.events.map((event) => event.at);

      expect(times).toEqual([...times].sort((a, b) => a - b));
      for (const event of run.result.events) {
        if (event.kind === 'transmit') {
          expect(ids.has(event.from)).toBe(true);
          expect(ids.has(event.to)).toBe(true);
          expect(links.has(event.linkId)).toBe(true);
        }
        if (event.kind === 'pdu-created') expect(ids.has(event.atNode)).toBe(true);
        if (event.kind === 'annotate') expect(ids.has(event.targetId)).toBe(true);
      }
    }
  });
});

describe('the comparison', () => {
  it('names the discovery step as the difference that matters most', () => {
    const row = WHOIS_VS_RDAP.find((entry) => entry.aspect === 'Finding the server');
    expect(row?.whois).toContain('No discovery');
    expect(row?.rdap).toContain('bootstrap');
  });

  it('explains the expiry field, which is the one people read wrong', () => {
    expect(RDAP_FIELD_NOTES.expiration).toContain('not when the domain stops working');
  });

  it('has an expired fixture whose statuses explain the outage', () => {
    expect(EXAMPLE_ORG.statuses).toContain('clientHold');
    expect(EXAMPLE_ORG.summary).toContain('SERVFAIL');
  });
});
