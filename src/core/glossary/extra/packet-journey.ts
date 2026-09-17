import type { GlossaryTerm } from '../terms';

/**
 * Terms the Packet Journey adds to the glossary. Only that module's pass edits this file, which
 * is what lets ten module passes add words in parallel without conflicting
 * (docs/implementation/uiux.md §7.6). Same writing rules as `../terms.ts`.
 */
export const EXTRA_TERMS: readonly GlossaryTerm[] = [];
