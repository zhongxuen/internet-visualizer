'use client';

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Keyboard,
  Pause,
  Play,
  Repeat1,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { usePauseAtSteps, usePreference } from '@/components/prefs';
import { buttonClasses, Popover, Switch } from '@/components/ui';
import { PLAYBACK_SPEEDS, type PlaybackStatus } from '@/core/sim/playback';
import { cn } from '@/lib/cn';

import { KeyboardLegend } from './KeyboardLegend';
import type { PlaybackCommand } from './keymap';

/**
 * The transport bar's controls (uiux-spec.md §5.3, stage rule 3).
 *
 * Every button emits a `PlaybackCommand`, the same value the keyboard map produces, so
 * the two routes into playback cannot drift apart: a shortcut that works is a button that
 * works. The component holds no playback state and knows nothing about stores; it renders
 * a status and reports intent. The one thing it does read is the viewer's "Pause after
 * each step" preference, because the switch *is* that preference.
 *
 * ## What is on it
 *
 * - **Back, Play, Next step**, labelled in words. Play is the page's primary action, so
 *   it is the largest thing here (at least 44px) and reads "Play", "Pause" or "Play
 *   again". The visible label is always inside the accessible name (WCAG 2.5.3).
 * - **The middle** is the view's: step dots and the timeline, passed as `children`.
 * - **Speed**, in a menu. Its options keep the plain "4x" names the browser suites press.
 * - **Pause after each step** and **Shortcuts** beside it at `lg`. Below `lg` they, and
 *   "Replay this step", go into one "More" menu, because a 390px bar has room for three
 *   labelled buttons and not for eight.
 *
 * "Replay this step" is `Repeat1` and "Play again" is `RotateCcw`: one replays a part and
 * the other the whole, and they used to share an icon.
 */

export interface PlaybackControlsProps {
  status: PlaybackStatus;
  speed: number;
  onCommand: (command: PlaybackCommand) => void;
  /** The middle of the bar: step dots and the timeline. */
  children?: ReactNode;
  /** Drop the shortcuts menu -- for a view that prints the legend elsewhere. */
  showLegend?: boolean;
  className?: string;
}

/** What the big button does next, given where playback is. */
export function playbackAction(status: PlaybackStatus): {
  icon: LucideIcon;
  label: string;
} {
  if (status === 'playing') return { icon: Pause, label: 'Pause' };
  if (status === 'ended') return { icon: RotateCcw, label: 'Play again' };
  return { icon: Play, label: 'Play' };
}

function PauseAtStepsSwitch({ className }: { className?: string }) {
  const pauseAtSteps = usePauseAtSteps();
  const [, setPauseAtSteps] = usePreference('pauseAtSteps');

  return (
    <Switch
      label="Pause after each step"
      checked={pauseAtSteps}
      onCheckedChange={setPauseAtSteps}
      className={className}
    />
  );
}

function ReplayStepButton({
  onCommand,
  withLabel = false,
  className,
}: {
  onCommand: (command: PlaybackCommand) => void;
  withLabel?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onCommand({ type: 'replay-phase' })}
      aria-label={withLabel ? undefined : 'Replay this step'}
      title="Replay this step (.)"
      className={buttonClasses({
        variant: 'ghost',
        className: cn(withLabel ? 'justify-start' : 'size-target px-0', className),
      })}
    >
      <Repeat1 aria-hidden="true" className="size-4 shrink-0" />
      {withLabel ? 'Replay this step' : null}
    </button>
  );
}

