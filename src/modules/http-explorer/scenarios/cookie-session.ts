/**
 * Scenario 5 -- a login, the cookie it sets, and the attack that cookie survives.
 *
 * HTTP has no memory. Every request is complete in itself and the server has no way to
 * know that two of them came from the same person -- which is a genuinely good design,
 * and also useless for anything with an account in it. A cookie is the patch: the server
 * hands the browser a value, and the browser hands it back on every subsequent request
 * that matches the cookie's scope.
 *
 * *"Matches the cookie's scope"* is where all the interest is. The attributes on a
 * `Set-Cookie` are not configuration; each one closes a specific attack, and the last
 * step here shows one of them doing it.
 *
 * ## The three steps
 *
 * 1. **POST /login** answers 303 and sets two cookies. The session cookie is
 *    `__Host-session`, `Secure`, `HttpOnly`, `SameSite=Lax`. The preference cookie is
 *    `theme`, with none of that, because it protects nothing worth protecting.
 * 2. The 303 sends the browser to **GET /account**, which now carries both cookies and
 *    is answered 200. This is the entire mechanism: one round trip later the server knows
 *    who is asking.
 * 3. **A different site makes a cross-site POST** to `/account/transfer`. The request is
 *    sent -- nothing stops it -- and arrives **without the session cookie**, because
 *    `SameSite=Lax` withholds it from a cross-site POST. The server sees an anonymous
 *    request and refuses. That is CSRF, defeated by one attribute.
 *
 * ## What each attribute stops
 *
 * | Attribute       | Attack it closes           | Without it                                    |
 * | --------------- | -------------------------- | --------------------------------------------- |
 * | `HttpOnly`      | Session theft via XSS      | One injected script reads the session and posts it away |
 * | `SameSite=Lax`  | Cross-site request forgery | Any site can make authenticated requests as the user   |
 * | `Secure`        | Plaintext leak             | One `http://` link puts the session on the wire        |
 * | `__Host-` prefix| Fixation from a sibling host | `evil.example.com` sets a cookie `www` reads as its own |
 *
 * The `__Host-` prefix is the subtle one. A server receiving a `Cookie` field gets names
 * and values and nothing else -- no domain, no path, no flags -- so it cannot tell a
 * cookie it set from one a sibling subdomain set. The prefix is the workaround: the
 * browser refuses to store a `__Host-` cookie unless it is `Secure`, host-only, and
 * `Path=/`, so the guarantee travels inside the one part the server does get back.
 */

import { header } from '../sim/message';
import type { HttpScenario } from '../sim/exchange';

import { FIXTURE_ADDRESSES, HTTP_CLOCK } from './common';

const ACCOUNT_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Your account</title></head>
  <body>
    <h1>Signed in as ada</h1>
    <p>The server knows that because of one field on this request.</p>
  </body>
