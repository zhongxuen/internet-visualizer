'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * The selected story, kept in `?scenario=` so a link can open one (uiux-spec.md §7.4).
 *
 * ```ts
 * const [scenarioId, setScenarioId] = useScenarioParam(ids, DEFAULT_ID);
 * ```
 *
 * ## Why not `useSearchParams`
 *
 * Every module route is statically prerendered. Next's docs
 * (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`,
 * "Prerendering") say that calling `useSearchParams` in a prerendered route makes the
 * client tree up to the nearest `<Suspense>` render on the client only. For a module that
 * tree is the whole Stage -- the canvas box, the controls, the list of machines -- so the
 * server HTML would lose all of it, and LCP with it. Reading the page's `searchParams`
 * prop instead would make every module route dynamic.
 *
 * So the query string is read the way `useDetail` reads preferences: through
 * `useSyncExternalStore`, whose server snapshot is "no parameter". The server and the
 * hydrating client both render `defaultId`; a link carrying `?scenario=` switches story
 * straight after hydration. Nothing suspends and the route stays static.
 *
 * ## Writing without navigating
 *
 * `history.replaceState`, which the same docs ("Native History API") say Next folds into
 * its router, so `usePathname` and `useSearchParams` elsewhere stay in step. Replace
 * rather than push: choosing a story is not a place the Back button should step through.
 * The default story is written as no parameter at all, so a plain module URL stays plain.
 *
 * An id that is not in `ids` -- a typo, a story since renamed -- reads as `defaultId`.
 */

export const SCENARIO_PARAM = 'scenario';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Back and Forward restore an older URL without telling anyone else.
  if (listeners.size === 1) window.addEventListener('popstate', notify);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', notify);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** The raw parameter, or `null`. A string, so the snapshot is stable between reads. */
function readParam(): string | null {
  return new URLSearchParams(window.location.search).get(SCENARIO_PARAM);
}

function readServerParam(): string | null {
  return null;
}

/** The URL with `?scenario=` set to `id`, or removed when `id` is the default. */
export function scenarioHref(href: string, id: string, defaultId: string): string {
  const url = new URL(href);
  if (id === defaultId) url.searchParams.delete(SCENARIO_PARAM);
  else url.searchParams.set(SCENARIO_PARAM, id);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function useScenarioParam(
  ids: readonly string[],
  defaultId: string,
): [string, (id: string) => void] {
  const raw = useSyncExternalStore(subscribe, readParam, readServerParam);
  const selected = raw !== null && ids.includes(raw) ? raw : defaultId;

  const select = useCallback(
    (id: string) => {
      const next = scenarioHref(window.location.href, id, defaultId);
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      // `null`, as the docs write it: Next copies its own entry state across, and state
      // that already carries Next's marker would skip the router sync altogether.
      if (next !== current) window.history.replaceState(null, '', next);
      notify();
    },
    [defaultId],
  );

  return [selected, select];
}
