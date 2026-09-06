/**
 * The page, as the origin serves it -- and as the caches remember it.
 *
 * Three stages need the same responses: the cache check looks for the document in the
 * browser's private store, the CDN stage produces it from the edge or the origin, and the
 * render stage fetches the subresources the document names. Building them in one place is
 * what keeps a cached copy and a fresh copy the *same response*, which is the only way a
 * 304 can mean anything: revalidation compares an entity tag against the representation
 * the origin currently holds, and if the two were constructed separately the comparison
 * would be theatre.
 *
 * ## Sizes are modelled, bodies are excerpts
 *
 * A response here carries a `Content-Length` taken from the scenario's declared byte count
 * and a `body` that is a short excerpt of what that many bytes would contain. This module
 * models payload *lengths* -- they are what drives serialization delay, and a 180 KB string
 * in a scenario file would be 180 KB of noise. The same discipline is already used for the
 * TCP checksum in `@/core/protocols/tcp`, and for the same reason: a number that cannot be
 * computed honestly is better modelled explicitly than faked.
 *
 * Every response is stamped from {@link SIM_CLOCK}, so `Date`, `Last-Modified`, and `Age`
 * are consistent with the virtual timeline and with each other.
 */

import {
  createCache,
  storeResponse,
  type HttpCache,
  type CacheTier,
} from '@/core/protocols/http/caching';
import {
  dateHeaderAt,
  formatHttpDate,
  header,
  request,
  response,
  toEpoch,
  type HeaderList,
  type HttpHeader,
  type HttpRequest,
  type HttpResponse,
  type HttpVersion,
} from '@/core/protocols/http/message';
import { reasonPhrase } from '@/core/protocols/http/semantics';

import {
  SIM_CLOCK,
  type DocumentSpec,
  type ResourceKind,
  type SimulatorScenario,
  type SubresourceSpec,
} from './stage';

/** What the origin claims each kind of resource is. */
const CONTENT_TYPES: Readonly<Record<ResourceKind, string>> = {
  stylesheet: 'text/css; charset=utf-8',
  script: 'text/javascript; charset=utf-8',
  image: 'image/avif',
  font: 'font/woff2',
  fetch: 'application/json; charset=utf-8',
};

/** How long a browser spends on a resource it found in its own cache. */
export const MEMORY_CACHE_MS = 1;

/**
 * One thing this page consists of, whether or not it crosses the wire.
 *
 * The document and its subresources are modelled identically on purpose: a document is
 * just the first resource, it is cached by the same rules, and treating it as special is
 * how a page-load model ends up unable to explain why the *second* visit is fast.
 */
export interface PageResource {
  readonly id: string;
  readonly label: string;
  readonly target: string;
  readonly kind: ResourceKind | 'document';
  readonly bytes: number;
  readonly response: HttpResponse;
  readonly renderBlocking: boolean;
  readonly lcpCandidate: boolean;
  readonly serverThinkMs: number;
}

/** Everything a run needs to know about what it is loading. */
export interface PageModel {
  readonly host: string;
  readonly document: PageResource;
  readonly subresources: readonly PageResource[];
  /** Document and subresources together, in discovery order. */
  readonly all: readonly PageResource[];
  /** Total bytes if nothing at all were cached. */
  readonly totalBytes: number;
}

/** Look a resource up by request-target. */
export function resourceFor(page: PageModel, target: string): PageResource | undefined {
  return page.all.find((resource) => resource.target === target);
}

/** The `GET` a browser would send for one resource. */
export function requestFor(
  resource: PageResource,
  host: string,
  version: HttpVersion,
  extra: HeaderList = [],
): HttpRequest {
  return request({
    method: 'GET',
    target: resource.target,
    version,
    headers: [
      header('Host', host),
      header('User-Agent', 'InternetVisualizer/1.0 (simulated)'),
      header(
        'Accept',
        resource.kind === 'document'
          ? 'text/html,application/xhtml+xml,*/*;q=0.8'
          : (CONTENT_TYPES[resource.kind as ResourceKind] ?? '*/*').split(';')[0],
      ),
      header('Accept-Encoding', 'gzip, br'),
      ...extra,
    ],
  });
}

function commonHeaders(init: {
  at: number;
  bytes: number;
  contentType: string;
  cacheControl?: string;
  etag?: string;
  lastModifiedAgoSeconds?: number;
}): HeaderList {
  const headers: HttpHeader[] = [
    header('Date', formatHttpDate(toEpoch(SIM_CLOCK, init.at))),
    header('Server', 'simulated-origin'),
    header('Content-Type', init.contentType),
    header('Content-Length', `${init.bytes}`),
  ];
  const extra: HttpHeader[] = [];
  if (init.cacheControl !== undefined) {
    extra.push(header('Cache-Control', init.cacheControl));
  }
  if (init.etag !== undefined) extra.push(header('ETag', init.etag));
  if (init.lastModifiedAgoSeconds !== undefined) {
    extra.push(
      header(
        'Last-Modified',
        formatHttpDate(toEpoch(SIM_CLOCK, init.at - init.lastModifiedAgoSeconds * 1000)),
      ),
    );
  }
  return [...headers, ...extra];
}

