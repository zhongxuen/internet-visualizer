import { describe, expect, it } from 'vitest';

import { classifyIp, ip } from '@/core/net/address';

import {
  ROOT,
  SIMULATED_INTERNET,
  UDP_MAX_PAYLOAD,
  answerFrom,
  displayName,
  dsDigest,
  estimateMessageSize,
  findZone,
  isInBailiwick,
  isSubdomainOf,
  keyTagOf,
  lookupInZone,
  normalizeName,
  parentOf,
  parseDomainName,
  question,
  rdataText,
  rr,
  signZone,
  zoneKeys,
  type DnsZone,
  type ResourceRecord,
} from './records';

const rootZone = findZone(SIMULATED_INTERNET, ROOT) as DnsZone;
const comZone = findZone(SIMULATED_INTERNET, 'com') as DnsZone;
const exampleCom = findZone(SIMULATED_INTERNET, 'example.com') as DnsZone;

/** Every address the fixtures contain, from both the server list and the zone data. */
function everyAddress(): string[] {
  const addresses: string[] = [];
  for (const zone of SIMULATED_INTERNET.zones) {
    for (const server of zone.nameservers) {
      addresses.push(server.ipv4);
      if (server.ipv6) addresses.push(server.ipv6);
    }
    for (const record of zone.records) {
      if (record.data.type === 'A' || record.data.type === 'AAAA') {
        addresses.push(record.data.address);
      }
    }
  }
  return addresses;
}

describe('names', () => {
  it('canonicalises the trailing dot and the case away', () => {
    expect(normalizeName('WWW.Example.COM.')).toBe('www.example.com');
    expect(normalizeName('.')).toBe(ROOT);
    expect(normalizeName('')).toBe(ROOT);
    expect(displayName(ROOT)).toBe('.');
    expect(displayName('example.com')).toBe('example.com.');
  });

  it('walks up the tree one label at a time, ending at the root', () => {
    expect(parentOf('www.example.com')).toBe('example.com');
    expect(parentOf('com')).toBe(ROOT);
    expect(isSubdomainOf('www.example.com', 'example.com')).toBe(true);
    expect(isSubdomainOf('example.com', 'example.com')).toBe(false);
    // Everything is below the root, and nothing is below a name it merely ends with.
    expect(isSubdomainOf('example.com', ROOT)).toBe(true);
    expect(isSubdomainOf('notexample.com', 'example.com')).toBe(false);
  });

  it('treats bailiwick as "at or below", which is what caching depends on', () => {
    expect(isInBailiwick('example.com', 'example.com')).toBe(true);
    expect(isInBailiwick('www.example.com', 'com')).toBe(true);
    expect(isInBailiwick('example.org', 'com')).toBe(false);
  });

  it('accepts the labels the DNS actually allows, and rejects the rest', () => {
    expect(parseDomainName('Example.COM.')).toEqual({ ok: true, value: 'example.com' });
    // Service labels (RFC 2782) and wildcards (RFC 4592) are legal names.
    expect(parseDomainName('_sip._tcp.example.com').ok).toBe(true);
    expect(parseDomainName('*.dev.example.com').ok).toBe(true);

    expect(parseDomainName('example..com')).toEqual({
      ok: false,
      error: 'name has an empty label (two dots in a row)',
    });
    expect(parseDomainName('bad_$_label.com').ok).toBe(false);
    expect(parseDomainName(`${'a'.repeat(64)}.com`).ok).toBe(false);
    expect(parseDomainName(`${'a'.repeat(60)}.`.repeat(5)).ok).toBe(false);
  });
});

describe('the fixtures', () => {
  /**
   * The safety rule for the whole module: a learner must never be able to mistake one of
   * these for a real host, and nothing here may ever be pointed at one. RFC 5737 and RFC
   * 3849 exist precisely so documentation can use addresses that route nowhere.
   */
  it('uses only addresses reserved for documentation', () => {
    const wrong = everyAddress().filter(
      (address) => classifyIp(ip(address)) !== 'documentation',
    );
    expect(wrong).toEqual([]);
  });

  it('names the thirteen root servers, which are thirteen addresses and not thirteen machines', () => {
    const names = rootZone.records
      .filter((record) => record.name === ROOT && record.type === 'NS')
      .map((record) => (record.data.type === 'NS' ? record.data.nameserver : ''));

    expect(names).toHaveLength(13);
    expect(names[0]).toBe('a.root-servers.net');
    expect(names[12]).toBe('m.root-servers.net');
    expect(SIMULATED_INTERNET.rootHints).toHaveLength(13);
  });

  it('prints records the way a zone file does', () => {
    const a = rr('example.com', 3600, { type: 'A', address: '203.0.113.20' });
    expect(rdataText(a.data)).toBe('203.0.113.20');
    expect(rdataText({ type: 'MX', preference: 10, exchange: 'mail.example.com' })).toBe(
      '10 mail.example.com.',
    );
    expect(rdataText({ type: 'TXT', strings: ['v=spf1 -all'] })).toBe('"v=spf1 -all"');
  });
});

