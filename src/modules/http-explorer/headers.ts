/**
 * Every header the scenarios can put on the wire, as a teaching object.
 *
 * `WireView` makes each field line focusable and `HeaderExplainer` answers "what is this
 * line for?" from this table. Keeping the answers here rather than inside the component
 * has two consequences worth the file: the explanations are data a test can walk, and the
 * same sentences are available to the Learning Center in phase 13 without lifting them
 * out of JSX.
 *
 * ## The citations
 *
 * Only current specifications. The RFC 723x series and RFC 2616 are obsolete -- they were
 * replaced in 2022 by RFC 9110 (semantics), 9111 (caching), 9112 (HTTP/1.1), 9113
 * (HTTP/2) and 9114 (HTTP/3) -- and most of what people still believe about HTTP that
 * stopped being true comes from having read them. `headers.test.ts` fails the build if an
 * entry ever cites one.
 *
 * Two families are not RFCs at all and are cited honestly rather than approximately: the
 * `Access-Control-*` fields are defined by the WHATWG Fetch Standard, and `X-Request-Id`
 * is defined by nobody, which is itself the thing worth knowing about it.
 */

/** Which direction a field travels in. */
export type HeaderDirection =
  /** Only meaningful on a request. */
  | 'request'
  /** Only meaningful on a response. */
  | 'response'
  /** Sent in both directions, usually meaning slightly different things. */
  | 'both';

/** Where a field is defined. Not every field on the wire has an RFC behind it. */
export type SpecRef =
  | {
      readonly kind: 'rfc';
      readonly rfc: number;
      readonly section?: string;
      readonly title: string;
    }
  | {
      readonly kind: 'living';
      /** The document's short name, e.g. `WHATWG Fetch`. */
      readonly spec: string;
      readonly section?: string;
      readonly title: string;
    }
  | {
      readonly kind: 'none';
      /** Why there is nothing to cite. */
      readonly note: string;
    };

/** `RFC 9110 §8.6`, `WHATWG Fetch §3.2.3`, or the fact that there is no citation. */
export function formatSpec(ref: SpecRef): string {
  if (ref.kind === 'none') return 'No specification';
  const section = ref.section ? ` §${ref.section}` : '';
  return ref.kind === 'rfc' ? `RFC ${ref.rfc}${section}` : `${ref.spec}${section}`;
}

/** One field, explained. */
export interface HeaderExplanation {
  /** Canonical casing, as the wire view prints it. Matching is case-insensitive. */
  readonly name: string;
  readonly direction: HeaderDirection;
  /** Who actually puts this on the wire -- rarely the person writing the code. */
  readonly setBy: string;
  /** What it does, in one or two sentences. */
  readonly what: string;
  /** The sharp edge: what it does *not* do, or what people get wrong about it. */
  readonly detail?: string;
  readonly reference: SpecRef;
}

const SEMANTICS = 'HTTP Semantics';
const CACHING = 'HTTP Caching';
const COOKIES = 'HTTP State Management Mechanism';
const FETCH = 'WHATWG Fetch';
const CORS_PROTOCOL = 'CORS protocol';
const PREFLIGHT = 'CORS preflight request';

/**
 * The catalogue, grouped by what a field is *about* rather than alphabetically.
 *
 * Alphabetical order would separate `ETag` from `If-None-Match`, which is the one pairing
 * a reader most needs to see together.
 */
