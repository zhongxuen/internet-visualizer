/**
 * Join element ids into an IDREF list for `aria-describedby` and friends, or
 * `undefined` when there are none -- an empty `aria-describedby=""` is an attribute that
 * points at nothing, and some validators report it.
 *
 * Not `cn()`: that runs `tailwind-merge`, which is for class names and is free to drop
 * a token it thinks conflicts with another.
 */
export function idList(
  ...ids: Array<string | false | null | undefined>
): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}
