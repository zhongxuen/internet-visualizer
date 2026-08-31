import { PlannedModule, moduleMetadata } from '@/components/shell';

export const metadata = moduleMetadata('network-map');

/**
 * Route placeholder. The chrome comes from `(modules)/layout.tsx`; the phase that
 * builds this module replaces the body below with its composition root.
 */
export default function NetworkMapPage() {
  return <PlannedModule moduleId="network-map" />;
}
