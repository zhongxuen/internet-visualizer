/**
 * The First steps track, as the home page needs it: which six lessons, and roughly how
 * long they take together.
 *
 * **A stand-in.** The track itself (docs/implementation/uiux-spec.md §7.7) is being
 * written by UX-2.6 in parallel with the home page, so this copies its slugs and titles
 * from that table and estimates the minutes. UX-W2 replaces this constant with values
 * derived from `learning-center/content/tracks.ts` and deletes it. Until then, change
 * the numbers here and nowhere else -- the call to action and `StartPath` both read them.
 */

export interface StartPathStep {
  /** The lesson's slug, which is also the key its progress is stored under. */
  slug: string;
  title: string;
}

export const FIRST_STEPS_PATH = {
  trackId: 'first-steps',
  /** About how long all six lessons take, in minutes. An estimate until UX-W2. */
  minutes: 25,
  steps: [
    {
      slug: 'what-happens-when-you-open-a-website',
      title: 'What happens when you open a website?',
    },
    { slug: 'your-devices-are-on-a-network', title: 'Your devices are on a network' },
    { slug: 'messages-travel-in-packets', title: 'Messages travel in small packets' },
    { slug: 'finding-a-websites-address', title: "Finding a website's address" },
    { slug: 'asking-for-the-page', title: 'Asking for the page' },
    { slug: 'keeping-it-private', title: 'Keeping it private with HTTPS' },
  ] satisfies readonly StartPathStep[],
} as const;
