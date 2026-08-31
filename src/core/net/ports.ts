/**
 * Ports -- the 16-bit numbers that decide *which program* on a host receives a segment.
 *
 * An IP address gets a packet to a machine; a port gets it to a process. That is the
 * one idea this file exists to make visible, which is why every entry carries a
 * sentence of explanation rather than just a name: the inspector should be able to
 * turn `dport=53` into "DNS -- the name lookup that starts almost every connection".
 *
 * The table is a curated teaching set, not a copy of the IANA registry: the ports a
 * learner will actually meet in these modules, plus the ones worth recognising in a
 * packet capture. `lookupPort` returning `undefined` is normal and expected.
 *
 * `parsePort` is here for the same reason the address validators are strict: phase 12
 * accepts a port from the user, and "080" or "65536" must be rejected, not coerced.
 */

import { fail, ok, type ParseResult } from './result';

/** The two transport protocols that carry ports. */
export type Transport = 'tcp' | 'udp';

/** One entry in the well-known port table. */
export interface PortInfo {
  /** The port number itself, 0-65535. */
  readonly port: number;
  /** The IANA service name, lower case, as `/etc/services` writes it: `'https'`. */
  readonly service: string;
  /** Display name for the UI: `'HTTPS'`. */
  readonly label: string;
  /** Which transports actually use this port for this service. */
  readonly transports: readonly Transport[];
  /** One sentence on what the service does, shown in the inspector. */
  readonly description: string;
}

/**
 * IANA's three ranges, and the reason a client's source port looks random.
 *
 * - `well-known` (0-1023): assigned services; binding one needs privileges on Unix.
 * - `registered` (1024-49151): assigned to applications on request.
 * - `dynamic` (49152-65535): never assigned; the kernel draws a client's source port
 *   from here for each new connection.
 */
export type PortRange = 'well-known' | 'registered' | 'dynamic';

/** The IANA dynamic/ephemeral range, inclusive. Source ports come from here. */
export const EPHEMERAL_PORT_RANGE = { first: 49152, last: 65535 } as const;

/** The highest legal port number: ports are a 16-bit header field. */
export const MAX_PORT = 65535;

/**
 * Well-known and commonly seen ports, in ascending numeric order.
 *
 * Ordered by number rather than by importance so the table reads like the registry it
 * comes from, and so a UI can render it directly.
 */
