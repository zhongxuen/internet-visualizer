'use client';

import { cn } from '@/lib/cn';

import { DialogSurface, type DialogProps } from './Dialog';

/**
 * A `Dialog` that slides in from the edge: the mobile navigation, and the Steps,
 * Details and Go deeper panels on a phone (docs/implementation/uiux.md §5.3).
 *
 * Everything `Dialog` promises holds here, because it is the same component -- native
 * `showModal()`, Escape, the close button, the backdrop click, focus returned to the
 * opener. Only the box differs:
 *
 * - **From `sm` up** it is a full-height sheet on the `side` edge.
 * - **Under `sm`** it is a bottom sheet whatever `side` says. On a phone a side sheet
 *   covers most of the screen anyway, and the bottom is where the thumb already is.
 *
 * The slide is one custom property, `--drawer-from`, set per breakpoint and per side, so
 * the open, closed and `@starting-style` states each name one value rather than a pair
 * of axes that have to be kept consistent at every breakpoint.
 */

export interface DrawerProps extends DialogProps {
  /** Which edge it slides from, from `sm` up. */
  side?: 'left' | 'right';
}

const SIDE: Record<NonNullable<DrawerProps['side']>, string> = {
  left: 'sm:left-0 sm:right-auto sm:border-r sm:[--drawer-from:-100%_0]',
  right: 'sm:right-0 sm:left-auto sm:border-l sm:[--drawer-from:100%_0]',
};

export function Drawer({ side = 'left', ...props }: DrawerProps) {
  return (
    <DialogSurface
      {...props}
      surfaceClassName={cn(
        // `m-0` and the `max-*` resets undo the UA's centred-dialog box.
        'fixed m-0 max-w-none',
        // Phone: a bottom sheet.
        'inset-x-0 top-auto bottom-0 max-h-[85dvh] w-full rounded-t-xl border-x-0 border-b-0 [--drawer-from:0_100%]',
        // `sm` and up: a full-height side sheet.
        'sm:inset-y-0 sm:h-dvh sm:max-h-none sm:w-[min(22rem,calc(100vw_-_3rem))] sm:rounded-none sm:border-y-0',
        SIDE[side],
        // An arbitrary property, not `translate-(--drawer-from)`: that utility writes the
        // variable to both axes, and `--drawer-from` already holds both.
        '[translate:var(--drawer-from)] open:[translate:none] starting:open:[translate:var(--drawer-from)]',
        'transition-[translate,display,overlay] transition-discrete duration-(--dur-base) ease-out',
      )}
    />
  );
}
