/**
 * Scenario 1 -- a browser fetches a page.
 *
 * The complete life of a TCP connection across eleven machines and two continents: the
 * three-way handshake, one request, one response, and the four-segment teardown, with a
 * NAPT rewrite on the way out and its exact reverse on the way back.
 *
 * This is the scenario that answers "what actually happens when I press enter". The
 * things worth watching, in the order they appear:
 *
 * - The frame leaving the laptop is addressed to the **router**, not to the server. It
 *   crosses the access point and the switch untouched, because neither of them opens the
 *   IP header.
 * - Every router rewrites both MAC addresses, decrements the TTL, and recomputes the
 *   header checksum -- and changes neither IP address.
 * - The home router changes both. It is the only machine on the path that does, and it
 *   writes down what it did so the reply can find its way back to one laptop out of
 *   three.
 * - The `Ack` in every segment is the peer's `Seq` plus what it sent. That arithmetic is
 *   the entire mechanism of TCP reliability, and it is checked, not asserted.
 *
 * Port 80 and plain HTTP, deliberately: what TLS adds on top is phase 09's subject, and
 * showing an unencrypted request here is what makes the HTTPS module's version of the
 * same picture mean something.
 */

import type { ProtocolLayer } from '@/core/types/pdu';

import type { JourneyScenario } from '../sim/journey';

import { HOME_PUBLIC_IP, JOURNEY_TOPOLOGY, PATH_TO_ORIGIN } from './topology';

/** A GET, as the browser writes it onto the connection. */
const HTTP_REQUEST: ProtocolLayer = {
  layer: 'application',
  protocol: 'HTTP/1.1',
  fields: [
    {
      name: 'Request line',
      value: 'GET /index.html HTTP/1.1',
      note: 'Method, path, version. The path is all the server is told about what was asked for -- the hostname is a header.',
    },
    {
      name: 'Host',
      value: 'app.example',
      note: 'Which site is wanted. One address can serve thousands, and this header is what tells them apart.',
    },
    { name: 'User-Agent', value: 'Mozilla/5.0 (internet-visualizer)' },
    {
      name: 'Accept-Encoding',
      value: 'gzip, br',
      note: 'What the client can decompress. The server picks one and says which in its reply.',
    },
    { name: 'Connection', value: 'keep-alive' },
  ],
  payloadPreview: 'GET /index.html HTTP/1.1\r\nHost: app.example\r\n...',
};

/** The answer, headers and a small HTML body. */
const HTTP_RESPONSE: ProtocolLayer = {
  layer: 'application',
  protocol: 'HTTP/1.1',
  fields: [
    {
      name: 'Status line',
      value: 'HTTP/1.1 200 OK',
      note: 'Version, status code, reason phrase. Everything else in the response is a header or a body.',
    },
    { name: 'Content-Type', value: 'text/html; charset=utf-8' },
    {
      name: 'Content-Length',
      value: '946',
      note: 'How many body bytes follow, so the receiver knows where the message ends without closing the connection.',
    },
    { name: 'Cache-Control', value: 'max-age=300' },
    { name: 'Server', value: 'example-origin' },
  ],
  payloadPreview: '<!doctype html><html lang="en"><head><title>app.example</title>...',
};

/** The scenario the module opens on. */
export const TCP_WEB_REQUEST: JourneyScenario = {
  id: 'tcp-web-request',
  title: 'TCP web request',
  summary:
    'A laptop fetches a page from a server in Frankfurt. Handshake, request, response, teardown -- with a NAPT rewrite at the home router and its exact reverse on the way back.',
  teaches: [
    'Encapsulation: HTTP inside TCP inside IPv4 inside Ethernet',
    'MAC addresses change every hop; IP addresses do not',
    'TTL decrement and checksum recomputation',
    'NAPT translation and the table that reverses it',
    'TCP sequence and acknowledgement arithmetic',
  ],
  topology: JOURNEY_TOPOLOGY,
  path: PATH_TO_ORIGIN,
  transport: 'tcp',
  clientPort: 49152,
  serverPort: 80,
  nat: { nodeId: 'router', publicIp: HOME_PUBLIC_IP, firstPort: 60000 },
  seed: 'tcp-web-request',
  clientIsn: 1_842_000,
  serverIsn: 3_517_400,
  writes: [
    {
      from: 'client',
      bytes: 412,
      application: HTTP_REQUEST,
      preview: 'GET /index.html HTTP/1.1',
      phase: {
        id: 'request',
        title: 'HTTP request',
        description:
          'The browser writes 412 bytes onto the open connection. TCP puts them in one segment; IPv4 and Ethernet wrap it for the first wire.',
      },
      note: {
        text: 'The request is one segment because 412 bytes fits comfortably inside the 1460-byte maximum segment size the handshake settled on -- which is 1500 less the 20-byte IPv4 header and the 20-byte TCP header. Nothing here has to be fragmented.',
        reference: {
          rfc: 9293,
          section: '3.7.1',
          title: 'Transmission Control Protocol',
        },
      },
    },
    {
      from: 'server',
      bytes: 1180,
      application: HTTP_RESPONSE,
      preview: 'HTTP/1.1 200 OK',
      phase: {
        id: 'response',
        title: 'HTTP response',
        description:
          'The origin answers with headers and a small HTML body, back along the same path -- and through the same NAT row, read the other way.',
      },
      note: {
        targetId: 'router',
        text: 'The reply arrived addressed to 203.0.113.7 and the port the router allocated. It looks that row up, puts the laptop’s private address and original port back, and forwards it onto the LAN. Without the row there would be nothing to look up, and no way to guess which of the three devices in the house it was for.',
        reference: {
          rfc: 3022,
          section: '2.2',
          title: 'Traditional IP Network Address Translator',
        },
      },
    },
  ],
};