export const HEADER_EXPLANATIONS: readonly HeaderExplanation[] = [
  // -------------------------------------------------------------------------
  // Addressing and framing
  // -------------------------------------------------------------------------
  {
    name: 'Host',
    direction: 'request',
    setBy: 'The browser, from the URL. Mandatory -- a request without it is a 400.',
    what: 'Names which site on this server the request is for.',
    detail:
      'The request-line carries only a path, so without Host a server holding a thousand ' +
      'sites on one address would have no way to tell which one a path belongs to. This ' +
      'field is the entire reason one IP address can serve more than one website. HTTP/2 ' +
      'and HTTP/3 carry the same information as the :authority pseudo-header instead.',
    reference: { kind: 'rfc', rfc: 9110, section: '7.2', title: SEMANTICS },
  },
  {
    name: 'Content-Length',
    direction: 'both',
    setBy: 'Whichever end is sending content.',
    what: 'How many octets of body follow the blank line.',
    detail:
      'Octets, not characters. A body containing an accented letter is one character and ' +
      'two bytes, and a sender that counted characters would truncate itself and leave ' +
      'the connection out of step for whatever came next. Together with the blank line ' +
      'it is the whole of HTTP/1.1 framing, which is why two servers on one path ' +
      'disagreeing about it is the basis of request smuggling.',
    reference: { kind: 'rfc', rfc: 9110, section: '8.6', title: SEMANTICS },
  },
  {
    name: 'Content-Type',
    direction: 'both',
    setBy: 'The sender of the content.',
    what: 'The media type of the body, and for text the charset it is encoded in.',
    detail:
      'The browser believes this over the file extension and over the bytes themselves. ' +
      'It is also a CORS boundary: a cross-origin POST of application/json needs a ' +
      'preflight, while the same POST as text/plain does not, because an HTML form could ' +
      'always have sent the latter.',
    reference: { kind: 'rfc', rfc: 9110, section: '8.3', title: SEMANTICS },
  },
  {
    name: 'Connection',
    direction: 'both',
    setBy: 'The HTTP/1.1 implementation at each end.',
    what: 'Controls whether the connection stays open, and names hop-by-hop fields.',
    detail:
      'Connections persist by default in HTTP/1.1, so this is mostly seen carrying ' +
      'close. It is forbidden outright in HTTP/2 and HTTP/3, where connection management ' +
      'belongs to the framing layer rather than to a field a proxy might forward by ' +
      'accident.',
    reference: { kind: 'rfc', rfc: 9112, section: '9.6', title: 'HTTP/1.1' },
  },
  {
    name: 'Date',
    direction: 'both',
    setBy: 'The origin server, when the response was generated.',
    what: 'When this message left its sender, as an absolute instant.',
    detail:
      'Caches subtract from it to work out how old a stored copy is, which means a ' +
      'server whose clock is wrong makes every cache downstream of it wrong in the same ' +
      'direction. That is the reason max-age -- a relative number nobody has to agree a ' +
      'clock for -- beats Expires.',
    reference: { kind: 'rfc', rfc: 9110, section: '6.6.1', title: SEMANTICS },
  },
  {
    name: 'Server',
    direction: 'response',
    setBy: 'The origin server, if it feels like it.',
    what: 'What software produced the response.',
    detail:
      'Advisory, and often trimmed or faked, because a precise version string tells an ' +
      'attacker which vulnerabilities to try first. Never branch on it.',
    reference: { kind: 'rfc', rfc: 9110, section: '10.2.4', title: SEMANTICS },
  },

  // -------------------------------------------------------------------------
  // Content negotiation
  // -------------------------------------------------------------------------
  {
    name: 'Accept',
    direction: 'request',
    setBy: 'The browser, or the code calling fetch.',
    what: 'Which media types the client can handle, with relative preferences.',
    detail:
      'The q values are weights rather than an ordering: */*;q=0.8 means "anything, but ' +
      'I would rather have one of the types above". A server is free to ignore the whole ' +
      'field and send what it has.',
    reference: { kind: 'rfc', rfc: 9110, section: '12.5.1', title: SEMANTICS },
  },
  {
    name: 'Accept-Language',
    direction: 'request',
    setBy: 'The browser, from the operating system and browser language settings.',
    what: 'Which natural languages the user would prefer the content in.',
    detail:
      'A response that varies on it must say Vary: Accept-Language, or a shared cache ' +
      'will serve one visitor the German page it stored for another.',
    reference: { kind: 'rfc', rfc: 9110, section: '12.5.4', title: SEMANTICS },
  },
  {
    name: 'Accept-Encoding',
    direction: 'request',
    setBy: 'The browser. Not settable from script.',
    what: 'Which compressions the client can decode -- gzip, br, zstd.',
    detail:
      'This is a coding applied for the trip, not a change of media type: the body is ' +
      'still text/html, it has simply been squeezed. Responses that vary on it must say ' +
      'so in Vary, which is why an uncompressed page occasionally reaches a browser that ' +
      'asked for gzip.',
    reference: { kind: 'rfc', rfc: 9110, section: '12.5.3', title: SEMANTICS },
  },
  {
    name: 'Vary',
    direction: 'response',
    setBy: 'The origin server, when a response depends on the request.',
    what: 'Which request fields a cache must also match before reusing this response.',
    detail:
      'The secondary cache key. Omitting it on a response that does vary is how one user ' +
      'is served another user’s language, another user’s currency, or -- with ' +
      'Vary: Cookie missing -- another user’s logged-in page. Listing too much is ' +
      'merely wasteful; listing too little is a data leak.',
    reference: { kind: 'rfc', rfc: 9110, section: '12.5.5', title: SEMANTICS },
  },
  {
    name: 'User-Agent',
    direction: 'request',
    setBy: 'The browser.',
    what: 'What software is making the request.',
    detail:
      'Decades of servers sniffing this string turned it into a compatibility fiction in ' +
      'which every browser claims to be several other browsers. Feature detection is the ' +
      'answer; this field is not.',
    reference: { kind: 'rfc', rfc: 9110, section: '10.1.5', title: SEMANTICS },
  },
  {
    name: 'Allow',
    direction: 'response',
    setBy: 'The origin server, on a 405.',
    what: 'Which methods the target resource actually supports.',
    detail:
      'Required on a 405 Method Not Allowed. A 405 without it tells the client it is ' +
      'wrong without telling it what would have been right.',
    reference: { kind: 'rfc', rfc: 9110, section: '10.2.1', title: SEMANTICS },
  },

  // -------------------------------------------------------------------------
  // Redirection
  // -------------------------------------------------------------------------
  {
    name: 'Location',
    direction: 'response',
    setBy: 'The origin server, on a 3xx or a 201.',
    what: 'Where to go instead -- or, on a 201, where the thing just created now lives.',
    detail:
      'Which method the browser uses for the second request depends entirely on the ' +
      'status beside it: 303 always switches to GET, 307 and 308 always preserve the ' +
      'method, and 301 and 302 are specified to preserve it but are implemented by every ' +
      'browser to rewrite POST to GET. That gap is exactly why 307 and 308 were added.',
    reference: { kind: 'rfc', rfc: 9110, section: '10.2.2', title: SEMANTICS },
  },

  // -------------------------------------------------------------------------
  // Caching and validators
  // -------------------------------------------------------------------------
  {
    name: 'Cache-Control',
    direction: 'both',
    setBy: 'The origin server on a response; the browser on a reload.',
    what: 'The directives governing whether, where, and for how long this may be reused.',
    detail:
      'no-cache and no-store are different instructions, and the confusion between them ' +
      'is near-universal: no-cache means "store it, but revalidate before every reuse", ' +
      'and no-store means "never write it down at all". max-age binds every cache, ' +
      's-maxage overrides it in shared caches only, and private forbids shared caches ' +
      'from storing the response while leaving the browser free to.',
    reference: { kind: 'rfc', rfc: 9111, section: '5.2', title: CACHING },
  },
  {
    name: 'Expires',
    direction: 'response',
    setBy: 'The origin server.',
    what: 'The absolute instant after which this response is stale.',
    detail:
      'Superseded in practice by Cache-Control: max-age, which wins whenever both are ' +
      'present. Being absolute, it drags both machines’ clocks into the arithmetic; ' +
      'max-age is a duration, and does not.',
    reference: { kind: 'rfc', rfc: 9111, section: '5.3', title: CACHING },
  },
  {
    name: 'Age',
    direction: 'response',
    setBy: 'A shared cache, on the way back.',
    what: 'How many seconds ago this response was generated at the origin.',
    detail:
      'Its presence is the tell that the bytes came from a cache rather than from the ' +
      'origin, and it is subtracted from the freshness lifetime -- a max-age=300 ' +
      'response arriving with Age: 280 has twenty seconds of life left, not three ' +
      'hundred.',
    reference: { kind: 'rfc', rfc: 9111, section: '5.1', title: CACHING },
  },
  {
    name: 'ETag',
    direction: 'response',
    setBy: 'The origin server.',
    what: 'An opaque identifier for this exact version of the resource.',
    detail:
      'Opaque means opaque: never parse it, and never compare it with anything but ' +
      'another ETag. A leading W/ marks it weak, meaning "semantically the same" rather ' +
      'than byte-identical -- enough for caching, not enough for a range request.',
    reference: { kind: 'rfc', rfc: 9110, section: '8.8.3', title: SEMANTICS },
  },
  {
    name: 'Last-Modified',
    direction: 'response',
    setBy: 'The origin server.',
    what: 'When the resource last changed, to the second.',
    detail:
      'A weaker validator than ETag because its resolution is one second: two changes ' +
      'inside the same second are indistinguishable. It doubles as the basis of a ' +
      'heuristic freshness lifetime when a response says nothing about caching at all.',
    reference: { kind: 'rfc', rfc: 9110, section: '8.8.2', title: SEMANTICS },
  },
  {
    name: 'If-None-Match',
    direction: 'request',
    setBy: 'The cache or the browser, from a stored ETag.',
    what: 'Send the body only if the version has changed; otherwise answer 304.',
    detail:
      'This is the whole revalidation mechanism, and the saving is real: a 304 is a ' +
      'couple of hundred bytes of fields against a megabyte of body. When a request ' +
      'carries both this and If-Modified-Since, the entity tag alone decides.',
    reference: { kind: 'rfc', rfc: 9110, section: '13.1.2', title: SEMANTICS },
  },
  {
    name: 'If-Modified-Since',
    direction: 'request',
    setBy: 'The cache or the browser, from a stored Last-Modified.',
    what: 'Send the body only if it has changed since this instant.',
    detail:
      'The fallback when there is no ETag to send. Ignored outright if If-None-Match is ' +
      'present as well.',
    reference: { kind: 'rfc', rfc: 9110, section: '13.1.3', title: SEMANTICS },
  },
  {
    name: 'If-Match',
    direction: 'request',
    setBy: 'The client, deliberately, before a write.',
    what: 'Perform this method only if the resource is still the version I saw.',
    detail:
      'Optimistic concurrency control in one field: a PUT with If-Match and a stale ETag ' +
      'gets a 412 Precondition Failed instead of silently overwriting somebody ' +
      'else’s edit. The mirror image of If-None-Match, used for writing rather than ' +
      'for reading.',
    reference: { kind: 'rfc', rfc: 9110, section: '13.1.1', title: SEMANTICS },
  },
  {
    name: 'If-Unmodified-Since',
    direction: 'request',
    setBy: 'The client, before a write.',
    what: 'Perform this method only if the resource has not changed since this instant.',
    detail:
      'The date-based form of If-Match, with the same one-second resolution problem.',
    reference: { kind: 'rfc', rfc: 9110, section: '13.1.4', title: SEMANTICS },
  },

  // -------------------------------------------------------------------------
  // Identity: cookies and authentication
  // -------------------------------------------------------------------------
  {
    name: 'Set-Cookie',
    direction: 'response',
    setBy: 'The origin server. One field per cookie -- it never folds into a list.',
    what: 'Asks the browser to store a name, a value, and the rules for sending it back.',
    detail:
      'The attributes are the security model. HttpOnly hides the cookie from script and ' +
      'so from XSS; SameSite withholds it from cross-site requests and so from CSRF; ' +
      'Secure keeps it off plaintext connections; and omitting Domain is what makes a ' +
      'cookie host-only, because setting Domain widens its scope rather than narrowing ' +
      'it.',
    reference: { kind: 'rfc', rfc: 6265, section: '4.1', title: COOKIES },
  },
  {
    name: 'Cookie',
    direction: 'request',
    setBy: 'The browser, automatically, on every matching request.',
    what: 'Every stored cookie whose domain, path, and SameSite rules match this request.',
    detail:
      'Automatically is the load-bearing word, and it is the whole of CSRF: the browser ' +
      'attaches these because of where the request is going, not because of who caused ' +
      'it. Longest path first, and the server gets back only names and values -- never ' +
      'the attributes it set them with.',
    reference: { kind: 'rfc', rfc: 6265, section: '4.2', title: COOKIES },
  },
  {
    name: 'Authorization',
    direction: 'request',
    setBy: 'The client, deliberately.',
    what: 'Credentials for the target resource -- a scheme and its parameters.',
    detail:
      'Unlike a cookie, the browser never adds this on its own, which is why token auth ' +
      'is not exposed to CSRF the way session cookies are. Its presence also stops shared ' +
      'caches storing the response unless the response explicitly permits it, and it is ' +
      'not on the CORS safelist, so a cross-origin request carrying one always costs a ' +
      'preflight.',
    reference: { kind: 'rfc', rfc: 9110, section: '11.6.2', title: SEMANTICS },
  },
  {
    name: 'WWW-Authenticate',
    direction: 'response',
    setBy: 'The origin server, on a 401.',
    what: 'Which authentication schemes the resource will accept, and their parameters.',
    detail:
      'Required on a 401. It is the difference between "you are not allowed" and "you ' +
      'are not allowed, and here is how to become allowed" -- which is also the ' +
      'difference between 401 and 403.',
    reference: { kind: 'rfc', rfc: 9110, section: '11.6.1', title: SEMANTICS },
  },

  // -------------------------------------------------------------------------
  // CORS -- the browser's policy, not the server's
  // -------------------------------------------------------------------------
  {
    name: 'Origin',
    direction: 'request',
    setBy: 'The browser. Script can neither set nor forge it.',
    what: 'Which origin the page making this request belongs to -- scheme, host, port.',
    detail:
      'The scheme and host only, never the path, so the server learns which site is ' +
      'asking and nothing about which page. Because the browser controls it and a page ' +
      'cannot, it is the one input a CORS decision can safely be made on.',
    reference: { kind: 'rfc', rfc: 6454, section: '7', title: 'The Web Origin Concept' },
  },
  {
    name: 'Access-Control-Request-Method',
    direction: 'request',
    setBy: 'The browser, on a preflight OPTIONS it sent by itself.',
    what: 'Which method the real request that follows is going to use.',
    detail:
      'Part of asking permission before sending anything an HTML form could not already ' +
      'have sent. The preflight is entirely the browser’s own request: the page ' +
      'never sees it, and cannot suppress it.',
    reference: { kind: 'living', spec: FETCH, section: '3.2.2', title: PREFLIGHT },
  },
  {
    name: 'Access-Control-Request-Headers',
    direction: 'request',
    setBy: 'The browser, on a preflight.',
    what: 'Which non-safelisted fields the real request intends to carry.',
    detail:
      'Any field beyond the tiny safelist -- Authorization, X-Requested-With, anything a ' +
      'framework invented -- lands here and costs a whole extra round trip before the ' +
      'real request may leave. It is the commonest reason a cross-origin API feels slow.',
    reference: { kind: 'living', spec: FETCH, section: '3.2.2', title: PREFLIGHT },
  },
  {
    name: 'Access-Control-Allow-Origin',
    direction: 'response',
    setBy: 'The origin server.',
    what: 'Which origin is permitted to read this response.',
    detail:
      'Read, not send. The request was delivered and executed whether or not this field ' +
      'comes back; without it the browser simply refuses to hand the response to the ' +
      'page. CORS is a rule about disclosure, enforced in the browser -- it is not, and ' +
      'has never been, server-side access control.',
    reference: { kind: 'living', spec: FETCH, section: '3.2.3', title: CORS_PROTOCOL },
  },
  {
    name: 'Access-Control-Allow-Methods',
    direction: 'response',
    setBy: 'The origin server, on a preflight response.',
    what: 'Which methods the real request is allowed to use.',
    detail: 'Answered on the OPTIONS, and cached for Access-Control-Max-Age seconds.',
    reference: { kind: 'living', spec: FETCH, section: '3.2.3', title: CORS_PROTOCOL },
  },
  {
    name: 'Access-Control-Allow-Headers',
    direction: 'response',
    setBy: 'The origin server, on a preflight response.',
    what: 'Which non-safelisted request fields the real request may carry.',
    detail:
      'A field the page intends to send but this list omits fails the preflight, and the ' +
      'real request is never sent at all -- the one case where CORS stops a request ' +
      'rather than a response.',
    reference: { kind: 'living', spec: FETCH, section: '3.2.3', title: CORS_PROTOCOL },
  },
  {
    name: 'Access-Control-Allow-Credentials',
    direction: 'response',
    setBy: 'The origin server.',
    what: 'Whether the page may send cookies with the request and read the response.',
    detail:
      'Cannot be combined with Access-Control-Allow-Origin: *. A credentialed request ' +
      'must be permitted for one named origin, because "any site at all may make ' +
      'authenticated requests here and read the answers" is not a policy anyone means to ' +
      'write.',
    reference: { kind: 'living', spec: FETCH, section: '3.2.3', title: CORS_PROTOCOL },
  },
  {
    name: 'Access-Control-Max-Age',
    direction: 'response',
    setBy: 'The origin server, on a preflight response.',
    what: 'How many seconds the browser may remember this preflight result.',
    detail:
      'Turns the extra round trip from per-request into per-few-minutes. Browsers cap it ' +
      'well below whatever the server asks for.',
    reference: { kind: 'living', spec: FETCH, section: '3.2.3', title: CORS_PROTOCOL },
  },

  // -------------------------------------------------------------------------
  // Not standardised at all
  // -------------------------------------------------------------------------
  {
    name: 'X-Request-Id',
    direction: 'both',
    setBy: 'A load balancer, a gateway, or the application itself.',
    what: 'A correlation id, so one request can be found in several services’ logs.',
    detail:
      'Defined by convention rather than by any specification, which is why the same idea ' +
      'also travels as X-Correlation-Id and as X-Amzn-Trace-Id. The X- prefix convention ' +
      'was deprecated in 2012 (RFC 6648); the field survives because the logs did.',
    reference: {
      kind: 'none',
      note: 'A de facto convention. Standardised tracing uses the W3C traceparent field.',
    },
  },
];

const BY_NAME = new Map(
  HEADER_EXPLANATIONS.map((entry) => [entry.name.toLowerCase(), entry]),
);

/**
 * Explain one field.
 *
 * Case-insensitive, because field names are (RFC 9110 §5.1) and because HTTP/2 and
 * HTTP/3 require them lower-cased on the wire while HTTP/1.1 conventionally title-cases
 * them -- the same field, spelled two ways, has to reach the same entry.
 *
 * `undefined` for anything not catalogued, which the explainer renders as an honest "no
 * entry for this field" rather than inventing one.
 */
export function explainHeader(name: string): HeaderExplanation | undefined {
  return BY_NAME.get(name.trim().toLowerCase());
}

/** How each direction is labelled in the UI. */
export const DIRECTION_LABELS: Readonly<Record<HeaderDirection, string>> = {
  request: 'Request field',
  response: 'Response field',
  both: 'Request and response',
};
