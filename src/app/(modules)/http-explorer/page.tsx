import { moduleMetadata } from '@/components/shell';
import { HttpExplorerModule } from '@/modules/http-explorer';

export const metadata = moduleMetadata('http-explorer');

/**
 * The HTTP Explorer route.
 *
 * A server component that renders one client component and nothing else. The back link,
 * the title, the topic badges, and the "Simulated" badge all come from
 * `(modules)/layout.tsx`, which resolves them from the registry -- a module page never
 * draws its own chrome, and this one has no reason to be a page rather than a component
 * beyond owning the URL.
 */
export default function HttpExplorerPage() {
  return <HttpExplorerModule />;
}
