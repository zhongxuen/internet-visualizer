import type { SimNode } from '@/core/types/topology';
import { cn } from '@/lib/cn';

import { useAddressVisibility } from '../display';

/**
 * The addresses a machine answers to, read straight off the `SimNode`.
 *
 * Only fields the scenario actually set are drawn: a switch that is transparent at
 * layer 3 shows a MAC and nothing else, and a teaching scenario that leaves IPv6 out to
 * keep the diagram readable simply has no IPv6 row. Nothing is invented here — if it is
 * on screen it is in the topology.
 *
 * A `<dl>` rather than divs so the label/value pairing is real for a screen reader.
 *
 * A view may hide addressing across the whole canvas (`AddressVisibilityContext`), which
 * is what the Network Map's address toggle does. `always` opts out of that: the inspector
 * shows one machine at a time on request, so it is never the thing causing the overload
 * the toggle exists to remove.
 */
const ADDRESS_FIELDS = [
  { key: 'ipv4', label: 'IPv4' },
  { key: 'ipv6', label: 'IPv6' },
  { key: 'mac', label: 'MAC' },
] as const satisfies readonly { key: keyof SimNode; label: string }[];

export interface AddressListProps {
  node: SimNode;
  /** Render even where the view has hidden addressing. Used by the inspector. */
  always?: boolean;
  className?: string;
}

export function AddressList({ node, always = false, className }: AddressListProps) {
  const visible = useAddressVisibility();
  const rows = ADDRESS_FIELDS.filter(({ key }) => typeof node[key] === 'string');

  if (rows.length === 0) return null;
  if (!visible && !always) return null;

  return (
    <dl className={cn('grid grid-cols-[2.4rem_1fr] gap-x-2 gap-y-0.5', className)}>
      {rows.map(({ key, label }) => (
        <div key={key} className="contents">
          <dt className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
            {label}
          </dt>
          <dd
            className="text-fg-secondary truncate font-mono text-[0.6875rem]"
            title={node[key] as string}
          >
            {node[key] as string}
          </dd>
        </div>
      ))}
    </dl>
  );
}