</html>
`;

/** The site the cross-site request comes from. Simulated, and not a real domain. */
const ATTACKER_ORIGIN = 'https://free-tote-bags.example';

/** A login, an authenticated request, and a cross-site POST that arrives logged out. */
export const COOKIE_SESSION: HttpScenario = {
  id: 'cookie-session',
  title: 'Cookies and sessions',
  summary:
    'A login sets a hardened session cookie, the next request carries it, and then a ' +
    'cross-site POST arrives without it -- because SameSite withheld it.',
  teaches: [
    'HTTP is stateless; a session is a value the browser is asked to repeat',
    'HttpOnly hides the cookie from document.cookie, which is what stops XSS reading it',
    'SameSite=Lax withholds the cookie from cross-site POSTs, which is what stops CSRF',
    '__Host- forces Secure, host-only and Path=/, because the name is all the server gets back',
    'A cross-site request is still sent; only the cookie is withheld',
  ],
  seed: 'http:cookie-session',
  version: 'HTTP/1.1',
  secure: true,
  clock: HTTP_CLOCK,
  conditions: { rttMs: 85, bandwidthKbps: 18_000 },
  origins: [
    {
      host: 'shop.example.com',
      label: 'shop.example.com',
      ipv4: FIXTURE_ADDRESSES.shop,
      server: 'simulated-app',
      thinkMs: 22,
      routes: [
        {
          path: '/login',
          methods: ['POST'],
          status: 303,
          thinkMs: 90,
          headers: [header('Location', '/account'), header('Cache-Control', 'no-store')],
          setCookies: [
            // Everything this cookie needs, and nothing it does not. No Domain, so it is
            // host-only; no Expires, so it dies with the browser session.
            '__Host-session=n8Qd3xLp5fT2vR9c; Path=/; Secure; HttpOnly; SameSite=Lax',
            // A preference, not a credential. It is readable by script on purpose,
            // because the page needs to read it, and losing it costs nothing.
            'theme=dark; Path=/; Max-Age=31536000; Secure; SameSite=Lax',
          ],
        },
        {
          path: '/account',
          status: 200,
          thinkMs: 30,
          requiresCookie: '__Host-session',
          denied: {
            status: 401,
            headers: [
              header('WWW-Authenticate', 'Cookie realm="shop"'),
              header('Content-Type', 'text/plain; charset=utf-8'),
            ],
            body: 'No session cookie arrived, so nobody is signed in.\n',
          },
          headers: [
            header('Content-Type', 'text/html; charset=utf-8'),
            // Anything with a name on it is private and must never reach a shared cache.
            header('Cache-Control', 'private, no-store'),
          ],
          body: ACCOUNT_PAGE,
        },
        {
          path: '/account/transfer',
          methods: ['POST'],
          status: 200,
          thinkMs: 40,
          requiresCookie: '__Host-session',
          denied: {
            status: 403,
            headers: [header('Content-Type', 'text/plain; charset=utf-8')],
            body: 'No session cookie on this request. Nothing was transferred.\n',
          },
          headers: [
            header('Content-Type', 'text/plain; charset=utf-8'),
            header('Cache-Control', 'no-store'),
          ],
          body: 'Transfer accepted.\n',
        },
      ],
    },
  ],
  steps: [
    {
      kind: 'request',
      id: 'login',
      title: 'POST /login',
      host: 'shop.example.com',
      target: '/login',
      method: 'POST',
      headers: [header('Content-Type', 'application/x-www-form-urlencoded')],
      body: 'user=ada&password=hunter2-but-simulated',
      intent:
        'Credentials go up once. What comes back is a 303 and two Set-Cookie fields, and ' +
        'from here on the password is never sent again.',
      initiator: { pageOrigin: 'https://shop.example.com', topLevelNavigation: true },
    },
    {
      kind: 'request',
      id: 'csrf',
      title: 'A cross-site POST',
      host: 'shop.example.com',
      target: '/account/transfer',
      method: 'POST',
      afterMs: 4_000,
      headers: [header('Content-Type', 'application/x-www-form-urlencoded')],
      body: 'to=attacker&amount=all',
      intent:
        "A form on somebody else's page posts to this site. The request is sent, and it " +
        'arrives with no session cookie at all.',
      initiator: {
        pageOrigin: ATTACKER_ORIGIN,
        topLevelNavigation: false,
        withCredentials: true,
      },
    },
  ],
  notes: [
    {
      phase: 'login',
      text: 'Two Set-Cookie fields, and they repeat rather than combining -- Set-Cookie is the one field where a comma-joined value would be ambiguous, because the date in an Expires attribute contains a comma of its own. This is also why headers are modelled as an ordered list here rather than a map: the wire format allows repeats and this field needs them.',
      reference: {
        rfc: 6265,
        section: '4.1',
        title: 'HTTP State Management Mechanism: Set-Cookie',
      },
    },
    {
      phase: 'login',
      text: "The session cookie has no Domain attribute, and that is deliberate: omitting Domain makes a cookie host-only, so it goes to shop.example.com and to no subdomain of it. Setting Domain=example.com would widen it to every subdomain -- including whichever one is running someone else's static site -- which is the reverse of what most people expect an attribute called Domain to do.",
      reference: {
        rfc: 6265,
        section: '5.1.3',
        title: 'HTTP State Management Mechanism: Domain Matching',
      },
    },
    {
      phase: 'login',
      text: 'It has no Expires and no Max-Age either, which makes it a session cookie: it lives until the browser closes and never touches disk. The theme cookie has Max-Age=31536000 and will outlive a year of reboots. The difference between "remember me" and not is expressed entirely by the absence of two attributes.',
      reference: {
        rfc: 6265,
        section: '5.3',
        title: 'HTTP State Management Mechanism: Storage Model',
      },
    },
    {
      phase: 'login-redirect-1',
      text: 'The redirect is followed and the cookies come with it -- longer paths first, and among equal paths the older cookie first, which is the ordering RFC 6265 s5.4 specifies. Note what the Cookie field carries: names and values, and nothing else. No Path, no Domain, no HttpOnly. The server cannot see any of the attributes it set, which is exactly why the __Host- prefix had to be invented.',
      reference: {
        rfc: 6265,
        section: '5.4',
        title: 'HTTP State Management Mechanism: The Cookie Header',
      },
    },
    {
      phase: 'login-redirect-1',
      text: "HttpOnly is doing nothing visible here and everything important. It makes the cookie invisible to document.cookie, so a single injected script -- one unescaped comment, one compromised analytics tag -- cannot read the session and post it to an attacker. Without it, an XSS bug is a full account takeover; with it, the attacker has to make requests from the victim's own browser and can never take the session away.",
      reference: {
        rfc: 6265,
        section: '4.1.2.6',
        title: 'HTTP State Management Mechanism: HttpOnly',
      },
    },
    {
      phase: 'csrf',
      text: 'This request was sent. Nothing prevented it: any page anywhere can cause a browser to POST a form to any URL, and it always could. What SameSite=Lax changes is what travels with it -- the cookie is withheld from a cross-site request unless it is a top-level navigation with a safe method, and a form POST from another site is neither. The server sees an anonymous request and refuses. Strict would also withhold it from a link click, which is safer and is why clicking a link to a Strict site arrives logged out.',
      reference: {
        rfc: 6265,
        section: '5.4.7',
        title: 'HTTP State Management Mechanism (6265bis): SameSite',
      },
    },
    {
      phase: 'csrf',
      text: 'Read the failure carefully: the 403 came from the application, not from the browser. CORS did not stop this request either -- a form POST with a urlencoded body is a simple request and needs no permission to be sent. Both of those layers protect the *reader* of a response, and neither one protects the server. The only thing that defended this account was one attribute on one cookie.',
      reference: { rfc: 9110, section: '15.5.4', title: 'HTTP Semantics: 403 Forbidden' },
    },
  ],
};
