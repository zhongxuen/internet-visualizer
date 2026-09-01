/**
 * Small office -- the home LAN after somebody has to take it seriously.
 *
 * Same shape as `./homeLan.ts` and deliberately so: the interesting part is what got
 * added, and why. A managed switch splits one flat network into three VLANs, a firewall
 * becomes the gateway for all of them, and two machines that need to be found by name
 * get a resolver of their own.
 *
 * The accuracy choices that carry the lesson:
 *
 * - The switch stays **layer 2**. It tags and untags frames; it does not route between
 *   VLANs. Nothing here draws a switch doing a router job.
 * - The **firewall is the layer-3 gateway**, one sub-interface per VLAN on a single
 *   802.1Q trunk. That is why it sits where it does: traffic between two VLANs has no
 *   path that avoids it, so a policy applied here cannot be walked around.
 * - Addressing moves to `10.0.0.0/8`, subnetted per VLAN, to show that RFC 1918 is three
 *   ranges of different sizes rather than one habit of typing `192.168.1.x`.
 */

import type { Topology } from '../types/topology';

import { ieee, rfc, type ScenarioTopology } from './types';

/** One /24 per VLAN, carved out of 10.0.0.0/8. */
const STAFF_VLAN = '10.20.10.0/24';
const SERVER_VLAN = '10.20.20.0/24';
const GUEST_VLAN = '10.20.30.0/24';

