/**
 * What one stage actually established, as a short list of checkable facts.
 *
 * `StageZoom` is a composite module's hardest UI problem: eight stages, each with a
 * dedicated module already devoted to showing it properly, and a panel that must say
 * something worth reading about any of them without turning into a worse copy of all six.
 * The answer taken here is that the zoom shows *the handful of numbers this stage produced*
 * -- the ones a learner would quote back -- and then hands off. The long version is a click
 * away in the module that exists for it, which is the whole design of the handoff.
 *
 * Pure and separate from the component so the choice of facts can be tested. A fact that is
 * absent because the stage did not run is simply not in the list; the panel says why
 * separately, from the stage's own skip reason.
 */

import { displayName } from '@/core/protocols/dns/records';

import type { PageLoadRun } from './sim/pipeline';
import type { StageId } from './sim/stage';
import type { CacheOutcome } from './sim/stages/cache-check';
import type { ResponseSource } from './sim/stages/cdn-stage';

/** One row of the zoom's fact table. */
export interface StageFact {
  readonly label: string;
  readonly value: string;
  /** Why this number is the interesting one. Omitted when the label says it. */
  readonly note?: string;
}

/** How a cache verdict is written where a user reads it. */
const CACHE_OUTCOMES: Readonly<Record<CacheOutcome, string>> = {
  fresh: 'Fresh hit',
  revalidate: 'Stale, revalidating',
  miss: 'Miss',
  'service-worker': 'Answered by a service worker',
  bypass: 'Bypassed',
};

/** Where the bytes came from, written out. */
const RESPONSE_SOURCES: Readonly<Record<ResponseSource, string>> = {
  'edge-cache': 'The CDN edge, from its shared cache',
  'origin-via-edge': 'The origin, proxied through the edge',
  origin: 'The origin, directly',
  'browser-cache': "This browser's own store, confirmed by a 304",
};

function bytes(count: number): string {
  if (count === 0) return '0 bytes';
  if (count < 1024) return `${count} bytes`;
  return `${(count / 1024).toFixed(1)} KB`;
}

function ms(value: number): string {
  return `${Math.round(value)} ms`;
}

/**
 * The facts one stage produced, or an empty list when it produced none.
 *
 * Every branch reads state a *later* stage would also have read, so a fact shown here is
 * one the run genuinely depended on rather than a summary written for the panel.
 */
