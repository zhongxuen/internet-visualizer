/**
 * The response headers every route in the product carries, and the reasoning behind
 * each one.
 *
 * This lives here rather than inline in `next.config.ts` for one reason: a header set
 * written into a config object is a header set nothing can assert on. `next.config.ts`
 * imports {@link securityHeaders} and returns it verbatim, `tests/security-headers.test.ts`
 * asserts the policy, and `e2e/security.spec.ts` asserts the headers actually arrive on
 * a real response from a production build. The string is built once, in one place, so
 * those three can never be describing three different policies.
 *
 * The file is deliberately dependency-free. `next.config.ts` is bundled before any
 * module resolution the app enjoys exists, so anything imported here would have to be
 * bundled with it.
 */

/**
 * Whether the browser should block a violation or merely report it.
 *
 * The phase doc asks for report-only first and enforcement second, which is the right
 * order for a policy nobody has measured yet: report-only tells you what would break
 * without breaking it. The rollout is written down in `.env.example`; both modes are
 * reachable from an environment variable so that flipping between them is a redeploy
 * rather than an edit.
 */
export type CspMode = 'enforce' | 'report-only';

/** One header, in the shape `next.config.ts`'s `headers()` wants it. */
export interface HeaderEntry {
  readonly key: string;
  readonly value: string;
}

export interface SecurityHeaderOptions {
  /** Defaults to `'enforce'`. See {@link cspModeFromEnv}. */
  readonly mode?: CspMode;
  /**
   * Loosens exactly two directives for the dev server, and nothing else. Turbopack
   * evaluates compiled modules and talks to its own websocket for Fast Refresh; both
   * are development machinery that never reaches a deployment, so the shipped policy
   * must not pay for them.
   */
  readonly development?: boolean;
  /** When set, violations are POSTed here as well as surfaced to the console. */
  readonly reportUri?: string;
}

/**
 * The policy, directive by directive.
 *
 * Two of these are doing real work for this product in particular, and are worth
 * reading before either is relaxed:
 *
 *  - **`connect-src 'self'`** is the browser-level statement of the rule the whole
 *    product is organised around. Every module except Network Diagnostics is a pure
 *    client-side simulation, and this is what makes that structural rather than
 *    conventional: a `fetch`, `XMLHttpRequest`, `EventSource` or `WebSocket` to
 *    anywhere but this origin is refused by the browser, whatever the code asked for.
 *    Live mode still works, because its three lookups are same-origin `GET`s to
 *    `/api/diagnostics/*` and the outbound half happens on the server behind
 *    `guardedFetch`. So the one module allowed to reach a network reaches it exactly
 *    the way it documents, and nothing else can reach one at all.
 *  - **`frame-ancestors 'none'`** because Live mode's acknowledgement gate is a
 *    consent UI, and a consent UI that can be framed is a consent UI that can be
 *    clickjacked into being pressed by someone who never read it.
 *
 * `'unsafe-inline'` on scripts is the policy's one real weakness and is stated rather
 * than hidden. Next's App Router streams its payload through inline `<script>` tags
 * whose content changes per page, so the alternatives are a nonce or nothing. A nonce
 * has to be minted per request, which means a proxy on every HTML route, which means
 * every page in the product renders dynamically -- including the thirty-three
 * pre-rendered lessons. That trade is not worth making here: there is no user-generated
 * content anywhere in the product, no third-party script, and no authenticated session
 * or cookie for an injected script to steal. The directives that do carry weight are
 * the ones that bound the damage of a script that did somehow run: it cannot reach
 * another origin (`connect-src`), rewrite the document base (`base-uri`), post a form
 * elsewhere (`form-action`), or load a plugin (`object-src`).
 *
 * `style-src 'unsafe-inline'` is not negotiable at all: React Flow positions every node
 * with a `style` attribute, and `motion` animates by writing one.
 */
export function contentSecurityPolicy(options: SecurityHeaderOptions = {}): string {
  const { development = false, reportUri } = options;

  const directives: string[][] = [
    ['default-src', "'self'"],
    // No nonce; see the note above. 'unsafe-eval' is Turbopack's, and dev-only.
    [
      'script-src',
      "'self'",
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    ['style-src', "'self'", "'unsafe-inline'"],
    // `data:` for the favicon and any inlined SVG; `blob:` for a canvas readback.
    ['img-src', "'self'", 'data:', 'blob:'],
    // next/font self-hosts both Geist faces, so there is no font origin to allow.
    ['font-src', "'self'"],
    // The rule the product is built on. `ws:` is the Fast Refresh socket, dev only.
    ['connect-src', "'self'", ...(development ? ['ws:', 'wss:'] : [])],
    ['object-src', "'none'"],
    ['frame-src', "'none'"],
    ['frame-ancestors', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['manifest-src', "'self'"],
    ['media-src', "'none'"],
    ['worker-src', "'self'", 'blob:'],
  ];

  // Meaningless over http, and on a dev server it would break every asset request.
  if (!development) directives.push(['upgrade-insecure-requests']);
  if (reportUri) directives.push(['report-uri', reportUri]);

  return directives.map((parts) => parts.join(' ')).join('; ');
}

/**
 * `Permissions-Policy`, denying the three the phase doc names and three more.
 *
 * An empty allowlist -- `camera=()` -- denies the feature to this document and to every
 * frame inside it. Nothing in the product asks for any of these, so the honest value is
 * "no" rather than "not yet": a page that draws packets on a canvas has no business
 * being able to prompt for a camera, and saying so here means a future dependency that
 * tries cannot.
 */
export const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'interest-cohort=()',
].join(', ');

/**
 * Two years, subdomains included, and preload-eligible.
 *
 * `max-age` is in seconds. The `preload` token is a claim rather than an instruction --
 * it only does anything once the domain is submitted to the preload list -- and it is
 * safe to state here because the deployment is HTTPS-only on every hostname Vercel
 * serves it under.
 */
export const STRICT_TRANSPORT_SECURITY = 'max-age=63072000; includeSubDomains; preload';

/**
 * Every security header, in one array.
 *
 * `X-Frame-Options` is redundant beside `frame-ancestors 'none'` for any browser
 * released this decade and is here for the ones that are not; it costs 24 bytes.
 * `X-Content-Type-Options` matters most for `/api/diagnostics/*`, which returns text
 * fetched from a host the user named: `nosniff` is what stops a response the handler
 * labelled `application/json` from being re-interpreted as something executable.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}): HeaderEntry[] {
  const mode: CspMode = options.mode ?? 'enforce';

  return [
    {
      key:
        mode === 'report-only'
          ? 'Content-Security-Policy-Report-Only'
          : 'Content-Security-Policy',
      value: contentSecurityPolicy(options),
    },
    { key: 'Strict-Transport-Security', value: STRICT_TRANSPORT_SECURITY },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
    { key: 'X-Frame-Options', value: 'DENY' },
  ];
}

/**
 * Read the mode from the environment, treating anything unrecognised as enforcement.
 *
 * The default is the strict one on purpose. A typo in a dashboard variable, or a
 * variable that was never set on a new environment, should leave the policy enforcing
 * rather than silently reporting -- the failure mode of guessing wrong here is a
 * deployment that believes it is protected and is not.
 */
export function cspModeFromEnv(
  env: Record<string, string | undefined> = process.env,
): CspMode {
  const raw = (env.CSP_MODE ?? '').trim().toLowerCase();
  return raw === 'report-only' ? 'report-only' : 'enforce';
}
