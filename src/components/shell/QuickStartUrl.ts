/**
 * The shape check behind the home page's "Type a website and watch" box.
 *
 * **Shape only.** This decides whether the text could be a web address, so the form can
 * say "that doesn't look like one" before navigating. Whether the simulator can load it,
 * and what it says about a host it has no fixture for, is the Internet Simulator's
 * decision (UX-3.8 makes it read `?url=`), and repeating that here would be a second
 * opinion that could disagree with the one on screen. It is also why this is not zod:
 * the home page's first load has no other use for it.
 *
 * Plain functions with no React, so the rule is tested without a DOM.
 */

/** Where the simulator lives. The registry route, restated so this file stays pure. */
export const QUICK_START_ROUTE = '/internet-simulator';

/** Longer than any address a person types; a guard, not a rule about URLs. */
const MAX_LENGTH = 2048;

export type QuickStartCheck =
  | { readonly ok: true; readonly href: string }
  | { readonly ok: false; readonly error: string };

/**
 * Accepts what a browser's address bar accepts for a website: `example.com`,
 * `www.example.com/path`, `https://example.com`, `http://localhost:3000`. Rejects empty
 * text, spaces, other schemes (`ftp:`, `mailto:`, `javascript:`), and a single word with
 * no dot, which is a search rather than an address.
 */
export function checkQuickStart(raw: string): QuickStartCheck {
  const value = raw.trim();

  if (value === '') {
    return { ok: false, error: 'Type a web address first, like example.com.' };
  }
  if (value.length > MAX_LENGTH || /\s/.test(value)) {
    return {
      ok: false,
      error: "That doesn't look like a web address. Try something like example.com.",
    };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) {
    return {
      ok: false,
      error: 'Only website addresses work here: ones starting http:// or https://.',
    };
  }

  let url: URL;
  try {
    url = new URL(hasScheme ? value : `https://${value}`);
  } catch {
    return {
      ok: false,
      error: "That doesn't look like a web address. Try something like example.com.",
    };
  }

  const host = url.hostname;
  const looksLikeHost =
    host === 'localhost' ||
    (host.includes('.') &&
      !host.startsWith('.') &&
      !host.endsWith('.') &&
      !host.includes('..'));
  if (!looksLikeHost) {
    return {
      ok: false,
      error: "That doesn't look like a web address. Try something like example.com.",
    };
  }

  return { ok: true, href: quickStartHref(value) };
}

/** The simulator's URL for an address, exactly as typed (trimmed) so the module sees it. */
export function quickStartHref(value: string): string {
  return `${QUICK_START_ROUTE}?url=${encodeURIComponent(value.trim())}`;
}