export function stageFacts(run: PageLoadRun, id: StageId): readonly StageFact[] {
  const state = run.state;

  switch (id) {
    case 'url-parse': {
      const url = state.url;
      if (!url) return [];
      return [
        {
          label: 'Scheme',
          value: url.scheme,
          note: 'Decides the port and whether TLS runs.',
        },
        {
          label: 'Host',
          value: displayName(url.host),
          note: 'Sent twice: once to DNS, and again in the Host field.',
        },
        {
          label: 'Port',
          value: `${url.port}${url.defaultPort ? ' (implied by the scheme)' : ''}`,
        },
        {
          label: 'Request target',
          value: url.target,
          note: 'What goes in the request line.',
        },
        {
          label: 'Fragment',
          value: url.fragment === '' ? 'none' : `#${url.fragment}`,
          note: 'Never leaves the browser. The server cannot see it, log it, or route on it.',
        },
      ];
    }

    case 'cache-check': {
      const check = state.cache;
      if (!check) return [];
      return [
        { label: 'Verdict', value: CACHE_OUTCOMES[check.outcome], note: check.reason },
        {
          label: 'HSTS',
          value: check.hstsUpgraded
            ? 'Upgraded http to https locally'
            : 'Not upgraded here',
          note: check.hstsUpgraded
            ? 'The cleartext request was never sent. The upgrade happened before any socket existed.'
            : undefined,
        },
        {
          label: 'Service worker',
          value: check.serviceWorkerRan ? 'Consulted' : 'None registered',
        },
        {
          label: 'Network needed',
          value: check.skipsNetwork ? 'No' : 'Yes',
          note: check.skipsNetwork
            ? 'Five stages below this one never got a turn, and the rail shows them greyed.'
            : undefined,
        },
      ];
    }

    case 'dns': {
      const dns = state.dns;
      if (!dns) return [];
      return [
        { label: 'Answer', value: dns.addresses.join(', ') || 'none' },
        {
          label: 'Queries sent',
          value: `${dns.queryCount}`,
          note: dns.servedFromCache
            ? 'Answered from the resolver cache, so nothing was asked of the hierarchy.'
            : 'Root, then the TLD, then the zone. Each one is a round trip.',
        },
        { label: 'Servers touched', value: `${dns.nodesTouched.length}` },
        {
          label: 'Cache',
          value: dns.servedFromCache ? 'Warm' : 'Cold',
          note: 'A warm resolver turns this whole stage into a memory read.',
        },
      ];
    }

    case 'tcp': {
      const tcp = state.tcp;
      if (!tcp) return [];
      return [
        {
          label: 'Established',
          value: tcp.established ? 'Yes' : 'No',
          note: tcp.established ? undefined : 'The SYN was never answered.',
        },
        { label: 'Peer', value: `${tcp.peerAddress}:${tcp.serverPort}` },
        {
          label: 'Local port',
          value: `${tcp.clientPort}`,
          note: 'Ephemeral, chosen per connection.',
        },
        {
          label: 'Setup',
          value: ms(tcp.setupMs),
          note: 'One round trip on a healthy link -- the third segment carries data, so it is not three.',
        },
        { label: 'Segments', value: `${tcp.steps.length}` },
      ];
    }

    case 'tls': {
      const tls = state.tls;
      if (!tls) return [];
      return [
        { label: 'Version', value: tls.version },
        {
          label: 'Round trips',
          value: `${tls.roundTrips}`,
          note: tls.earlyData
            ? 'Zero: the request went out as early data on a resumed session.'
            : 'What the handshake costs before a single byte of HTTP exists.',
        },
        { label: 'ALPN', value: `${tls.alpn} (${tls.httpVersion})` },
        {
          label: 'Certificate',
          value: tls.validation.trusted ? 'Trusted' : 'Rejected',
          note: tls.validation.trusted
            ? `Chain of ${tls.validation.path.length} verified against the local trust store.`
            : tls.validation.failures.map((step) => step.title).join('; '),
        },
      ];
    }

    case 'http': {
      const http = state.http;
      if (!http) return [];
      return [
        { label: 'Request', value: `${http.request.method} ${http.request.target}` },
        { label: 'Version', value: http.version },
        {
          label: 'Header bytes',
          value: `${bytes(http.headerBytesOnWire)} on the wire, ${bytes(http.headerBytesRaw)} raw`,
          note:
            http.headerBytesOnWire < http.headerBytesRaw
              ? 'HPACK compressed them. Headers repeat on every request, which is what makes that worth doing.'
              : undefined,
        },
        {
          label: 'Conditional',
          value: http.conditional ? 'Yes -- validators attached' : 'No',
          note: http.conditional
            ? 'A stored copy exists; this asks whether it is still good, rather than for the bytes.'
            : undefined,
        },
      ];
    }

    case 'cdn': {
      const cdn = state.cdn;
      if (!cdn) return [];
      return [
        { label: 'Served by', value: RESPONSE_SOURCES[cdn.source], note: cdn.reason },
        { label: 'Status', value: `${cdn.response.status} ${cdn.response.reason}` },
        {
          label: 'Origin contacted',
          value: cdn.originFetched ? 'Yes' : 'No',
          note: cdn.originFetched
            ? 'The edge did not have it, so the round trip to the origin is in this number too.'
            : 'The edge answered alone. This is the entire argument for a CDN.',
        },
        {
          label: 'Transferred',
          value: bytes(cdn.transferredBytes),
          note: cdn.bodyBytes === 0 ? 'A 304 carries headers and no body.' : undefined,
        },
      ];
    }

    case 'render': {
      const render = state.render;
      if (!render) return [];
      const blocked = render.blockedFirstPaintBy;
      return [
        {
          label: 'First Paint',
          value: ms(run.metrics.firstPaintMs ?? render.firstPaintAt),
          note:
            blocked.length === 0
              ? 'Nothing blocked the first frame.'
              : `Held for ${blocked.join(', ')}. A stylesheet in the head blocks on purpose: painting unstyled text and re-painting it looks worse than painting nothing.`,
        },
        {
          label: 'Largest Contentful Paint',
          value: ms(
            run.metrics.largestContentfulPaintMs ?? render.largestContentfulPaintAt,
          ),
          note: 'When the biggest thing above the fold finished arriving.',
        },
        {
          label: 'Subresources',
          value: `${render.fetches.length} (${render.fetches.filter((f) => f.source === 'browser-cache').length} from cache)`,
        },
        { label: 'Transferred here', value: bytes(render.transferredBytes) },
      ];
    }

    default:
      return [];
  }
}
