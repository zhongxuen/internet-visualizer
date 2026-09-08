import { FlaskConical, Radio } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';

/**
 * The visual half of the security rule in CLAUDE.md: a user must never be unsure
 * whether an action touches a real network.
 *
 * Two variants, and there will only ever be two. Anything in between ("mostly
 * simulated", "live but read-only") is exactly the ambiguity this component exists to
 * remove.
 *
 *  - `simulated` — muted and calm. The default everywhere, because everything in this
 *    product is a deterministic client-side simulation.
 *  - `live` — a different colour, a different icon, and a tooltip that says outright
 *    that packets leave the machine.
 *
 * Any surface that can cause a real network request renders the `live` variant. That
 * rule is re-checked in phase 12, when Network Diagnostics gains its opt-in live mode.
 */
export type SafetyVariant = 'simulated' | 'live';

interface VariantSpec {
  label: string;
  tooltip: string;
  icon: typeof FlaskConical;
  className: string;
}

const VARIANTS: Record<SafetyVariant, VariantSpec> = {
  simulated: {
    label: 'Simulated',
    tooltip:
      'Runs entirely in your browser. No packets leave this machine and no real host is contacted.',
    icon: FlaskConical,
    // Deliberately the quietest chip in the product: the safe state should read as
    // background information, not as a warning.
    className: 'border-border bg-surface-overlay text-fg-muted',
  },
  live: {
    label: 'Live network',
    tooltip:
      'This touches a real network: it sends requests from the server to the host you name. Only use targets you own or are authorised to test.',
    icon: Radio,
    // Distinct hue, distinct icon, and the word "Live" — three signals, so the
    // meaning survives colour blindness, a greyscale screenshot, and a glance.
    className: 'border-state-warn/50 bg-state-warn/15 text-state-warn',
  },
};

export interface SafetyBadgeProps {
  variant?: SafetyVariant;
  /** Hide the text and keep the icon. Only for dense rows that repeat the badge. */
  compact?: boolean;
  /**
   * Drop the tooltip and the tab stop, for a badge rendered *inside* something already
   * focusable -- the nav's module links are the case this exists for.
   *
   * The default badge is a tooltip trigger with `tabIndex={0}`, which is the only way a
   * keyboard user reads the `live` warning. Nested inside a link that is itself the
   * thing being described, that same trigger is wrong twice over: interactive content
   * inside an `<a>`, and -- since those links are `role="menuitem"` in a `role="menu"`
   * -- a focusable stop in the tab order that is not a menu item, which is what stops
   * Tab from leaving the menu.
   *
   * Nothing is lost by dropping it there. The badge sits inside the link's own label,
   * so the word "Live network" is read out as part of the link rather than as a
   * separate stop after it, and the hue and the icon are unchanged. The full sentence
   * still belongs to the surface that can actually make the request, and phase 12 puts
   * it there: the module's mode switch and its live console both carry the real badge.
   */
  interactive?: boolean;
  className?: string;
}

export function SafetyBadge({
  variant = 'simulated',
  compact = false,
  interactive = true,
  className,
}: SafetyBadgeProps) {
  const spec = VARIANTS[variant];
  const Icon = spec.icon;

  const badge = (
    <Badge
      // Focusable so the tooltip is reachable by keyboard, which is the only way
      // the `live` warning gets read by someone not using a mouse.
      tabIndex={interactive ? 0 : undefined}
      data-variant={variant}
      aria-label={compact ? spec.label : undefined}
      className={cn('cursor-default', spec.className, className)}
      icon={<Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />}
    >
      {compact ? null : spec.label}
    </Badge>
  );

  return interactive ? <Tooltip content={spec.tooltip}>{badge}</Tooltip> : badge;
}

/** The badge a module's chrome should show, given its registry entry. */
export function safetyVariantFor(usesRealNetwork: boolean): SafetyVariant {
  return usesRealNetwork ? 'live' : 'simulated';
}