export const WELL_KNOWN_PORTS: readonly PortInfo[] = [
  {
    port: 20,
    service: 'ftp-data',
    label: 'FTP (data)',
    transports: ['tcp'],
    description: 'The separate data channel classic FTP opens to transfer a file.',
  },
  {
    port: 21,
    service: 'ftp',
    label: 'FTP (control)',
    transports: ['tcp'],
    description: 'File Transfer Protocol commands, in clear text.',
  },
  {
    port: 22,
    service: 'ssh',
    label: 'SSH',
    transports: ['tcp'],
    description: 'Encrypted remote shell; also carries SFTP and port forwarding.',
  },
  {
    port: 23,
    service: 'telnet',
    label: 'Telnet',
    transports: ['tcp'],
    description: 'Remote shell with no encryption at all. Superseded by SSH.',
  },
  {
    port: 25,
    service: 'smtp',
    label: 'SMTP',
    transports: ['tcp'],
    description: 'Mail relay between mail servers.',
  },
  {
    port: 53,
    service: 'domain',
    label: 'DNS',
    transports: ['udp', 'tcp'],
    description:
      'Name lookups. UDP for ordinary queries, TCP when the answer will not fit.',
  },
  {
    port: 67,
    service: 'bootps',
    label: 'DHCP (server)',
    transports: ['udp'],
    description: 'Where a client sends the broadcast that asks for an IP address.',
  },
  {
    port: 68,
    service: 'bootpc',
    label: 'DHCP (client)',
    transports: ['udp'],
    description: 'Where the client listens for the offer and the lease.',
  },
  {
    port: 69,
    service: 'tftp',
    label: 'TFTP',
    transports: ['udp'],
    description: 'Trivial file transfer; used to boot devices over the network.',
  },
  {
    port: 80,
    service: 'http',
    label: 'HTTP',
    transports: ['tcp'],
    description: 'The web, unencrypted. Usually now a redirect to 443.',
  },
  {
    port: 110,
    service: 'pop3',
    label: 'POP3',
    transports: ['tcp'],
    description: 'Downloads mail from a server, traditionally deleting it there.',
  },
  {
    port: 123,
    service: 'ntp',
    label: 'NTP',
    transports: ['udp'],
    description: 'Clock synchronisation; TLS certificate checks depend on it.',
  },
  {
    port: 143,
    service: 'imap',
    label: 'IMAP',
    transports: ['tcp'],
    description: 'Reads mail while leaving it on the server, synced across devices.',
  },
  {
    port: 161,
    service: 'snmp',
    label: 'SNMP',
    transports: ['udp'],
    description: 'Polls network devices for counters and status.',
  },
  {
    port: 179,
    service: 'bgp',
    label: 'BGP',
    transports: ['tcp'],
    description:
      'The routing protocol networks use to tell each other what they can reach.',
  },
  {
    port: 389,
    service: 'ldap',
    label: 'LDAP',
    transports: ['tcp', 'udp'],
    description: 'Directory lookups for users, groups, and devices.',
  },
  {
    port: 443,
    service: 'https',
    label: 'HTTPS',
    transports: ['tcp', 'udp'],
    description: 'The web over TLS. UDP here is HTTP/3 over QUIC.',
  },
  {
    port: 445,
    service: 'microsoft-ds',
    label: 'SMB',
    transports: ['tcp'],
    description: 'Windows file and printer sharing. Never expose it to the Internet.',
  },
  {
    port: 465,
    service: 'submissions',
    label: 'SMTPS',
    transports: ['tcp'],
    description: 'Mail submission wrapped in TLS from the first byte.',
  },
  {
    port: 500,
    service: 'isakmp',
    label: 'IKE',
    transports: ['udp'],
    description: 'Key exchange that sets up an IPsec VPN tunnel.',
  },
  {
    port: 514,
    service: 'syslog',
    label: 'Syslog',
    transports: ['udp'],
    description: 'Log messages shipped to a central collector.',
  },
  {
    port: 587,
    service: 'submission',
    label: 'SMTP (submission)',
    transports: ['tcp'],
    description:
      'Where a mail client hands a message to its own server, upgrading to TLS.',
  },
  {
    port: 636,
    service: 'ldaps',
    label: 'LDAPS',
    transports: ['tcp'],
    description: 'LDAP over TLS.',
  },
  {
    port: 853,
    service: 'domain-s',
    label: 'DNS over TLS',
    transports: ['tcp', 'udp'],
    description: 'Encrypted DNS, so the network cannot read or rewrite your lookups.',
  },
  {
    port: 993,
    service: 'imaps',
    label: 'IMAPS',
    transports: ['tcp'],
    description: 'IMAP over TLS.',
  },
  {
    port: 995,
    service: 'pop3s',
    label: 'POP3S',
    transports: ['tcp'],
    description: 'POP3 over TLS.',
  },
  {
    port: 1080,
    service: 'socks',
    label: 'SOCKS proxy',
    transports: ['tcp'],
    description: 'A generic proxy that forwards TCP connections on a client behalf.',
  },
  {
    port: 1194,
    service: 'openvpn',
    label: 'OpenVPN',
    transports: ['udp', 'tcp'],
    description: 'Tunnels a whole network stack inside a TLS-protected session.',
  },
  {
    port: 1433,
    service: 'ms-sql-s',
    label: 'Microsoft SQL Server',
    transports: ['tcp'],
    description: 'Database traffic; belongs on a private network only.',
  },
  {
    port: 1883,
    service: 'mqtt',
    label: 'MQTT',
    transports: ['tcp'],
    description: 'Lightweight publish/subscribe messaging used by IoT devices.',
  },
  {
    port: 3306,
    service: 'mysql',
    label: 'MySQL',
    transports: ['tcp'],
    description: 'Database traffic; belongs on a private network only.',
  },
  {
    port: 3389,
    service: 'ms-wbt-server',
    label: 'RDP',
    transports: ['tcp', 'udp'],
    description: 'Windows remote desktop. A favourite target when exposed.',
  },
  {
    port: 3478,
    service: 'stun',
    label: 'STUN/TURN',
    transports: ['udp', 'tcp'],
    description: 'Lets a peer behind NAT discover how the outside world sees it.',
  },
  {
    port: 5060,
    service: 'sip',
    label: 'SIP',
    transports: ['udp', 'tcp'],
    description: 'Sets up voice and video calls.',
  },
  {
    port: 5222,
    service: 'xmpp-client',
    label: 'XMPP',
    transports: ['tcp'],
    description: 'Federated chat; the protocol behind several messaging networks.',
  },
  {
    port: 5432,
    service: 'postgresql',
    label: 'PostgreSQL',
    transports: ['tcp'],
    description: 'Database traffic; belongs on a private network only.',
  },
  {
    port: 6379,
    service: 'redis',
    label: 'Redis',
    transports: ['tcp'],
    description: 'In-memory data store; unauthenticated by default, so keep it private.',
  },
  {
    port: 8080,
    service: 'http-alt',
    label: 'HTTP (alternate)',
    transports: ['tcp'],
    description: 'The usual port for a local dev server or a service behind a proxy.',
  },
  {
    port: 8443,
    service: 'https-alt',
    label: 'HTTPS (alternate)',
    transports: ['tcp'],
    description: 'HTTPS on an unprivileged port, behind a load balancer or in dev.',
  },
  {
    port: 27017,
    service: 'mongodb',
    label: 'MongoDB',
    transports: ['tcp'],
    description: 'Database traffic; belongs on a private network only.',
  },
];