function SpeedMenu({
  speed,
  onCommand,
}: {
  speed: number;
  onCommand: (command: PlaybackCommand) => void;
}) {
  return (
    <Popover
      side="top"
      align="end"
      label="Playback speed"
      triggerVariant="ghost"
      triggerClassName="gap-1 px-2.5 font-mono"
      triggerProps={{ 'aria-label': `Speed ${speed}x`, title: 'Speed (1 to 5)' }}
      trigger={
        <>
          {speed}x
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </>
      }
    >
      {({ close }) => (
        <div role="group" aria-label="Playback speed" className="flex flex-col gap-1">
          {PLAYBACK_SPEEDS.map((option, index) => {
            const active = option === speed;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onCommand({ type: 'speed', speed: option });
                  close();
                }}
                aria-pressed={active}
                title={`Speed ${option}x (${index + 1})`}
                className={buttonClasses({
                  variant: active ? 'primary' : 'ghost',
                  size: 'sm',
                  className: 'min-w-20 justify-start font-mono',
                })}
              >
                {option}x
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

export function PlaybackControls({
  status,
  speed,
  onCommand,
  children,
  showLegend = true,
  className,
}: PlaybackControlsProps) {
  const action = playbackAction(status);

  return (
    <div
      className={cn(
        'grid items-center gap-x-4 gap-y-2 lg:grid-cols-[auto_minmax(0,1fr)_auto]',
        className,
      )}
    >
      <div
        role="group"
        aria-label="Playback"
        className="flex items-center gap-1.5 sm:gap-2"
      >
        <button
          type="button"
          onClick={() => onCommand({ type: 'step-phase', direction: -1 })}
          title="Back one step (Left arrow)"
          className={buttonClasses({ variant: 'secondary', className: 'px-3' })}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Back
        </button>

        <button
          type="button"
          onClick={() => onCommand({ type: 'toggle' })}
          // The same words as the label on screen, so a name spoken to a voice-control
          // tool is the name it finds.
          aria-label={action.label}
          title={`${action.label} (Space)`}
          data-transport-play=""
          /*
            One width whatever it says. "Play", "Pause" and "Play again" are different
            lengths, and a button that resized as playback changed state would push Next
            step and the timeline sideways mid-run: a layout shift, counted by CLS, that
            nobody asked for. Fixed at lg; below it, the space Back and Next step leave.
          */
          className={buttonClasses({
            className:
              'text-body h-12 min-w-0 flex-1 gap-2 px-3 whitespace-nowrap lg:w-40 lg:flex-none lg:gap-2.5',
          })}
        >
          <action.icon
            aria-hidden="true"
            // Filled for the play and pause shapes; a filled arrow is a blob.
            className={cn('size-5 shrink-0', status !== 'ended' && 'fill-current')}
          />
          {action.label}
        </button>

        <button
          type="button"
          onClick={() => onCommand({ type: 'step-phase', direction: 1 })}
          title="Next step (Right arrow)"
          className={buttonClasses({ variant: 'secondary', className: 'px-3' })}
        >
          Next step
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>

        <ReplayStepButton onCommand={onCommand} className="max-lg:hidden" />
      </div>

      <div className="flex min-w-0 items-center gap-3">
        {children}
        <SpeedMenu speed={speed} onCommand={onCommand} />

        <Popover
          side="top"
          align="end"
          label="More playback options"
          triggerVariant="ghost"
          triggerClassName="size-target px-0 lg:hidden"
          triggerProps={{ 'aria-label': 'More playback options' }}
          trigger={<Ellipsis aria-hidden="true" className="size-5" />}
        >
          <div className="flex w-72 max-w-full flex-col gap-2">
            <ReplayStepButton onCommand={onCommand} withLabel />
            <PauseAtStepsSwitch className="w-full" />
            {showLegend ? (
              <div className="border-border border-t pt-3">
                <KeyboardLegend />
              </div>
            ) : null}
          </div>
        </Popover>
      </div>

      <div className="hidden items-center gap-1 lg:flex">
        <PauseAtStepsSwitch />
        {showLegend ? (
          <Popover
            side="top"
            align="end"
            label="Keyboard shortcuts"
            triggerVariant="ghost"
            triggerClassName="size-target px-0"
            triggerProps={{ 'aria-label': 'Keyboard shortcuts' }}
            trigger={<Keyboard aria-hidden="true" className="size-5" />}
          >
            <KeyboardLegend />
          </Popover>
        ) : null}
      </div>
    </div>
  );
}
