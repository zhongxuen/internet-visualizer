'use client';

import { Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { formatDuration } from '@/components/viz';
import { cn } from '@/lib/cn';

import { NETWORK_PROFILES, type NetworkProfileId } from '../sim/stage';

/**
 * The link the page is fetched across -- five presets, and the same scenario on each.
 *
 * This control is the module's best argument, and it makes it by comparison rather than by
 * assertion. Every profile's load time for the *current* scenario is drawn at once, so the
 * claim "handshakes dominate on a slow link" is not a sentence a learner has to take on
 * trust; it is a row of bars where satellite is many times fiber while carrying more
 * bandwidth than 3G. Round trips, not bytes.
 *
 * Running all five is affordable because a run is a pure function of a scenario and a
 * profile: the module memoizes them together and this component only draws the numbers.
 */

export interface NetworkProfileControlsProps {
  value: NetworkProfileId;
  onChange: (id: NetworkProfileId) => void;
  /**
   * The current scenario's total load time on each profile, keyed by profile id.
   *
   * Optional so the control still works before the comparison runs exist; without it the
   * bars are simply absent and the presets still switch.
   */
  loadByProfile?: Readonly<Partial<Record<NetworkProfileId, number>>>;
  className?: string;
}

export function NetworkProfileControls({
  value,
  onChange,
  loadByProfile,
  className,
}: NetworkProfileControlsProps) {
  const times = NETWORK_PROFILES.map((profile) => loadByProfile?.[profile.id]).filter(
    (time): time is number => typeof time === 'number' && time > 0,
  );
  const slowest = times.length > 0 ? Math.max(...times) : 0;
  const fastest = times.length > 0 ? Math.min(...times) : 0;
  const active = NETWORK_PROFILES.find((profile) => profile.id === value);

  return (
    <Panel title="Network profile" className={cn('min-w-0', className)}>
      <div role="radiogroup" aria-label="Network profile" className="flex flex-col gap-1">
        {NETWORK_PROFILES.map((profile) => {
          const selected = profile.id === value;
          const load = loadByProfile?.[profile.id];
          const share = slowest > 0 && load ? Math.max(0.02, load / slowest) : 0;
          const multiple = fastest > 0 && load ? load / fastest : 0;

          return (
            <button
              key={profile.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(profile.id)}
              className={cn(
                'group grid w-full grid-cols-[7rem_minmax(0,1fr)_5rem] items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                focusRing,
                selected
                  ? 'border-accent/60 bg-accent/10'
                  : 'hover:bg-surface-overlay border-transparent',
              )}
            >
              <span className="min-w-0">
                <span
                  className={cn(
                    'block truncate text-sm font-medium',
                    selected ? 'text-fg' : 'text-fg-secondary',
                  )}
                >
                  {profile.label}
                </span>
                <span className="text-fg-muted block font-mono text-[0.625rem]">
                  {profile.rttMs} ms RTT
                </span>
              </span>

              {/*
                One bar per profile, all scaled against the slowest, so the comparison is
                between the profiles rather than against an abstract maximum.
              */}
              <span className="bg-surface border-border/60 relative block h-5 overflow-hidden rounded border">
                <span
                  aria-hidden="true"
                  className={cn(
                    'block h-full transition-[width] duration-300',
                    selected ? 'bg-accent/45' : 'bg-fg-muted/25',
                  )}
                  style={{ width: `${share * 100}%` }}
                />
              </span>

              <span className="text-right">
                <span
                  className={cn(
                    'block font-mono text-xs tabular-nums',
                    selected ? 'text-fg' : 'text-fg-secondary',
                  )}
                >
                  {load === undefined ? '--' : formatDuration(load)}
                </span>
                {multiple >= 1.05 ? (
                  <span className="text-fg-muted block font-mono text-[0.625rem] tabular-nums">
                    {multiple.toFixed(1)}x
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {active ? (
        <p className="text-fg-secondary mt-3 text-xs leading-relaxed">{active.note}</p>
      ) : null}

      <p className="text-fg-muted mt-2 text-[0.6875rem] leading-relaxed">
        Satellite carries more bandwidth than 3G and still loses badly. A page load is
        mostly round trips, and no amount of capacity shortens one -- which is the entire
        reason TLS 1.3, session resumption, HTTP/2, and connection reuse exist.
      </p>
    </Panel>
  );
}