const PORTS_BY_NUMBER: ReadonlyMap<number, PortInfo> = new Map(
  WELL_KNOWN_PORTS.map((info) => [info.port, info]),
);

const PORTS_BY_SERVICE: ReadonlyMap<string, PortInfo> = new Map(
  WELL_KNOWN_PORTS.map((info) => [info.service, info]),
);

/** Is this a legal port number? Integer, 0-65535. */
export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_PORT;
}

/**
 * Parse a port typed by a user.
 *
 * Decimal digits only, no leading zeros, and 0 is rejected: it is reserved, is never a
 * real endpoint, and "port 0" reaching a connect() call is usually a bug or a probe.
 */
export function parsePort(input: string): ParseResult<number> {
  if (typeof input !== 'string') {
    return fail('expected a string');
  }
  if (!/^\d{1,5}$/.test(input)) {
    return fail(`"${input}" is not a decimal port number`);
  }
  if (input.length > 1 && input.startsWith('0')) {
    return fail(`port "${input}" has a leading zero`);
  }
  const port = Number(input);
  if (port === 0) {
    return fail('port 0 is reserved and is never a real endpoint');
  }
  if (port > MAX_PORT) {
    return fail(`port ${port} is out of range 1-${MAX_PORT}`);
  }
  return ok(port);
}

/**
 * The table entry for a port, if there is one.
 *
 * Passing `transport` narrows the match: port 53 is DNS over both UDP and TCP, but
 * `lookupPort(80, 'udp')` is `undefined`, because nothing standard runs there.
 */
export function lookupPort(port: number, transport?: Transport): PortInfo | undefined {
  const info = PORTS_BY_NUMBER.get(port);
  if (!info) {
    return undefined;
  }
  if (transport && !info.transports.includes(transport)) {
    return undefined;
  }
  return info;
}

/** The table entry for an IANA service name, e.g. `'https'`. */
export function lookupService(service: string): PortInfo | undefined {
  return PORTS_BY_SERVICE.get(service.toLowerCase());
}

/** The IANA service name for a port, or `undefined` if it is not in the table. */
export function serviceName(port: number, transport?: Transport): string | undefined {
  return lookupPort(port, transport)?.service;
}

/**
 * A one-line label for a port, always non-empty.
 *
 * Known ports read `'443/tcp (https)'`; unknown ones fall back to `'51820/udp'`, since
 * most ports on a real host are not in any registry.
 */
export function describePort(port: number, transport?: Transport): string {
  const suffix = transport ? `/${transport}` : '';
  const info = lookupPort(port, transport);
  return info ? `${port}${suffix} (${info.service})` : `${port}${suffix}`;
}

/** Which IANA range a port falls in. See {@link PortRange}. */
export function portRange(port: number): PortRange {
  if (!isValidPort(port)) {
    throw new RangeError(`${port} is not a port number`);
  }
  if (port <= 1023) {
    return 'well-known';
  }
  return port < EPHEMERAL_PORT_RANGE.first ? 'registered' : 'dynamic';
}

/**
 * Is this port in the dynamic range a kernel draws source ports from?
 *
 * Useful for explaining why the client side of a connection looks like a random number
 * while the server side is always the same.
 */
export function isEphemeralPort(port: number): boolean {
  return (
    isValidPort(port) &&
    port >= EPHEMERAL_PORT_RANGE.first &&
    port <= EPHEMERAL_PORT_RANGE.last
  );
}
