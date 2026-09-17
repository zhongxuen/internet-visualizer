import { redirect } from 'next/navigation';

import { START_HERE_DESTINATION } from './destination';

/**
 * `/start`: the address every "Start here" button uses, so the beginner path can move
 * without a link anywhere else changing.
 *
 * Deliberately not in the sitemap (it is a redirect, not a page) and not in
 * `e2e/routes.ts` (whose smoke test asserts a 200); `e2e/smoke.spec.ts` checks the
 * redirect on its own.
 */
export default function StartHere(): never {
  redirect(START_HERE_DESTINATION);
}
