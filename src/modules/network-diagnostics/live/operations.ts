/**
 * The three live operations, described completely enough to be shown to a user *before*
 * one of them runs.
 *
 * Live mode's whole safety argument is that nothing happens that was not disclosed
 * first, so this file's job is to turn "look up example.com" into a plan: which URL the
 * browser will call, which URL the server will then call, with which method, and what
 * the answer will and will not mean. `LiveDisclosure` renders that plan, `client.ts`
 * executes exactly it, and both build it from {@link planLiveRequest} -- one function,
 * so the panel cannot promise one request while another is made.
 *
 * There are three operations and there is no fourth. `traceroute` is absent on purpose:
 * a TTL-limited probe needs a raw socket, a serverless runtime does not grant one, and
 * an entry that quietly fell back to the simulation would be precisely the "am I
 * touching a real network?" ambiguity the safety badge exists to remove. The Learn-mode
 * traceroute stays the only traceroute, and {@link LIVE_TRACEROUTE_NOTE} says why.
 *
 * Nothing here performs I/O.
 */

import {
  diagnosticsRouteUrl,
  dohUrlFor,
  DOH_RESOLVER,
  normalizeReachTarget,
  rdapUrlFor,
  REACH_NOT_ICMP,
  SUPPORTED_TYPES,
  type LiveOperationId,
  type SupportedType,
} from '@/core/net/diagnostics';
import { inspectUrl, parseLookupTarget, type GuardResult } from '@/core/net/guard';

export { SUPPORTED_TYPES, type LiveOperationId, type SupportedType };

/** The Learn-mode tool that explains what a live operation is measuring. */
export type LearnTool = 'ping' | 'traceroute' | 'lookup' | 'rdap';

/** One live operation, as the UI needs to describe it before running it. */
export interface LiveOperation {
  readonly id: LiveOperationId;
  /** The tab label. Deliberately not "ping" for `reach` -- see {@link LiveOperation.warning}. */
  readonly label: string;
  /** The simulated tool whose explanation belongs beside this operation's result. */
  readonly tool: LearnTool;
  /** One sentence on what the operation does. */
  readonly blurb: string;
  /** The method the *server* uses when it reaches the internet. */
  readonly upstreamMethod: 'GET' | 'HEAD';
  /** Who answers: the resolver, the registry, or the target itself. */
  readonly answeredBy: string;
  /** What the target box takes, in the box. */
  readonly placeholder: string;
  /** Targets that are safe to suggest: IANA reserved documentation names. */
  readonly examples: readonly string[];
  /** True when the socket opens to the address the user chose. Only `reach`. */
  readonly reachesTheTarget: boolean;
  /**
   * The claim this operation is *not* allowed to make, shown before the run and beside
   * the result. `undefined` when there is no common misreading to head off.
   */
  readonly warning?: string;
}

/** Why there is no live traceroute, in one sentence the UI can show where one would be. */
export const LIVE_TRACEROUTE_NOTE =
  'There is no live traceroute. A traceroute works by sending probes with a deliberately small TTL and reading the ICMP Time Exceeded replies, and that needs a raw socket — a privilege a serverless runtime does not grant. Rather than fake it, this module leaves traceroute simulated, where the TTL arithmetic is visible instead of hidden.';

/**
 * The three operations, in the order they build on each other: name to address, name to
 * registration, then an actual connection to the thing.
 */
export const LIVE_OPERATIONS: readonly LiveOperation[] = [
  {
    id: 'dns',
    label: 'DNS lookup',
    tool: 'lookup',
    blurb:
      'Asks one public resolver over DNS-over-HTTPS what a name currently resolves to.',
    upstreamMethod: 'GET',
    answeredBy: DOH_RESOLVER.name,
    placeholder: 'example.com',
    examples: ['example.com', 'iana.org', 'cloudflare.com'],
    reachesTheTarget: false,
    warning:
      'This is one resolver’s answer, from a server in a datacenter. Your own resolver, on your own network, may legitimately return something different — which is the single most common reason a lookup and a browser disagree.',
  },
  {
    id: 'rdap',
    label: 'RDAP lookup',
    tool: 'rdap',
    blurb:
      'Asks IANA which registry holds a name or an address block, then asks that registry for the record.',
    upstreamMethod: 'GET',
    answeredBy: 'the registry IANA’s bootstrap file names',
    // A routable address, because the guard refuses the documentation ranges
    // (192.0.2.0/24, 2001:db8::/32) along with every other reserved block -- a
    // placeholder that would be rejected on sight is worse than no placeholder.
    placeholder: 'example.com or 193.0.6.135',
    examples: ['example.com', 'iana.org', '193.0.6.135'],
    reachesTheTarget: false,
    warning:
      'Registrant, admin, and tech contacts are redacted by the registry itself, not by this app. An empty contact is the normal answer since GDPR, and is not a sign that anything failed.',
  },
  {
    id: 'reach',
    // Not "ping". The word would be a lie, and the tab is the first place the lie would
    // be told.
    label: 'Reachability (TCP + HTTP timing)',
    tool: 'ping',
    blurb:
      'Makes one HTTP HEAD request from this server and times how long the first byte takes.',
    upstreamMethod: 'HEAD',
    answeredBy: 'the target itself',
    placeholder: 'example.com or https://example.com/',
    examples: ['example.com', 'https://iana.org/', 'https://www.rfc-editor.org/'],
    reachesTheTarget: true,
    warning: REACH_NOT_ICMP,
  },
];

/** One operation by id. `undefined` only for an id outside the union. */
export function getLiveOperation(id: LiveOperationId): LiveOperation | undefined {
  return LIVE_OPERATIONS.find((operation) => operation.id === id);
}

