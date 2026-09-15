export type Level = 'beginner' | 'intermediate' | 'advanced';

/** The beginner-facing face of a scenario. Required on every scenario after its module's wave-3 pass. */
export interface StoryMeta {
  /** ≤ 6 words, no unglossed jargon. e.g. 'Visiting a site for the first time'. */
  plainTitle: string;
  /** The question this run answers, ending in '?', ≤ 16 words. */
  question: string;
  level: Level;
}
