import { PlannedModule, moduleMetadata } from '@/components/shell';

export const metadata = moduleMetadata('packet-journey');

/**
 * Route placeholder. The chrome comes from `(modules)/layout.tsx`; the phase that
 * builds this module replaces the body below with its composition root.
 */
export default function PacketJourneyPage() {
  return <PlannedModule moduleId="packet-journey" />;
}