/** A body excerpt long enough to read and short enough not to be the point. */
function excerptFor(kind: ResourceKind, label: string, bytes: number): string {
  switch (kind) {
    case 'stylesheet':
      return `/* ${label} -- ${bytes} bytes */\n:root{--bg:#0b1020}\nbody{margin:0}`;
    case 'script':
      return `// ${label} -- ${bytes} bytes\nexport const ready = true;`;
    case 'image':
      return `<${bytes} bytes of AVIF image data: ${label}>`;
    case 'font':
      return `<${bytes} bytes of WOFF2 font data: ${label}>`;
    case 'fetch':
      return `{"resource":"${label}","bytes":${bytes}}`;
  }
}

/** Build the origin's response for the document. */
export function documentResponse(spec: DocumentSpec, at: number): HttpResponse {
  const status = spec.status ?? 200;
  return response({
    status,
    reason: reasonPhrase(status),
    version: 'HTTP/1.1',
    headers: commonHeaders({
      at,
      bytes: spec.bytes,
      contentType: spec.contentType ?? 'text/html; charset=utf-8',
      cacheControl: spec.cacheControl,
      etag: spec.etag,
      lastModifiedAgoSeconds: spec.lastModifiedAgoSeconds,
    }),
    body: spec.excerpt,
  });
}

/** Build the origin's response for one subresource. */
export function subresourceResponse(spec: SubresourceSpec, at: number): HttpResponse {
  return response({
    status: 200,
    reason: reasonPhrase(200),
    version: 'HTTP/1.1',
    headers: commonHeaders({
      at,
      bytes: spec.bytes,
      contentType: CONTENT_TYPES[spec.kind],
      cacheControl: spec.cacheControl,
      etag: spec.etag,
    }),
    body: excerptFor(spec.kind, spec.label, spec.bytes),
  });
}

/**
 * Assemble the page a scenario describes.
 *
 * `generatedAt` is the virtual millisecond the origin's copy is dated. It is negative for
 * anything a previous visit stored, which is how a cache entry ends up with an age: the
 * response really was produced before this timeline started.
 */
export function buildPage(scenario: SimulatorScenario, host: string): PageModel {
  const doc = scenario.origin.document;
  const document: PageResource = {
    id: 'document',
    label: 'document',
    target: '/',
    kind: 'document',
    bytes: doc.bytes,
    response: documentResponse(doc, 0),
    renderBlocking: true,
    lcpCandidate: false,
    serverThinkMs: doc.serverThinkMs ?? 20,
  };

  const subresources = (scenario.origin.subresources ?? []).map<PageResource>((spec) => ({
    id: spec.id,
    label: spec.label,
    target: spec.target,
    kind: spec.kind,
    bytes: spec.bytes,
    response: subresourceResponse(spec, 0),
    renderBlocking: spec.renderBlocking ?? false,
    lcpCandidate: spec.lcpCandidate ?? false,
    serverThinkMs: spec.serverThinkMs ?? 4,
  }));

  const all = [document, ...subresources];
  return {
    host,
    document,
    subresources,
    all,
    totalBytes: all.reduce((sum, resource) => sum + resource.bytes, 0),
  };
}

/**
 * The document's target as the URL asks for it.
 *
 * The scenario declares the document under `/` because that is what it usually is; a URL
 * with a path re-targets it, so the cache key, the request line, and the waterfall row
 * all agree with the address bar.
 */
export function retarget(page: PageModel, target: string): PageModel {
  if (page.document.target === target) return page;
  const document: PageResource = { ...page.document, target };
  return { ...page, document, all: [document, ...page.subresources] };
}

/**
 * A cache holding what a previous visit left behind.
 *
 * Entries are written through the real {@link storeResponse}, which means a scenario
 * cannot store something the RFC would refuse to store: declaring `no-store` on a
 * resource and then claiming it was cached simply produces an empty cache, which is the
 * correct answer and a better lesson than an honoured lie.
 *
 * `storedSecondsAgo` becomes a negative virtual timestamp. That is not a trick -- the
 * response was received before this page load began, and the freshness arithmetic in
 * `@/core/protocols/http/caching` is a subtraction that does not care about the sign.
 */
export function warmCache(
  tier: CacheTier,
  page: PageModel,
  entries: readonly { target: string; storedSecondsAgo: number }[],
  version: HttpVersion,
  rttMs: number,
): HttpCache {
  let cache = createCache(tier);

  for (const entry of entries) {
    const resource = resourceFor(page, entry.target);
    if (!resource) continue;

    const receivedAt = -entry.storedSecondsAgo * 1000;
    const requestedAt = receivedAt - rttMs;
    const stored = storeResponse(cache, {
      request: requestFor(resource, page.host, version),
      // Re-dated to when it was actually received, so `Age` is the real elapsed time
      // rather than an accident of when the scenario file happened to build it.
      response: {
        ...resource.response,
        headers: resource.response.headers.map((field) =>
          field.name.toLowerCase() === 'date'
            ? header('Date', formatHttpDate(toEpoch(SIM_CLOCK, receivedAt)))
            : field,
        ),
      },
      requestedAt,
      receivedAt,
    });
    cache = stored.cache;
  }

  return cache;
}

/** The `Date` a response carries, as a virtual millisecond. Used by the cache panel. */
export function responseDateMs(message: HttpResponse): number | undefined {
  return dateHeaderAt(message.headers, 'Date', SIM_CLOCK);
}
