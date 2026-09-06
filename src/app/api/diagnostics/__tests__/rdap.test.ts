/**
 * Integration tests for `GET /api/diagnostics/rdap`.
 *
 * The interesting parts here are the two that are unique to this route: the IANA
 * bootstrap step (which is itself a network fetch, and is therefore itself guarded and
 * cached), and redirects -- this is the only route that follows one, and it must
 * re-validate before it does. The redirect-to-a-private-host test is the important one:
 * the redirect is what an attacker controls once a registry answer is in play.
 */

import { describe, expect, it } from 'vitest';

import {
  BOOTSTRAP_ORIGIN,
  BOOTSTRAP_URLS,
  createRdapHandler,
  rdapUrlFor,
} from '../_lib/rdap';
import {
  bodyOf,
  fakeFetch,
  get,
  jsonResponse,
  makeDeps,
  noFetch,
  tableResolver,
} from './harness';

const VERISIGN = 'https://rdap.verisign.com/com/v1/';
const ARIN = 'https://rdap.arin.net/registry/';

const DNS_BOOTSTRAP = {
  description: 'RDAP bootstrap file for Domain Name System registrations',
  publication: '2026-01-14T00:00:00Z',
  version: '1.0',
  services: [
    [['com', 'net'], [VERISIGN]],
    [['org'], ['https://rdap.publicinterestregistry.org/rdap/']],
    // A more specific entry that must win over the bare TLD above it.
    [['sub.example.net'], ['https://rdap.sub.example.org/']],
  ],
};

const IPV4_BOOTSTRAP = {
  publication: '2026-01-14T00:00:00Z',
  services: [
    [['93.0.0.0/8'], [ARIN]],
    // A less specific block that must lose to the /8 above.
    [['0.0.0.0/0'], ['https://rdap.example.org/wrong/']],
  ],
};

const IPV6_BOOTSTRAP = {
  publication: '2026-01-14T00:00:00Z',
  services: [[['2600::/12'], [ARIN]]],
};

/** A trimmed but structurally faithful RDAP domain object. */
const DOMAIN_RECORD = {
  objectClassName: 'domain',
  handle: '2336799_DOMAIN_COM-VRSN',
  ldhName: 'EXAMPLE.COM',
  status: ['client delete prohibited', 'clientTransferProhibited'],
  events: [
    { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
    { eventAction: 'expiration', eventDate: '2026-08-13T04:00:00Z' },
  ],
  nameservers: [
    { objectClassName: 'nameserver', ldhName: 'A.IANA-SERVERS.NET' },
    {
      objectClassName: 'nameserver',
      ldhName: 'B.IANA-SERVERS.NET',
      ipAddresses: { v4: ['199.43.133.53'], v6: ['2001:500:8d::53'] },
    },
  ],
  secureDNS: { delegationSigned: true },
  entities: [
    {
      objectClassName: 'entity',
      handle: '376',
      roles: ['registrar'],
      publicIds: [{ type: 'IANA Registrar ID', identifier: '376' }],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'RESERVED-Internet Assigned Numbers Authority'],
        ],
      ],
    },
    // The GDPR-era shape: a role, and nothing else.
    { objectClassName: 'entity', roles: ['registrant'] },
  ],
};

const IP_RECORD = {
  objectClassName: 'ip network',
  handle: 'NET-93-184-216-0-1',
  startAddress: '93.184.216.0',
  endAddress: '93.184.216.255',
  name: 'EDGECAST-NETBLK',
  type: 'DIRECT ALLOCATION',
  country: 'US',
  status: ['active'],
  events: [{ eventAction: 'registration', eventDate: '2008-06-02T00:00:00Z' }],
  entities: [],
};