describe('lookupInZone', () => {
  /** The single most common misconception about DNS, asserted directly. */
  it('makes the root refer rather than answer, even for a name it could look up', () => {
    const response = lookupInZone(rootZone, question('www.example.com', 'A'));

    expect(response.outcome).toBe('referral');
    expect(response.answer).toEqual([]);
    expect(response.authoritative).toBe(false);
    expect(response.delegation).toBe('com');
    expect(
      response.authority.every((record) => record.type === 'NS' && record.name === 'com'),
    ).toBe(true);
  });

  it('makes the TLD refer too, one label further down', () => {
    const response = lookupInZone(comZone, question('www.example.com', 'A'));

    expect(response.outcome).toBe('referral');
    expect(response.answer).toEqual([]);
    expect(response.delegation).toBe('example.com');
  });

  /**
   * A delegation to a nameserver inside the zone being delegated is unfollowable unless
   * the parent also hands over its address. That is the entire job of glue.
   */
  it('carries glue for nameservers that live inside the zone being delegated', () => {
    const response = lookupInZone(comZone, question('www.example.com', 'A'));
    const glue = response.additional.map((record) => record.name);

    expect(glue).toContain('ns1.example.com');
    expect(
      response.additional.every(
        (record) => record.type === 'A' || record.type === 'AAAA',
      ),
    ).toBe(true);
  });

  it('sends no glue when the nameservers live outside the zone', () => {
    const org = findZone(SIMULATED_INTERNET, 'org') as DnsZone;
    const response = lookupInZone(org, question('example.org', 'A'));

    expect(response.outcome).toBe('referral');
    expect(response.additional).toEqual([]);
  });

  it('answers authoritatively once the walk reaches the zone that owns the name', () => {
    const response = lookupInZone(exampleCom, question('example.com', 'A'));

    expect(response.outcome).toBe('answer');
    expect(response.authoritative).toBe(true);
    expect(response.answer).toHaveLength(1);
    expect(rdataText(response.answer[0].data)).toBe('203.0.113.20');
  });

  it('follows an alias only as far as its own zone reaches', () => {
    const inside = lookupInZone(exampleCom, question('www.example.com', 'A'));
    expect(inside.outcome).toBe('answer');
    expect(inside.answer.map((record) => record.type)).toEqual(['CNAME', 'A']);

    const outside = lookupInZone(exampleCom, question('shop.example.com', 'A'));
    expect(outside.outcome).toBe('cname');
    expect(outside.target).toBe('edge.cdn.example.net');
    expect(outside.answer.map((record) => record.type)).toEqual(['CNAME']);
  });

  /** NODATA is not an error, and telling it apart from NXDOMAIN is the point. */
  it('separates "no such type" from "no such name"', () => {
    const nodata = lookupInZone(exampleCom, question('mail.example.com', 'AAAA'));
    expect(nodata.outcome).toBe('nodata');
    expect(nodata.rcode).toBe('NOERROR');
    expect(nodata.soa?.type).toBe('SOA');

    const nxdomain = lookupInZone(exampleCom, question('nope.example.com', 'A'));
    expect(nxdomain.outcome).toBe('nxdomain');
    expect(nxdomain.rcode).toBe('NXDOMAIN');
    // The SOA is what says how long the "no" may be remembered (RFC 2308).
    expect(nxdomain.soa?.type).toBe('SOA');
    expect(nxdomain.authority).toContain(nxdomain.soa);
  });

  it('synthesises an answer at the queried name from a wildcard', () => {
    const response = lookupInZone(exampleCom, question('anything.dev.example.com', 'A'));

    expect(response.outcome).toBe('answer');
    expect(response.answer[0].name).toBe('anything.dev.example.com');
    expect(rdataText(response.answer[0].data)).toBe('203.0.113.28');
  });

  /** DS lives on the parent's side of the cut, so the parent answers it (RFC 4035 s3.1.4). */
  it('answers a DS query from the parent instead of referring', () => {
    const response = lookupInZone(rootZone, question('com', 'DS'), { dnssec: true });

    expect(response.outcome).toBe('answer');
    expect(response.answer.some((record) => record.type === 'DS')).toBe(true);
  });

  it('keeps signatures off the wire unless the asker set DO', () => {
    const plain = lookupInZone(exampleCom, question('example.com', 'A'));
    expect(plain.answer.some((record) => record.type === 'RRSIG')).toBe(false);

    const org = findZone(SIMULATED_INTERNET, 'example.org') as DnsZone;
    const signed = lookupInZone(org, question('example.org', 'A'), { dnssec: true });
    expect(signed.answer.some((record) => record.type === 'RRSIG')).toBe(true);
  });
});

