/**
 * Every lesson's metadata, and the navigation built out of it.
 *
 * Deliberately separate from the MDX itself. This file is plain data with no `.mdx`
 * import anywhere in it, which means:
 *
 *  - the track list, the lesson navigation and the progress display can be rendered,
 *    and tested, without compiling a single lesson;
 *  - the coverage test in `coverage.test.ts` -- "every learning topic the spec lists
 *    appears in at least one lesson" -- reads `topics` from here rather than parsing
 *    prose;
 *  - `content/load.ts` is the *only* module that pulls in MDX, so exactly one file has
 *    to change when a lesson is added.
 *
 * The prose, the simulations and the quizzes live in the `.mdx` file. What lives here
 * is what something *other than the lesson* needs to know about it.
 */

/** A specification a lesson cites. Rendered as a link in the lesson footer. */
export interface LessonReference {
  /** Short label, e.g. `RFC 1122`. */
  label: string;
  /** What that document actually says, in a few words. */
  title: string;
  href: string;
}

export interface LessonMeta {
  /** URL segment, and the key progress is stored under. Unique across all tracks. */
  slug: string;
  title: string;
  /** One line, shown on the track card and in the lesson header. */
  summary: string;
  /** Reading time in minutes. The spec's budget for one lesson is 5-10. */
  minutes: number;
  /**
   * Learning topics this lesson covers. These strings are matched against the `topics`
   * on registry entries and against `SPEC_LEARNING_TOPICS`, so they must be spelled
   * exactly as the registry spells them -- that match is what `coverage.test.ts`
   * asserts, in both directions.
   */
  topics: readonly string[];
  /** Registry ids of the modules this lesson sends the reader to next. */
  modules: readonly string[];
  /** Primary sources. Every lesson cites at least one. */
  references: readonly LessonReference[];
}

/**
 * The curriculum: thirty-three lessons, listed in `TRACKS` order.
 *
 * Order in this array is documentation only. `tracks.ts` decides what follows what,
 * and a lesson deliberately does not name the track it belongs to -- see the note at
 * the top of that file.
 */
