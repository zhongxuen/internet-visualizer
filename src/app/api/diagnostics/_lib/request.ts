/**
 * `request.ts` -- how a diagnostics route reads its input, and the rule that there is
 * exactly one of it.
 *
 * The phase doc's hardest structural requirement is "one target, one request. No
 * ranges, no CIDR expansion, no port sweeps, no concurrent fan-out. This module must be
 * structurally incapable of scanning." That is enforced in three places, and this file
 * is the first:
 *
 *   1. here -- the query string may carry exactly one `target`, and no plural-looking
 *      parameter at all, so a second target has nowhere to be written;
 *   2. `lookupTargetSchema` / `targetUrlSchema` in `guard.ts` -- a single value may not
 *      contain a comma, a slash (so no CIDR), or a dashed range;
 *   3. the handlers -- each makes at most one outbound call, sequentially, never a fan-out.
 *
 * The routes are `GET`-only, which is the fourth: a `GET` has no body, so there is no
 * JSON array for a list of targets to arrive in. Next returns 405 for the methods a
 * `route.ts` does not export, so that needs no code of its own.
 */

import { deny, type GuardResult } from '@/core/net/guard';

/**
 * Parameter names that only make sense if you meant to pass more than one thing.
 *
 * Refused by name rather than ignored: silently dropping `?targets=a,b` would leave a
 * caller believing a list was accepted and only one entry answered, which is exactly
 * the ambiguity the security rules are about.
 */
export const PLURAL_PARAMS: readonly string[] = [
  'targets',
  'target[]',
  'hosts',
  'urls',
  'range',
  'cidr',
  'ports',
];

/** Approve `value` -- kept local so this file does not re-export the guard's helper. */
function single(value: string): GuardResult<string> {
  return { allowed: true, value };
}

/**
 * Exactly one value for `name`, or a denial explaining which rule was broken.
 *
 * `getAll` rather than `get`: `?target=a.com&target=b.com` is the obvious way to try to
 * smuggle a second target past a handler that only ever calls `get`, and it would be
 * answered for `a.com` with no sign that `b.com` was ignored.
 */
export function readSingleParam(url: URL, name: string): GuardResult<string> {
  for (const plural of PLURAL_PARAMS) {
    if (url.searchParams.has(plural)) {
      return deny(
        'malformed-input',
        `"${plural}" is not accepted: a live lookup takes exactly one target, so that this module cannot be used to scan`,
      );
    }
  }

  const values = url.searchParams.getAll(name);
  if (values.length === 0) {
    return deny('malformed-input', `"${name}" is required`);
  }
  if (values.length > 1) {
    return deny(
      'malformed-input',
      `${values.length} values were given for "${name}"; a live lookup takes exactly one target`,
    );
  }
  return single(values[0] as string);
}

/** One optional value for `name`, or `undefined`. More than one is still a refusal. */
export function readOptionalParam(
  url: URL,
  name: string,
): GuardResult<string | undefined> {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) return { allowed: true, value: undefined };
  if (values.length > 1) {
    return deny(
      'malformed-input',
      `${values.length} values were given for "${name}"; only one is allowed`,
    );
  }
  return single(values[0] as string);
}
