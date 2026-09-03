'use client';

import { RotateCcw } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  authoredMtu,
  authoredPayload,
  isAuthored,
  MAX_PAYLOAD_BYTES,
  MIN_PAYLOAD_BYTES,
  MTU_CHOICES,
  narrowestMtu,
  PAYLOAD_STEP_BYTES,
  TRANSPORT_CHOICES,
  type JourneyOptions,
} from '../options';
import type { JourneyScenario } from '../sim/journey';

/**
 * Which journey, and what to change about it.
 *
 * The four knobs the phase doc asks for -- transport, payload size, MTU, loss -- plus the
 * scenario they apply to, because a knob is only interesting next to the run it changes:
 * dropping the MTU to 1280 means nothing until you can see it turn one packet into two on
 * the diagram behind it.
 *
 * ## Every knob starts at "as authored"
 *
 * A scenario is a designed lesson, and the controls exist to let a learner ask "what if"
 * about it -- not to be the only way to get a sensible run. So nothing here is
 * pre-selected: each control reads *As authored* until it is turned, and one Reset puts
 * every one of them back. The mapping to the engine, including the two knobs that are
 * more than an assignment, is in `../options.ts`.
 *
 * ## Why the changes are printed, not just applied
 *
 * Each control says what the scenario itself does beside it (`Authored: 1500`), because
 * the interesting fact is usually the difference. The MTU control additionally prints the
 * *narrowest link on the path*, which is not always the number chosen -- a scenario may
 * pin one link lower -- and is the number that actually decides whether a packet is split.
 */

export interface JourneyControlsProps {
  scenarios: readonly JourneyScenario[];
  scenarioId: string;
  onScenarioChange: (id: string) => void;
  options: JourneyOptions;
  onOptionsChange: (options: JourneyOptions) => void;
  className?: string;
}

/** The shared shell for one labelled knob. */
function Control({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p className="text-fg-muted text-[0.6875rem] leading-snug">{hint}</p>
      ) : null}
    </div>
  );
}

const selectClasses = cn(
  'border-border bg-surface text-fg h-8 w-full rounded-md border px-2 text-xs',
  'hover:border-border-strong transition-colors',
  focusRing,
);