export const LESSONS: readonly LessonMeta[] = [
  {
    slug: 'what-is-a-network',
    title: 'What a network actually is',
    summary:
      'Two machines, one link, and the smallest possible agreement about how to take turns.',
    minutes: 6,
    topics: ['TCP/IP', 'Routing', 'Topology'],
    modules: ['network-map', 'packet-journey'],
    references: [
      {
        label: 'RFC 1122',
        title: 'Requirements for Internet Hosts -- Communication Layers',
        href: 'https://www.rfc-editor.org/rfc/rfc1122',
      },
      {
        label: 'RFC 791',
        title: 'Internet Protocol',
        href: 'https://www.rfc-editor.org/rfc/rfc791',
      },
    ],
  },
  {
    slug: 'addresses-and-subnets',
    title: 'Addresses, subnets, and the default gateway',
    summary:
      'Why your laptop has a number nobody else can reach, and how it decides whether to shout or to ask the router.',
    minutes: 8,
    topics: ['TCP/IP', 'Topology'],
    modules: ['network-map', 'packet-journey'],
    references: [
      {
        label: 'RFC 1918',
        title: 'Address Allocation for Private Internets',
        href: 'https://www.rfc-editor.org/rfc/rfc1918',
      },
      {
        label: 'RFC 4632',
        title: 'Classless Inter-domain Routing (CIDR)',
        href: 'https://www.rfc-editor.org/rfc/rfc4632',
      },
      {
        label: 'RFC 2131',
        title: 'Dynamic Host Configuration Protocol',
        href: 'https://www.rfc-editor.org/rfc/rfc2131',
      },
    ],
  },
  {
    slug: 'routing-and-the-path-between',
    title: 'Routing: how a packet finds its way',
    summary:
      'Nobody knows the whole route. Every router knows one thing -- which way is closer -- and that is enough.',
    minutes: 9,
    topics: ['TCP/IP', 'Routing', 'Topology'],
    modules: ['network-map', 'packet-journey'],
    references: [
      {
        label: 'RFC 1812',
        title: 'Requirements for IP Version 4 Routers',
        href: 'https://www.rfc-editor.org/rfc/rfc1812',
      },
      {
        label: 'RFC 4271',
        title: 'A Border Gateway Protocol 4 (BGP-4)',
        href: 'https://www.rfc-editor.org/rfc/rfc4271',
      },
      {
        label: 'RFC 791',
        title: 'Internet Protocol',
        href: 'https://www.rfc-editor.org/rfc/rfc791',
      },
    ],
  },
  {
    slug: 'tcp-and-udp',
    title: 'TCP and UDP: two ways to use a network',
    summary:
      'One transport rebuilds reliability out of unreliable parts. The other hands you the parts.',
    minutes: 9,
    topics: ['TCP/IP', 'UDP'],
    modules: ['packet-journey', 'dns-explorer'],
    references: [
      {
        label: 'RFC 9293',
        title: 'Transmission Control Protocol (TCP)',
        href: 'https://www.rfc-editor.org/rfc/rfc9293',
      },
      {
        label: 'RFC 768',
        title: 'User Datagram Protocol',
        href: 'https://www.rfc-editor.org/rfc/rfc768',
      },
      {
        label: 'RFC 1191',
        title: 'Path MTU Discovery',
        href: 'https://www.rfc-editor.org/rfc/rfc1191',
      },
    ],
  },
  {
    slug: 'from-url-to-pixels',
    title: 'From a URL to pixels',
    summary:
      'Five stages between pressing Enter and seeing anything, and the request is only the fourth of them.',
    minutes: 9,
    topics: ['DNS', 'TCP/IP', 'SSL/TLS', 'HTTP'],
    modules: ['internet-simulator', 'dns-explorer', 'https-explorer'],
    references: [
      {
        label: 'RFC 3986',
        title: 'Uniform Resource Identifier (URI): Generic Syntax',
        href: 'https://www.rfc-editor.org/rfc/rfc3986',
      },
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
      {
        label: 'RFC 8446',
        title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
        href: 'https://www.rfc-editor.org/rfc/rfc8446',
      },
    ],
  },
  {
    slug: 'the-second-visit',
    title: 'The second visit',
    summary:
      'The same page again, minutes later. Four different mechanisms each remove a different part of the cost.',
    minutes: 8,
    topics: ['Caching', 'HTTP', 'SSL/TLS', 'DNS'],
    modules: ['internet-simulator', 'http-explorer'],
    references: [
      {
        label: 'RFC 9111',
        title: 'HTTP Caching',
        href: 'https://www.rfc-editor.org/rfc/rfc9111',
      },
      {
        label: 'RFC 8446',
        title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
        href: 'https://www.rfc-editor.org/rfc/rfc8446',
      },
      {
        label: 'RFC 1035',
        title: 'Domain Names -- Implementation and Specification',
        href: 'https://www.rfc-editor.org/rfc/rfc1035',
      },
    ],
  },
  {
    slug: 'why-pages-feel-slow',
    title: 'Why pages feel slow',
    summary:
      'A fast link on the far side of the planet is still slow, and no amount of bandwidth fixes it.',
    minutes: 8,
    topics: ['TCP/IP', 'HTTP'],
    modules: ['internet-simulator', 'http-explorer'],
    references: [
      {
        label: 'RFC 9293',
        title: 'Transmission Control Protocol (TCP)',
        href: 'https://www.rfc-editor.org/rfc/rfc9293',
      },
      {
        label: 'RFC 9000',
        title: 'QUIC: A UDP-Based Multiplexed and Secure Transport',
        href: 'https://www.rfc-editor.org/rfc/rfc9000',
      },
      {
        label: 'RFC 9114',
        title: 'HTTP/3',
        href: 'https://www.rfc-editor.org/rfc/rfc9114',
      },
    ],
  },
  {
    slug: 'when-a-page-load-fails',
    title: 'When a page load fails',
    summary:
      'Three failures that look identical in a browser and are nothing alike underneath -- told apart by how long they take.',
    minutes: 8,
    topics: ['DNS', 'SSL/TLS', 'TCP/IP', 'HTTPS'],
    modules: ['internet-simulator', 'network-diagnostics'],
    references: [
      {
        label: 'RFC 2308',
        title: 'Negative Caching of DNS Queries (DNS NCACHE)',
        href: 'https://www.rfc-editor.org/rfc/rfc2308',
      },
      {
        label: 'RFC 8446',
        title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
        href: 'https://www.rfc-editor.org/rfc/rfc8446',
      },
      {
        label: 'RFC 9293',
        title: 'Transmission Control Protocol (TCP)',
        href: 'https://www.rfc-editor.org/rfc/rfc9293',
      },
    ],
  },
  {
    slug: 'how-a-name-is-resolved',
    title: 'How a name is resolved',
    summary:
      'Nobody holds a list of every domain. The answer is found by asking three servers, none of which knows it.',
    minutes: 9,
    topics: ['DNS', 'UDP'],
    modules: ['dns-explorer', 'packet-journey'],
    references: [
      {
        label: 'RFC 1034',
        title: 'Domain Names -- Concepts and Facilities',
        href: 'https://www.rfc-editor.org/rfc/rfc1034',
      },
      {
        label: 'RFC 1035',
        title: 'Domain Names -- Implementation and Specification',
        href: 'https://www.rfc-editor.org/rfc/rfc1035',
      },
      {
        label: 'RFC 7766',
        title: 'DNS Transport over TCP -- Implementation Requirements',
        href: 'https://www.rfc-editor.org/rfc/rfc7766',
      },
    ],
  },
  {
    slug: 'records-aliases-and-delegation',
    title: 'Records, aliases, and delegation',
    summary:
      'A zone is a piece of the tree somebody was handed. A CNAME is how they hand part of it on again.',
    minutes: 8,
    topics: ['DNS', 'CDN'],
    modules: ['dns-explorer'],
    references: [
      {
        label: 'RFC 1034',
        title: 'Domain Names -- Concepts and Facilities',
        href: 'https://www.rfc-editor.org/rfc/rfc1034',
      },
      {
        label: 'RFC 2181',
        title: 'Clarifications to the DNS Specification',
        href: 'https://www.rfc-editor.org/rfc/rfc2181',
      },
      {
        label: 'RFC 1035',
        title: 'Domain Names -- Implementation and Specification',
        href: 'https://www.rfc-editor.org/rfc/rfc1035',
      },
    ],
  },
  {
    slug: 'dns-caching-and-ttl',
    title: 'Caching, TTLs, and saying no',
    summary:
      'Almost every DNS query in the world is answered from memory. This is the lesson about the ones that are not.',
    minutes: 8,
    topics: ['DNS', 'Caching'],
    modules: ['dns-explorer'],
    references: [
      {
        label: 'RFC 1035',
        title: 'Domain Names -- Implementation and Specification',
        href: 'https://www.rfc-editor.org/rfc/rfc1035',
      },
      {
        label: 'RFC 2308',
        title: 'Negative Caching of DNS Queries (DNS NCACHE)',
        href: 'https://www.rfc-editor.org/rfc/rfc2308',
      },
      {
        label: 'RFC 8767',
        title: 'Serving Stale Data to Improve DNS Resiliency',
        href: 'https://www.rfc-editor.org/rfc/rfc8767',
      },
    ],
  },
  {
    slug: 'dnssec-and-the-chain-of-trust',
    title: 'DNSSEC and the chain of trust',
    summary:
      'DNS answers arrive unauthenticated. DNSSEC does not encrypt them -- it lets you prove they were not edited.',
    minutes: 9,
    topics: ['DNS', 'Certificates'],
    modules: ['dns-explorer', 'https-explorer'],
    references: [
      {
        label: 'RFC 4033',
        title: 'DNS Security Introduction and Requirements',
        href: 'https://www.rfc-editor.org/rfc/rfc4033',
      },
      {
        label: 'RFC 4034',
        title: 'Resource Records for the DNS Security Extensions',
        href: 'https://www.rfc-editor.org/rfc/rfc4034',
      },
      {
        label: 'RFC 4035',
        title: 'Protocol Modifications for the DNS Security Extensions',
        href: 'https://www.rfc-editor.org/rfc/rfc4035',
      },
    ],
  },
  {
    slug: 'anatomy-of-an-http-message',
    title: 'The anatomy of an HTTP message',
    summary:
      'A request is a line, some fields, a blank line, and maybe a body. That blank line does more work than it looks like.',
    minutes: 8,
    topics: ['HTTP'],
    modules: ['http-explorer', 'api-visualizer'],
    references: [
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
      {
        label: 'RFC 9112',
        title: 'HTTP/1.1',
        href: 'https://www.rfc-editor.org/rfc/rfc9112',
      },
    ],
  },
  {
    slug: 'status-codes-and-redirects',
    title: 'Status codes and redirects',
    summary:
      'Three digits that tell a client what to do next -- and four redirect codes that disagree about what to do with a POST.',
    minutes: 7,
    topics: ['HTTP'],
    modules: ['http-explorer', 'api-visualizer'],
    references: [
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
      {
        label: 'RFC 9112',
        title: 'HTTP/1.1',
        href: 'https://www.rfc-editor.org/rfc/rfc9112',
      },
    ],
  },
  {
    slug: 'http-caching',
    title: 'HTTP caching',
    summary:
      'The fastest request is the one never sent. The second fastest comes back with no body at all.',
    minutes: 9,
    topics: ['HTTP', 'Caching'],
    modules: ['http-explorer', 'internet-simulator'],
    references: [
      {
        label: 'RFC 9111',
        title: 'HTTP Caching',
        href: 'https://www.rfc-editor.org/rfc/rfc9111',
      },
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
    ],
  },
  {
    slug: 'cookies-and-sessions',
    title: 'Cookies and sessions',
    summary:
      'HTTP forgets you between requests. A session is a value the server asks the browser to keep repeating.',
    minutes: 9,
    topics: ['HTTP', 'Cookies', 'Sessions', 'Authentication'],
    modules: ['http-explorer', 'api-visualizer'],
    references: [
      {
        label: 'RFC 6265',
        title: 'HTTP State Management Mechanism',
        href: 'https://www.rfc-editor.org/rfc/rfc6265',
      },
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
    ],
  },
  {
    slug: 'cross-origin-requests',
    title: 'Origins, CORS, and the preflight',
    summary:
      'The browser sends the request anyway. What it withholds is the answer -- and that distinction is the whole model.',
    minutes: 8,
    topics: ['HTTP', 'APIs'],
    modules: ['http-explorer', 'api-visualizer'],
    references: [
      {
        label: 'RFC 6454',
        title: 'The Web Origin Concept',
        href: 'https://www.rfc-editor.org/rfc/rfc6454',
      },
      {
        label: 'Fetch Standard',
        title: 'The living standard that defines CORS, preflights, and request modes',
        href: 'https://fetch.spec.whatwg.org/',
      },
    ],
  },
  {
    slug: 'http-1-2-and-3',
    title: 'HTTP/1.1, HTTP/2, HTTP/3',
    summary:
      'Three versions of one set of semantics, differing only in how bytes are framed -- each fixing the queue the last one left.',
    minutes: 9,
    topics: ['HTTP', 'TCP/IP'],
    modules: ['http-explorer', 'internet-simulator'],
    references: [
      {
        label: 'RFC 9113',
        title: 'HTTP/2',
        href: 'https://www.rfc-editor.org/rfc/rfc9113',
      },
      {
        label: 'RFC 9114',
        title: 'HTTP/3',
        href: 'https://www.rfc-editor.org/rfc/rfc9114',
      },
      {
        label: 'RFC 9000',
        title: 'QUIC: A UDP-Based Multiplexed and Secure Transport',
        href: 'https://www.rfc-editor.org/rfc/rfc9000',
      },
    ],
  },
  {
    slug: 'what-tls-actually-does',
    title: 'What TLS actually does',
    summary:
      'Three guarantees, negotiated in one round trip, over a wire the attacker is reading the whole time.',
    minutes: 9,
    topics: ['HTTPS', 'SSL/TLS'],
    modules: ['https-explorer', 'internet-simulator'],
    references: [
      {
        label: 'RFC 8446',
        title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
        href: 'https://www.rfc-editor.org/rfc/rfc8446',
      },
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
    ],
  },
  {
    slug: 'certificates-and-trust',
    title: 'Certificates, and where trust comes from',
    summary:
      'A certificate is a signed claim about a name. Three separate checks can fail it, and the browser says so differently each time.',
    minutes: 9,
    topics: ['HTTPS', 'SSL/TLS', 'Certificates'],
    modules: ['https-explorer'],
    references: [
      {
        label: 'RFC 5280',
        title: 'Internet X.509 Public Key Infrastructure Certificate and CRL Profile',
        href: 'https://www.rfc-editor.org/rfc/rfc5280',
      },
      {
        label: 'RFC 9525',
        title: 'Service Identity in TLS',
        href: 'https://www.rfc-editor.org/rfc/rfc9525',
      },
      {
        label: 'RFC 6960',
        title: 'X.509 Internet PKI Online Certificate Status Protocol (OCSP)',
        href: 'https://www.rfc-editor.org/rfc/rfc6960',
      },
    ],
  },
  {
    slug: 'handshakes-and-resumption',
    title: 'Handshakes, versions, and resumption',
    summary:
      'TLS 1.2 needed two round trips and told the world who you were talking to. TLS 1.3 needs one, or none.',
    minutes: 9,
    topics: ['SSL/TLS', 'HTTPS', 'Caching'],
    modules: ['https-explorer', 'internet-simulator'],
    references: [
      {
        label: 'RFC 8446',
        title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
        href: 'https://www.rfc-editor.org/rfc/rfc8446',
      },
      {
        label: 'RFC 5246',
        title: 'The Transport Layer Security (TLS) Protocol Version 1.2',
        href: 'https://www.rfc-editor.org/rfc/rfc5246',
      },
    ],
  },
  {
    slug: 'what-https-does-not-protect',
    title: 'What HTTPS does not protect',
    summary:
      'The padlock is a statement about a name and a key. It says nothing about who holds them or what they do with your data.',
    minutes: 8,
    topics: ['HTTPS', 'SSL/TLS', 'Certificates', 'DNS'],
    modules: ['https-explorer', 'network-diagnostics'],
    references: [
      {
        label: 'RFC 8446',
        title: 'The Transport Layer Security (TLS) Protocol Version 1.3',
        href: 'https://www.rfc-editor.org/rfc/rfc8446',
      },
      {
        label: 'RFC 6797',
        title: 'HTTP Strict Transport Security (HSTS)',
        href: 'https://www.rfc-editor.org/rfc/rfc6797',
      },
      {
        label: 'RFC 8484',
        title: 'DNS Queries over HTTPS (DoH)',
        href: 'https://www.rfc-editor.org/rfc/rfc8484',
      },
    ],
  },
  {
    slug: 'rest-and-resources',
    title: 'REST, and what GraphQL changes',
    summary:
      'Nouns in the URL, verbs in the method -- and the one query language that throws that arrangement out.',
    minutes: 9,
    topics: ['APIs', 'HTTP'],
    modules: ['api-visualizer', 'http-explorer'],
    references: [
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
      {
        label: 'GraphQL',
        title: 'The GraphQL specification',
        href: 'https://spec.graphql.org/',
      },
    ],
  },
  {
    slug: 'api-authentication',
    title: 'API authentication',
    summary:
      'A key says who you are. A token says who you are and what you may do. Neither is a secret once it is in a URL.',
    minutes: 9,
    topics: ['APIs', 'Authentication', 'HTTP'],
    modules: ['api-visualizer', 'http-explorer'],
    references: [
      {
        label: 'RFC 6750',
        title: 'The OAuth 2.0 Authorization Framework: Bearer Token Usage',
        href: 'https://www.rfc-editor.org/rfc/rfc6750',
      },
      {
        label: 'RFC 6749',
        title: 'The OAuth 2.0 Authorization Framework',
        href: 'https://www.rfc-editor.org/rfc/rfc6749',
      },
      {
        label: 'RFC 7636',
        title: 'Proof Key for Code Exchange by OAuth Public Clients',
        href: 'https://www.rfc-editor.org/rfc/rfc7636',
      },
      {
        label: 'RFC 7519',
        title: 'JSON Web Token (JWT)',
        href: 'https://www.rfc-editor.org/rfc/rfc7519',
      },
    ],
  },
  {
    slug: 'pagination-and-rate-limits',
    title: 'Pagination and rate limits',
    summary:
      'Two problems that only appear at scale: a list that changes while you read it, and a client that wants everything at once.',
    minutes: 9,
    topics: ['APIs', 'HTTP', 'Caching'],
    modules: ['api-visualizer'],
    references: [
      {
        label: 'RFC 8288',
        title: 'Web Linking',
        href: 'https://www.rfc-editor.org/rfc/rfc8288',
      },
      {
        label: 'RFC 6585',
        title: 'Additional HTTP Status Codes',
        href: 'https://www.rfc-editor.org/rfc/rfc6585',
      },
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
    ],
  },
  {
    slug: 'webhooks',
    title: 'Webhooks: when the API calls you',
    summary:
      'Reverse the arrow and every assumption changes. Your endpoint is now a server, and it will be called twice.',
    minutes: 8,
    topics: ['APIs', 'Authentication', 'HTTP'],
    modules: ['api-visualizer'],
    references: [
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
      {
        label: 'RFC 9421',
        title: 'HTTP Message Signatures',
        href: 'https://www.rfc-editor.org/rfc/rfc9421',
      },
    ],
  },
  {
    slug: 'choosing-a-realtime-transport',
    title: 'Choosing a real-time transport',
    summary:
      'Polling, long polling, SSE and WebSocket, priced in requests and bytes over the same sixty seconds.',
    minutes: 8,
    topics: ['WebSockets', 'HTTP', 'APIs'],
    modules: ['websocket-viewer', 'api-visualizer'],
    references: [
      {
        label: 'RFC 6455',
        title: 'The WebSocket Protocol',
        href: 'https://www.rfc-editor.org/rfc/rfc6455',
      },
      {
        label: 'HTML: Server-sent events',
        title: 'The living standard that defines EventSource and Last-Event-ID',
        href: 'https://html.spec.whatwg.org/multipage/server-sent-events.html',
      },
    ],
  },
  {
    slug: 'the-websocket-upgrade',
    title: 'The upgrade, and the frames after it',
    summary:
      'It starts as an ordinary GET. One blank line later HTTP is gone, and the same socket carries frames both ways.',
    minutes: 9,
    topics: ['WebSockets', 'HTTP', 'TCP/IP'],
    modules: ['websocket-viewer', 'http-explorer'],
    references: [
      {
        label: 'RFC 6455',
        title: 'The WebSocket Protocol',
        href: 'https://www.rfc-editor.org/rfc/rfc6455',
      },
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
    ],
  },
  {
    slug: 'keeping-a-websocket-alive',
    title: 'Keeping a WebSocket alive',
    summary:
      'An open socket is not a working one. Three things go wrong here, and two of them are silent.',
    minutes: 8,
    topics: ['WebSockets', 'TCP/IP'],
    modules: ['websocket-viewer', 'network-diagnostics'],
    references: [
      {
        label: 'RFC 6455',
        title: 'The WebSocket Protocol',
        href: 'https://www.rfc-editor.org/rfc/rfc6455',
      },
      {
        label: 'RFC 9293',
        title: 'Transmission Control Protocol (TCP)',
        href: 'https://www.rfc-editor.org/rfc/rfc9293',
      },
    ],
  },
  {
    slug: 'cdns-and-the-edge',
    title: 'CDNs and the edge',
    summary:
      'A shared HTTP cache a few milliseconds away, obeying the same rules you already know from the browser cache.',
    minutes: 8,
    topics: ['CDN', 'Caching', 'DNS', 'HTTP'],
    modules: ['internet-simulator', 'dns-explorer'],
    references: [
      {
        label: 'RFC 9111',
        title: 'HTTP Caching',
        href: 'https://www.rfc-editor.org/rfc/rfc9111',
      },
      {
        label: 'RFC 7871',
        title: 'Client Subnet in DNS Queries',
        href: 'https://www.rfc-editor.org/rfc/rfc7871',
      },
      {
        label: 'RFC 4786',
        title: 'Operation of Anycast Services',
        href: 'https://www.rfc-editor.org/rfc/rfc4786',
      },
    ],
  },
  {
    slug: 'load-balancers-and-reverse-proxies',
    title: 'Load balancers and reverse proxies',
    summary:
      'One hostname, a dozen machines. Everything between the edge and the database, and why each layer is there.',
    minutes: 9,
    topics: ['Load Balancers', 'Reverse Proxy', 'Topology', 'HTTPS'],
    modules: ['network-map', 'internet-simulator'],
    references: [
      {
        label: 'RFC 9110',
        title: 'HTTP Semantics',
        href: 'https://www.rfc-editor.org/rfc/rfc9110',
      },
      {
        label: 'RFC 7239',
        title: 'Forwarded HTTP Extension',
        href: 'https://www.rfc-editor.org/rfc/rfc7239',
      },
      {
        label: 'RFC 3234',
        title: 'Middleboxes: Taxonomy and Issues',
        href: 'https://www.rfc-editor.org/rfc/rfc3234',
      },
    ],
  },
  {
    slug: 'nat-and-private-addresses',
    title: 'NAT and private addresses',
    summary:
      'There were never enough IPv4 addresses. NAT is the workaround almost every home network on Earth runs on.',
    minutes: 8,
    topics: ['TCP/IP', 'Topology'],
    modules: ['network-map', 'packet-journey'],
    references: [
      {
        label: 'RFC 1918',
        title: 'Address Allocation for Private Internets',
        href: 'https://www.rfc-editor.org/rfc/rfc1918',
      },
      {
        label: 'RFC 3022',
        title: 'Traditional IP Network Address Translator (Traditional NAT)',
        href: 'https://www.rfc-editor.org/rfc/rfc3022',
      },
      {
        label: 'RFC 4787',
        title: 'NAT Behavioral Requirements for Unicast UDP',
        href: 'https://www.rfc-editor.org/rfc/rfc4787',
      },
    ],
  },
  {
    slug: 'firewalls-and-segmentation',
    title: 'Firewalls and segmentation',
    summary:
      'A firewall is a policy at a boundary. The interesting decision is where you put the boundary.',
    minutes: 8,
    topics: ['TCP/IP', 'Topology'],
    modules: ['network-map', 'network-diagnostics'],
    references: [
      {
        label: 'RFC 2979',
        title: 'Behavior of and Requirements for Internet Firewalls',
        href: 'https://www.rfc-editor.org/rfc/rfc2979',
      },
      {
        label: 'RFC 1918',
        title: 'Address Allocation for Private Internets',
        href: 'https://www.rfc-editor.org/rfc/rfc1918',
      },
      {
        label: 'RFC 4949',
        title: 'Internet Security Glossary, Version 2',
        href: 'https://www.rfc-editor.org/rfc/rfc4949',
      },
    ],
  },
];

/** Look a lesson up by slug. */
export function getLesson(slug: string): LessonMeta | undefined {
  return LESSONS.find((lesson) => lesson.slug === slug);
}
