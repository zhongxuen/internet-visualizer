/**
 * Simulated WHOIS, and the RDAP that replaced it.
 *
 * "Who registered this domain" is the one diagnostic question with two answers, because
 * it has two protocols. This file models the record once and prints it both ways, which
 * is the only honest way to explain why the second protocol exists:
 *
 * - **WHOIS (RFC 3912)** is a 2004 document describing 1982 practice. Open TCP port 43,
 *   send a string, read text until the server closes the connection. There is no
 *   authentication, no encryption, no structure, no defined character set, and no way to
 *   discover which of hundreds of servers to ask. Every registry's output is a different
 *   shape, so every consumer of it is a screen-scraper.
 * - **RDAP (RFC 7480-7484, RFC 9082-9083)** is the same data over HTTPS as JSON, with a
 *   bootstrap registry that tells you which server owns a given name or address. It is
 *   the official successor, it is what this project's Live mode uses, and port 43 is not
 *   something a serverless function can rely on reaching anyway.
 *
 * The teaching value is in the *fields*, not the transport: expiry dates that are not
 * when a domain stops working, EPP status codes that explain why a transfer is failing,
 * and a redacted registrant that is a privacy regulation rather than a broken record.
 * {@link EPP_STATUS_CODES} and {@link RDAP_FIELD_NOTES} carry a sentence for each.
 *
 * Every record here is a fixture under a name RFC 2606 reserves, and every address is
 * from RFC 5737. Nothing in this file opens a socket, and the Live-mode RDAP client that
 * arrives with the route handlers is a separate thing entirely.
 */

import { summarizePhases, type SimResult } from '@/core/sim/result';
import type { RfcRef, SimEvent } from '@/core/types/events';
import type { PDU } from '@/core/types/pdu';
import type { SimNode, Topology } from '@/core/types/topology';

// ---------------------------------------------------------------------------
// EPP status codes
// ---------------------------------------------------------------------------

/** One status code, and what it actually stops you doing. */
export interface EppStatus {
  readonly code: string;
  /**
   * Who set it. `client` means the registrar -- the company the domain was bought from --
   * and can be removed by asking them. `server` means the registry, and usually cannot.
   */
  readonly setBy: 'client' | 'server';
  readonly meaning: string;
  /** The practical consequence, which is what someone reading a WHOIS record wants. */
  readonly consequence: string;
}

/**
 * The status codes that appear on the fixtures, with the sentence each one is missing.
 *
 * A status list is the most useful part of a registration record and the part most often
 * skipped over. `clientTransferProhibited` on nearly every healthy domain is a *good*
 * sign -- it is the lock that stops a domain being stolen -- while `clientHold` means the
 * registrar has pulled the domain out of the zone entirely, and no amount of DNS
 * debugging will explain why the name stopped resolving.
 */
export const EPP_STATUS_CODES: Readonly<Record<string, EppStatus>> = {
  ok: {
    code: 'ok',
    setBy: 'server',
    meaning: 'The standard status of a domain with no pending operations and no locks.',
    consequence:
      'Nothing is blocked -- which also means no transfer lock is set. On a domain you care about, `ok` alone is worth improving on.',
  },
  clientTransferProhibited: {
    code: 'clientTransferProhibited',
    setBy: 'client',
    meaning: 'The registrar will refuse a request to transfer this domain elsewhere.',
    consequence:
      'The single most common anti-hijacking lock, and the reason a legitimate transfer fails. Remove it in the registrar control panel before starting one.',
  },
  clientDeleteProhibited: {
    code: 'clientDeleteProhibited',
    setBy: 'client',
    meaning: 'The registrar will refuse a delete request for this domain.',
    consequence: 'Protects against an accidental or unauthorised deletion.',
  },
  clientUpdateProhibited: {
    code: 'clientUpdateProhibited',
    setBy: 'client',
    meaning:
      'The registrar will refuse changes to the domain object, nameservers included.',
    consequence:
      'Changing nameservers silently does nothing until this is lifted -- a genuinely confusing failure, because the control panel may accept the change.',
  },
  serverTransferProhibited: {
    code: 'serverTransferProhibited',
    setBy: 'server',
    meaning: 'The registry itself will refuse a transfer.',
    consequence:
      'Set automatically for the first 60 days after a registration or a previous transfer, and by the registry in a dispute. The registrar cannot remove it.',
  },
  addPeriod: {
    code: 'addPeriod',
    setBy: 'server',
    meaning: 'Set for the first five days after a domain is registered.',
    consequence:
      'A delete during this window refunds the registration fee, which is why it exists -- and why a brand-new domain cannot be transferred.',
  },
  autoRenewPeriod: {
    code: 'autoRenewPeriod',
    setBy: 'server',
    meaning: 'The registry auto-renewed the domain when it passed its expiry date.',
    consequence:
      'The domain is still working. The registrar has 45 days to either bill for the renewal or delete it.',
  },
  clientHold: {
    code: 'clientHold',
    setBy: 'client',
    meaning:
      'The registrar has asked the registry to remove this domain from the zone file.',
    consequence:
      'The name stops resolving everywhere -- not because DNS is broken, but because the delegation is gone. Usually unpaid renewal or an abuse complaint. This is the status to look for when a domain vanishes overnight.',
  },
  redemptionPeriod: {
    code: 'redemptionPeriod',
    setBy: 'server',
    meaning:
      'The domain was deleted and is in a 30-day grace period before it is purged.',
    consequence:
      'It can still be recovered by the original registrant, usually for a large fee. It is already out of the zone and already not resolving.',
  },
  pendingDelete: {
    code: 'pendingDelete',
    setBy: 'server',
    meaning:
      'The redemption period is over; the domain will be purged in about five days.',
    consequence:
      'No longer recoverable. When it is purged it becomes available to anyone, which is how expired domains get bought out from under their old owners.',
  },
};

