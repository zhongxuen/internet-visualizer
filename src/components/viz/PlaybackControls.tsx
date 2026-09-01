'use client';

import {
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  type LucideIcon,
} from 'lucide-react';

import { PLAYBACK_SPEEDS, type PlaybackStatus } from '@/core/sim/playback';
import { cn } from '@/lib/cn';

import { KeyboardLegend } from './KeyboardLegend';
import type { PlaybackCommand } from './keymap';

/**
 * Play, pause, step, jump, speed -- and the legend that says which key does each.
 *
 * Every button emits a `PlaybackCommand`, the same value the keyboard map produces, so
 * the two routes into playback cannot drift apart: a shortcut that works is a button that
 * works. The component itself holds no state and knows nothing about stores; it renders
 * a status and reports intent.
 *
 * Each control names its shortcut in its tooltip, and the full map is one disclosure
 * away, because a keyboard-driven visualization that does not advertise its keys is a
 * mouse-driven one.
 */

export interface PlaybackControlsProps {
  status: PlaybackStatus;
  speed: number;
  onCommand: (command: PlaybackCommand) => void;
  /** Drop the shortcut disclosure -- for a module that prints the legend elsewhere. */
  showLegend?: boolean;
  className?: string;
}

const BUTTON =
  'text-fg-secondary hover:bg-surface-overlay hover:text-fg focus-visible:outline-focus inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2';

function ControlButton({
  icon: Icon,
  label,
  hint,
  onClick,
  className,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={`${label} (${hint})`}
      className={cn(BUTTON, className)}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}

/** What the big button does next, given where playback is. */
function playbackAction(status: PlaybackStatus) {
  if (status === 'playing') return { icon: Pause, label: 'Pause' };
  if (status === 'ended') return { icon: RotateCcw, label: 'Play again' };
  return { icon: Play, label: 'Play' };
}

export function PlaybackControls({
  status,
  speed,
  onCommand,
  showLegend = true,
  className,
}: PlaybackControlsProps) {
  const action = playbackAction(status);

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <div className="flex items-center gap-1" role="group" aria-label="Playback">
        <ControlButton
          icon={SkipBack}
          label="Jump to the start"
          hint="Home"
          onClick={() => onCommand({ type: 'jump', to: 'start' })}
        />
        <ControlButton
          icon={ChevronLeft}
          label="Previous phase"
          hint="Left arrow"
          onClick={() => onCommand({ type: 'step-phase', direction: -1 })}
        />

        <button
          type="button"
          onClick={() => onCommand({ type: 'toggle' })}
          aria-label={action.label}
          title={`${action.label} (Space)`}
          className={cn(
            BUTTON,
            'bg-accent text-accent-ink hover:bg-accent-strong hover:text-accent-ink size-9',
          )}
        >
          <action.icon aria-hidden="true" className="size-4" />
        </button>

        <ControlButton
          icon={ChevronRight}
          label="Next phase"
          hint="Right arrow"
          onClick={() => onCommand({ type: 'step-phase', direction: 1 })}
        />
        <ControlButton
          icon={SkipForward}
          label="Jump to the end"
          hint="End"
          onClick={() => onCommand({ type: 'jump', to: 'end' })}
        />
        <ControlButton
          icon={RotateCcw}
          label="Replay the current phase"
          hint="Period"
          onClick={() => onCommand({ type: 'replay-phase' })}
        />
      </div>

      <div
        role="group"
        aria-label="Playback speed"
        className="border-border bg-surface-overlay/60 flex items-center gap-0.5 rounded-md border p-0.5"
      >
        {PLAYBACK_SPEEDS.map((option, index) => {
          const active = option === speed;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onCommand({ type: 'speed', speed: option })}
              aria-pressed={active}
              title={`Speed ${option}x (${index + 1})`}
              className={cn(
                'focus-visible:outline-focus rounded px-1.5 py-0.5 font-mono text-[0.6875rem] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1',
                active
                  ? 'bg-accent text-accent-ink'
                  : 'text-fg-muted hover:text-fg hover:bg-surface-overlay',
              )}
            >
              {option}x
            </button>
          );
        })}
      </div>

      {showLegend ? (
        <details className="group ml-auto">
          <summary
            className={cn(
              'text-fg-secondary hover:text-fg focus-visible:outline-focus flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2',
            )}
          >
            <Keyboard aria-hidden="true" className="size-3.5" />
            Shortcuts
          </summary>
          <div className="border-border bg-surface-overlay mt-2 rounded-lg border p-3">
            <KeyboardLegend />
          </div>
        </details>
      ) : null}
    </div>
  );
}
