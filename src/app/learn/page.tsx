import { moduleMetadata } from '@/components/shell';
import { LearningCenterModule, LEARNING_CENTER_ID } from '@/modules/learning-center';

export const metadata = moduleMetadata(LEARNING_CENTER_ID);

/**
 * `/learn` -- the Learning Center index.
 *
 * Outside the `(modules)` route group, unlike every other module route, and
 * deliberately: `ModuleChrome` renders the module title as the page's `h1`, and a
 * lesson's `h1` has to be the lesson. See the note on the registry entry.
 */
export default function LearnPage() {
  return <LearningCenterModule />;
}
