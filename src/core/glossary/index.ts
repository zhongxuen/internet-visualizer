/**
 * One term list for the whole product: the base entries plus every module's extras.
 *
 * `GLOSSARY` is what the glossary page, `<Term>` and every popover read, so there is one
 * sentence per term everywhere. Plain data, which is why it lives in `src/core`: every
 * module and every component may import core, and no module may import another
 * (docs/implementation/uiux.md §5.6).
 *
 * Popovers should import `./inline.ts` rather than this file; lookups go through
 * `./lookup.ts`.
 */

import { EXTRA_TERMS as apiVisualizer } from './extra/api-visualizer';
import { EXTRA_TERMS as dnsExplorer } from './extra/dns-explorer';
import { EXTRA_TERMS as httpExplorer } from './extra/http-explorer';
import { EXTRA_TERMS as httpsExplorer } from './extra/https-explorer';
import { EXTRA_TERMS as internetSimulator } from './extra/internet-simulator';
import { EXTRA_TERMS as learningCenter } from './extra/learning-center';
import { EXTRA_TERMS as networkDiagnostics } from './extra/network-diagnostics';
import { EXTRA_TERMS as networkMap } from './extra/network-map';
import { EXTRA_TERMS as packetJourney } from './extra/packet-journey';
import { EXTRA_TERMS as websocketViewer } from './extra/websocket-viewer';
import { TERMS, type GlossaryTerm } from './terms';

export type { GlossaryTerm } from './terms';
export { TERMS } from './terms';

/** Each module's extra terms, keyed by registry id, in registry order. */
export const EXTRA_TERMS_BY_MODULE: Readonly<Record<string, readonly GlossaryTerm[]>> = {
  'network-map': networkMap,
  'packet-journey': packetJourney,
  'dns-explorer': dnsExplorer,
  'http-explorer': httpExplorer,
  'https-explorer': httpsExplorer,
  'api-visualizer': apiVisualizer,
  'websocket-viewer': websocketViewer,
  'internet-simulator': internetSimulator,
  'network-diagnostics': networkDiagnostics,
  'learning-center': learningCenter,
};

/** The authoring order: the base terms, then each module's extras in registry order. */
export const GLOSSARY: readonly GlossaryTerm[] = [
  ...TERMS,
  ...Object.values(EXTRA_TERMS_BY_MODULE).flat(),
];