const topology: Topology = {
  nodes: [
    {
      id: 'desk-1',
      kind: 'client',
      label: 'Workstation 1',
      ipv4: '10.20.10.21',
      mac: '00:00:5e:00:53:11',
      detail: {
        VLAN: '10 (Staff)',
        'Default gateway': '10.20.10.1 (the firewall)',
        'Switch port': 'Access port, untagged VLAN 10',
      },
    },
    {
      id: 'desk-2',
      kind: 'client',
      label: 'Workstation 2',
      ipv4: '10.20.10.22',
      mac: '00:00:5e:00:53:12',
      detail: {
        VLAN: '10 (Staff)',
        'Default gateway': '10.20.10.1 (the firewall)',
        'Switch port': 'Access port, untagged VLAN 10',
      },
    },
    {
      id: 'guest-laptop',
      kind: 'client',
      label: 'Visitor laptop',
      ipv4: '10.20.30.55',
      mac: '00:00:5e:00:53:13',
      detail: {
        VLAN: '30 (Guest)',
        'Default gateway': '10.20.30.1 (the firewall)',
        Allowed: 'Outbound to the Internet only',
        Blocked: 'Every address in 10.0.0.0/8',
      },
    },
    {
      id: 'office-ap',
      kind: 'switch',
      label: 'Wi-Fi access point',
      ipv4: '10.20.10.5',
      mac: '00:00:5e:00:53:14',
      detail: {
        'SSID "office"': 'Bridged into VLAN 10',
        'SSID "office-guest"': 'Bridged into VLAN 30',
        Uplink: '802.1Q trunk carrying VLANs 10 and 30',
        'Its address is for': 'Management only',
      },
    },
    {
      id: 'core-switch',
      kind: 'switch',
      label: 'Managed switch',
      ipv4: '10.20.10.2',
      mac: '00:00:5e:00:53:15',
      detail: {
        'Access ports': 'One untagged VLAN each: the port decides which network you join',
        'Trunk ports': 'To the access point and the firewall, frames carry a VLAN tag',
        'Does not route': 'A frame tagged VLAN 30 can only leave on a VLAN 30 port',
        'Its address is for': 'Management only',
      },
    },
    {
      id: 'firewall',
      kind: 'firewall',
      label: 'Firewall / VLAN gateway',
      ipv4: '10.20.10.1',
      mac: '00:00:5e:00:53:16',
      detail: {
        'VLAN 10 gateway': '10.20.10.1/24',
        'VLAN 20 gateway': '10.20.20.1/24',
        'VLAN 30 gateway': '10.20.30.1/24',
        'WAN interface': '198.51.100.14/30, peer 198.51.100.13',
        Translation: 'NAPT for all three VLANs behind one public address',
        Policy: 'Default deny inbound; guest VLAN denied to every 10.0.0.0/8 address',
      },
    },
    {
      id: 'dns-server',
      kind: 'dns-resolver',
      label: 'Office DNS resolver',
      ipv4: '10.20.20.53',
      mac: '00:00:5e:00:53:17',
      detail: {
        VLAN: '20 (Servers)',
        'Authoritative for': 'office.example, the internal zone',
        Forwards: 'Everything else upstream to 198.51.100.53',
        Why: 'Staff can reach nas.office.example without anyone memorising an address',
      },
    },
    {
      id: 'nas',
      kind: 'server',
      label: 'NAS (file server)',
      ipv4: '10.20.20.20',
      mac: '00:00:5e:00:53:18',
      detail: {
        VLAN: '20 (Servers)',
        Serves: 'File shares to VLAN 10 only',
        Name: 'nas.office.example',
        Uplink: '10 Gb/s, because everyone reads from it at once',
      },
    },
    {
      id: 'printer',
      kind: 'server',
      label: 'Office printer',
      ipv4: '10.20.20.30',
      mac: '00:00:5e:00:53:19',
      detail: {
        VLAN: '20 (Servers)',
        Protocol: 'IPP over TCP port 631',
        Uplink: '100BASE-TX. A printer has never needed more.',
      },
    },
    {
      id: 'isp-router',
      kind: 'router',
      label: 'ISP business uplink',
      ipv4: '198.51.100.13',
      detail: {
        Link: '198.51.100.12/30, a point-to-point handoff with two usable addresses',
        Service: '500 Mb/s symmetric business fibre',
        'AS number': 'AS64496 (reserved for documentation, RFC 5398)',
      },
    },
  ],
  links: [
    {
      id: 'eth-desk-1',
      from: 'desk-1',
      to: 'core-switch',
      latencyMs: 0.05,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'eth-desk-2',
      from: 'desk-2',
      to: 'core-switch',
      latencyMs: 0.05,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'wifi-guest',
      from: 'guest-laptop',
      to: 'office-ap',
      latencyMs: 0.9,
      bandwidthMbps: 300,
      medium: 'wifi',
    },
    {
      id: 'trunk-ap',
      from: 'office-ap',
      to: 'core-switch',
      latencyMs: 0.1,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'eth-dns',
      from: 'dns-server',
      to: 'core-switch',
      latencyMs: 0.05,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'eth-nas',
      from: 'nas',
      to: 'core-switch',
      latencyMs: 0.05,
      bandwidthMbps: 10000,
      medium: 'ethernet',
    },
    {
      id: 'eth-printer',
      from: 'printer',
      to: 'core-switch',
      latencyMs: 0.1,
      bandwidthMbps: 100,
      medium: 'ethernet',
    },
    {
      id: 'trunk-firewall',
      from: 'core-switch',
      to: 'firewall',
      latencyMs: 0.05,
      bandwidthMbps: 1000,
      medium: 'ethernet',
    },
    {
      id: 'wan-uplink',
      from: 'firewall',
      to: 'isp-router',
      latencyMs: 5,
      bandwidthMbps: 500,
      medium: 'fiber',
    },
  ],
};

