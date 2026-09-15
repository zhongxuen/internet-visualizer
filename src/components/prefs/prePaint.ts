import { PREFERENCES_KEY } from './preferences';

/**
 * The attributes the stylesheet reads, set on `<html>` before the first paint.
 *
 * The server renders with the defaults because it cannot see `localStorage`; React
 * learns the stored preferences only after hydration. Between the two, a Full-detail
 * or Large-text viewer would see the default page and then watch it change. An inline
 * script in `<head>` runs while the HTML is still being parsed, before anything is
 * painted, so CSS keyed on these attributes is right from the first frame
 * (node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md).
 *
 * ## This function is shipped as its own source text
 *
 * `PRE_PAINT_SCRIPT` below is `applyPreferenceAttributes.toString()`, called with the
 * storage key. So the body must be **self-contained**: it may not refer to anything
 * outside itself -- no imports, no module constants, no helpers -- because none of them
 * exist where it runs. It is also written in syntax every browser the product supports
 * parses natively (no `?.`, no `??`, no spread), because this text is taken from the
 * server bundle and never passes through the client build's transpilation.
 *
 * It repeats the validation in `preferences.ts` for the three fields it reads rather than
 * calling it, for the same reason. `prePaint.test.ts` holds the two to agreement over a
 * table of stored values, so they cannot drift apart silently.
 *
 * `data-motion` is written as the *resolved* value, `full` or `reduced`, exactly as
 * `MotionProvider` writes it after hydration, so the attribute never changes hands
 * between the two writers.
 */
export function applyPreferenceAttributes(key: string): void {
  let detail = 'simple';
  let motion = 'system';
  let textSize = 'normal';

  try {
    const raw = window.localStorage.getItem(key);
    const stored = raw ? JSON.parse(raw) : null;
    if (
      stored &&
      typeof stored === 'object' &&
      !Array.isArray(stored) &&
      stored.version === 1
    ) {
      if (stored.detail === 'simple' || stored.detail === 'full') detail = stored.detail;
      if (
        stored.motion === 'system' ||
        stored.motion === 'full' ||
        stored.motion === 'reduced'
      ) {
        motion = stored.motion;
      }
      if (stored.textSize === 'normal' || stored.textSize === 'large') {
        textSize = stored.textSize;
      }
    }
  } catch {
    // Unreadable storage or unparseable JSON: the defaults stand.
  }

  let reduced = motion === 'reduced';
  if (motion === 'system') {
    try {
      reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reduced = false;
    }
  }

  const root = document.documentElement;
  root.setAttribute('data-detail', detail);
  root.setAttribute('data-text-size', textSize);
  root.setAttribute('data-motion', reduced ? 'reduced' : 'full');
}

/**
 * The inline script's text: the function above, invoked with the key.
 *
 * Wrapped in its own `try` so that nothing it could conceivably throw -- a browser with
 * no `document.documentElement` yet, say -- stops the rest of the page's parsing.
 */
export const PRE_PAINT_SCRIPT = `try{(${applyPreferenceAttributes.toString()})(${JSON.stringify(PREFERENCES_KEY)})}catch(e){}`;
