'use client';

import { useEffect, useState } from 'react';

import { useReducedMotionSafe } from '@/components/motion';
import { Badge, Panel, type BadgeTone } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  cacheStats,
  isExpired,
  remainingSeconds,
  type CacheEntryKind,
  type DnsCache,
  type DnsCacheEntry,
} from '../sim/cache';
import { displayName, rdataText } from '../sim/records';

/**
 * The resolver's memory, counting down.
 *
 * A TTL is a number in a record until you watch one run out, and this panel exists to
 * make that the ordinary experience rather than a footnote. Every entry the run put in
 * the cache is here with the time it has left, and when that reaches zero the entry stops
 * being an answer -- it is struck through rather than removed, because "it was here and
 * now it is not" is the fact worth seeing.
 *
 * Negative entries sit in the same list as positive ones, which is the point of RFC 2308:
 * "there is no such name" is an answer, it comes with an SOA that licenses caching it,
 * and a resolver that threw it away would re-walk the tree for every typo on the
 * Internet.
 *
 * ## Two clocks
 *
 * The run's clock is virtual milliseconds and the whole walk takes about a tenth of a
 * second, so nothing would ever expire inside it: the shortest TTL in the fixtures is
 * thirty seconds and the longest is two days. So the panel adds a second clock of its own
 * -- real time since it was mounted, multiplied by a rate the reader picks -- and shows
 * the sum. The header says how far past the playhead that has run, so the number is never
 * mistaken for part of the simulation.
 *
 * Nothing here writes to the cache. The entries are the run's own, and moving this clock
 * forward changes what is *shown* about them, not what the resolver did.
 */

export interface CachePanelProps {
  /** The cache as the run left it. */
  cache: DnsCache;
  /** The playhead, in virtual milliseconds -- the base this panel's clock adds to. */
  virtualTime: number;
  className?: string;
}

/** How fast the reader wants cache time to pass, in cache-seconds per real second. */
const RATES: readonly { value: number; label: string; hint: string }[] = [
  { value: 0, label: 'Hold', hint: 'Frozen at the playhead.' },
  { value: 1, label: '1×', hint: 'Real time: one second per second.' },
  {
    value: 60,
    label: '60×',
    hint: 'A minute a second — negative entries expire in view.',
  },
  {
    value: 3600,
    label: '3600×',
    hint: 'An hour a second — even the NS records age out.',
  },
];

const DEFAULT_RATE = 1;

/** How often the countdown redraws. A second is the resolution a TTL is quoted in. */
const TICK_MS = 250;

const KIND_LABELS: Readonly<Record<CacheEntryKind, string>> = {
  positive: 'Answer',
  nodata: 'NODATA',
  nxdomain: 'NXDOMAIN',
};

const KIND_TONES: Readonly<Record<CacheEntryKind, BadgeTone>> = {
  positive: 'ok',
  nodata: 'warn',
  nxdomain: 'error',
};

