/**
 * `reach.ts` -- one `HEAD` request to a target the user typed, with timing.
 *
 * This is the only route where the address the user chose is the address a socket is
 * opened to, so it is the only one that runs the *whole* guard: parse, block-list the
 * literal, resolve the name, re-check every address that came back, restrict the scheme
 * and port, cap the timeout, and refuse to follow the redirect.
 *
 * It is also the one that has to be honest about what it is not. Vercel's serverless
 * runtime cannot send an ICMP echo -- raw sockets need privileges it does not grant --
 * so there is no real `ping` to offer. What there is, is the time from this server
 * issuing an HTTP request to the first byte of the response coming back. That number
 * includes DNS, the TCP handshake, the TLS handshake, and the target's own web stack
 * deciding to answer, which is a different measurement from an ICMP round trip and is
 * usually a larger one. {@link REACH_NOT_ICMP} is the sentence the UI must show; it lives
 * in `@/core/net/diagnostics` so the API and the UI cannot drift into two different
 * claims.
 */

import {
  normalizeReachTarget,
  REACH_NOT_ICMP,
  REPORTED_HEADERS,
  type ReachPayload,
} from '@/core/net/diagnostics';

import type { DiagnosticsDeps } from './deps';
import { clientKeyOf } from './deps';
import { guardedFetch, isOutboundOk, respondOutboundFailure } from './outbound';
import { readSingleParam } from './request';
import {
  respondDenied,
  respondOk,
  respondRateLimited,
  type DiagnosticsSource,
} from './respond';

/**
 * The ICMP caveat, the header allow-list, the target normaliser, and the payload shape
 * live in `@/core/net/diagnostics`: Live mode has to show the URL this handler will
 * request, and print the same "not an ICMP echo" sentence, before the request is made.
 * Re-exported under the names this file has always used.
 */
export {
  normalizeReachTarget,
  REACH_NOT_ICMP,
  REPORTED_HEADERS,
  type ReachAddress,
  type ReachPayload,
} from '@/core/net/diagnostics';

function sourceFor(url: string, hostname: string): DiagnosticsSource {
  return {
    kind: 'http-head',
    name: hostname,
    endpoint: url,
    note: 'Measured by this server making one HTTP HEAD request. Your browser made no request to this host.',
  };
}

/** Build the `GET /api/diagnostics/reach` handler. */
export function createReachHandler(deps: DiagnosticsDeps) {
  return async function GET(request: Request): Promise<Response> {
    const decision = deps.limiter.take(clientKeyOf(request));
    if (!decision.allowed) return respondRateLimited(decision);

    const url = new URL(request.url);

    const rawTarget = readSingleParam(url, 'target');
    if (!rawTarget.allowed) return respondDenied(rawTarget, decision);

    const { url: requestedUrl } = normalizeReachTarget(rawTarget.value);

    const outcome = await guardedFetch(requestedUrl, deps, {
      method: 'HEAD',
      readBody: false,
      // Zero redirects: a 3xx is reported, never obeyed. Following one would mean a
      // second request the `LiveDisclosure` panel did not show the user in advance.
      policy: { maxRedirects: 0 },
    });
    if (!isOutboundOk(outcome)) return respondOutboundFailure(outcome, decision);

    const { target, response, ttfbMs, elapsedMs } = outcome.value;

    const headers: Record<string, string> = {};
    for (const name of REPORTED_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }

    const location = response.headers.get('location');
    const isRedirect = response.status >= 300 && response.status < 400 && location;

    const payload: ReachPayload = {
      target: rawTarget.value,
      requestedUrl: target.url,
      method: 'HEAD',
      scheme: target.scheme,
      hostname: target.hostname,
      port: target.port,
      answered: true,
      status: response.status,
      statusText: response.statusText,
      ok: response.status >= 200 && response.status < 400,
      responseTimeMs: Math.round(ttfbMs),
      resolved: target.resolved,
      addresses: target.addresses.map((entry) => ({
        address: entry.text,
        scope: entry.classification.scope,
        version: entry.address.version,
      })),
      headers,
      ...(isRedirect
        ? {
            redirect: {
              status: response.status,
              location,
              followed: false as const,
              note: 'The target asked to be followed somewhere else. This was not done: a redirect is a new target, and it would have to pass the whole SSRF guard again before anything was requested from it.',
            },
          }
        : {}),
      ...(target.scheme === 'https:'
        ? {
            tls: {
              negotiated: true as const,
              note: 'The response arrived over TLS, so the handshake succeeded and the certificate chained to a trusted root and matched this hostname. The platform fetch API does not expose the peer certificate, so issuer and expiry are not shown here.',
            },
          }
        : {}),
      note: REACH_NOT_ICMP,
    };

    return respondOk(
      payload,
      {
        requestedAt: new Date().toISOString(),
        elapsedMs: Math.round(elapsedMs),
        source: sourceFor(target.url, target.hostname),
      },
      decision,
    );
  };
}
