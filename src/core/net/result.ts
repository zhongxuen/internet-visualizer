/**
 * `ParseResult` -- the return type shared by every validator in `src/core/net`.
 *
 * These parsers never throw and never return a bare `null`, because the two callers
 * that matter both need the *reason* a value was rejected:
 *
 * - the diagnostics UI (phase 12) shows it under the input the user typed;
 * - tests assert on it, which is how a validator stays honest about what it rejects.
 *
 * The shape is a plain discriminated union rather than a class so that results stay
 * structurally comparable -- `expect(parseIpv4(x)).toEqual({ ok: true, value })` works,
 * and a `SimResult` containing one still deep-equals another (see the determinism rule
 * in docs/implementation/03-simulation-core.md).
 */

/** Either a successfully parsed `value`, or an `error` explaining the rejection. */
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

/** Wrap a successfully parsed value. */
export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

/**
 * Reject an input.
 *
 * `error` is a lower-case fragment written to read well on its own under a form field
 * ("octet \"256\" is out of range 0-255"), not a sentence with a capital and a full stop.
 */
export function fail<T = never>(error: string): ParseResult<T> {
  return { ok: false, error };
}

/** Narrowing helper, mostly for readability at call sites that only need the boolean. */
export function isOk<T>(result: ParseResult<T>): result is { ok: true; value: T } {
  return result.ok;
}

/** The parsed value, or `fallback` if the input was rejected. */
export function unwrapOr<T>(result: ParseResult<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * The parsed value, or a thrown `Error`.
 *
 * For **trusted literals only** -- topology files, scenario scripts, the tables in this
 * folder -- where a rejection means a typo in the repository and should fail loudly at
 * import time. Never call this on user input; handle the `ParseResult` instead.
 */
export function unwrap<T>(result: ParseResult<T>, context = 'value'): T {
  if (!result.ok) {
    throw new Error(`invalid ${context}: ${result.error}`);
  }
  return result.value;
}
