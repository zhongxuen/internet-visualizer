'use client';

import { Hash } from 'lucide-react';

import { Tooltip } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

/**
 * Show or hide the addresses on the diagram.
 *
 * The first time someone opens a topology, the numbers are the problem. Thirteen cards
 * each carrying an IPv4 address, an IPv6 address, and a MAC is forty rows of hexadecimal
 * before the learner knows what a gateway is -- and the shape of the network, which is
 * what they came for, is buried under it. Turning them off leaves the machines, the
 * roles, the layers, and the wires: the picture, without the data.
 *
 * Nothing is removed from the product. The addresses are still in the scenario, still in
 * the inspector for whichever machine is clicked, and still in the accessible name of
 * every node -- so a screen reader user is never handed the reduced version of the
 * diagram. This hides one layer of detail on the canvas, and only there.
 */

export interface AddressToggleProps {
  /** `true` when addresses are drawn on the node cards. */
  showAddresses: boolean;
  onChange: (next: boolean) => void;
  className?: string;
}

export function AddressToggle({
  showAddresses,
  onChange,
  className,
}: AddressToggleProps) {
  return (
    <Tooltip
      content={
        showAddresses
          ? 'Addresses are on the diagram. Hide them to read the shape of the network first \u2014 they stay in the inspector.'
          : 'Addresses are hidden on the diagram. Click any machine to see its addresses in the inspector, or show them all again.'
      }
    >
      <button
        type="button"
        role="switch"
        aria-checked={showAddresses}
        onClick={() => onChange(!showAddresses)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
          focusRing,
          showAddresses
            ? 'border-border-strong bg-surface-overlay text-fg'
            : 'border-border text-fg-muted hover:text-fg hover:border-border-strong',
          className,
        )}
      >
        <Hash aria-hidden="true" className="size-3.5" />
        Addresses
      </button>
    </Tooltip>
  );
}
