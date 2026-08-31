import { PlannedModule, moduleMetadata } from '@/components/shell';

export const metadata = moduleMetadata('https-explorer');

/**
 * Route placeholder. The chrome comes from `(modules)/layout.tsx`; the phase that
 * builds this module replaces the body below with its composition root.
 */
export default function HttpsExplorerPage() {
  return <PlannedModule moduleId="https-explorer" />;
}
