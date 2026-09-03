/**
 * Scenario 2 -- a name lookup over UDP.
 *
 * Deliberately the same journey as `tcp-web-request` up to the access network, so the
 * two can be compared hop for hop. What changes is everything above IP:
 *
 * - **No handshake.** The first packet on the wire carries the question. TCP spent a
 *   whole round trip before it could send a byte; this sends the byte first.
 * - **No acknowledgement.** The response *is* the acknowledgement, and if neither ever
 *   arrives, nothing in the network says so. The resolver client gives up on its own
 *   timer and asks again -- reliability the application built, at a cost it chose.
 * - **No teardown.** There is no connection to close. Two packets, and it is over.
 *
 * Everything below IP is unchanged, which is the point: the MAC rewrite at each hop, the
 * TTL decrement, and the NAPT row all happen exactly as before. NAPT works here at all
 * only because UDP has ports -- which is why "NAT" for a protocol without them (raw
 * ICMP, say) has to be a different and much uglier mechanism.
 *
 * The resolver is one hop past the ISP gateway, which is roughly where a real one sits
 * and is why a cached lookup costs a few milliseconds rather than a trip abroad.
 */

import type { ProtocolLayer } from '@/core/types/pdu';

import type { JourneyScenario } from '../sim/journey';

import { HOME_PUBLIC_IP, JOURNEY_TOPOLOGY, PATH_TO_RESOLVER } from './topology';

/** The question: one name, one type, and a number to match the answer against. */
const DNS_QUERY: ProtocolLayer = {
  layer: 'application',
  protocol: 'DNS',
  fields: [
    {
      name: 'Transaction ID',
      value: '0x8f2a',
      bits: 16,
      note: 'Copied into the reply. With no connection to rely on, this and the port pair are all that tie an answer to its question -- which is why both are chosen unpredictably.',
    },
    {
      name: 'Flags',
      value: '0x0100 (standard query, recursion desired)',
      bits: 16,
      note: 'Recursion desired asks the resolver to do the whole chase itself rather than answering with a referral.',
    },
    { name: 'Questions', value: '1', bits: 16 },
    { name: 'Answer RRs', value: '0', bits: 16 },
    {
      name: 'QNAME',
      value: 'app.example',
      note: 'Encoded as length-prefixed labels: 3app7example0.',
    },
    {
      name: 'QTYPE',
      value: 'A (1)',
      bits: 16,
      note: 'An IPv4 address. AAAA would ask for the IPv6 one.',
    },
    { name: 'QCLASS', value: 'IN (1)', bits: 16 },
  ],
  payloadPreview: 'app.example. IN A',
};

/** The answer, with a TTL that is a cache lifetime and nothing to do with the IP TTL. */
const DNS_RESPONSE: ProtocolLayer = {
  layer: 'application',
  protocol: 'DNS',
  fields: [
    {
      name: 'Transaction ID',
      value: '0x8f2a',
      bits: 16,
      note: 'The same number the query carried. Anything else is not an answer to this question.',
    },
    {
      name: 'Flags',
      value: '0x8180 (response, recursion available, no error)',
      bits: 16,
    },
    { name: 'Questions', value: '1', bits: 16 },
    { name: 'Answer RRs', value: '2', bits: 16 },
    { name: 'Answer 1', value: 'app.example. 300 IN A 192.0.2.80' },
    { name: 'Answer 2', value: 'app.example. 300 IN A 192.0.2.81' },
    {
      name: 'Record TTL',
      value: '300 seconds',
      note: 'How long this answer may be cached. Entirely unrelated to the IPv4 header TTL, which counts hops -- two different fields with the same unfortunate name.',
    },
  ],
  payloadPreview: 'app.example. 300 IN A 192.0.2.80',
};

/** A name lookup: two packets, no connection, no acknowledgement. */
export const UDP_DNS_QUERY: JourneyScenario = {
  id: 'udp-dns-query',
  title: 'UDP DNS query',
  summary:
    'The same journey out of the house, carrying a name lookup instead of a web request. No handshake, no acknowledgement, no teardown -- two datagrams and it is over.',
  teaches: [
    'UDP: eight header bytes and no connection state',
    'Why a lookup costs one round trip and a TCP request costs two',
    'NAPT works for UDP because UDP has ports',
    'What has to be rebuilt in the application when the transport provides nothing',
  ],
  topology: JOURNEY_TOPOLOGY,
  path: PATH_TO_RESOLVER,
  transport: 'udp',
  clientPort: 49152,
  serverPort: 53,
  nat: { nodeId: 'router', publicIp: HOME_PUBLIC_IP, firstPort: 60000 },
  seed: 'udp-dns-query',
  writes: [
    {
      from: 'client',
      bytes: 29,
      application: DNS_QUERY,
      preview: 'app.example. IN A',
      phase: {
        id: 'query',
        title: 'The question goes out',
        description:
          'One datagram: 29 bytes of DNS, an 8-byte UDP header, a 20-byte IPv4 header, and a 14-byte frame. The first packet on the wire already carries the question.',
      },
      note: {
        text: 'Nothing was negotiated before this. TCP would have spent a full round trip on a handshake before it could send a single byte of the query; UDP puts the question in the first packet, and the answer comes back in the second.',
        reference: { rfc: 768, title: 'User Datagram Protocol' },
      },
    },
    {
      from: 'server',
      bytes: 61,
      application: DNS_RESPONSE,
      preview: 'app.example. 300 IN A 192.0.2.80',
      phase: {
        id: 'answer',
        title: 'The answer comes back',
        description:
          'The resolver replies to the address and port it saw, which is the router’s public address and the port it allocated. The row does the rest.',
      },
      note: {
        text: 'Nothing acknowledges this datagram. If it had been lost, no part of the network would have said so -- the client would simply have sat there until its own timer expired and asked again. Every reliability guarantee a UDP application has, it wrote itself.',
        reference: {
          rfc: 1035,
          section: '4.2.1',
          title: 'Domain Names -- Implementation and Specification',
        },
      },
    },
  ],
};