/** `1d 4h`, `12m 30s`, `9s` -- the largest two units, which is how a TTL is read. */
export function formatTtl(seconds: number): string {
  if (seconds <= 0) return 'expired';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

/** What an entry holds, in one line: the answer, or the SOA that licensed caching "no". */
function entryValue(entry: DnsCacheEntry): string {
  if (entry.records.length > 0) {
    return entry.records.map((record) => rdataText(record.data)).join(', ');
  }
  return entry.soa ? `SOA ${displayName(entry.soa.name)}` : '—';
}

export function CachePanel({ cache, virtualTime, className }: CachePanelProps) {
  const { reduced } = useReducedMotionSafe();
  const [rate, setRate] = useState(DEFAULT_RATE);

  // The drift is stamped with the cache it belongs to rather than reset by an effect: a
  // new run is a new cache, and elapsed time against the old one means nothing against
  // this one. Comparing during render is React's own answer to "reset state when a prop
  // changes", and it avoids a frame of the wrong numbers.
  const [drift, setDrift] = useState<{ cache: DnsCache; ms: number }>(() => ({
    cache,
    ms: 0,
  }));
  const driftMs = drift.cache === cache ? drift.ms : 0;

  useEffect(() => {
    if (rate === 0) return;
    const timer = setInterval(() => {
      setDrift((previous) => ({
        cache,
        ms: (previous.cache === cache ? previous.ms : 0) + TICK_MS * rate,
      }));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [cache, rate]);

  const now = virtualTime + driftMs;

  // An entry appears when the run put it there, not when the run finished: a cache that
  // showed every row it would ever hold would be showing the answer before the question.
  // Insertion is judged by the playhead; expiry by the panel's own clock, which is the
  // only one that moves far enough for a TTL to matter.
  const visible = cache.entries.filter((entry) => entry.insertedAt <= virtualTime);

  const stats = cacheStats({ ...cache, entries: visible }, now);

  // Soonest to expire first among the live ones, then whatever has already gone. A cache
  // is read by what is about to disappear from it.
  const entries = [...visible].sort((a, b) => {
    const dead = Number(isExpired(a, now)) - Number(isExpired(b, now));
    return dead !== 0 ? dead : a.expiresAt - b.expiresAt;
  });

  return (
    <Panel
      title="Resolver cache"
      aside={
        <span className="text-fg-muted text-[0.6875rem]">
          {stats.total} live · {stats.negative} negative
          {stats.expired > 0 ? ` · ${stats.expired} expired` : ''}
        </span>
      }
      scroll
      flush
      className={cn('max-h-[26rem]', className)}
    >
      <div className="border-border/60 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div role="group" aria-label="Cache clock speed" className="flex gap-1">
          {RATES.map((choice) => {
            const active = rate === choice.value;

            return (
              <button
                key={choice.value}
                type="button"
                aria-pressed={active}
                title={choice.hint}
                onClick={() => setRate(choice.value)}
                className={cn(
                  'rounded-md border px-2 py-1 font-mono text-[0.625rem] transition-colors',
                  focusRing,
                  active
                    ? 'border-accent/60 bg-accent/12 text-fg'
                    : 'border-border bg-surface text-fg-secondary hover:border-border-strong',
                )}
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        <p className="text-fg-muted text-[0.625rem]">
          {driftMs > 0
            ? `${formatTtl(driftMs / 1000)} past the playhead`
            : 'At the playhead'}
        </p>
      </div>

      {entries.length === 0 ? (
        <p className="text-fg-muted px-3 py-3 text-xs leading-snug">
          Empty. Nothing has been learned yet — the resolver knows only the root hints,
          which are configuration rather than cache.
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">
            Everything this run put in the resolver&apos;s cache, with the time each entry
            has left before it expires.
          </caption>
          <thead className="bg-surface-raised sticky top-0 z-10">
            <tr className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              {['Name', 'Type', 'Kind', 'Value', 'TTL left'].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className={cn(
                    'border-border border-b px-2 py-2 font-medium whitespace-nowrap',
                    heading === 'TTL left' && 'text-right',
                  )}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {entries.map((entry) => {
              const left = remainingSeconds(entry, now);
              const dead = left <= 0;
              const fraction = entry.ttlSeconds > 0 ? left / entry.ttlSeconds : 0;

              return (
                <tr
                  key={entry.key}
                  className={cn(
                    'border-border/40 border-t align-top',
                    dead && 'text-fg-muted line-through opacity-60',
                  )}
                >
                  <td className="px-2 py-1.5 font-mono break-all">
                    {displayName(entry.name)}
                  </td>
                  <td className="text-accent px-2 py-1.5 font-mono">{entry.type}</td>
                  <td className="px-2 py-1.5">
                    <Badge tone={dead ? 'neutral' : KIND_TONES[entry.kind]}>
                      {KIND_LABELS[entry.kind]}
                    </Badge>
                  </td>
                  <td className="text-fg-secondary px-2 py-1.5 font-mono break-all">
                    {entryValue(entry)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <span className="font-mono tabular-nums">{formatTtl(left)}</span>
                    <span
                      aria-hidden="true"
                      className="bg-surface-overlay mt-1 block h-1 w-16 overflow-hidden rounded-full"
                    >
                      <span
                        style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
                        className={cn(
                          'block h-full',
                          dead ? 'bg-border' : 'bg-accent/70',
                          !reduced && 'transition-[width] duration-200 ease-linear',
                        )}
                      />
                    </span>
                    <span className="text-fg-muted mt-0.5 block font-mono text-[0.5625rem]">
                      of {formatTtl(entry.ttlSeconds)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
