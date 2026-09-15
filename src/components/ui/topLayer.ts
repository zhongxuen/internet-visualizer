'use client';

import { useSyncExternalStore } from 'react';

/**
 * Feature detection for the two platform features the overlay primitives are built on:
 * the `popover` attribute and `<dialog>.showModal()`.
 *
 * Both are Baseline, and both are still detected rather than assumed, for two reasons.
 * An older school Chromebook or phone is exactly the reader this product is now for
 * (docs/implementation/uiux.md §2), and a menu that never opens there is worse than one
 * that opens without the top layer. And jsdom implements neither, so without a fallback
 * every test that mounts a component using these primitives would need a polyfill it has
 * no reason to know about.
 *
 * The fallbacks are smaller than the real thing on purpose -- no top layer, no inert
 * background -- and each component says what it gives up.
 */

export function supportsPopover(): boolean {
  return (
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.showPopover === 'function'
  );
}

export function supportsModalDialog(): boolean {
  return (
    typeof HTMLDialogElement !== 'undefined' &&
    typeof HTMLDialogElement.prototype.showModal === 'function'
  );
}

const noSubscription = () => () => {};

/**
 * {@link supportsPopover} as a hook that is safe to render on the server.
 *
 * The server snapshot is `false`, so the server and the hydrating client both render the
 * fallback markup, and the client switches to the native path in the render after
 * hydration. Reading `supportsPopover()` directly during render would disagree between the
 * two and fail hydration.
 */
export function useSupportsPopover(): boolean {
  return useSyncExternalStore(noSubscription, supportsPopover, () => false);
}

/**
 * Move focus back to `target` if focus has nowhere better to be.
 *
 * "Nowhere better" means it is on `<body>` (the focused element was hidden or removed) or
 * still inside the overlay that just closed. If the user closed a popover by clicking
 * another control, focus is already on that control, and taking it back would undo what
 * they just did.
 */
export function restoreFocus(target: HTMLElement | null, overlay: HTMLElement | null) {
  if (!target || !target.isConnected) return;
  const active = document.activeElement;
  if (active === null || active === document.body || overlay?.contains(active)) {
    target.focus({ preventScroll: true });
  }
}
