import { PlannedModule, moduleMetadata } from '@/components/shell';

export const metadata = moduleMetadata('learning-center');

/**
 * Route placeholder. The chrome comes from `(modules)/layout.tsx`; the phase that
 * builds this module replaces the body below with its composition root.
 */
export default function LearningCenterPage() {
  return <PlannedModule moduleId="learning-center" />;
}