function stubbedDomain(extra: Record<string, unknown> = {}) {
  return fakeFetch({
    [BOOTSTRAP_URLS.domain]: jsonResponse(DNS_BOOTSTRAP),
    [BOOTSTRAP_URLS.ipv4]: jsonResponse(IPV4_BOOTSTRAP),
    [BOOTSTRAP_URLS.ipv6]: jsonResponse(IPV6_BOOTSTRAP),
    [`${VERISIGN}domain/example.com`]: jsonResponse(DOMAIN_RECORD),
    // A prefix, not a full URL: `rdapUrlFor` percent-encodes the colons of an IPv6
    // literal, so matching the whole path would mean restating that encoding here.
    [`${ARIN}ip/`]: jsonResponse(IP_RECORD),
    ...extra,
  });
}

describe('GET /api/diagnostics/rdap', () => {
  describe('bootstrap discovery', () => {
    it('asks IANA who answers for the TLD, then asks that registry', async () => {
      const stub = stubbedDomain();
      const response = await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/rdap?target=example.com'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(200);
      expect(stub.calls.map((call) => call.url)).toEqual([
        BOOTSTRAP_URLS.domain,
        rdapUrlFor(VERISIGN, 'domain', 'example.com'),
      ]);
      expect(new URL(stub.calls[0]!.url).origin).toBe(BOOTSTRAP_ORIGIN);
      expect(body.registry).toMatchObject({
        base: VERISIGN,
        bootstrap: BOOTSTRAP_URLS.domain,
        publication: '2026-01-14T00:00:00Z',
      });
    });

    it('caches the bootstrap file across requests', async () => {
      const stub = stubbedDomain();
      const handler = createRdapHandler(makeDeps({ fetch: stub.fetch, limit: 10 }));

      await handler(get('/api/diagnostics/rdap?target=example.com'));
      await handler(get('/api/diagnostics/rdap?target=example.com'));

      const bootstrapCalls = stub.calls.filter(
        (call) => call.url === BOOTSTRAP_URLS.domain,
      );
      expect(bootstrapCalls).toHaveLength(1);
      expect(stub.calls).toHaveLength(3);
    });

    it('prefers the most specific matching entry', async () => {
      const stub = stubbedDomain({
        'https://rdap.sub.example.org/domain/host.sub.example.net':
          jsonResponse(DOMAIN_RECORD),
      });
      const body = await bodyOf(
        await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/rdap?target=host.sub.example.net'),
        ),
      );

      expect(body.registry.base).toBe('https://rdap.sub.example.org/');
    });

    it('says so when no registry publishes RDAP for the TLD', async () => {
      const stub = stubbedDomain();
      const response = await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/rdap?target=example.aero'),
      );

      expect(response.status).toBe(404);
      expect((await bodyOf(response)).error.code).toBe('not-found');
      // The bootstrap was fetched; the registry was not, because there is not one.
      expect(stub.calls).toHaveLength(1);
    });

    it('reports an unreadable bootstrap file as an upstream failure', async () => {
      const stub = fakeFetch({
        [BOOTSTRAP_URLS.domain]: new Response('not json', { status: 200 }),
      });
      const response = await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/rdap?target=example.com'),
      );

      expect(response.status).toBe(502);
      expect((await bodyOf(response)).error.code).toBe('upstream-failed');
    });
  });

  describe('the normalised record', () => {
    it('flattens the RDAP object into the fields the UI shows', async () => {
      const stub = stubbedDomain();
      const body = await bodyOf(
        await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/rdap?target=example.com'),
        ),
      );

      expect(body).toMatchObject({
        target: 'example.com',
        kind: 'domain',
        found: true,
        handle: '2336799_DOMAIN_COM-VRSN',
        ldhName: 'example.com',
        delegationSigned: true,
      });
      expect(body.statuses).toEqual([
        'client delete prohibited',
        'clientTransferProhibited',
      ]);
      expect(body.events).toEqual([
        { action: 'registration', date: '1995-08-14T04:00:00Z' },
        { action: 'expiration', date: '2026-08-13T04:00:00Z' },
      ]);
      expect(body.nameservers).toEqual([
        { host: 'a.iana-servers.net', addresses: [] },
        {
          host: 'b.iana-servers.net',
          addresses: ['199.43.133.53', '2001:500:8d::53'],
        },
      ]);
      expect(body.registrar).toEqual({
        name: 'RESERVED-Internet Assigned Numbers Authority',
        ianaId: 376,
      });
    });

    it('marks a contact the registry withheld as redacted rather than empty', async () => {
      const stub = stubbedDomain();
      const body = await bodyOf(
        await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/rdap?target=example.com'),
        ),
      );

      const registrant = body.entities.find((entity: { roles: string[] }) =>
        entity.roles.includes('registrant'),
      );
      expect(registrant.redacted).toBe(true);
      expect(registrant.name).toBeUndefined();
    });

    it('looks an address up in the IPv4 bootstrap and picks the smallest block', async () => {
      const stub = stubbedDomain();
      const body = await bodyOf(
        await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
          get('/api/diagnostics/rdap?target=93.184.216.34'),
        ),
      );

      expect(body.kind).toBe('ip');
      expect(body.registry.base).toBe(ARIN);
      expect(body.registry.bootstrap).toBe(BOOTSTRAP_URLS.ipv4);
      expect(body.network).toMatchObject({
        startAddress: '93.184.216.0',
        endAddress: '93.184.216.255',
        name: 'EDGECAST-NETBLK',
        country: 'US',
      });
    });

    it('uses the IPv6 bootstrap for an IPv6 target', async () => {
      const stub = stubbedDomain();
      const body = await bodyOf(
        await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
          get(
            `/api/diagnostics/rdap?target=${encodeURIComponent('2606:2800:220:1:248:1893:25c8:1946')}`,
          ),
        ),
      );

      expect(body.registry.bootstrap).toBe(BOOTSTRAP_URLS.ipv6);
    });

    it('treats a registry 404 as "not registered", not as an error', async () => {
      const stub = stubbedDomain({
        [`${VERISIGN}domain/unregistered-name.com`]: new Response('', { status: 404 }),
      });
      const response = await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/rdap?target=unregistered-name.com'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(200);
      expect(body.found).toBe(false);
      expect(body.statuses).toEqual([]);
    });
  });

  describe('redirects are re-validated, never merely followed', () => {
    it('follows a registry redirect after running the whole guard again', async () => {
      const redirected = 'https://rdap.registrar.example.net/domain/example.com';
      const stub = stubbedDomain({
        [`${VERISIGN}domain/example.com`]: new Response('', {
          status: 302,
          headers: { location: redirected },
        }),
        [redirected]: jsonResponse(DOMAIN_RECORD),
      });
      const resolver = tableResolver();
      const response = await createRdapHandler(
        makeDeps({ fetch: stub.fetch, resolve: resolver.resolve }),
      )(get('/api/diagnostics/rdap?target=example.com'));
      const body = await bodyOf(response);

      expect(response.status).toBe(200);
      expect(body.redirects).toEqual([redirected]);
      expect(stub.calls.map((call) => call.url)).toEqual([
        BOOTSTRAP_URLS.domain,
        `${VERISIGN}domain/example.com`,
        redirected,
      ]);
      // The redirect target was resolved and re-checked, not trusted.
      expect(resolver.seen).toContain('rdap.registrar.example.net');
    });

    it('refuses a redirect to a host that resolves privately, without requesting it', async () => {
      const redirected = 'https://rdap-internal.example.net/domain/example.com';
      const stub = stubbedDomain({
        [`${VERISIGN}domain/example.com`]: new Response('', {
          status: 302,
          headers: { location: redirected },
        }),
      });
      const resolver = tableResolver({ 'rdap-internal.example.net': ['10.0.0.5'] });
      const response = await createRdapHandler(
        makeDeps({ fetch: stub.fetch, resolve: resolver.resolve }),
      )(get('/api/diagnostics/rdap?target=example.com'));
      const body = await bodyOf(response);

      expect(response.status).toBe(403);
      expect(body.error.reason).toBe('blocked-resolved-address');
      expect(body.error.address).toBe('10.0.0.5');
      expect(stub.calls.map((call) => call.url)).not.toContain(redirected);
    });

    it('refuses a redirect to a private literal', async () => {
      const stub = stubbedDomain({
        [`${VERISIGN}domain/example.com`]: new Response('', {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        }),
      });
      const response = await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/rdap?target=example.com'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(403);
      expect(body.error.metadataEndpoint).toMatch(/metadata/i);
      expect(stub.calls).toHaveLength(2);
    });

    it('gives up on a redirect loop rather than following it', async () => {
      let hop = 0;
      const stub = stubbedDomain({
        [`${VERISIGN}domain/example.com`]: () =>
          new Response('', {
            status: 302,
            headers: { location: `https://rdap.hop${(hop += 1)}.example.net/domain/x` },
          }),
        'https://rdap.hop': () =>
          new Response('', {
            status: 302,
            headers: { location: `https://rdap.hop${(hop += 1)}.example.net/domain/x` },
          }),
      });
      const response = await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
        get('/api/diagnostics/rdap?target=example.com'),
      );
      const body = await bodyOf(response);

      expect(response.status).toBe(502);
      expect(body.error.reason).toBe('too-many-redirects');
    });
  });

  describe('blocked targets never reach the network', () => {
    const blocked = [
      'localhost',
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      'nas.local',
      '::1',
    ];

    for (const target of blocked) {
      it(`refuses ${target} before even fetching the bootstrap`, async () => {
        const stub = noFetch();
        const response = await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
          get(`/api/diagnostics/rdap?target=${encodeURIComponent(target)}`),
        );

        expect(response.status).toBe(403);
        expect((await bodyOf(response)).error.code).toBe('blocked-target');
        expect(stub.calls).toEqual([]);
      });
    }
  });

  describe('exactly one target', () => {
    const multi = [
      'target=example.com&target=example.net',
      'target=example.com,example.net',
      'targets=example.com,example.net',
      'target=93.184.216.0/24',
      'target=93.184.216.1-93.184.216.9',
      'cidr=10.0.0.0/8&target=example.com',
    ];

    for (const query of multi) {
      it(`refuses "${query}"`, async () => {
        const stub = noFetch();
        const response = await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
          get(`/api/diagnostics/rdap?${query}`),
        );

        expect(response.status).toBe(400);
        expect((await bodyOf(response)).error.code).toBe('invalid-target');
        expect(stub.calls).toEqual([]);
      });
    }
  });

  describe('rate limiting', () => {
    it('answers 429 with Retry-After and makes no request', async () => {
      const stub = stubbedDomain();
      const handler = createRdapHandler(makeDeps({ fetch: stub.fetch, limit: 1 }));

      expect(
        (await handler(get('/api/diagnostics/rdap?target=example.com'))).status,
      ).toBe(200);
      const callsAfterFirst = stub.calls.length;

      const refused = await handler(get('/api/diagnostics/rdap?target=example.com'));
      expect(refused.status).toBe(429);
      expect(refused.headers.get('Retry-After')).toBeTruthy();
      expect((await bodyOf(refused)).error.code).toBe('rate-limited');
      expect(stub.calls).toHaveLength(callsAfterFirst);
    });
  });

  it('forwards no cookies or credentials to the registry', async () => {
    const stub = stubbedDomain();
    await createRdapHandler(makeDeps({ fetch: stub.fetch }))(
      get('/api/diagnostics/rdap?target=example.com', {
        cookie: 'session=secret',
        'x-api-key': 'secret',
      }),
    );

    for (const call of stub.calls) {
      expect(call.init.credentials).toBe('omit');
      expect(call.init.redirect).toBe('manual');
      expect(Object.keys(call.init.headers as Record<string, string>)).toEqual([
        'accept',
      ]);
    }
  });
});