export const SMALL_OFFICE: ScenarioTopology = {
  id: 'small-office',
  title: 'Small office',
  summary:
    'One switch, three VLANs, and a firewall that every VLAN has to pass through. Segmentation, and why the firewall sits where it does.',
  teaches: [
    'Subnetting inside 10.0.0.0/8',
    'VLANs and 802.1Q tagging',
    'Access ports vs trunk ports',
    'Why a firewall is placed at the layer-3 boundary',
    'Running a local resolver for an internal zone',
  ],
  topology,
  notes: [
    {
      targetId: 'desk-1',
      text: 'Nothing on this workstation says which VLAN it is in. The switch port it is plugged into decides that, and the port is untagged, so the machine sends and receives ordinary frames and never sees a VLAN tag at all. Moving the cable to a VLAN 30 port would silently put it on the guest network.',
      reference: ieee('802.1Q', 'Bridges and Bridged Networks: VLAN tagging'),
    },
    {
      targetId: 'desk-2',
      text: `This office uses ${STAFF_VLAN} rather than a 192.168 network because 10.0.0.0/8 leaves room to give each VLAN a whole /24 and still have millions of addresses spare. All three of the private ranges are equally valid; the /8 is simply the one with space to grow into.`,
      reference: rfc(1918, 'Address Allocation for Private Internets'),
    },
    {
      targetId: 'guest-laptop',
      text: `A visitor joins the guest SSID and lands in ${GUEST_VLAN}, a different broadcast domain from the staff network. It cannot reach the NAS by address, by name, or by broadcast, because the only path from VLAN 30 to VLAN 20 runs through the firewall and the firewall refuses it. Guest isolation is a routing fact here, not a promise.`,
      reference: ieee('802.11', 'Wireless LAN Medium Access Control and Physical Layer'),
    },
    {
      targetId: 'office-ap',
      text: 'One access point, two SSIDs, two VLANs. Frames from each network go up the same cable to the switch, tagged so the switch can tell them apart. The access point is still only a bridge: it never decides where a packet goes, only which VLAN the frame belongs to.',
      reference: ieee('802.1Q', 'Bridges and Bridged Networks: VLAN tagging'),
    },
    {
      targetId: 'core-switch',
      text: 'A managed switch adds a 4-byte tag to each frame naming the VLAN it belongs to, and refuses to forward a tagged frame out of a port that does not carry that VLAN. That single rule is the whole of the segmentation: three networks share one physical switch and one set of cables, and frames never cross between them.',
      reference: ieee('802.1Q', 'Bridges and Bridged Networks: VLAN tagging'),
    },
    {
      targetId: 'firewall',
      text: 'The firewall holds one address in every VLAN, so it is the default gateway for all three, and it is the only device that can move a packet from one to another. That is why it sits here rather than at the edge: policy applied at the layer-3 boundary cannot be avoided by a machine that is simply plugged into a different port. It also performs NAPT outbound, exactly as a home router does.',
      reference: rfc(2979, 'Behavior of and Requirements for Internet Firewalls'),
    },
    {
      targetId: 'dns-server',
      text: 'A local resolver answers for office.example from its own zone file and forwards everything else to the ISP resolver upstream. That gives internal machines real names instead of memorised addresses, and it keeps internal names from ever being asked about on the public Internet.',
      reference: rfc(1035, 'Domain Names: Implementation and Specification'),
    },
    {
      targetId: 'nas',
      text: 'The file server sits in the server VLAN with a 10 Gb/s uplink, because everyone in the office reads from it at once and the switch can only forward as fast as the slowest link in the path. Staff reach it across the firewall from VLAN 10; the guest VLAN has no route to it at all.',
    },
    {
      targetId: 'printer',
      text: 'The printer speaks IPP over TCP port 631, so it is a server in the same sense the NAS is, and it belongs in the server VLAN for the same reason. Its 100 Mb/s port is not a mistake: a print job is small and a printer is slow.',
      reference: rfc(8010, 'Internet Printing Protocol/1.1: Encoding and Transport'),
    },
    {
      targetId: 'isp-router',
      text: 'The uplink is a /30: four addresses, of which two are usable, one at each end. That is the smallest sensible subnet for a point-to-point link, and it is where the office stops being responsible for its own addressing. The ISP drops anything arriving from the office with a source address it has not assigned.',
      reference: rfc(2827, 'Network Ingress Filtering (BCP 38)'),
    },
    {
      targetId: 'trunk-firewall',
      text: `Every packet between two VLANs crosses this one cable twice: in tagged for ${SERVER_VLAN}, out tagged for ${STAFF_VLAN}, with the firewall turning it round in between. It is the busiest link in the office and the single point where policy is enforced.`,
    },
  ],
};
