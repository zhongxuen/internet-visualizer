'use client';

import { useSyncExternalStore } from 'react';

/**
 * The glossary's inline index, loaded on demand and shared by every term on the page.
 *
 * ## Why not a static import
 *
 * `@/core/glossary/inline` is built from the whole glossary, definitions included: about
 * 11 KB gzipped today, and the popover half alone (spellings and `short`) is 3.8 KB --
 * over uiux-spec.md §5.6's "under 4 KB added to a module route" before a line of
 * component code, and wave 3 adds more terms. So a term costs a route only this loader
 * and the `Popover`; the index arrives as its own chunk, once, when the first term
 * mounts.
 *
 * ## What renders before it arrives
 *
 * The server snapshot is `null`, so the prerendered HTML and the hydration pass show the
 * words as plain text, and the underline appears when the chunk lands. That is honest
 * rather than a compromise: a definition button does nothing without JavaScript, and
 * the underline adds no box, so the upgrade shifts no layout. After the first load the
 * index is a module-level value, so a term mounted later (a client navigation, the next
 * step's caption) renders as a button on its first render.
 *
 * A chunk that fails to load leaves the words as plain text and is retried by the next
 * term that mounts: losing the glossary costs the definitions, not the sentence.
 */

type InlineModule = typeof import('@/core/glossary/inline');

let loaded: InlineModule | null = null;
let pending: Promise<InlineModule> | null = null;
const listeners = new Set<() => void>();

function load() {
  pending ??= import('@/core/glossary/inline').then(
    (module) => {
      loaded = module;
      for (const listener of listeners) listener();
      return module;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loaded) load().catch(() => {});
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => loaded;
const getServerSnapshot = () => null;

/** The inline glossary once it has loaded, `null` until then (and always on the server). */
export function useInlineGlossary(): InlineModule | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Resolves once the index has loaded. For tests, and for a caller that wants to warm it. */
export function preloadInlineGlossary(): Promise<InlineModule> {
  return load();
}