/** Look up a status, tolerating a code the fixtures do not describe. */
export function describeStatus(code: string): EppStatus {
  return (
    EPP_STATUS_CODES[code] ?? {
      code,
      setBy: 'server',
      meaning: 'A registry status not covered by this module.',
      consequence: 'See the ICANN EPP status code reference.',
    }
  );
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** What kind of object a query is about. RDAP answers for both. */
export type RegistrationKind = 'domain' | 'ip-network';

/** A contact on the record, or the reason there is not one. */
export interface RegistrationEntity {
  readonly role: 'registrar' | 'registrant' | 'administrative' | 'technical' | 'abuse';
  readonly name: string;
  readonly organization?: string;
  readonly email?: string;
  readonly phone?: string;
  /**
   * True when the fields are withheld rather than absent.
   *
   * Since 2018 most registries redact registrant contact details by default. A blank
   * registrant is a data-protection policy, not a broken or anonymous registration, and
   * the abuse contact below it is the one that is required to stay published.
   */
  readonly redacted: boolean;
  readonly note?: string;
}

/** One dated thing that happened to the object. RDAP calls these `events`. */
export interface RegistrationEvent {
  readonly action:
    | 'registration'
    | 'expiration'
    | 'last changed'
    | 'transfer'
    | 'last update of RDAP database';
  /** ISO 8601, fixed in the fixture. Nothing in this project reads a clock. */
  readonly date: string;
  readonly note: string;
}

/** A nameserver as the registry has it -- the delegation, not the zone's own answer. */
export interface RegistrationNameserver {
  readonly host: string;
  /** Glue addresses, present only when the nameserver is inside the domain it serves. */
  readonly addresses?: readonly string[];
}

/** Which registry answered, and how it was found. */
export interface RegistrySource {
  readonly name: string;
  /** The RDAP base URL the bootstrap service returns for this object. */
  readonly rdapBase: string;
  /** The legacy port-43 server, where one exists. */
  readonly whoisServer?: string;
  readonly note: string;
}

/** One registration record, in the shape both presentations are generated from. */
export interface RegistrationRecord {
  readonly id: string;
  readonly kind: RegistrationKind;
  /** The domain name or CIDR block that was asked about. */
  readonly target: string;
  readonly title: string;
  readonly summary: string;
  readonly teaches: readonly string[];
  /** False for a name nobody has registered: RDAP 404, WHOIS "No match". */
  readonly found: boolean;
  readonly registry: RegistrySource;
  /** The registry's own handle for the object. */
  readonly handle?: string;
  readonly registrar?: { readonly name: string; readonly ianaId: number };
  readonly events: readonly RegistrationEvent[];
  readonly nameservers: readonly RegistrationNameserver[];
  readonly statuses: readonly string[];
  readonly entities: readonly RegistrationEntity[];
  /** Whether the parent zone holds a DS record for this domain. */
  readonly delegationSigned?: boolean;
  /** For an IP object: the allocation type and the network's name. */
  readonly allocation?: { readonly type: string; readonly netName: string };
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// What each field means
// ---------------------------------------------------------------------------

/** A sentence per field, for the panel that annotates the record. */
export const RDAP_FIELD_NOTES: Readonly<Record<string, string>> = {
  handle:
    "The registry's own identifier for this object. Stable across renewals and transfers, unlike the name itself.",
  registrar:
    'The company the domain was bought from. It is not the owner, and it is the party to contact about a lock, a transfer, or an unpaid renewal. The IANA ID beside it is globally unique.',
  registration:
    'When the domain was first created. Age is one of the few automatically checkable signals of legitimacy -- most abusive domains are days old.',
  expiration:
    'When the *registration* lapses, which is not when the domain stops working. Expiry starts a chain of grace periods -- autoRenewPeriod, then redemptionPeriod, then pendingDelete -- and a name usually stops resolving somewhere in the middle of it, when the registrar sets clientHold.',
  'last changed':
    'The last modification to the registry object. A change immediately before a problem is a strong hint about its cause.',
  transfer: 'When the domain last moved between registrars.',
  nameservers:
    'The delegation as the *parent* zone holds it. This is what the TLD servers hand out in a referral, and it can disagree with what the nameservers themselves claim -- which is exactly the failure a lookup tool alone cannot see.',
  statuses:
    'EPP status codes. The most informative field on the record and the most skipped: they say what operations are blocked, and by whom.',
  registrant:
    'The party the domain belongs to. Usually redacted since 2018 -- withheld, not missing.',
  abuse:
    'The registrar abuse contact, which registries require to stay published even when everything else is redacted. This is the address a genuine complaint goes to.',
  delegationSigned:
    'Whether the parent holds a DS record, meaning this zone is signed and validating resolvers will check it. A mismatch between this and the zone’s own keys makes the domain fail to resolve for validating clients only, which is a memorably confusing outage.',
  allocation:
    'For an address block: who the registry allocated it to, and under what policy. The same protocol answers for names and for numbers.',
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COM_REGISTRY: RegistrySource = {
  name: 'Simulated .com registry',
  rdapBase: 'https://rdap.registry.example/rdap/',
  whoisServer: 'whois.registry.example',
  note: 'A thin registry: it holds the delegation, the dates, and the statuses, and refers the rest to the registrar.',
};

const RIR_REGISTRY: RegistrySource = {
  name: 'Simulated regional Internet registry',
  rdapBase: 'https://rdap.rir.example/rdap/',
  whoisServer: 'whois.rir.example',
  note: 'Address space is delegated the same way names are: IANA to a regional registry, regional registry to a network operator.',
};

/** The healthy, boring case -- which is what a good registration looks like. */
export const EXAMPLE_COM: RegistrationRecord = {
  id: 'example-com',
  kind: 'domain',
  target: 'example.com',
  title: 'A well-kept domain',
  summary:
    'Registered a long time ago, locked against transfer, signed with DNSSEC, and redacted in the places privacy law requires. Every field on this record is what you want the answer to be, which makes it the one to read the other three against.',
  teaches: [
    'What the fields on a registration record mean',
    'Why clientTransferProhibited is a good sign',
    'Redaction is a policy, not a missing record',
  ],
  found: true,
  registry: COM_REGISTRY,
  handle: 'D1234567-COM',
  registrar: { name: 'Simulated Registrar Ltd', ianaId: 9999 },
  events: [
    {
      action: 'registration',
      date: '1995-08-14T04:00:00Z',
      note: 'Thirty years of continuous registration. Age is cheap to check and hard to fake.',
    },
    {
      action: 'expiration',
      date: '2027-08-13T04:00:00Z',
      note: 'The registration lapses here. The domain does not stop working here.',
    },
    {
      action: 'last changed',
      date: '2026-08-14T09:12:00Z',
      note: 'Last renewal. Nothing else has been touched in a year.',
    },
    {
      action: 'last update of RDAP database',
      date: '2026-09-06T00:00:00Z',
      note: 'How fresh this answer is. Registry data is not live; it is a database export with a stated age.',
    },
  ],
  nameservers: [
    { host: 'ns1.example.com', addresses: ['203.0.113.10'] },
    { host: 'ns2.example.net' },
  ],
  statuses: [
    'clientTransferProhibited',
    'clientDeleteProhibited',
    'clientUpdateProhibited',
  ],
  delegationSigned: true,
  entities: [
    {
      role: 'registrant',
      name: 'REDACTED FOR PRIVACY',
      redacted: true,
      note: 'Withheld under data-protection policy. The registrar holds the real details and will forward a legitimate request.',
    },
    {
      role: 'abuse',
      name: 'Registrar abuse contact',
      email: 'abuse@registrar.example',
      phone: '+1.5555550100',
      redacted: false,
      note: 'Required to stay published even when everything else is redacted.',
    },
  ],
  note: 'ns1 has a glue address because it lives inside the domain it serves -- without it the delegation would be circular. ns2 does not, because it does not.',
};

/** New, and therefore locked out of a transfer for reasons nobody explains at checkout. */
export const EXAMPLE_NET: RegistrationRecord = {
  id: 'example-net',
  kind: 'domain',
  target: 'example.net',
  title: 'Registered three days ago',
  summary:
    'A brand-new domain, still in addPeriod and under a 60-day registry transfer lock. Both statuses are automatic and neither is a problem -- but between them they explain why a domain bought this morning cannot be moved to another registrar this afternoon.',
  teaches: [
    'addPeriod and the five-day refund window',
    'The 60-day registry transfer lock',
    'Domain age as a signal',
  ],
  found: true,
  registry: {
    ...COM_REGISTRY,
    name: 'Simulated .net registry',
    rdapBase: 'https://rdap.net-registry.example/rdap/',
    whoisServer: 'whois.net-registry.example',
  },
  handle: 'D7654321-NET',
  registrar: { name: 'Another Simulated Registrar', ianaId: 9998 },
  events: [
    {
      action: 'registration',
      date: '2026-09-03T11:45:00Z',
      note: 'Three days old. Nearly every domain used in a phishing campaign is younger than a month.',
    },
    {
      action: 'expiration',
      date: '2027-09-03T11:45:00Z',
      note: 'One year, the usual default.',
    },
    {
      action: 'last update of RDAP database',
      date: '2026-09-06T00:00:00Z',
      note: '',
    },
  ],
  nameservers: [{ host: 'ns1.parking.example' }, { host: 'ns2.parking.example' }],
  statuses: ['addPeriod', 'serverTransferProhibited'],
  delegationSigned: false,
  entities: [
    {
      role: 'registrant',
      name: 'Privacy proxy service',
      organization: 'Simulated Privacy Proxy Inc',
      email: 'contact@proxy.example',
      redacted: false,
      note: 'A paid proxy standing in as the legal registrant. Distinct from redaction: here the details published are real, they just belong to somebody else.',
    },
    {
      role: 'abuse',
      name: 'Registrar abuse contact',
      email: 'abuse@registrar2.example',
      redacted: false,
    },
  ],
  note: 'Still pointing at the registrar’s parking nameservers, which is why the name resolves to a placeholder page.',
};

/** The one where the DNS looks broken and the DNS is not the problem. */
export const EXAMPLE_ORG: RegistrationRecord = {
  id: 'example-org',
  kind: 'domain',
  target: 'example.org',
  title: 'Expired, and on hold',
  summary:
    'The name stopped resolving overnight and every DNS tool reports SERVFAIL. Nothing is wrong with the DNS: the registration lapsed, the registrar set clientHold, and the registry pulled the delegation out of the zone. No amount of nameserver debugging finds this. The registration record does, immediately.',
  teaches: [
    'clientHold removes a domain from the zone',
    'Expiry is a chain of grace periods, not a switch',
    'Why the registration record belongs in a DNS investigation',
  ],
  found: true,
  registry: {
    ...COM_REGISTRY,
    name: 'Simulated .org registry',
    rdapBase: 'https://rdap.org-registry.example/rdap/',
    whoisServer: 'whois.org-registry.example',
  },
  handle: 'D2468013-ORG',
  registrar: { name: 'Simulated Registrar Ltd', ianaId: 9999 },
  events: [
    { action: 'registration', date: '2014-02-19T08:00:00Z', note: '' },
    {
      action: 'expiration',
      date: '2026-07-19T08:00:00Z',
      note: 'Forty-nine days ago. The domain kept working for most of that time, which is why the outage looks unrelated to the expiry.',
    },
    {
      action: 'last changed',
      date: '2026-09-02T02:31:00Z',
      note: 'The day clientHold was set -- and the day the name stopped resolving.',
    },
    {
      action: 'last update of RDAP database',
      date: '2026-09-06T00:00:00Z',
      note: '',
    },
  ],
  nameservers: [{ host: 'ns1.example.org' }, { host: 'ns2.example.org' }],
  statuses: ['clientHold', 'autoRenewPeriod'],
  delegationSigned: false,
  entities: [
    { role: 'registrant', name: 'REDACTED FOR PRIVACY', redacted: true },
    {
      role: 'abuse',
      name: 'Registrar abuse contact',
      email: 'abuse@registrar.example',
      redacted: false,
    },
  ],
  note: 'The nameservers are still listed. They are simply no longer referred to by the parent zone, and a delegation nobody publishes is a delegation nobody can follow.',
};

/** RDAP is not only about names. */
export const DOC_NETWORK: RegistrationRecord = {
  id: 'doc-network',
  kind: 'ip-network',
  target: '203.0.113.0/24',
  title: 'An address block',
  summary:
    'The same protocol, asked about a number instead of a name. The bootstrap service sends the query to a regional Internet registry rather than a TLD registry, and the answer describes an allocation: who holds the block, under what policy, and who to complain to.',
  teaches: [
    'RDAP answers for addresses as well as domains',
    'Address space is delegated in a hierarchy too',
    'Finding the operator responsible for an address',
  ],
  found: true,
  registry: RIR_REGISTRY,
  handle: 'NET-203-0-113-0-1',
  events: [
    {
      action: 'registration',
      date: '2010-01-11T00:00:00Z',
      note: 'When the block was allocated.',
    },
    {
      action: 'last changed',
      date: '2024-05-02T00:00:00Z',
      note: 'The last time the holder updated their contact details.',
    },
    {
      action: 'last update of RDAP database',
      date: '2026-09-06T00:00:00Z',
      note: '',
    },
  ],
  nameservers: [],
  statuses: ['ok'],
  allocation: { type: 'DOCUMENTATION', netName: 'TEST-NET-3' },
  entities: [
    {
      role: 'registrant',
      name: 'Internet Assigned Numbers Authority (simulated)',
      redacted: false,
      note: 'This block is reserved by RFC 5737 for documentation, which is why every example in this project uses it. Nothing is routed here.',
    },
    {
      role: 'abuse',
      name: 'Network abuse contact',
      email: 'abuse@rir.example',
      redacted: false,
    },
  ],
};

/** No record at all, which is itself an answer. */
export const UNREGISTERED: RegistrationRecord = {
  id: 'unregistered',
  kind: 'domain',
  target: 'notregistered.example',
  title: 'No such registration',
  summary:
    'Nobody has registered this name. RDAP says so with an HTTP 404 and a structured error object; WHOIS says so with a line of prose that every registry words differently. The contrast is the whole argument for the newer protocol in one screen.',
  teaches: [
    'A 404 is a real answer, not a failure',
    'Why scraping WHOIS text never quite works',
    'Availability is a registry fact, not a DNS one',
  ],
  found: false,
  registry: COM_REGISTRY,
  events: [
    {
      action: 'last update of RDAP database',
      date: '2026-09-06T00:00:00Z',
      note: 'Even the "no" is dated.',
    },
  ],
  nameservers: [],
  statuses: [],
  entities: [],
  note: 'A name with no registration also has no delegation, so a DNS lookup for it returns NXDOMAIN. Two tools, two protocols, one underlying fact.',
};

/** Every fixture, in the order the picker offers them. */
export const REGISTRATION_RECORDS: readonly RegistrationRecord[] = [
  EXAMPLE_COM,
  EXAMPLE_NET,
  EXAMPLE_ORG,
  DOC_NETWORK,
  UNREGISTERED,
];

/** The record the tool opens on. */
export const DEFAULT_RECORD_ID = EXAMPLE_COM.id;

/** Look one up by id. */
export function getRecord(id: string): RegistrationRecord | undefined {
  return REGISTRATION_RECORDS.find((record) => record.id === id);
}

// ---------------------------------------------------------------------------
// Why RDAP
// ---------------------------------------------------------------------------

/** One row of the comparison table. */
export interface ProtocolContrast {
  readonly aspect: string;
  readonly whois: string;
  readonly rdap: string;
}

/** The reasons port 43 is not the thing to build on. */
export const WHOIS_VS_RDAP: readonly ProtocolContrast[] = [
  {
    aspect: 'Transport',
    whois:
      'Bare TCP on port 43. No TLS, so the query and the answer cross the network in the clear.',
    rdap: 'HTTPS. Encrypted, cacheable, and it works through everything that already understands HTTP.',
  },
  {
    aspect: 'Format',
    whois:
      'Free text, in whatever layout the registry chose. Every consumer is a screen-scraper, and every scraper breaks when a registry changes a label.',
    rdap: 'JSON with a defined schema. The same field has the same name at every registry.',
  },
  {
    aspect: 'Finding the server',
    whois:
      'No discovery. You have to already know which of hundreds of servers holds the record, or follow a referral if the server happens to emit one.',
    rdap: 'A bootstrap registry published by IANA maps a TLD or an address range to the RDAP base URL that serves it.',
  },
  {
    aspect: 'Errors',
    whois:
      'A sentence. "No match", "NOT FOUND", "No entries found" -- all of them meaning the same thing, none of them machine-readable.',
    rdap: 'HTTP status codes plus a structured error object. 404 means no such object, and every client understands it already.',
  },
  {
    aspect: 'Internationalisation',
    whois: 'No defined character set. Non-ASCII names and addresses are a guess.',
    rdap: 'UTF-8 throughout, with internationalised names carried properly.',
  },
  {
    aspect: 'Access control',
    whois:
      'None, so registries protect data by removing it from the output for everyone.',
    rdap: 'Standard HTTP authentication, so a registry can return more to an authenticated requester than to the public.',
  },
];

// ---------------------------------------------------------------------------
// The two presentations
// ---------------------------------------------------------------------------

/** The record as a legacy port-43 server would emit it: text, and only text. */
export function formatWhois(record: RegistrationRecord): string[] {
  if (!record.found) {
    return [
      `No match for "${record.target.toUpperCase()}".`,
      '',
      '>>> Last update of WHOIS database: 2026-09-06T00:00:00Z <<<',
      '',
      'NOTICE: The expiration date displayed in this record is the date the',
      "registrar's sponsorship of the domain name registration in the registry is",
      'currently set to expire.',
    ];
  }

  const dateOf = (action: RegistrationEvent['action']): string =>
    record.events.find((event) => event.action === action)?.date ?? '';

  if (record.kind === 'ip-network') {
    return [
      `NetRange:       ${record.target}`,
      `NetName:        ${record.allocation?.netName ?? ''}`,
      `NetHandle:      ${record.handle ?? ''}`,
      `NetType:        ${record.allocation?.type ?? ''}`,
      `RegDate:        ${dateOf('registration')}`,
      `Updated:        ${dateOf('last changed')}`,
      ...record.entities.map(
        (entity) =>
          `${entity.role.padEnd(15)} ${entity.name}${entity.email ? ` <${entity.email}>` : ''}`,
      ),
    ];
  }

  return [
    `Domain Name: ${record.target.toUpperCase()}`,
    `Registry Domain ID: ${record.handle ?? ''}`,
    `Registrar WHOIS Server: ${record.registry.whoisServer ?? ''}`,
    `Updated Date: ${dateOf('last changed')}`,
    `Creation Date: ${dateOf('registration')}`,
    `Registry Expiry Date: ${dateOf('expiration')}`,
    `Registrar: ${record.registrar?.name ?? ''}`,
    `Registrar IANA ID: ${record.registrar?.ianaId ?? ''}`,
    ...record.statuses.map(
      (status) => `Domain Status: ${status} https://icann.org/epp#${status}`,
    ),
    ...record.entities
      .filter((entity) => entity.role === 'registrant')
      .map((entity) => `Registrant Organization: ${entity.organization ?? entity.name}`),
    ...record.nameservers.map((ns) => `Name Server: ${ns.host.toUpperCase()}`),
    `DNSSEC: ${record.delegationSigned ? 'signedDelegation' : 'unsigned'}`,
    ...record.entities
      .filter((entity) => entity.role === 'abuse')
      .flatMap((entity) => [
        `Registrar Abuse Contact Email: ${entity.email ?? ''}`,
        `Registrar Abuse Contact Phone: ${entity.phone ?? ''}`,
      ]),
    '>>> Last update of WHOIS database: 2026-09-06T00:00:00Z <<<',
  ];
}

/**
 * The record as an RDAP response body.
 *
 * Shaped after RFC 9083: `objectClassName`, `handle`, `events`, `status`, `entities` with
 * jCard-ish contact data, and `nameservers` as objects rather than as repeated lines. The
 * point of showing the JSON rather than a prettified table is that the JSON is the
 * *contract* -- the same keys come back from every registry, which is the thing WHOIS
 * could never offer.
 */
export function rdapBody(record: RegistrationRecord): unknown {
  if (!record.found) {
    return {
      errorCode: 404,
      title: 'Not Found',
      description: [
        `No registration exists for ${record.target}.`,
        'A 404 here is an answer: the registry looked and there is no object.',
      ],
      rdapConformance: ['rdap_level_0'],
    };
  }

  const entities = record.entities.map((entity) => ({
    objectClassName: 'entity',
    roles: [entity.role],
    ...(entity.redacted
      ? {
          remarks: [
            {
              title: 'REDACTED FOR PRIVACY',
              type: 'object redacted due to authorization',
            },
          ],
        }
      : {}),
    vcardArray: [
      'vcard',
      [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', entity.name],
        ...(entity.organization ? [['org', {}, 'text', entity.organization]] : []),
        ...(entity.email ? [['email', {}, 'text', entity.email]] : []),
        ...(entity.phone ? [['tel', {}, 'text', entity.phone]] : []),
      ],
    ],
  }));

  const common = {
    rdapConformance: ['rdap_level_0'],
    handle: record.handle,
    events: record.events.map((event) => ({
      eventAction: event.action,
      eventDate: event.date,
    })),
    status: record.statuses,
    entities,
    links: [
      {
        rel: 'self',
        href: `${record.registry.rdapBase}${record.kind === 'domain' ? 'domain' : 'ip'}/${record.target}`,
        type: 'application/rdap+json',
      },
    ],
  };

  if (record.kind === 'ip-network') {
    return {
      objectClassName: 'ip network',
      ...common,
      startAddress: record.target.split('/')[0],
      endAddress: '203.0.113.255',
      ipVersion: 'v4',
      name: record.allocation?.netName,
      type: record.allocation?.type,
    };
  }

  return {
    objectClassName: 'domain',
    ...common,
    ldhName: record.target,
    nameservers: record.nameservers.map((ns) => ({
      objectClassName: 'nameserver',
      ldhName: ns.host,
      ...(ns.addresses ? { ipAddresses: { v4: [...ns.addresses] } } : {}),
    })),
    secureDNS: { delegationSigned: record.delegationSigned ?? false },
  };
}

/** The RDAP body, pretty-printed, as the tool would show it. */
export function formatRdap(record: RegistrationRecord): string[] {
  return JSON.stringify(rdapBody(record), null, 2).split('\n');
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** One registration lookup, both ways, ready to draw. */
export interface RegistrationRun {
  readonly record: RegistrationRecord;
  /** The legacy port-43 transcript. */
  readonly whois: readonly string[];
  /** The RDAP response body, pretty-printed. */
  readonly rdap: readonly string[];
  /** The HTTP status the RDAP request came back with. */
  readonly httpStatus: number;
  /** The two requests RDAP makes, in order. */
  readonly requests: readonly {
    readonly method: string;
    readonly url: string;
    readonly why: string;
  }[];
  readonly topology: Topology;
  readonly result: SimResult;
}

const CLIENT = 'client';
const WHOIS_SERVER = 'whois-server';
const BOOTSTRAP = 'rdap-bootstrap';
const REGISTRY = 'rdap-registry';

const RFC_3912: RfcRef = { rfc: 3912, title: 'WHOIS Protocol Specification' };
const RFC_9082: RfcRef = {
  rfc: 9082,
  title: 'Registration Data Access Protocol (RDAP) Query Format',
};
const RFC_7484: RfcRef = {
  rfc: 7484,
  title: 'Finding the Authoritative Registration Data (RDAP) Service',
};

/** One-way latency to each simulated server, virtual milliseconds. */
const WHOIS_RTT_MS = 45;
const BOOTSTRAP_RTT_MS = 18;
const REGISTRY_RTT_MS = 32;
/** Time to set up TLS before either RDAP request can be sent. */
const TLS_SETUP_MS = 48;
/** Quiet milliseconds after the last response. */
const TAIL_MS = 250;

/**
 * Query one registration record over both protocols and package it for the view.
 *
 * Pure and total: a fixture in, a deep-equal `RegistrationRun` out. There is no seeded
 * randomness here at all, because nothing about a registry lookup is variable -- it is a
 * database read, and the only interesting numbers are which requests were made.
 */
export function runRegistrationLookup(record: RegistrationRecord): RegistrationRun {
  const events: SimEvent[] = [];
  const pdus: Record<string, PDU> = {};

  const objectPath = record.kind === 'domain' ? 'domain' : 'ip';
  const bootstrapUrl =
    record.kind === 'domain'
      ? 'https://bootstrap.iana.example/rdap/dns.json'
      : 'https://bootstrap.iana.example/rdap/ipv4.json';
  const registryUrl = `${record.registry.rdapBase}${objectPath}/${record.target}`;
  const httpStatus = record.found ? 200 : 404;

  const requests = [
    {
      method: 'GET',
      url: bootstrapUrl,
      why: `The bootstrap file maps ${record.kind === 'domain' ? 'each TLD' : 'each address range'} to the RDAP service that owns it. WHOIS has no equivalent: you either already know the server or you guess.`,
    },
    {
      method: 'GET',
      url: registryUrl,
      why: `The registry that the bootstrap named, asked for this exact object. The response is ${record.found ? 'a 200 with a JSON object' : 'a 404 with a structured error'} -- either way, machine-readable.`,
    },
  ];

  // --- Phase 1: the old way -------------------------------------------------
  events.push({
    kind: 'phase',
    at: 0,
    id: 'whois',
    title: 'WHOIS, port 43',
    description:
      'Open a TCP connection to port 43, send the name followed by CRLF, and read text until the server hangs up. That is the entire protocol. No TLS, no structure, no way to have known which server to ask.',
  });
  events.push({
    kind: 'annotate',
    at: 0,
    targetId: WHOIS_SERVER,
    text: `RFC 3912 is two pages long and specifies almost nothing: a connection, a query string, and a text response. Everything a client would need -- what the fields are called, what encoding they are in, which server holds the record -- is left to convention, and convention differs per registry.`,
    reference: RFC_3912,
  });

  const whoisQuery = textPdu(
    'whois-query',
    'WHOIS query',
    `${record.target}\\r\\n`,
    'The whole request. There is no header, no verb, and no version.',
  );
  pdus[whoisQuery.id] = whoisQuery;
  events.push({ kind: 'pdu-created', at: 0, pdu: whoisQuery, atNode: CLIENT });
  events.push({
    kind: 'transmit',
    at: 0,
    pduId: whoisQuery.id,
    from: CLIENT,
    to: WHOIS_SERVER,
    durationMs: WHOIS_RTT_MS / 2,
    linkId: `${CLIENT}-${WHOIS_SERVER}`,
  });

  const whoisText = formatWhois(record);
  const whoisReply = textPdu(
    'whois-reply',
    'WHOIS response',
    whoisText.slice(0, 3).join(' / '),
    'Free text, terminated by the server closing the connection. A parser for this registry will not parse the next one.',
  );
  pdus[whoisReply.id] = whoisReply;
  events.push({
    kind: 'pdu-created',
    at: WHOIS_RTT_MS / 2,
    pdu: whoisReply,
    atNode: WHOIS_SERVER,
  });
  events.push({
    kind: 'transmit',
    at: WHOIS_RTT_MS / 2,
    pduId: whoisReply.id,
    from: WHOIS_SERVER,
    to: CLIENT,
    durationMs: WHOIS_RTT_MS / 2,
    linkId: `${CLIENT}-${WHOIS_SERVER}`,
  });
  events.push({
    kind: 'log',
    at: WHOIS_RTT_MS,
    level: 'warn',
    text: `${whoisText.length} lines of text, in the clear, in this registry's own layout.`,
  });

  // --- Phase 2: find the registry ------------------------------------------
  const bootstrapAt = WHOIS_RTT_MS + 120;
  events.push({
    kind: 'phase',
    at: bootstrapAt,
    id: 'bootstrap',
    title: 'RDAP: find the registry',
    description: requests[0]!.why,
  });
  events.push({
    kind: 'annotate',
    at: bootstrapAt,
    targetId: BOOTSTRAP,
    text: `IANA publishes a JSON file mapping every TLD and every address range to the RDAP base URL that serves it. This one step is the difference between a protocol you can write a client for and a protocol you can only write a scraper for.`,
    reference: RFC_7484,
  });

  const bootstrapEnd = pushHttp(events, pdus, {
    id: 'bootstrap',
    from: CLIENT,
    to: BOOTSTRAP,
    at: bootstrapAt,
    rttMs: BOOTSTRAP_RTT_MS,
    method: 'GET',
    url: bootstrapUrl,
    status: 200,
    summary: `{ "services": [ [ ["${record.kind === 'domain' ? 'com' : '203.0.113.0/24'}"], ["${record.registry.rdapBase}"] ] ] }`,
  });

  // --- Phase 3: ask it ------------------------------------------------------
  const registryAt = bootstrapEnd + 40;
  events.push({
    kind: 'phase',
    at: registryAt,
    id: 'registry',
    title: 'RDAP: ask the registry',
    description: requests[1]!.why,
  });
  events.push({
    kind: 'annotate',
    at: registryAt,
    targetId: REGISTRY,
    text: `The query format is part of the standard: \`/domain/{name}\` and \`/ip/{address}\` mean the same thing at every registry that implements RDAP, and the response carries the same key names. That is the property WHOIS never had.`,
    reference: RFC_9082,
  });

  const registryEnd = pushHttp(events, pdus, {
    id: 'registry',
    from: CLIENT,
    to: REGISTRY,
    at: registryAt,
    rttMs: REGISTRY_RTT_MS,
    method: 'GET',
    url: registryUrl,
    status: httpStatus,
    summary: record.found
      ? `application/rdap+json, ${record.statuses.length} status code${record.statuses.length === 1 ? '' : 's'}, ${record.events.length} dated events`
      : 'application/rdap+json, structured 404 error object',
  });

  events.push({
    kind: 'phase',
    at: registryEnd,
    id: 'reading',
    title: 'Reading the record',
    description: record.found
      ? `${record.statuses.length} status codes, ${record.nameservers.length} nameservers, and a set of dates. The statuses are the field worth reading first: they say which operations are blocked and by whom.`
      : `A 404 with a body that says why. WHOIS answered the same question with a sentence that every registry words differently.`,
  });

  const durationMs = registryEnd + TAIL_MS;
  const sorted = [...events].sort((a, b) => a.at - b.at);

  return {
    record,
    whois: whoisText,
    rdap: formatRdap(record),
    httpStatus,
    requests,
    topology: buildTopology(record),
    result: {
      events: sorted,
      phases: summarizePhases(sorted, durationMs),
      durationMs,
      pdus,
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildTopology(record: RegistrationRecord): Topology {
  const nodes: SimNode[] = [
    {
      id: CLIENT,
      kind: 'client',
      label: 'Your machine',
      ipv4: '192.168.1.24',
      detail: {
        Role: 'Running the lookup',
        Simulated: 'No request leaves your browser.',
      },
    },
    {
      id: WHOIS_SERVER,
      kind: 'server',
      label: record.registry.whoisServer ?? 'whois server',
      ipv4: '192.0.2.43',
      detail: {
        Protocol: 'WHOIS over bare TCP, port 43',
        Encryption: 'none -- the query and the answer are in the clear',
        Format: "free text, in this registry's own layout",
        Since: 'RFC 3912 (2004), describing practice from 1982',
      },
    },
    {
      id: BOOTSTRAP,
      kind: 'server',
      label: 'IANA RDAP bootstrap',
      ipv4: '192.0.2.80',
      detail: {
        Protocol: 'HTTPS, port 443',
        Serves: 'A JSON map from TLD or address range to RDAP base URL',
        Why: 'It is the discovery step WHOIS never had',
      },
    },
    {
      id: REGISTRY,
      kind: 'server',
      label: record.registry.name,
      ipv4: '192.0.2.90',
      detail: {
        Protocol: 'RDAP over HTTPS, port 443',
        Format: 'application/rdap+json, schema defined by RFC 9083',
        Note: record.registry.note,
      },
    },
  ];

  return {
    nodes,
    links: [
      {
        id: `${CLIENT}-${WHOIS_SERVER}`,
        from: CLIENT,
        to: WHOIS_SERVER,
        latencyMs: WHOIS_RTT_MS / 2,
      },
      {
        id: `${CLIENT}-${BOOTSTRAP}`,
        from: CLIENT,
        to: BOOTSTRAP,
        latencyMs: BOOTSTRAP_RTT_MS / 2,
      },
      {
        id: `${CLIENT}-${REGISTRY}`,
        from: CLIENT,
        to: REGISTRY,
        latencyMs: REGISTRY_RTT_MS / 2,
      },
    ],
  };
}

interface HttpArgs {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly at: number;
  readonly rttMs: number;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly summary: string;
}

/** One HTTPS request and its response, and the time the response lands. */
function pushHttp(events: SimEvent[], pdus: Record<string, PDU>, args: HttpArgs): number {
  const half = args.rttMs / 2;
  // TLS first. Named rather than animated: the HTTPS Explorer is where the handshake
  // belongs, and repeating it here would bury the two requests that are the subject.
  const sentAt = args.at + TLS_SETUP_MS;
  events.push({
    kind: 'node-state',
    at: args.at,
    nodeId: args.from,
    state: 'processing',
    note: 'TLS handshake',
  });

  const request = httpPdu(
    `${args.id}-request`,
    `${args.method} ${new URL(args.url).pathname}`,
    [
      { name: 'Method', value: args.method },
      { name: 'Host', value: new URL(args.url).host },
      { name: 'Path', value: new URL(args.url).pathname },
      {
        name: 'Accept',
        value: 'application/rdap+json',
        note: 'Content negotiation, which WHOIS has no concept of.',
      },
    ],
    'No cookies and no credentials. A registration lookup is a public read.',
  );
  pdus[request.id] = request;
  events.push({ kind: 'pdu-created', at: sentAt, pdu: request, atNode: args.from });
  events.push({
    kind: 'transmit',
    at: sentAt,
    pduId: request.id,
    from: args.from,
    to: args.to,
    durationMs: half,
    linkId: `${args.from}-${args.to}`,
  });

  const response = httpPdu(
    `${args.id}-response`,
    `${args.status} ${args.status === 200 ? 'OK' : 'Not Found'}`,
    [
      {
        name: 'Status',
        value: String(args.status),
        note:
          args.status === 404
            ? 'A status code every HTTP client already understands, rather than a sentence to parse.'
            : 'Ordinary HTTP, so it caches, proxies, and logs like everything else.',
      },
      { name: 'Content-Type', value: 'application/rdap+json' },
    ],
    args.summary,
  );
  pdus[response.id] = response;
  events.push({
    kind: 'pdu-created',
    at: sentAt + half,
    pdu: response,
    atNode: args.to,
  });
  events.push({
    kind: 'node-state',
    at: sentAt + half,
    nodeId: args.to,
    state: args.status === 200 ? 'active' : 'error',
    note: `${args.status}`,
  });
  events.push({
    kind: 'transmit',
    at: sentAt + half,
    pduId: response.id,
    from: args.to,
    to: args.from,
    durationMs: half,
    linkId: `${args.from}-${args.to}`,
  });
  events.push({
    kind: 'log',
    at: sentAt + args.rttMs,
    level: args.status === 200 ? 'info' : 'warn',
    text: `${args.method} ${args.url} -> ${args.status}. ${args.summary}`,
  });

  return sentAt + args.rttMs;
}

function httpPdu(
  id: string,
  summary: string,
  fields: { name: string; value: string; note?: string }[],
  preview: string,
): PDU {
  return {
    id,
    layers: [
      {
        layer: 'session',
        protocol: 'TLS',
        fields: [
          { name: 'Version', value: 'TLS 1.3' },
          {
            name: 'Content Type',
            value: '23 (application_data)',
            note: 'Everything above this line is encrypted on the wire. The WHOIS exchange above is not.',
          },
        ],
      },
      { layer: 'application', protocol: 'HTTP/1.1', fields, payloadPreview: preview },
    ],
    sizeBytes: 320,
    summary,
  };
}

function textPdu(id: string, summary: string, body: string, note: string): PDU {
  return {
    id,
    layers: [
      {
        layer: 'transport',
        protocol: 'TCP',
        fields: [
          {
            name: 'Destination Port',
            value: '43',
            note: 'WHOIS. Frequently blocked outbound, and not reachable at all from most serverless platforms -- which is one more reason Live mode uses RDAP.',
          },
        ],
      },
      {
        layer: 'application',
        protocol: 'WHOIS',
        fields: [{ name: 'Body', value: body, note }],
        payloadPreview: body,
      },
    ],
    sizeBytes: 96,
    summary,
  };
}
