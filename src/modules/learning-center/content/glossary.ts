/**
 * One term list for the whole product.
 *
 * Both surfaces read this file and there is no second copy: `<Term>` shows `short` in
 * a popover wherever a lesson wraps a word, and `/learn/glossary` shows `definition`
 * plus the links. That is the point of a glossary -- a reader who meets "MTU" in three
 * lessons must meet the same sentence three times, or the definition is not a
 * definition.
 *
 * Writing rules, so the popover stays a popover:
 *
 *  - `short` is **one sentence** and must make sense with no surrounding context. It
 *    is what someone sees mid-paragraph, and a reader who has to parse two clauses to
 *    get back to the sentence they were reading has been interrupted, not helped.
 *  - `definition` is two or three sentences and may assume the reader came looking.
 *  - `aliases` exist so a lesson can write `<Term>packets</Term>` in the natural
 *    plural, or `<Term>MTU</Term>` where the entry is spelled out.
 *  - `modules` are registry ids, `lessons` are slugs. Both are checked by the content
 *    test, so a renamed module or a deleted lesson fails the suite rather than
 *    rendering a dead link on the glossary page.
 */

export interface GlossaryTerm {
  /** Stable key. What `<Term id="...">` refers to, and the anchor on the glossary. */
  id: string;
  /** How the term is written when the glossary lists it. */
  term: string;
  /** Other spellings a lesson may legitimately use, matched case-insensitively. */
  aliases?: readonly string[];
  /** One sentence. This is the popover. */
  short: string;
  /** The fuller entry, shown on the glossary page. */
  definition: string;
  /** Registry ids of modules that show this concept running. */
  modules?: readonly string[];
  /** Lesson slugs that teach it. */
  lessons?: readonly string[];
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    id: 'protocol',
    term: 'protocol',
    aliases: ['protocols'],
    short:
      'An agreement about the format and ordering of messages, so two machines written by strangers can still understand each other.',
    definition:
      'A protocol fixes what a message looks like on the wire and what each side is allowed to send next. It is the reason a browser written by one company can talk to a server written by another with no prior arrangement. Almost everything in this product is a protocol being taken apart.',
    modules: ['packet-journey', 'internet-simulator'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'packet',
    term: 'packet',
    aliases: ['packets'],
    short:
      'A small, self-describing chunk of data: a header saying where it is going, followed by the bytes being carried.',
    definition:
      'Networks move packets rather than whole files because a shared link has to be shared. Splitting data into bounded chunks lets many conversations interleave on one wire, lets a lost chunk be resent on its own, and lets each chunk be routed independently.',
    modules: ['packet-journey', 'network-map'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'header',
    term: 'header',
    aliases: ['headers'],
    short:
      'The fixed, machine-readable fields at the front of a packet that say what it is and where it is going.',
    definition:
      'Every layer adds its own header in front of whatever the layer above handed down, so a packet on the wire is a stack of envelopes. Routers read only the outer few fields they need; the payload inside is none of their business.',
    modules: ['packet-journey', 'http-explorer'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'payload',
    term: 'payload',
    short:
      'The part of a packet that is the actual message, as opposed to the headers describing it.',
    definition:
      'The payload of one layer is the entire packet of the next, headers and all. That nesting is what lets HTTP travel over TCP over IP without any of the three knowing much about the others.',
    modules: ['packet-journey'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'host',
    term: 'host',
    aliases: ['hosts'],
    short:
      'Any machine that sends or receives traffic in its own right, rather than only forwarding it.',
    definition:
      'Your laptop is a host; so is the server it fetches a page from. The distinction that matters is against a router, which forwards packets addressed to other machines and is not an endpoint of the conversation.',
    modules: ['network-map'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'router',
    term: 'router',
    aliases: ['routers'],
    short:
      'A machine whose job is to accept a packet on one link and forward it out of another, closer to its destination.',
    definition:
      'A router makes one decision per packet, using only the destination address and its own table: which way next. It has no memory of the conversation and no view of the whole path, which is exactly why the Internet scales.',
    modules: ['network-map', 'packet-journey'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'ip-address',
    term: 'IP address',
    aliases: ['IP', 'IP addresses', 'address'],
    short:
      'The number that identifies where on the network an interface is, so a packet can be routed to it.',
    definition:
      'An IP address names a location in the network rather than a machine: move a laptop to another network and it gets a different one. That is the difference between an address and a name, and it is the reason DNS exists.',
    modules: ['network-map', 'dns-explorer'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'hop',
    term: 'hop',
    aliases: ['hops'],
    short:
      'One step of the journey a packet makes: the crossing of a single link from one router to the next.',
    definition:
      'Path length is counted in hops because that is what a packet actually experiences. Each hop is a fresh forwarding decision, a fresh queue, and one decrement of the TTL that stops a looping packet from circulating forever.',
    modules: ['packet-journey', 'network-diagnostics'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'latency',
    term: 'latency',
    short:
      'How long one message takes to get there -- a delay, measured in milliseconds, not a quantity of data.',
    definition:
      'Latency and bandwidth are independent: a link can be enormously fast and still slow to answer. Distance sets a floor no amount of money removes, which is why the fastest request is the one that is never made.',
    modules: ['internet-simulator', 'network-diagnostics'],
    lessons: ['what-is-a-network'],
  },
  {
    id: 'bandwidth',
    term: 'bandwidth',
    short: 'How much data a link can carry per second, once it has started carrying it.',
    definition:
      'Bandwidth describes a rate; latency describes a delay. Confusing the two is behind most wrong guesses about why a page is slow, because a page load is usually dozens of small round trips rather than one large transfer.',
    modules: ['internet-simulator'],
    lessons: ['what-is-a-network'],
  },

  /*
   * Phase 13.3 vocabulary. Everything above was needed by the first lesson;
   * everything below is a word one of the other thirty-two wraps in <Term>, in
   * roughly the order the curriculum introduces them.
   */
  {
    id: 'subnet',
    term: 'subnet',
    aliases: ['subnets', 'subnet mask', 'netmask', 'prefix length'],
    short:
      'The block of addresses a machine treats as local, written as a prefix length such as /24.',
    definition:
      'The subnet mask is the only thing a host uses to decide whether a destination is reachable directly or has to go through the router. Everything inside the prefix is a neighbour on the same link; everything outside it is somebody else’s problem, handed to the default gateway.',
    modules: ['network-map'],
    lessons: ['addresses-and-subnets', 'firewalls-and-segmentation'],
  },
  {
    id: 'default-gateway',
    term: 'default gateway',
    aliases: ['gateway', 'gateways'],
    short:
      'The router a host sends anything to when the destination is not inside its own subnet.',
    definition:
      'A host has a tiny routing table: one entry for its own subnet, and a default route pointing at the gateway. That is why a laptop needs to know exactly one router address to reach the entire Internet -- every decision after the first is made by somebody else.',
    modules: ['network-map', 'packet-journey'],
    lessons: ['addresses-and-subnets', 'routing-and-the-path-between'],
  },
  {
    id: 'dhcp',
    term: 'DHCP',
    aliases: ['Dynamic Host Configuration Protocol'],
    short:
      'The protocol a machine uses to be told its address, its subnet mask, its gateway and its resolver when it joins a network.',
    definition:
      'DHCP hands out a lease -- an address held for a bounded time and then renewed. It is why plugging a laptop into an unfamiliar network works with no configuration at all, and why the address it gets is not stable across networks or even across days.',
    modules: ['network-map'],
    lessons: ['addresses-and-subnets'],
  },
  {
    id: 'nat',
    term: 'NAT',
    aliases: ['NAPT', 'network address translation'],
    short:
      'Rewriting addresses and ports at a boundary so many private machines can share one public address.',
    definition:
      'The router keeps a table mapping each inside address and port to a port of its own, rewrites outgoing packets, and reverses the rewrite on the way back. It is what lets a household of a dozen devices exist behind one IPv4 address, and it is also why an unsolicited inbound connection has nowhere to go.',
    modules: ['network-map', 'packet-journey'],
    lessons: ['nat-and-private-addresses', 'addresses-and-subnets'],
  },
  {
    id: 'port',
    term: 'port',
    aliases: ['ports', 'port number'],
    short:
      'A sixteen-bit number identifying which conversation on a machine a packet belongs to.',
    definition:
      'An address gets a packet to the right machine; a port gets it to the right program. Ports are a transport-layer idea, which is why TCP and UDP each have their own independent set of them and why NAT can only work for protocols that have them.',
    modules: ['packet-journey', 'network-map'],
    lessons: ['tcp-and-udp', 'nat-and-private-addresses'],
  },
  {
    id: 'tcp',
    term: 'TCP',
    aliases: ['Transmission Control Protocol'],
    short:
      'The transport that turns an unreliable packet network into an ordered, reliable byte stream.',
    definition:
      'TCP numbers every byte, acknowledges what arrived, retransmits what did not, and delivers to the application strictly in order. All of that is built on top of IP, which promises none of it -- and all of it costs a handshake before the first byte of data.',
    modules: ['packet-journey', 'internet-simulator'],
    lessons: ['tcp-and-udp', 'from-url-to-pixels'],
  },
  {
    id: 'udp',
    term: 'UDP',
    aliases: ['User Datagram Protocol', 'datagram', 'datagrams'],
    short: 'The transport that adds ports and a checksum to IP, and nothing else at all.',
    definition:
      'Eight bytes of header, no connection, no acknowledgement, no ordering and no retransmission. That is a feature when an application would rather handle loss itself -- a DNS lookup simply asks again, and a lost video frame is better skipped than delivered late.',
    modules: ['packet-journey', 'dns-explorer'],
    lessons: ['tcp-and-udp', 'how-a-name-is-resolved'],
  },
  {
    id: 'mtu',
    term: 'MTU',
    aliases: ['maximum transmission unit'],
    short:
      'The largest packet a link will carry, typically 1500 bytes on Ethernet and less on anything tunnelled.',
    definition:
      'A packet larger than the MTU of the next link must be fragmented or dropped. Path MTU discovery finds the smallest MTU along a route by sending packets marked Don’t Fragment and reading the ICMP errors that come back.',
    modules: ['packet-journey'],
    lessons: ['tcp-and-udp'],
  },
  {
    id: 'ttl',
    term: 'TTL',
    aliases: ['time to live'],
    short:
      'A budget attached to data that says how much longer it may live -- hops for a packet, seconds for a DNS answer.',
    definition:
      'In an IPv4 header the TTL is a hop counter every router decrements, and a packet that reaches zero is dropped: that is what stops a routing loop from circulating forever. In DNS the same three letters mean a duration in seconds, and are what makes caching safe.',
    modules: ['packet-journey', 'dns-explorer'],
    lessons: ['routing-and-the-path-between', 'dns-caching-and-ttl'],
  },
  {
    id: 'autonomous-system',
    term: 'autonomous system',
    aliases: ['AS', 'autonomous systems', 'AS number', 'ASN'],
    short:
      'One network under one routing policy -- an ISP, a university, a large company -- identified by a number.',
    definition:
      'The Internet is not a graph of routers, it is a graph of about a hundred thousand autonomous systems. Routing inside one is that operator’s private business; routing between them is BGP, and every path you can trace is a sequence of AS numbers.',
    modules: ['network-map'],
    lessons: ['routing-and-the-path-between'],
  },
  {
    id: 'bgp',
    term: 'BGP',
    aliases: ['Border Gateway Protocol'],
    short:
      'The protocol autonomous systems use to tell each other which address blocks they can reach.',
    definition:
      'BGP is a policy protocol wearing a routing protocol’s clothes: a network advertises what it is willing to carry, not what is shortest. That is why traffic between two neighbours can cross a continent, and why a single wrong advertisement can black-hole a large part of the Internet.',
    modules: ['network-map'],
    lessons: ['routing-and-the-path-between'],
  },
  {
    id: 'peering',
    term: 'peering',
    aliases: ['peer', 'transit'],
    short:
      'Two networks exchanging traffic directly, usually without paying each other -- as opposed to transit, which is buying reachability to everywhere.',
    definition:
      'Peering is why a CDN edge is one hop away and a server on another continent is fifteen. The economics decide the topology: networks peer where the traffic is mutual and buy transit where it is not.',
    modules: ['network-map'],
    lessons: ['routing-and-the-path-between', 'cdns-and-the-edge'],
  },
  {
    id: 'dns',
    term: 'DNS',
    aliases: ['Domain Name System'],
    short:
      'The distributed directory that turns a name people can remember into an address a packet can be routed to.',
    definition:
      'No single machine holds the mapping. The namespace is a tree cut into zones, each delegated to somebody, and an answer is found by walking down from the root. Almost every lookup in practice is answered from a cache rather than by walking anything.',
    modules: ['dns-explorer', 'internet-simulator'],
    lessons: ['how-a-name-is-resolved', 'from-url-to-pixels'],
  },
  {
    id: 'resolver',
    term: 'resolver',
    aliases: ['resolvers', 'recursive resolver', 'stub resolver'],
    short:
      'The server that does the looking-up on your behalf, and remembers the answers.',
    definition:
      'Your machine asks one question and waits; the resolver asks as many as it takes -- root, then TLD, then authoritative -- and caches every answer it gets. Everything that makes DNS fast, and everything that makes it a privacy question, lives at the resolver.',
    modules: ['dns-explorer', 'network-diagnostics'],
    lessons: ['how-a-name-is-resolved', 'dns-caching-and-ttl'],
  },
  {
    id: 'authoritative-server',
    term: 'authoritative server',
    aliases: ['authoritative', 'authoritative name server', 'nameserver', 'name server'],
    short:
      'The server that holds a zone’s real data, and the only one that can say a name does not exist.',
    definition:
      'Authoritative servers answer from a zone file rather than from a cache, which is why only they can return NXDOMAIN. Everything else in the chain -- roots, TLDs, resolvers -- either delegates or remembers.',
    modules: ['dns-explorer'],
    lessons: ['how-a-name-is-resolved', 'records-aliases-and-delegation'],
  },
  {
    id: 'zone',
    term: 'zone',
    aliases: ['zones', 'zone cut'],
    short:
      'The slice of the DNS tree that one operator actually administers, bounded by delegations to somebody else.',
    definition:
      'A zone is not the same as a domain: example.com and shop.example.com may be one zone or two, depending on whether a delegation was made between them. Every place the tree changes hands is a zone cut, and every zone cut is where a referral happens.',
    modules: ['dns-explorer'],
    lessons: ['records-aliases-and-delegation', 'dnssec-and-the-chain-of-trust'],
  },
  {
    id: 'cname',
    term: 'CNAME',
    aliases: ['alias record', 'CNAMEs'],
    short:
      'A DNS record saying "this name is really that name" -- an instruction to start the lookup again elsewhere.',
    definition:
      'Because a CNAME replaces the name entirely it must be the only record at that name, which is why an apex like example.com cannot have one. Following an alias into another operator’s zone is exactly how a name is handed to a CDN.',
    modules: ['dns-explorer'],
    lessons: ['records-aliases-and-delegation', 'cdns-and-the-edge'],
  },
  {
    id: 'nxdomain',
    term: 'NXDOMAIN',
    aliases: ['negative caching'],
    short:
      'The definite answer that a name does not exist -- not a failure to get an answer.',
    definition:
      'Only an authoritative server can say it, and the SOA record it comes with is what tells resolvers how long they may remember the "no". Without negative caching, every typo in the world would walk the tree from the root every time.',
    modules: ['dns-explorer', 'network-diagnostics'],
    lessons: ['dns-caching-and-ttl', 'when-a-page-load-fails'],
  },
  {
    id: 'dnssec',
    term: 'DNSSEC',
    short:
      'Signatures over DNS data that let a resolver prove an answer was not altered on the way.',
    definition:
      'DNSSEC authenticates, it does not encrypt: a signed answer is still readable by anyone on the path. Trust is chained from a root key the resolver already holds, down through a DS record in each parent zone to the DNSKEY in each child.',
    modules: ['dns-explorer'],
    lessons: ['dnssec-and-the-chain-of-trust'],
  },
  {
    id: 'http',
    term: 'HTTP',
    aliases: ['Hypertext Transfer Protocol'],
    short:
      'The request/response protocol the web is made of: a method, a target, some fields, and maybe a body.',
    definition:
      'HTTP is stateless by design -- each request is complete on its own, which is what lets caches and proxies reason about one without tracking a conversation. HTTP/1.1, /2 and /3 share these semantics exactly and differ only in how the bytes are framed.',
    modules: ['http-explorer', 'api-visualizer'],
    lessons: ['anatomy-of-an-http-message', 'http-1-2-and-3'],
  },
  {
    id: 'status-code',
    term: 'status code',
    aliases: ['status codes'],
    short:
      'The three-digit number in an HTTP response, whose first digit says which of five things happened.',
    definition:
      '1xx is informational, 2xx succeeded, 3xx wants you to go elsewhere, 4xx blames the request and 5xx blames the server. A client that understands only the first digit still behaves correctly, which is exactly why the range is grouped that way.',
    modules: ['http-explorer', 'api-visualizer'],
    lessons: ['status-codes-and-redirects', 'rest-and-resources'],
  },
  {
    id: 'idempotent',
    term: 'idempotent',
    aliases: ['idempotency', 'idempotence'],
    short: 'A request that leaves the same state behind however many times it is sent.',
    definition:
      'Idempotency is about the resulting state, not the response: a DELETE that answers 404 the second time is still idempotent. It is the property that makes a retry safe, which is why GET, PUT and DELETE may be retried automatically and POST may not.',
    modules: ['api-visualizer', 'http-explorer'],
    lessons: ['rest-and-resources', 'webhooks'],
  },
  {
    id: 'cache',
    term: 'cache',
    aliases: ['caches', 'caching', 'cached'],
    short:
      'A store of a previous answer, kept so the next identical question costs nothing.',
    definition:
      'Every cache is a bet that the answer has not changed yet, and every caching mechanism is really an argument about how to bound that bet -- a TTL, a max-age, an ETag. A hit is not a faster request; it is no request at all.',
    modules: ['http-explorer', 'internet-simulator', 'dns-explorer'],
    lessons: ['http-caching', 'dns-caching-and-ttl', 'the-second-visit'],
  },
  {
    id: 'etag',
    term: 'ETag',
    aliases: ['entity tag', 'validator', 'validators'],
    short:
      'An opaque version marker a server attaches to a response so a client can later ask "has this changed?".',
    definition:
      'Sent back as If-None-Match, an ETag lets the server answer 304 Not Modified with no body at all. The saving is the body, and it is worth a round trip whenever the body is larger than the request that asked about it.',
    modules: ['http-explorer'],
    lessons: ['http-caching', 'the-second-visit'],
  },
  {
    id: 'cookie',
    term: 'cookie',
    aliases: ['cookies'],
    short:
      'A small value a server asks the browser to store and send back on every later request to that site.',
    definition:
      'Cookies are how a stateless protocol carries state. The attributes are the whole security story: Secure keeps one off cleartext, HttpOnly keeps scripts away from it, and SameSite decides whether a request started by another site carries it at all.',
    modules: ['http-explorer'],
    lessons: ['cookies-and-sessions'],
  },
  {
    id: 'session',
    term: 'session',
    aliases: ['sessions', 'session cookie'],
    short:
      'A server-side record of who you are, pointed at by an opaque identifier the browser keeps repeating.',
    definition:
      'The cookie usually holds nothing but a random id; everything real about the session lives on the server, where it can be revoked. That indirection is what makes logging out mean something, and what makes a stolen cookie a bounded rather than permanent problem.',
    modules: ['http-explorer', 'api-visualizer'],
    lessons: ['cookies-and-sessions', 'api-authentication'],
  },
  {
    id: 'origin',
    term: 'origin',
    aliases: ['origins', 'same-origin'],
    short:
      'The scheme, host and port of a URL taken together -- the browser’s unit of trust.',
    definition:
      'Two pages share an origin only if all three parts match, so https://example.com and http://example.com are different origins, as are example.com and api.example.com. Almost every rule the browser enforces about who may read what is expressed in these terms.',
    modules: ['http-explorer', 'api-visualizer'],
    lessons: ['cross-origin-requests'],
  },
  {
    id: 'cors',
    term: 'CORS',
    aliases: ['Cross-Origin Resource Sharing', 'preflight'],
    short:
      'The headers by which a server tells the browser that a page from another origin may read its response.',
    definition:
      'CORS relaxes the same-origin policy rather than enforcing it. The request is usually sent and executed regardless; what CORS controls is whether the calling page is allowed to see the answer -- and for anything beyond a simple form-style request, a preflight asks permission first.',
    modules: ['http-explorer', 'api-visualizer'],
    lessons: ['cross-origin-requests'],
  },
  {
    id: 'head-of-line-blocking',
    term: 'head-of-line blocking',
    aliases: ['HOL blocking', 'head of line blocking'],
    short:
      'One stalled item holding up everything queued behind it, even though nothing else depends on it.',
    definition:
      'HTTP/1.1 has it in the request queue; HTTP/2 removes that but inherits a worse one from TCP, which will not deliver later bytes until a lost earlier segment is retransmitted. Only HTTP/3 escapes it, because QUIC tracks loss per stream.',
    modules: ['http-explorer'],
    lessons: ['http-1-2-and-3', 'why-pages-feel-slow'],
  },
  {
    id: 'tls',
    term: 'TLS',
    aliases: ['SSL', 'SSL/TLS', 'Transport Layer Security'],
    short:
      'The layer that wraps a TCP connection in encryption, integrity checking and proof of who the far end is.',
    definition:
      'TLS gives three things and they are separable: confidentiality so nobody can read the traffic, integrity so nobody can alter it undetected, and authentication of the server’s identity. HTTPS is exactly HTTP carried inside it -- the semantics do not change at all.',
    modules: ['https-explorer', 'internet-simulator'],
    lessons: ['what-tls-actually-does', 'from-url-to-pixels'],
  },
  {
    id: 'certificate',
    term: 'certificate',
    aliases: ['certificates', 'leaf certificate'],
    short:
      'A public key plus a list of names it is valid for, signed by somebody the client already trusts.',
    definition:
      'The certificate itself is public and is not a secret; what proves the server owns it is a signature made with the matching private key during the handshake. Identity is matched against the subjectAltName list, and against nothing else.',
    modules: ['https-explorer'],
    lessons: ['certificates-and-trust'],
  },
  {
    id: 'certificate-authority',
    term: 'certificate authority',
    aliases: ['CA', 'certificate authorities', 'trust store'],
    short:
      'An organisation whose signature a client is willing to accept, because its root certificate ships in the trust store.',
    definition:
      'Trust in the web PKI is a fixed list installed with the operating system or browser, not something discovered during a handshake. A chain can be internally perfect and still worth nothing if nobody in it appears on that list.',
    modules: ['https-explorer'],
    lessons: ['certificates-and-trust'],
  },
  {
    id: 'handshake',
    term: 'handshake',
    aliases: ['handshakes'],
    short:
      'The opening exchange in which two endpoints agree on parameters before any real data flows.',
    definition:
      'TCP’s handshake establishes sequence numbers; TLS’s establishes keys and checks identity. Each one costs at least a round trip, which is why nearly every protocol optimisation of the last decade has been about removing one.',
    modules: ['https-explorer', 'packet-journey', 'websocket-viewer'],
    lessons: ['what-tls-actually-does', 'tcp-and-udp'],
  },
  {
    id: 'forward-secrecy',
    term: 'forward secrecy',
    aliases: ['perfect forward secrecy', 'PFS'],
    short:
      'The property that recording today’s traffic is useless even to somebody who steals the server’s key tomorrow.',
    definition:
      'It comes from deriving each session’s keys from a fresh ephemeral exchange rather than from the long-term private key. TLS 1.3 makes it mandatory; TLS 1.2 allowed static RSA key transport, under which one stolen key retroactively opened every recorded session.',
    modules: ['https-explorer'],
    lessons: ['handshakes-and-resumption', 'what-tls-actually-does'],
  },
  {
    id: 'api',
    term: 'API',
    aliases: ['APIs'],
    short:
      'A contract for programs rather than people: defined endpoints, defined shapes, and defined failure modes.',
    definition:
      'A web API is ordinary HTTP with the audience changed. Because the caller is code, the parts that matter most are the ones a human browsing would forgive: exact status codes, stable field names, and errors that say what to do next.',
    modules: ['api-visualizer'],
    lessons: ['rest-and-resources', 'api-authentication'],
  },
  {
    id: 'rest',
    term: 'REST',
    aliases: ['RESTful'],
    short:
      'An API style where the URL names a resource and the HTTP method is the only verb.',
    definition:
      'Putting the verb in the method rather than the path is what lets every cache and proxy on the way reason about a request without understanding the application. The cost is that the response shape is fixed by the server, which is the itch GraphQL was invented to scratch.',
    modules: ['api-visualizer'],
    lessons: ['rest-and-resources'],
  },
  {
    id: 'graphql',
    term: 'GraphQL',
    short:
      'A query language where the client describes the shape of the response it wants, over a single endpoint.',
    definition:
      'One POST replaces several REST round trips and returns no field the client did not ask for. What is given up is everything that came from the method and the URL: HTTP caching, per-resource authorisation, and a request whose cost is obvious before it runs.',
    modules: ['api-visualizer'],
    lessons: ['rest-and-resources'],
  },
  {
    id: 'webhook',
    term: 'webhook',
    aliases: ['webhooks'],
    short:
      'An HTTP callback: instead of you polling the API, the API POSTs to a URL you registered.',
    definition:
      'The roles reverse -- your endpoint becomes the server, and it must be public, fast, signature-checking and idempotent. Delivery is at-least-once in practice, because a timeout and a lost reply are indistinguishable to the sender.',
    modules: ['api-visualizer'],
    lessons: ['webhooks'],
  },
  {
    id: 'bearer-token',
    term: 'bearer token',
    aliases: ['bearer', 'JWT', 'access token'],
    short:
      'A credential that authorises whoever presents it, with no further proof of identity required.',
    definition:
      '"Bearer" is the whole security model: possession is sufficient, so the token must travel only over TLS and never in a URL. A JWT is one common shape -- signed so it cannot be altered, base64url so it can be read by anyone holding it.',
    modules: ['api-visualizer'],
    lessons: ['api-authentication'],
  },
  {
    id: 'oauth',
    term: 'OAuth',
    aliases: ['OAuth 2.0', 'PKCE'],
    short:
      'A delegation protocol: it lets an application act on your behalf without ever seeing your password.',
    definition:
      'The password is typed into the authorization server and nowhere else; the application receives a code through the browser and exchanges it, out of band, for a token. PKCE binds that exchange to the client that started it, so a stolen code is worthless.',
    modules: ['api-visualizer'],
    lessons: ['api-authentication'],
  },
  {
    id: 'rate-limit',
    term: 'rate limit',
    aliases: ['rate limiting', 'rate limits', 'token bucket'],
    short:
      'A cap on how many requests a client may make in a period, enforced by refusing the rest with 429.',
    definition:
      'The usual implementation is a token bucket: a level and a timestamp, recomputed on arrival, with capacity setting the burst and the refill rate setting the sustained limit. A 429 owes the client a Retry-After, which turns a refusal into an instruction.',
    modules: ['api-visualizer', 'network-diagnostics'],
    lessons: ['pagination-and-rate-limits'],
  },
  {
    id: 'websocket',
    term: 'WebSocket',
    aliases: ['WebSockets'],
    short:
      'A persistent, two-way connection that starts life as an HTTP request and then stops being HTTP.',
    definition:
      'The upgrade handshake is an ordinary GET on port 443, which is exactly why WebSockets pass through infrastructure that has never heard of them. After the 101 there is no request/response pairing at all -- two independent streams of frames sharing one socket.',
    modules: ['websocket-viewer'],
    lessons: ['the-websocket-upgrade', 'choosing-a-realtime-transport'],
  },
  {
    id: 'sse',
    term: 'Server-Sent Events',
    aliases: ['SSE', 'EventSource'],
    short:
      'A one-way stream of text events from server to browser over a single ordinary HTTP response.',
    definition:
      'SSE gives up sending anything back, and in exchange gets automatic reconnection and event replay via Last-Event-ID for free. For notifications, tickers and progress -- anything where the traffic is genuinely one-directional -- it is less machinery than a WebSocket for the same result.',
    modules: ['websocket-viewer'],
    lessons: ['choosing-a-realtime-transport'],
  },
  {
    id: 'frame',
    term: 'frame',
    aliases: ['frames', 'framing'],
    short:
      'The unit a protocol actually puts on the wire: a small header saying how long the rest is, then the rest.',
    definition:
      'Framing is how a receiver knows where one message ends and the next begins on a stream that has no natural boundaries. A WebSocket frame, an HTTP/2 frame and an Ethernet frame are different formats solving exactly this problem at different layers.',
    modules: ['websocket-viewer', 'packet-journey'],
    lessons: ['the-websocket-upgrade', 'http-1-2-and-3'],
  },
  {
    id: 'cdn',
    term: 'CDN',
    aliases: ['content delivery network', 'edge', 'edge server'],
    short:
      'A fleet of caches placed close to users, serving copies of a site so most requests never reach the origin.',
    definition:
      'An edge is an ordinary shared HTTP cache obeying the same RFC 9111 rules a browser does -- the trick is where it sits, not what it is. Traffic is steered to a nearby one by DNS or by anycast, so the distance a request travels shrinks to a few milliseconds.',
    modules: ['internet-simulator', 'network-map'],
    lessons: ['cdns-and-the-edge'],
  },
  {
    id: 'anycast',
    term: 'anycast',
    short:
      'Advertising one address from many places at once, so the network delivers each packet to the nearest of them.',
    definition:
      'Anycast makes routing do the load balancing: there is nothing to look up and no decision to make at the client. It is how root DNS servers and CDN edges present a single address worldwide, and why "the same IP" can be a different machine on different continents.',
    modules: ['network-map', 'internet-simulator'],
    lessons: ['cdns-and-the-edge'],
  },
  {
    id: 'load-balancer',
    term: 'load balancer',
    aliases: ['load balancers', 'load balancing'],
    short:
      'A machine that spreads incoming connections across a pool of servers and stops sending traffic to the sick ones.',
    definition:
      'A layer-4 balancer forwards TCP connections without reading them; a layer-7 balancer terminates the connection, reads the HTTP request and can route on its contents. Health checks are the half people forget, and they are what turns a crashed server into a non-event.',
    modules: ['network-map'],
    lessons: ['load-balancers-and-reverse-proxies'],
  },
  {
    id: 'reverse-proxy',
    term: 'reverse proxy',
    aliases: ['reverse proxies'],
    short:
      'A server that accepts requests on behalf of the real application and forwards them on.',
    definition:
      'The client believes it is talking to the site; the application behind it never sees the raw Internet. It is the natural place to terminate TLS, apply caching, compress, rate-limit and rewrite -- which is why it usually ends up doing all five.',
    modules: ['network-map', 'internet-simulator'],
    lessons: ['load-balancers-and-reverse-proxies'],
  },
  {
    id: 'firewall',
    term: 'firewall',
    aliases: ['firewalls'],
    short:
      'A policy applied at a network boundary that decides which traffic may cross it.',
    definition:
      'A stateful firewall remembers connections it allowed out so it can let the replies back in, which is what makes "allow outbound, deny inbound" a workable default. Its value comes almost entirely from where it is placed, not from how many rules it has.',
    modules: ['network-map', 'network-diagnostics'],
    lessons: ['firewalls-and-segmentation'],
  },
  {
    id: 'vlan',
    term: 'VLAN',
    aliases: ['VLANs', '802.1Q'],
    short:
      'One physical switch divided into several separate networks that cannot reach each other directly.',
    definition:
      'A VLAN tag on each frame keeps the groups apart on shared cabling, so traffic between them has to leave through a layer-3 device. That forced detour is the point: it gives the firewall somewhere to stand.',
    modules: ['network-map'],
    lessons: ['firewalls-and-segmentation'],
  },
  {
    id: 'round-trip',
    term: 'round trip',
    aliases: ['round trips', 'RTT', 'round-trip time'],
    short:
      'One message out and the reply back -- the unit almost every network delay is really counted in.',
    definition:
      'A page load is dozens of dependent round trips, not one transfer, which is why distance dominates and why every handshake optimisation of the last decade has been about removing one. Bandwidth changes how long a big body takes; nothing changes how long a round trip takes but being closer.',
    modules: ['internet-simulator', 'https-explorer'],
    lessons: ['why-pages-feel-slow', 'handshakes-and-resumption'],
  },
  {
    id: 'redirect',
    term: 'redirect',
    aliases: ['redirects', 'redirection'],
    short:
      'A 3xx response telling the client the thing it wants is at a different URL, with Location saying where.',
    definition:
      'Each redirect is a whole extra round trip before anything useful is served, and a chain costs one per hop. The codes differ mainly on whether a POST survives the jump: 301 and 302 have browsers rewrite it to GET, 307 and 308 do not, and 303 does so deliberately.',
    modules: ['http-explorer'],
    lessons: ['status-codes-and-redirects'],
  },
];

/**
 * Find a term by id, by its display spelling, or by an alias.
 *
 * Case-insensitive, because a lesson writes a term in whatever case the sentence
 * needs. `undefined` rather than a throw: an unrecognised term must degrade to plain
 * text, never take a lesson down.
 */
export function lookupTerm(key: string): GlossaryTerm | undefined {
  const needle = key.trim().toLowerCase();
  if (!needle) return undefined;

  return GLOSSARY.find(
    (entry) =>
      entry.id.toLowerCase() === needle ||
      entry.term.toLowerCase() === needle ||
      entry.aliases?.some((alias) => alias.toLowerCase() === needle),
  );
}

/** The glossary in alphabetical order, which is the only order a glossary may be in. */
export function sortedGlossary(): GlossaryTerm[] {
  return [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
}
