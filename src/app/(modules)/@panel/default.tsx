/**
 * Fallback for the explanation-panel slot.
 *
 * Every module route matches this until it adds its own `@panel/<route>/page.tsx`.
 * Returning `null` leaves the `<aside>` empty, and `ModuleChrome` collapses it, so an
 * unfilled slot costs no layout.
 */
export default function PanelDefault() {
  return null;
}
