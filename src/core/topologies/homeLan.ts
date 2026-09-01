/**
 * Home LAN -- the smallest complete network, and the one the learner is sitting on.
 *
 * Three devices, a Wi-Fi access point, a switch, a router, a fibre terminal, and the
 * first machine that belongs to somebody else. Everything inside the house shares one
 * private /24 and one public address; the whole scenario exists to make that sentence
 * mean something.
 *
 * The deliberate accuracy choices, because they are the point:
 *
 * - The access point and the switch are **layer 2**. They forward frames by MAC address
 *   and never look at an IP header. Their addresses are for managing them, nothing else.
 * - The router is the only thing here that routes, and the translation it performs is
 *   **NAPT** -- port-based -- not one-to-one NAT. Every device in the house shares a
 *   single public address, told apart by source port.
 * - The fibre terminal is a media converter in bridge mode, so it has no IP at all.
 */

import type { Topology } from '../types/topology';

import { ieee, itu, rfc, type ScenarioTopology } from './types';

/** The private network inside the house. Reused by the notes so they cannot drift. */
const LAN_PREFIX = '192.168.1.0/24';
const GATEWAY = '192.168.1.1';
const DHCP_POOL = '192.168.1.100 - 192.168.1.199';

const topology: Topology = {
  nodes: [
    {
      id: 'laptop',
      kind: 'client',
      label: 'Laptop',
      ipv4: '192.168.1.112',
      ipv6: '2001:db8:1a2b:cd00:200:5eff:fe00:5301',
      mac: '00:00:5e:00:53:01',
      detail: {
        'Subnet mask': '255.255.255.0 (/24)',
        'Default gateway': GATEWAY,
        'DNS server': `${GATEWAY} (the router forwards to the ISP)`,
        'Address from': 'DHCP, 24-hour lease',
        Attached: 'Wi-Fi 6, 5 GHz',
      },
    },
    {
      id: 'phone',
      kind: 'client',
      label: 'Phone',
      ipv4: '192.168.1.140',
      mac: '00:00:5e:00:53:02',
      detail: {
        'Subnet mask': '255.255.255.0 (/24)',
        'Default gateway': GATEWAY,
        'Address from': 'DHCP, 24-hour lease',
        Attached: 'Wi-Fi 6, 5 GHz',
      },
    },
    {
      id: 'desktop',
      kind: 'client',
      label: 'Desktop PC',
      ipv4: '192.168.1.101',
      mac: '00:00:5e:00:53:03',
      detail: {
        'Subnet mask': '255.255.255.0 (/24)',
        'Default gateway': GATEWAY,
        'Address from': 'DHCP, 24-hour lease',
        Attached: '1000BASE-T, full duplex',
      },
    },
    {
      id: 'ap',
      kind: 'switch',
      label: 'Wi-Fi access point',
      ipv4: '192.168.1.2',
      mac: '00:00:5e:00:53:04',
      detail: {
        Job: 'Bridges 802.11 frames onto the wired 802.3 segment',
        'Its address is for': 'Logging in to configure it. Nothing routes through it.',
        Radio: '5 GHz, 80 MHz channel',
      },
    },
    {
      id: 'lan-switch',
      kind: 'switch',
      label: 'LAN switch',
      mac: '00:00:5e:00:53:05',
      detail: {
        'Forwards by': 'Destination MAC address',
        Learns: 'Which MAC was last seen on which port',
        'Never reads': 'The IP header. It has no idea what a subnet is.',
        Ports: '4 x 1000BASE-T',
      },
    },
    {
      id: 'router',
      kind: 'router',
      label: 'Home router (NAPT)',
      ipv4: GATEWAY,
      ipv6: '2001:db8:1a2b:cd00::1',
      mac: '00:00:5e:00:53:06',
      detail: {
        'LAN interface': `${GATEWAY}/24`,
        'WAN interface': '203.0.113.7/24, leased from the ISP',
        Translation: 'NAPT: one public address, many devices, told apart by source port',
        'Also runs': `DHCP server (pool ${DHCP_POOL}) and a DNS forwarder`,
        'IPv6 prefix': '2001:db8:1a2b:cd00::/56, delegated. No translation needed.',
      },
    },
    {
      id: 'modem',
      kind: 'switch',
      label: 'Fibre terminal (ONT)',
      mac: '00:00:5e:00:53:07',
      detail: {
        Converts: 'GPON optical frames to and from Ethernet',
        Mode: 'Bridge. It forwards frames and holds no address of its own.',
        Layer: 'Physical and link only. Invisible to IP.',
      },
    },
    {
      id: 'isp-gateway',
      kind: 'router',
      label: 'ISP access router',
      ipv4: '203.0.113.1',
      detail: {
        Role: 'The first hop outside the house: the ISP edge',
        Provides: 'The public WAN address the home router leases',
        'AS number': 'AS64496 (reserved for documentation, RFC 5398)',
        'Past this point': 'Every address has to be globally unique',
      },
    },
  ],
  links: [
    {
      id: 'wifi-laptop',
      from: 'laptop',
      to: 'ap',
      latencyMs: 0.9,
      bandwidthMbps: 400,
      medium: 'wifi',
    },
    {
      id: 'wifi-phone',
      from: 'phone',
      to: 'ap',
      latencyMs: 0.9,
      bandwidthMbps: 200,
      medium: 'wifi',
    },
    {
      id: 'eth-desktop',
      from: 'desktop',
      to: 'lan-switch',
      latencyMs: 0.05,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'eth-ap-uplink',
      from: 'ap',
      to: 'lan-switch',
      latencyMs: 0.1,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'eth-switch-router',
      from: 'lan-switch',
      to: 'router',
      latencyMs: 0.05,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'eth-router-modem',
      from: 'router',
      to: 'modem',
      latencyMs: 0.05,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'access-uplink',
      from: 'modem',
      to: 'isp-gateway',
      latencyMs: 6,
      bandwidthMbps: 1000,
      medium: 'fiber',
    },
  ],
};

