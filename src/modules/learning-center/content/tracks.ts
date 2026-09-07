/**
 * The seven learning paths, in the order a beginner should walk them.
 *
 * A track is an **ordered list of lesson slugs**, and that ordering is the single
 * source of truth for "what comes next": `LessonNav` reads it, `TrackList` reads it,
 * and a lesson does not name the track it belongs to. One direction of reference means
 * moving a lesson between tracks is one edit and cannot leave the two halves
 * disagreeing.
 *
 * Titles and summaries come from `docs/implementation/13-module-learning-center.md`,
 * which fixes both the seven tracks and their subjects. All seven are declared here
 * from the start, because the shape of the curriculum is a design decision and not
 * something to discover lesson by lesson -- a track with no lessons yet renders as an
 * honest "not written yet" card rather than being absent and unexplained.
 *
 * Phase 13.1 shipped the framework and one lesson; phase 13.3 filled the rest of these
 * arrays, and nothing else about this file had to change when it did.
 *
 * The order within a track is a teaching order, not a difficulty ranking: each lesson
 * assumes the ones above it in the same track, and assumes nothing from any other
 * track. That is what lets a reader start at track 4 because they came for cookies,
 * and still follow it.
 */

export interface Track {
  /** URL segment, and the key progress is stored under. */
  id: string;
  title: string;
  /** One line, shown on the track card. */
  summary: string;
  /**
   * Lesson slugs, in teaching order. Every slug must exist in `LESSONS`; the
   * consistency test in `content.test.ts` is what keeps that true.
   */
  lessons: readonly string[];
}

export const TRACKS: readonly Track[] = [
  {
    id: 'internet-foundations',
    title: 'Internet Foundations',
    summary:
      'What a network actually is, how machines are addressed, and how packets move.',
    lessons: [
      'what-is-a-network',
      'addresses-and-subnets',
      'routing-and-the-path-between',
      'tcp-and-udp',
    ],
  },
  {
    id: 'how-a-web-page-loads',
    title: 'How a Web Page Loads',
    summary: 'One URL, end to end: DNS, then TCP, then TLS, then HTTP, then pixels.',
    lessons: [
      'from-url-to-pixels',
      'the-second-visit',
      'why-pages-feel-slow',
      'when-a-page-load-fails',
    ],
  },
  {
    id: 'names-and-addresses',
    title: 'Names and Addresses',
    summary: 'DNS in depth -- record types, the resolver hierarchy, caching, and DNSSEC.',
    lessons: [
      'how-a-name-is-resolved',
      'records-aliases-and-delegation',
      'dns-caching-and-ttl',
      'dnssec-and-the-chain-of-trust',
    ],
  },
  {
    id: 'the-web-protocol-layer',
    title: 'The Web Protocol Layer',
    summary:
      'HTTP semantics: methods, status codes, caching, cookies, sessions, and CORS.',
    lessons: [
      'anatomy-of-an-http-message',
      'status-codes-and-redirects',
      'http-caching',
      'cookies-and-sessions',
      'cross-origin-requests',
      'http-1-2-and-3',
    ],
  },
  {
    id: 'security-on-the-wire',
    title: 'Security on the Wire',
    summary:
      'TLS and certificates, and the sharp line between what HTTPS protects and what it does not.',
    lessons: [
      'what-tls-actually-does',
      'certificates-and-trust',
      'handshakes-and-resumption',
      'what-https-does-not-protect',
    ],
  },
  {
    id: 'real-time-and-apis',
    title: 'Real-Time and APIs',
    summary:
      'REST, GraphQL, webhooks, WebSockets and SSE -- and when each one is the right shape.',
    lessons: [
      'rest-and-resources',
      'api-authentication',
      'pagination-and-rate-limits',
      'webhooks',
      'choosing-a-realtime-transport',
      'the-websocket-upgrade',
      'keeping-a-websocket-alive',
    ],
  },
  {
    id: 'infrastructure',
    title: 'Infrastructure',
    summary:
      'The machines between you and the origin: CDNs, load balancers, proxies, NAT, firewalls.',
    lessons: [
      'cdns-and-the-edge',
      'load-balancers-and-reverse-proxies',
      'nat-and-private-addresses',
      'firewalls-and-segmentation',
    ],
  },
];

/** Look a track up by its URL segment. */
export function getTrack(id: string): Track | undefined {
  return TRACKS.find((track) => track.id === id);
}

/**
 * The track that teaches a lesson.
 *
 * Derived rather than stored: see the note at the top of the file. A lesson in no
 * track is orphaned and unreachable, which is why the content test asserts there are
 * none.
 */
export function trackOfLesson(slug: string): Track | undefined {
  return TRACKS.find((track) => track.lessons.includes(slug));
}