describe('answerFrom', () => {
  it('refuses a name the server holds no zone for, rather than recursing', () => {
    // The gTLD servers serve com and net. Nothing about example.org is their business,
    // and an authoritative server that recursed for strangers would be an open resolver.
    const response = answerFrom(
      SIMULATED_INTERNET,
      '192.0.2.30',
      question('example.org', 'A'),
    );

    expect(response.outcome).toBe('refused');
    expect(response.rcode).toBe('REFUSED');
  });

  it('picks the deepest zone a server holds for the name', () => {
    // The root servers also serve arpa, which is why a reverse lookup gets a referral
    // into the reverse tree from the first server it asks.
    const response = answerFrom(
      SIMULATED_INTERNET,
      '192.0.2.1',
      question('20.113.0.203.in-addr.arpa', 'PTR'),
    );

    expect(response.outcome).toBe('referral');
    expect(response.delegation).toBe('in-addr.arpa');
  });
});

describe('message sizing', () => {
  it('puts a long TXT record over the 512-byte datagram limit', () => {
    const response = lookupInZone(
      exampleCom,
      question('default._domainkey.example.com', 'TXT'),
    );
    const size = estimateMessageSize(question('default._domainkey.example.com', 'TXT'), [
      response.answer,
    ]);

    expect(size).toBeGreaterThan(UDP_MAX_PAYLOAD);
  });

  it('keeps an ordinary A response comfortably inside it', () => {
    const response = lookupInZone(exampleCom, question('example.com', 'A'));
    const size = estimateMessageSize(question('example.com', 'A'), [response.answer]);

    expect(size).toBeLessThan(UDP_MAX_PAYLOAD);
  });
});

describe('signZone', () => {
  const keys = zoneKeys('test.example');
  const soa = rr('test.example', 300, {
    type: 'SOA',
    mname: 'ns1.test.example',
    rname: 'hostmaster.test.example',
    serial: 1,
    refresh: 7200,
    retry: 3600,
    expire: 1209600,
    minimum: 300,
  });
  const apex = rr('test.example', 300, { type: 'A', address: '203.0.113.90' });
  const delegationNs = rr('child.test.example', 300, {
    type: 'NS',
    nameserver: 'ns1.child.test.example',
  });
  const glue = rr('ns1.child.test.example', 300, { type: 'A', address: '203.0.113.91' });
  const signed = signZone('test.example', [soa, apex, delegationNs, glue], keys);

  const sigsOver = (name: string, type: string): ResourceRecord[] =>
    signed.filter(
      (record) =>
        record.name === name &&
        record.data.type === 'RRSIG' &&
        record.data.typeCovered === type,
    );

  it('signs the zone its own data', () => {
    expect(sigsOver('test.example', 'A')).toHaveLength(1);
    expect(sigsOver('test.example', 'SOA')).toHaveLength(1);
  });

  /**
   * Delegation records belong to the child, not to this zone, so the parent does not
   * sign them. The only thing a parent vouches for at a cut is the DS.
   */
  it('leaves delegation NS records and glue unsigned', () => {
    expect(sigsOver('child.test.example', 'NS')).toEqual([]);
    expect(sigsOver('ns1.child.test.example', 'A')).toEqual([]);
  });

  it('signs the key set with the key-signing key and everything else with the zone key', () => {
    const withKeys = signZone(
      'test.example',
      [soa, apex, rr('test.example', 300, keys.ksk), rr('test.example', 300, keys.zsk)],
      keys,
    );
    const keySig = withKeys.find(
      (record) => record.data.type === 'RRSIG' && record.data.typeCovered === 'DNSKEY',
    );
    const dataSig = withKeys.find(
      (record) => record.data.type === 'RRSIG' && record.data.typeCovered === 'A',
    );

    expect(keySig?.data.type === 'RRSIG' && keySig.data.keyTag).toBe(keyTagOf(keys.ksk));
    expect(dataSig?.data.type === 'RRSIG' && dataSig.data.keyTag).toBe(
      keyTagOf(keys.zsk),
    );
  });

  it('fingerprints the key the way a DS record does', () => {
    expect(dsDigest('test.example', keys.ksk)).toBe(dsDigest('test.example', keys.ksk));
    expect(dsDigest('other.example', keys.ksk)).not.toBe(
      dsDigest('test.example', keys.ksk),
    );
  });
});
