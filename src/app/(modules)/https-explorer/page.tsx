import { moduleMetadata } from '@/components/shell';
import { HttpsExplorerModule } from '@/modules/https-explorer';

export const metadata = moduleMetadata('https-explorer');

/**
 * The HTTPS Explorer route.
 *
 * A server component that renders one client component and nothing else. The back link,
 * the title, the topic badges, and the "Simulated" badge all come from
 * `(modules)/layout.tsx`, which resolves them from the registry -- a module page never
 * draws its own chrome, and this one has no reason to be a page rather than a component
 * beyond owning the URL.
 */
export default function HttpsExplorerPage() {
  return <HttpsExplorerModule />;
}
