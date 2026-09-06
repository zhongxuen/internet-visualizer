import { moduleMetadata } from '@/components/shell';
import { NetworkDiagnosticsModule } from '@/modules/network-diagnostics';

export const metadata = moduleMetadata('network-diagnostics');

/**
 * The Network Diagnostics route.
 *
 * A server component that renders one client component and nothing else. The back link, the
 * title, the topic badges, and the safety badge all come from `(modules)/layout.tsx`, which
 * resolves them from the registry -- and since phase 12 that registry entry carries
 * `usesRealNetwork: true`, so the chrome shows the `live` badge for this route.
 *
 * That badge states what the module is capable of. Which half of it is actually in use is
 * shown inside the module, by the badge in its mode switch, because Learn mode is the
 * default and reaches nothing.
 *
 * This page still makes no request of its own and never will. Live mode's requests are made
 * by the Route Handlers under `src/app/api/diagnostics/`, called from the browser by
 * `modules/network-diagnostics/live/client.ts` and nowhere else.
 */
export default function NetworkDiagnosticsPage() {
  return <NetworkDiagnosticsModule />;
}
