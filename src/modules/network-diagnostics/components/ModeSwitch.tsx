'use client';

import { FlaskConical, Radio, ShieldAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { SafetyBadge } from '@/components/shell';
import { Button } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

/**
 * The boundary between the two halves of this module, and the gate in front of the live
 * one.
 *
 * Three rules from the phase doc are implemented here rather than described anywhere:
 *
 * - **Learn is the default.** The parent owns `mode` and initialises it to `'learn'`;
 *   this component has no way to start anywhere else, and nothing is persisted, so a
 *   reload also lands in Learn mode. That is the safe direction of forgetting.
 * - **Live requires an explicit acknowledgement that states what will happen.** Pressing
 *   *Live mode* while un-acknowledged does not switch anything: it opens the panel below,
 *   which lists what a live run does, what it refuses to do, and who is responsible for
 *   the target. The switch happens on the confirm button, and only with the checkbox
 *   ticked.
 * - **The badge is never ambiguous.** It sits inside the switch, reading the same `mode`
 *   the switch does, so the thing that says which mode you are in and the thing that
 *   changes it cannot disagree.
 *
 * The acknowledgement is once per session and lives in the parent's state. Re-prompting
 * on every entry to Live mode would train people to dismiss it, which is worse than
 * asking once and meaning it.
 */

export type DiagnosticsMode = 'learn' | 'live';

export interface ModeSwitchProps {
  mode: DiagnosticsMode;
  onModeChange: (mode: DiagnosticsMode) => void;
  /** True once the user has confirmed the gate. Owned by the parent, never persisted. */
  acknowledged: boolean;
  onAcknowledge: () => void;
  className?: string;
}

/** What a live run does. Every line is a property the code actually enforces. */
const WHAT_HAPPENS: readonly { text: string; enforcedBy: string }[] = [
  {
    text: 'This app’s server makes the request, not your browser. The target sees the server’s address, and your browser never connects to it.',
    enforcedBy: 'Route Handlers under /api/diagnostics',
  },
  {
    text: 'One target, one request, each time you press Run. There are no ranges, no CIDR blocks, no port lists, and no repeats — this module cannot be used to scan.',
    enforcedBy: 'readSingleParam + the target validators',
  },
  {
    text: 'Only three read-only operations exist: a DNS query to one public resolver, a registration lookup at the registry IANA names, and a single HTTP HEAD.',
    enforcedBy: 'GET-only routes, HEAD-only reachability',
  },
  {
    text: 'Private, loopback, link-local, and cloud metadata addresses are refused — after the name is resolved, so a name that points at one is refused too.',
    enforcedBy: 'src/core/net/guard.ts',
  },
  {
    text: 'Runs are rate limited, and a failure is shown to you exactly as it happened. Nothing is retried on your behalf.',
    enforcedBy: 'src/core/net/ratelimit.ts',
  },
];

/** One segment of the switch. */
function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
  caption,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FlaskConical;
  label: string;
  caption: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-1 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
        focusRing,
        active
          ? 'border-accent/60 bg-accent/12'
          : 'border-border bg-surface-raised hover:border-border-strong hover:bg-surface-overlay',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', active ? 'text-accent' : 'text-fg-muted')}
        strokeWidth={2.25}
      />
      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm font-medium',
            active ? 'text-fg' : 'text-fg-secondary',
          )}
        >
          {label}
        </span>
        <span className="text-fg-muted block text-xs leading-relaxed">{caption}</span>
      </span>
    </button>
  );
}

