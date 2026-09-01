import { Kbd } from '@/components/ui';
import { cn } from '@/lib/cn';

import { PLAYBACK_SHORTCUTS } from './keymap';

/**
 * The printed keyboard map.
 *
 * Rendered from the same `PLAYBACK_SHORTCUTS` table `matchPlaybackKey` is built on, so a
 * shortcut cannot exist without appearing here and cannot appear here without working.
 * Every module shows this legend, which is what makes the shortcuts worth learning once.
 *
 * A `<dl>` rather than a table: each row is one term (the keys) and its description
 * (what it does), which is what a screen reader should hear it as.
 */

export interface KeyboardLegendProps {
  className?: string;
}

export function KeyboardLegend({ className }: KeyboardLegendProps) {
  return (
    <dl
      className={cn(
        'grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-xs',
        className,
      )}
    >
      {PLAYBACK_SHORTCUTS.map((shortcut) => (
        <div key={shortcut.action} className="contents">
          <dt className="flex flex-wrap items-center gap-1">
            {shortcut.chords.map((chord, index) => (
              <span key={chord.join('+')} className="flex items-center gap-1">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-fg-muted">
                    /
                  </span>
                ) : null}
                <Kbd keys={chord} />
              </span>
            ))}
          </dt>
          <dd className="text-fg-secondary">{shortcut.action}</dd>
        </div>
      ))}
    </dl>
  );
}