export const HOME_LAN: ScenarioTopology = {
  id: 'home-lan',
  title: 'Home LAN',
  summary:
    'One house, one private /24, one public address. Where private addressing, the default gateway, DHCP, and NAPT all come from.',
  teaches: [
    'Private vs public addressing',
    'Subnet masks and the default gateway',
    'DHCP leases',
    'NAPT (port-based NAT)',
    'Layer 2 devices vs layer 3 devices',
  ],
  topology,
  notes: [
    {
      targetId: 'laptop',
      text: `This address is private: it identifies the laptop inside this house and nowhere else, so millions of other homes are using 192.168.1.112 at the same moment. The mask says the first 24 bits are the network, so anything in ${LAN_PREFIX} can be reached directly across the LAN. Anything outside it is handed to the default gateway instead.`,
      reference: rfc(1918, 'Address Allocation for Private Internets'),
    },
    {
      targetId: 'phone',
      text: 'The phone did not choose its address. It broadcast a request when it joined the Wi-Fi, and the router answered with an address, a mask, a gateway, and a DNS server in one exchange. The lease expires after 24 hours unless the phone renews it, which is how a network reclaims addresses from devices that have left.',
      reference: rfc(2131, 'Dynamic Host Configuration Protocol'),
    },
    {
      targetId: 'desktop',
      text: 'Wired Ethernet is a point-to-point full-duplex link into one switch port, so this machine never has to wait for anyone else to stop transmitting. That is most of the reason the wired hop costs 0.05 ms while the Wi-Fi hops cost 0.9 ms, despite Wi-Fi advertising the larger number.',
      reference: ieee('802.3', 'Ethernet'),
    },
    {
      targetId: 'ap',
      text: 'An access point is a bridge, not a router. It lifts an 802.11 frame off the air, rewrites it as an 802.3 frame, and puts it on the wire carrying the same source and destination MAC addresses, without ever opening the IP header. Its 192.168.1.2 address exists only so an administrator can log in and configure it.',
      reference: ieee('802.11', 'Wireless LAN Medium Access Control and Physical Layer'),
    },
    {
      targetId: 'lan-switch',
      text: 'The switch forwards frames by destination MAC address, and learns which address sits behind which port by watching the source address of everything that arrives. It holds no IP address on this network and cannot move traffic between subnets: that is the router job, and drawing a switch doing it is the most common way to get a diagram like this wrong.',
      reference: ieee('802.1D', 'MAC Bridges'),
    },
    {
      targetId: 'router',
      text: 'This is the only device in the house that routes, and the translation it performs is NAPT, not plain one-to-one NAT. It rewrites both the private source address and the source port of every outbound packet, and keeps a table so replies can be matched back to the device that asked. That table is why three devices share one public address, and why a packet arriving unsolicited from outside matches no row and is dropped.',
      reference: rfc(
        3022,
        'Traditional IP Network Address Translator (Traditional NAT)',
        '2.2',
      ),
    },
    {
      targetId: 'modem',
      text: 'The optical terminal converts between the fibre running to the street and the Ethernet running to the router. In bridge mode it holds no IP address at all, which is why a traceroute from the laptop never shows it: there is nothing at layer 3 for a packet to be addressed to.',
      reference: itu('G.984', 'Gigabit-capable Passive Optical Networks (GPON)'),
    },
    {
      targetId: 'isp-gateway',
      text: 'The first machine on the path that belongs to somebody else. It leases the public WAN address, and it is also where a well-run ISP drops packets claiming a source address that could not legitimately come from this line. Everything past here needs a globally unique address, which is the entire reason NAPT sits behind it.',
      reference: rfc(2827, 'Network Ingress Filtering (BCP 38)'),
    },
    {
      targetId: 'wifi-laptop',
      text: 'Wi-Fi is a shared, half-duplex medium: every device on the channel takes turns, and a sender listens before it transmits rather than talking over anyone. Waiting for a turn is what makes this hop roughly twenty times slower than the wired one.',
      reference: ieee('802.11', 'Wireless LAN Medium Access Control and Physical Layer'),
    },
    {
      targetId: 'access-uplink',
      text: 'This single hop costs more than the entire house put together: 6 ms out to the ISP against 0.05 ms across the LAN. Whatever a page load spends inside the home network is noise next to it, which is why slow browsing is almost never a problem on your side of the router.',
    },
  ],
};