export function ModeSwitch({
  mode,
  onModeChange,
  acknowledged,
  onAcknowledge,
  className,
}: ModeSwitchProps) {
  // Whether the gate is open, and whether its one condition is met. Both reset when the
  // panel closes, so a cancelled acknowledgement leaves nothing half-agreed behind.
  const [gateOpen, setGateOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const checkboxId = useId();
  const headingId = useId();

  function requestLive() {
    if (acknowledged) {
      onModeChange('live');
      return;
    }
    setAgreed(false);
    setGateOpen(true);
  }

  function closeGate() {
    setGateOpen(false);
    setAgreed(false);
  }

  function confirm() {
    if (!agreed) return;
    onAcknowledge();
    onModeChange('live');
    closeGate();
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Mode" className="flex min-w-0 flex-1 gap-2">
          <ModeButton
            active={mode === 'learn'}
            onClick={() => {
              closeGate();
              onModeChange('learn');
            }}
            icon={FlaskConical}
            label="Learn mode"
            caption="Four simulated tools. Nothing leaves this machine."
          />
          <ModeButton
            active={mode === 'live'}
            onClick={requestLive}
            icon={Radio}
            label="Live mode"
            caption="Three read-only lookups, made by this app’s server."
          />
        </div>
        {/*
          One badge, reading the same state the buttons do. In Learn mode it says
          Simulated because nothing in that half can reach a network; in Live mode it
          says Live network for as long as that mode is active.
        */}
        <SafetyBadge variant={mode === 'live' ? 'live' : 'simulated'} />
      </div>

      {/*
        The page header carries its own badge, drawn from the registry, and for this one
        module that badge reads "Live network" in both modes -- it is a statement about
        what the module is capable of, which is what the nav and the home page card need.
        On this screen that could be read as a claim about what is happening right now, so
        the difference is stated rather than left to be inferred. Being wrong about which
        mode you are in is exactly the mistake the badge exists to prevent, and an
        explanation costs one line.
      */}
      <p className="text-fg-muted text-xs leading-relaxed">
        {mode === 'live'
          ? 'Live mode is on. A request is made by this app’s server when you press Run — one at a time, never automatically, and never retried. Switch back to Learn mode to work entirely offline again.'
          : 'You are in Learn mode: everything below is a simulation running in your browser. The “Live network” badge in the page header means this module can reach a network in Live mode, not that anything here does.'}
      </p>

      {gateOpen ? (
        <section
          aria-labelledby={headingId}
          className="border-state-warn/50 bg-state-warn/8 flex flex-col gap-3 rounded-xl border p-4"
        >
          <div className="flex items-start gap-2.5">
            <ShieldAlert
              aria-hidden="true"
              className="text-state-warn mt-0.5 size-5 shrink-0"
              strokeWidth={2.25}
            />
            <div className="min-w-0">
              <h3 id={headingId} className="text-fg text-sm font-semibold">
                Live mode makes real network requests. Here is exactly what happens.
              </h3>
              <p className="text-fg-secondary mt-1 text-sm leading-relaxed">
                Everything else in this product is a simulation running in your browser.
                This is the one exception, and it stays off until you turn it on.
              </p>
            </div>
          </div>

          <ul className="flex flex-col gap-2.5">
            {WHAT_HAPPENS.map((item) => (
              <li key={item.enforcedBy} className="flex flex-col gap-0.5">
                <span className="text-fg-secondary text-sm leading-relaxed">
                  {item.text}
                </span>
                <span className="text-fg-muted font-mono text-[0.6875rem]">
                  {item.enforcedBy}
                </span>
              </li>
            ))}
          </ul>

          <label
            htmlFor={checkboxId}
            className="border-border bg-surface-raised flex cursor-pointer items-start gap-2.5 rounded-lg border p-3"
          >
            <input
              id={checkboxId}
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              className={cn('accent-accent mt-0.5 size-4 shrink-0', focusRing)}
            />
            <span className="text-fg text-sm leading-relaxed">
              I will only look up targets I own or am authorised to test, and I understand
              these requests are made from this app’s server on my behalf.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            {/* Disabled, not hidden: the reason the button will not work is the checkbox
                directly above it, and hiding it would make that harder to see. */}
            <Button size="sm" disabled={!agreed} onClick={confirm}>
              Enable Live mode
            </Button>
            <Button size="sm" variant="secondary" onClick={closeGate}>
              Stay in Learn mode
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
