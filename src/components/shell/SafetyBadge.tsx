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
  className?: string;
}

export function SafetyBadge({
  variant = 'simulated',
  compact = false,
  className,
}: SafetyBadgeProps) {
  const spec = VARIANTS[variant];
  const Icon = spec.icon;

  return (
    <Tooltip content={spec.tooltip}>
      <Badge
        // Focusable so the tooltip is reachable by keyboard, which is the only way
        // the `live` warning gets read by someone not using a mouse.
        tabIndex={0}
        data-variant={variant}
        aria-label={compact ? spec.label : undefined}
        className={cn('cursor-default', spec.className, className)}
        icon={<Icon aria-hidden="true" className="size-3.5" strokeWidth={2.25} />}
      >
        {compact ? null : spec.label}
      </Badge>
    </Tooltip>
  );
}

/** The badge a module's chrome should show, given its registry entry. */
export function safetyVariantFor(usesRealNetwork: boolean): SafetyVariant {
  return usesRealNetwork ? 'live' : 'simulated';
}
