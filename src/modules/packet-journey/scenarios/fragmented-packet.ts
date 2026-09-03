/**
 * Scenario 3 -- one link is narrower than the rest.
 *
 * The home router runs PPPoE over the fibre line, which costs 8 of the 1500 bytes and
 * leaves an MTU of 1492 (`ACCESS_LINK_MTU` in `./topology.ts`). That single number, on
 * one hop out of six, produces every effect in this scenario.
 *
 * Three chapters, and each is a thing the phase doc asks to be shown:
 *
 * 1. **Path MTU discovery.** The laptop sends a 1500-byte probe with `Don't Fragment`
 *    set. The router cannot forward it and is forbidden to split it, so it drops the
 *    packet and sends back ICMP Destination Unreachable, code 4, carrying the number
 *    1492. The sender learns the path MTU by being told what it is not.
 * 2. **Fragmentation.** The resolver answers with a DNSSEC-signed record set far larger
 *    than any link on the path will carry, so IPv4 splits it -- correct More Fragments
 *    flags, and offsets counted in 8-byte units, which is why 1480 payload bytes make
 *    the next fragment's offset 185 and not 1480.
 * 3. **Re-fragmentation, and why the runt exists.** The resolver split its answer to fit
 *    1500, because that is its own link. Two hops later the 1492-byte access line cannot
 *    take the result either, so the ISP gateway splits the *first fragment again* into
 *    1472 bytes and a **single 8-byte piece**. Three packets and one useless runt where
 *    two would have done -- which is the practical argument for the probe in chapter 1
 *    that a sender does at the start instead.
 *
 * Reassembly happens at the laptop and nowhere else. No router on the path held a
 * fragment, reordered one, or had any idea the three belonged together.
 *
 * UDP, because it is where this really bites: TCP negotiates a maximum segment size in
 * its handshake precisely so IPv4 never has to do any of this, while a large DNS answer
 * has nothing negotiating on its behalf and genuinely does arrive in pieces.
 */

import type { ProtocolLayer } from '@/core/types/pdu';

import type { JourneyScenario } from '../sim/journey';

import {
  ACCESS_LINK_MTU,
  HOME_PUBLIC_IP,
  JOURNEY_TOPOLOGY,
  PATH_TO_RESOLVER,
} from './topology';

/**
 * The probe: exactly 1500 bytes on the wire at layer 3, and told not to be split.
 *
 * 1472 payload + 8 UDP + 20 IPv4 = 1500. It fits every link inside the house and fails
 * on the first one outside it, which is precisely the case discovery exists to find.
 */
const PROBE_BYTES = 1472;

/** A DNS answer with signatures attached: far too large for any link on the path. */
const DNSSEC_RESPONSE: ProtocolLayer = {
  layer: 'application',
  protocol: 'DNS',
  fields: [
    { name: 'Transaction ID', value: '0x4c19', bits: 16 },
    {
      name: 'Flags',
      value: '0x8180 (response, recursion available, no error)',
      bits: 16,
    },
    { name: 'Answer RRs', value: '2', bits: 16 },
    {
      name: 'Additional RRs',
      value: '3',
      bits: 16,
      note: 'The OPT record advertising a 4096-byte UDP payload size, and the signatures.',
    },
    { name: 'Answer 1', value: 'app.example. 300 IN A 192.0.2.80' },
    {
      name: 'Answer 2',
      value: 'app.example. 300 IN RRSIG A ...',
      note: 'The DNSSEC signature over the answer. Signatures are what make a DNS response large enough to fragment.',
    },
    {
      name: 'EDNS0 UDP size',
      value: '4096',
      note: 'The client said it would accept datagrams up to 4096 bytes. Nothing on the path agreed to carry one that big -- EDNS0 negotiates with the resolver, not with the network.',
    },
  ],
  payloadPreview: 'app.example. 300 IN A 192.0.2.80 + RRSIG + DNSKEY (2800 bytes)',
};

/** One narrow link, and everything that follows from it. */
export const FRAGMENTED_PACKET: JourneyScenario = {
  id: 'fragmented-packet',
  title: 'Fragmented packet',
  summary:
    'The access line carries 1492 bytes, not 1500. A probe discovers it the hard way, and a 2 800-byte answer arrives in three pieces -- one of them 8 bytes long.',
  teaches: [
    "Don't Fragment and ICMP Fragmentation Needed: path MTU discovery",
    'More Fragments flags and offsets counted in 8-byte units',
    'Re-fragmentation, and the runt fragment a narrower link creates',
    'Reassembly happens at the destination and nowhere else',
  ],
  topology: JOURNEY_TOPOLOGY,
  path: PATH_TO_RESOLVER,
  transport: 'udp',
  clientPort: 49153,
  serverPort: 53,
  nat: { nodeId: 'router', publicIp: HOME_PUBLIC_IP, firstPort: 60000 },
  linkMtu: ACCESS_LINK_MTU,
  seed: 'fragmented-packet',
  writes: [
    {
      from: 'client',
      bytes: PROBE_BYTES,
      dontFragment: true,
      preview: '1472 bytes of padding, DF set',
      phase: {
        id: 'probe',
        title: 'Probing the path MTU',
        description:
          'A 1500-byte datagram with Don’t Fragment set. It crosses the house without trouble and dies at the first link that is narrower than it.',
      },
      note: {
        text: 'Don’t Fragment turns a size problem into an error message. Without it the router would have quietly split the packet and the sender would never have learned anything; with it, the router must drop the packet and report the MTU it could not exceed. That report is the only way a sender finds out.',
        reference: { rfc: 1191, title: 'Path MTU Discovery' },
      },
    },
    {
      from: 'client',
      bytes: 29,
      preview: 'app.example. IN A (+DO bit)',
      phase: {
        id: 'query',
        title: 'A query that asks for signatures',
        description:
          'The question is small -- 29 bytes. It is the answer that will not fit, and nothing in the query hints at that.',
      },
    },
    {
      from: 'server',
      bytes: 2800,
      application: DNSSEC_RESPONSE,
      preview: 'app.example. 300 IN A 192.0.2.80 + RRSIG + DNSKEY',
      phase: {
        id: 'fragments',
        title: 'The answer arrives in pieces',
        description:
          'The resolver splits 2 828 bytes to fit its own 1500-byte link. The ISP gateway then splits the first piece again to fit the 1492-byte access line, leaving an 8-byte runt behind it.',
      },
      note: {
        text: 'Each fragment is a complete IPv4 datagram with its own header, routed independently -- which is why a router in the middle cannot reassemble them and why the transport header, sitting only in the first piece, is invisible to a firewall inspecting any of the others.',
        reference: { rfc: 791, section: '3.2', title: 'Internet Protocol' },
      },
    },
  ],
};
