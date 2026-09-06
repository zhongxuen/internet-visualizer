/**
 * Placeholder values -- the one file in the TLS layer allowed to look like cryptography.
 *
 * # THERE IS NO CRYPTOGRAPHY IN THIS LAYER
 *
 * Every "key", "secret", "signature", "fingerprint" and "ciphertext" the TLS layer
 * shows comes from here, and every one of them is a deterministic FNV-1a hash of a label
 * string. They are:
 *
 * - **not secret** -- computed from public inputs anyone can read in this file,
 * - **not random** -- the same label always gives the same value,
 * - **not one-way** -- FNV-1a is a hash table function, not a cryptographic hash,
 * - **not a key** -- nothing in this layer encrypts, signs, or verifies anything.
 *
 * That is the point. A convincing-looking fake implementation is worse than an honest
 * diagram, because a learner cannot tell the difference and might reach for it. So the
 * values are deliberately *shaped* like the real thing -- right length, right hex
 * alphabet, so the key schedule and the record view have something concrete to show --
 * and every one of them is rendered through {@link labelled}, which stamps a
 * `PLACEHOLDER-` prefix that cannot be mistaken for output from a real library.
 *
 * ## Why determinism matters
 *
 * Real TLS values are random, and a real handshake never repeats. A teaching simulation
 * has the opposite requirement: the same scenario must produce the same screen every
 * time, so a learner can step back and forth, and so a test can assert on it. Every value
 * here is a pure function of its label, and no scenario in this layer ever calls
 * `Math.random()` or `Date.now()`.
 *
 * ## What is modelled faithfully
 *
 * The *structure*: which input goes into which derivation, what depends on what, who can
 * compute what and when, and the sizes involved. That structure is checkable against RFC
 * 8446 and it is what this layer teaches. The mathematics is absent on purpose.
 */

/** Prefix stamped on every rendered value so it can never be mistaken for a real one. */
export const PLACEHOLDER_PREFIX = 'PLACEHOLDER';

/**
 * The sentence the UI must show anywhere a "key" or "secret" appears.
 *
 * Exported as a constant rather than left to each component so it cannot drift, and so
 * grepping for it finds every surface that displays a fake value.
 */
export const PLACEHOLDER_NOTICE =
  'Not real cryptography. Every key, secret, and signature shown here is a placeholder derived from a label string -- the shape of the derivation is accurate, the values are not, and nothing on this page encrypts anything.';

/**
 * FNV-1a, 32-bit.
 *
 * Chosen precisely because it is *obviously* not a cryptographic hash: a dozen lines, no
 * rounds, no constants anyone recognises. Its only job is to turn a label into stable hex.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * `byteCount` bytes of stable hex derived from `label`.
 *
 * Produced by re-hashing with a counter so longer values do not repeat a single 4-byte
 * block, which would look wrong in a hex dump.
 */
export function placeholderHex(label: string, byteCount: number): string {
  let out = '';
  for (let block = 0; out.length < byteCount * 2; block += 1) {
    out += fnv1a(`${label}#${block}`).toString(16).padStart(8, '0');
  }
  return out.slice(0, byteCount * 2);
}

/**
 * Hex with the placeholder prefix attached -- the form anything user-visible should use.
 *
 * @example
 * labelled('c hs traffic', 32) // 'PLACEHOLDER-c-hs-traffic-8f2a1c4d...'
 */
export function labelled(label: string, byteCount: number): string {
  const slug = label
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${PLACEHOLDER_PREFIX}-${slug}-${placeholderHex(label, byteCount)}`;
}

/**
 * A stand-in for a derived secret, in the width the negotiated hash would produce.
 *
 * `byteCount` should be the cipher suite's `hashBytes` -- 32 for SHA-256, 48 for SHA-384
 * -- so the widths shown in `KeyScheduleDiagram` are at least honest about size.
 */
export function placeholderSecret(label: string, byteCount: number): string {
  return labelled(label, byteCount);
}

/** A stand-in for a signature or an encoded public key. */
export function placeholderSignature(label: string): string {
  return labelled(label, 24);
}

/**
 * A stand-in for a certificate fingerprint, formatted in colon-separated byte pairs the
 * way a certificate viewer shows one.
 */
export function placeholderFingerprint(label: string, byteCount = 32): string {
  const hex = placeholderHex(label, byteCount);
  const pairs = hex.match(/.{2}/g) ?? [];
  return `${PLACEHOLDER_PREFIX}:${pairs.join(':').toUpperCase()}`;
}

/**
 * A stand-in for the opaque bytes of an encrypted record.
 *
 * Truncated with an ellipsis past `maxBytes` because the observer view wants to show that
 * there *are* bytes and that they say nothing, not to fill a panel with hex.
 */
export function placeholderCiphertext(
  label: string,
  byteCount: number,
  maxBytes = 16,
): string {
  const shown = Math.min(byteCount, maxBytes);
  const hex = placeholderHex(label, shown);
  const pairs = hex.match(/.{2}/g) ?? [];
  const body = pairs.join(' ');
  return byteCount > shown ? `${body} ... (${byteCount} bytes)` : body;
}

/**
 * A stand-in for a public key share -- the value that really does go on the wire.
 *
 * Worth its own function because a `key_share` is the one "key-shaped" thing in a TLS
 * handshake that is genuinely public. An observer sees both of these in full and still
 * cannot derive the shared secret; that asymmetry is the whole lesson of
 * `KeyScheduleDiagram`, and it should not be muddled by rendering it the same way as a
 * secret.
 */
export function placeholderKeyShare(label: string, byteCount = 32): string {
  return `${PLACEHOLDER_PREFIX}-public-${label}-${placeholderHex(label, byteCount)}`;
}