export function JourneyControls({
  scenarios,
  scenarioId,
  onScenarioChange,
  options,
  onOptionsChange,
  className,
}: JourneyControlsProps) {
  const baseId = useId();
  const scenario = scenarios.find((entry) => entry.id === scenarioId);

  if (!scenario) return null;

  const payload = options.payloadBytes ?? authoredPayload(scenario);
  const mtu = options.mtu ?? authoredMtu(scenario);
  const narrowest = narrowestMtu(scenario, options.mtu);
  const lossy = options.lossy ?? scenario.loss !== undefined;

  const set = (patch: Partial<JourneyOptions>) =>
    onOptionsChange({ ...options, ...patch });

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
        {scenarios.map((entry, index) => {
          const active = entry.id === scenarioId;

          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={active}
              onClick={() => onScenarioChange(entry.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                focusRing,
                active
                  ? 'border-accent/60 bg-accent/12 text-fg'
                  : 'border-border bg-surface-raised text-fg-secondary hover:border-border-strong hover:bg-surface-overlay hover:text-fg',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'font-mono text-[0.6875rem]',
                  active ? 'text-accent' : 'text-fg-muted',
                )}
              >
                {index + 1}
              </span>
              {entry.title}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-fg-secondary max-w-3xl text-sm leading-relaxed">
          {scenario.summary}
        </p>
        <ul aria-label="What this scenario teaches" className="flex flex-wrap gap-1.5">
          {scenario.teaches.map((topic) => (
            <li key={topic}>
              <Badge tone="neutral">{topic}</Badge>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-border bg-surface-raised flex flex-col gap-3 rounded-xl border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-fg-secondary text-xs font-medium tracking-widest uppercase">
            Change the run
          </h2>
          <button
            type="button"
            disabled={isAuthored(options)}
            onClick={() =>
              onOptionsChange({
                transport: null,
                payloadBytes: null,
                mtu: null,
                lossy: null,
              })
            }
            className={cn(
              'text-fg-muted hover:text-fg inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
              'disabled:pointer-events-none disabled:opacity-40',
              focusRing,
            )}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            Reset to the scenario
          </button>
        </div>

        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
          <Control
            label="Transport"
            htmlFor={`${baseId}-transport`}
            hint={
              options.transport === null
                ? `As authored: ${scenario.transport.toUpperCase()}`
                : options.transport === 'udp'
                  ? 'No handshake, no acknowledgements, no teardown — one datagram either way.'
                  : 'A connection first: SYN, SYN-ACK, ACK before a byte of data moves.'
            }
          >
            <select
              id={`${baseId}-transport`}
              className={selectClasses}
              value={options.transport ?? 'authored'}
              onChange={(event) =>
                set({
                  transport:
                    event.target.value === 'authored'
                      ? null
                      : (event.target.value as 'tcp' | 'udp'),
                })
              }
            >
              <option value="authored">
                As authored — {scenario.transport.toUpperCase()}
              </option>
              {TRANSPORT_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Control>

          <Control
            label="Payload"
            htmlFor={`${baseId}-payload`}
            hint={
              options.payloadBytes === null
                ? `As authored: ${scenario.writes.map((write) => write.bytes).join(', ')} bytes`
                : `Every write in the run sends ${payload} bytes.`
            }
          >
            <div className="flex items-center gap-2">
              <input
                id={`${baseId}-payload`}
                type="range"
                min={MIN_PAYLOAD_BYTES}
                max={MAX_PAYLOAD_BYTES}
                step={PAYLOAD_STEP_BYTES}
                value={payload}
                aria-valuetext={`${payload} bytes`}
                onChange={(event) => set({ payloadBytes: Number(event.target.value) })}
                className={cn('accent-accent h-8 min-w-0 flex-1', focusRing)}
              />
              <output
                htmlFor={`${baseId}-payload`}
                className={cn(
                  'w-16 shrink-0 text-right font-mono text-xs',
                  options.payloadBytes === null ? 'text-fg-muted' : 'text-fg',
                )}
              >
                {payload} B
              </output>
            </div>
          </Control>

          <Control
            label="Link MTU"
            htmlFor={`${baseId}-mtu`}
            hint={
              narrowest < mtu
                ? `Narrowest link on the path: ${narrowest} bytes — anything larger is split there.`
                : `Anything over ${narrowest} bytes has to be fragmented.`
            }
          >
            <select
              id={`${baseId}-mtu`}
              className={selectClasses}
              value={options.mtu ?? 'authored'}
              onChange={(event) =>
                set({
                  mtu:
                    event.target.value === 'authored' ? null : Number(event.target.value),
                })
              }
            >
              <option value="authored">
                As authored — {authoredMtu(scenario)} bytes
              </option>
              {MTU_CHOICES.map((choice) => (
                <option key={choice.bytes} value={choice.bytes}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Control>

          <Control
            label="Link loss"
            hint={
              lossy
                ? 'Nothing reports a lost packet. The sender finds out when its timer expires.'
                : 'Every packet that is sent arrives.'
            }
          >
            <button
              type="button"
              role="switch"
              aria-checked={lossy}
              onClick={() => set({ lossy: !lossy })}
              className={cn(
                'flex h-8 items-center gap-2 rounded-md border px-2 text-xs font-medium transition-colors',
                focusRing,
                lossy
                  ? 'border-state-warn/50 bg-state-warn/12 text-state-warn'
                  : 'border-border bg-surface text-fg-secondary hover:border-border-strong',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
                  lossy ? 'border-state-warn/60 bg-state-warn/30' : 'border-border',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-2.5 rounded-full transition-[left]',
                    lossy ? 'bg-state-warn left-3.5' : 'bg-border-strong left-0.5',
                  )}
                />
              </span>
              {lossy ? 'Dropping packets' : 'Reliable'}
            </button>
          </Control>
        </div>
      </div>
    </div>
  );
}
