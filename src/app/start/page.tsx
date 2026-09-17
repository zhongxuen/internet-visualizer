import { redirect } from 'next/navigation';

import { firstStepsPath } from '@/modules/learning-center/content/navigation';

/**
 * `/start`: the address every "Start here" button uses, so the beginner path can move
 * without a link anywhere else changing. It lands on the First steps track's own first
 * lesson, read from the track data, so reordering the track moves it too.
 *
 * Deliberately not in the sitemap (it is a redirect, not a page) and not in
 * `e2e/routes.ts` (whose smoke test asserts a 200); `e2e/smoke.spec.ts` checks the
 * redirect on its own.
 */
export default function StartHere(): never {
  redirect(firstStepsPath().startHref);
}