/** The live operation that corresponds to a Learn-mode tool, if there is one. */
export function liveOperationForTool(tool: LearnTool): LiveOperation | undefined {
  return LIVE_OPERATIONS.find((operation) => operation.tool === tool);
}

// ---------------------------------------------------------------------------
// Validating what was typed, before anything is sent
// ---------------------------------------------------------------------------

/** A target that passed every check that can be made in the browser. */
export interface CheckedTarget {
  /** The value to put in the `?target=` parameter -- normalised, never re-parsed later. */
  readonly value: string;
  /** How the target reads once normalised: a name, an address, or a URL. */
  readonly display: string;
  /** True when a bare hostname was given `https://` to become a URL. `reach` only. */
  readonly assumedScheme: boolean;
}

/**
 * Check a typed target the way the route handler will, without sending anything.
 *
 * This runs the *same* functions the server runs -- `parseLookupTarget` for the two
 * lookups, `inspectUrl` for the one that opens a socket -- so the message under the
 * input box is the message the server would have returned, and a target that will be
 * refused is refused before a request is made rather than after.
 *
 * It is a mirror, not the authority. Everything here is repeated server-side, plus the
 * post-resolution address check that only the server can do, because a browser check is
 * advice and a route handler is the boundary.
 */
export function checkLiveTarget(
  operation: LiveOperationId,
  raw: string,
): GuardResult<CheckedTarget> {
  const trimmed = raw.trim();

  if (operation === 'reach') {
    const { url, assumedScheme } = normalizeReachTarget(trimmed);
    const inspected = inspectUrl(url);
    if (!inspected.allowed) return inspected;
    return {
      allowed: true,
      value: {
        // The URL as typed, not the normalised one: the handler normalises it again the
        // same way, and echoing it back keeps the disclosure honest about the input.
        value: trimmed,
        display: inspected.value.url,
        assumedScheme,
      },
    };
  }

  const parsed = parseLookupTarget(trimmed);
  if (!parsed.allowed) return parsed;
  const value = parsed.value.kind === 'hostname' ? parsed.value.name : parsed.value.text;
  return { allowed: true, value: { value, display: value, assumedScheme: false } };
}

// ---------------------------------------------------------------------------
// The plan: exactly what will be requested, by whom
// ---------------------------------------------------------------------------

/** One request in a plan, named by who makes it. */
export interface PlannedRequest {
  readonly method: 'GET' | 'HEAD';
  readonly url: string;
  /** What this step is for, in a few words. */
  readonly purpose: string;
}

/**
 * Everything that will happen if the user presses Run, in the order it happens.
 *
 * Two lists rather than one, because "where the request originates (the server, not the
 * browser)" is a thing the disclosure has to say and a thing users routinely get wrong.
 * The browser only ever calls this app's own origin; every request that leaves for the
 * wider internet is made by the route handler.
 */
export interface LivePlan {
  readonly operation: LiveOperation;
  readonly target: CheckedTarget;
  readonly recordType?: SupportedType;
  /** The single same-origin call the browser makes. */
  readonly fromBrowser: PlannedRequest;
  /** What the server will then request, in order. At most two. */
  readonly fromServer: readonly PlannedRequest[];
  /** True when one of `fromServer` opens a socket to the address the user chose. */
  readonly reachesTheTarget: boolean;
}

/**
 * Build the plan for one operation and one checked target.
 *
 * The RDAP plan names two steps and the second one honestly does not have a final URL
 * yet: the registry is whichever one IANA's bootstrap file points at, and that file has
 * not been read. Saying "the registry that file names" is more truthful than printing a
 * guess, and it is also the mechanism worth teaching.
 */
export function planLiveRequest(
  operation: LiveOperation,
  target: CheckedTarget,
  recordType: SupportedType = 'A',
): LivePlan {
  const fromBrowser: PlannedRequest = {
    method: 'GET',
    url: diagnosticsRouteUrl(
      operation.id,
      target.value,
      operation.id === 'dns' ? recordType : undefined,
    ),
    purpose: 'this app’s own route handler, on this origin',
  };

  if (operation.id === 'dns') {
    return {
      operation,
      target,
      recordType,
      fromBrowser,
      fromServer: [
        {
          method: 'GET',
          url: dohUrlFor(target.value, recordType),
          purpose: `${DOH_RESOLVER.name} — the one allow-listed resolver`,
        },
      ],
      reachesTheTarget: false,
    };
  }

  if (operation.id === 'rdap') {
    const bootstrap = target.value.includes(':')
      ? 'ipv6'
      : /^[\d.]+$/.test(target.value)
        ? 'ipv4'
        : 'domain';
    return {
      operation,
      target,
      fromBrowser,
      fromServer: [
        {
          method: 'GET',
          url: `https://data.iana.org/rdap/${bootstrap === 'domain' ? 'dns' : bootstrap}.json`,
          purpose: 'IANA’s bootstrap registry — which registry answers for this target',
        },
        {
          method: 'GET',
          url: rdapUrlFor(
            '«the registry base that file names»',
            bootstrap === 'domain' ? 'domain' : 'ip',
            target.value,
          ),
          purpose:
            'the registry itself — the base URL is only known once the file above is read',
        },
      ],
      reachesTheTarget: false,
    };
  }

  return {
    operation,
    target,
    fromBrowser,
    fromServer: [
      {
        method: 'HEAD',
        url: normalizeReachTarget(target.value).url,
        purpose: 'the target you typed — this is the one operation that connects to it',
      },
    ],
    reachesTheTarget: true,
  };
}
