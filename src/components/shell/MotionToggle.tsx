'use client';

import { Zap, ZapOff } from 'lucide-react';

import { useReducedMotionSafe } from '@/components/motion';
import { Tooltip } from '@/components/ui/Tooltip';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

/**
 * The manual motion override the reduced-motion policy calls for: some users want the
 * animation for one sitting without editing their OS settings, and some want it gone
 * without ever having set the OS flag.
 *
 * A `switch`, not a menu — there are exactly two states a user cares about. Choosing
 * either one pins the session; the OS setting still supplies the starting value.
 *
 * Turning motion down never removes content. Simulations keep running and stay fully
 * explorable; only the tweening between states goes away.
 */
export interface MotionToggleProps {
  className?: string;
}

export function MotionToggle({ className }: MotionToggleProps) {
  const { reduced, setPreference } = useReducedMotionSafe();

  const label = reduced ? 'Motion: reduced' : 'Motion: full';

  return (
    <Tooltip
      content={
        reduced
          ? 'Animation is off. Simulations still run and every step is still shown — only the movement between states is removed. Turn motion on.'
          : 'Animation is on. Turn it off to jump straight to each step without tweening.'
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={reduced}
        aria-label={label}
        onClick={() => setPreference(reduced ? 'full' : 'reduced')}
        className={cn(
          'text-fg-secondary hover:text-fg hover:bg-surface-overlay inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
          focusRing,
          className,
        )}
      >
        {reduced ? (
          <ZapOff aria-hidden="true" className="size-4" />
        ) : (
          <Zap aria-hidden="true" className="text-accent size-4" />
        )}
        <span className="hidden md:inline">{reduced ? 'Reduced' : 'Full'}</span>
      </button>
    </Tooltip>
  );
}
