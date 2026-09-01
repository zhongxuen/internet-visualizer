/**
 * Printing virtual time.
 *
 * Every number the playback UI shows is **virtual** milliseconds -- what the simulated
 * network took, never what the animation took. The distinction matters enough to be
 * worth one shared formatter: a DNS lookup is 40 ms whether it is being watched at 0.25x
 * or 4x, and a timeline that quietly printed real elapsed time would teach the wrong
 * thing.
 *
 * Both readings on the scrubber pass through `formatTimecode` with the same
 * `durationMs`, so the elapsed and total figures are always in the same unit and the
 * left-hand number does not switch units under the cursor while scrubbing.
 */

/** Runs shorter than this are printed in milliseconds; longer ones in seconds. */
const SECONDS_THRESHOLD_MS = 1000;

/**
 * A position on a timeline, in the unit that suits the run as a whole.
 *
 * `durationMs` decides the unit, not `ms`, which is what keeps `0.00 s / 1.20 s`
 * from reading as `0 ms / 1.20 s`.
 */
export function formatTimecode(ms: number, durationMs: number): string {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;

  if (durationMs >= SECONDS_THRESHOLD_MS) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

/** A duration on its own -- a phase length, a link latency, a hop time. */
export function formatDuration(ms: number): string {
  const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (value >= SECONDS_THRESHOLD_MS) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

/** `0`..`100`, for a CSS percentage. Safe on a zero-length run. */
export function percentOf(ms: number, durationMs: number): number {
  if (!(durationMs > 0) || !Number.isFinite(ms)) return 0;
  return Math.min(100, Math.max(0, (ms / durationMs) * 100));
}
