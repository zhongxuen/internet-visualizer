import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import {
  layerColor,
  layerLabel,
  layerShortLabel,
  layerTint,
  type LayerKey,
} from '@/lib/theme';

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'error' | 'pending';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-border bg-surface-overlay text-fg-secondary',
  accent: 'border-accent/40 bg-accent/15 text-accent',
  ok: 'border-state-ok/40 bg-state-ok/15 text-state-ok',
  warn: 'border-state-warn/40 bg-state-warn/15 text-state-warn',
  error: 'border-state-error/40 bg-state-error/15 text-state-error',
  pending: 'border-state-pending/40 bg-state-pending/15 text-state-pending',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /**
   * Colour this badge for an OSI layer. Colours come from `@/lib/theme`, never from a
   * literal, and the `L2`..`L7` short label is rendered automatically so the meaning
   * survives without colour.
   */
  layer?: LayerKey;
  /** Decorative leading glyph; the badge text still has to carry the meaning. */
  icon?: ReactNode;
}

/** Pill used for topics, protocol layers, and status. */
export function Badge({
  tone = 'neutral',
  layer,
  icon,
  className,
  children,
  style,
  ...props
}: BadgeProps) {
  const layerStyle = layer
    ? {
        color: layerColor(layer),
        backgroundColor: layerTint(layer),
        borderColor: layerTint(layer, 45),
      }
    : undefined;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        layer ? 'border' : TONES[tone],
        className,
      )}
      style={{ ...layerStyle, ...style }}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {layer ? (
        <span className="font-mono text-[0.65rem] tracking-wider opacity-90">
          {layerShortLabel(layer)}
        </span>
      ) : null}
      {children ?? (layer ? layerLabel(layer) : null)}
    </span>
  );
}
