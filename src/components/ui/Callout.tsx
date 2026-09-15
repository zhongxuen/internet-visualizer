import {
  Info,
  Lightbulb,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * A boxed aside in running content: a note, a tip, a warning, or a safety notice.
 *
 * Every tone is an icon *and* words, never a tint alone. The icon differs per tone, and
 * the tone's name is always in the heading: as the visible title when the caller gives
 * none, and after a custom title for a screen reader, which cannot see the icon.
 *
 * `safety` shares the `live` `SafetyBadge`'s hue on purpose -- it is the same warning, at
 * paragraph length -- and is told apart from `warning` by its shield and heavier edge.
 *
 * Not a live region, and not a landmark: it is part of the page's content, in reading
 * order, like the paragraph beside it. Something that has to be announced when it
 * appears belongs in the step caption, the view's one `aria-live` region.
 */

export type CalloutTone = 'info' | 'tip' | 'warning' | 'safety';

interface ToneSpec {
  name: string;
  icon: LucideIcon;
  box: string;
  iconClass: string;
}

const TONES: Record<CalloutTone, ToneSpec> = {
  info: {
    name: 'Note',
    icon: Info,
    box: 'border-accent/45 bg-accent/8',
    iconClass: 'text-accent',
  },
  tip: {
    name: 'Tip',
    icon: Lightbulb,
    box: 'border-state-ok/45 bg-state-ok/8',
    iconClass: 'text-state-ok',
  },
  warning: {
    name: 'Warning',
    icon: TriangleAlert,
    box: 'border-state-warn/45 bg-state-warn/8',
    iconClass: 'text-state-warn',
  },
  safety: {
    name: 'Safety',
    icon: ShieldAlert,
    box: 'border-state-warn/60 bg-state-warn/10 border-l-4',
    iconClass: 'text-state-warn',
  },
};

export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: CalloutTone;
  /** A short heading. Defaults to the tone's name ("Tip", "Warning"). */
  title?: ReactNode;
  children: ReactNode;
}

export function Callout({
  tone = 'info',
  title,
  className,
  children,
  ...props
}: CalloutProps) {
  const spec = TONES[tone];
  const Icon = spec.icon;

  return (
    <div
      // A tinted surface, so `.state-dim` must not reach inside it (see globals.css).
      data-no-dim=""
      data-tone={tone}
      className={cn('flex gap-3 rounded-lg border px-4 py-3', spec.box, className)}
      {...props}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 h-5 w-5 shrink-0', spec.iconClass)}
      />
      <div className="text-fg min-w-0 flex-1 text-sm leading-relaxed">
        <p className="text-fg font-semibold">
          {title ?? spec.name}
          {/* With a custom title, the tone's name still reaches a screen reader. */}
          {title ? <span className="sr-only"> ({spec.name})</span> : null}
        </p>
        <div className="text-fg-secondary mt-0.5">{children}</div>
      </div>
    </div>
  );
}
