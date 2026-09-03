import { describe, expect, it } from 'vitest';

import {
  NAT_IDLE_TIMEOUT_MS,
  createNatTable,
  describeFlow,
  expireNatBindings,
  findOutboundBinding,
  natTableRows,
  translateInbound,
  translateOutbound,
  type Flow,
  type NatTable,
} from './nat';

const PUBLIC_IP = '203.0.113.7';
const WEB_SERVER = { ip: '203.0.113.30', port: 443 };

function table(overrides: Partial<Parameters<typeof createNatTable>[0]> = {}): NatTable {
  return createNatTable({ publicIp: PUBLIC_IP, firstPort: 60000, ...overrides });
}

/** The laptop opening a connection to a web server. */
function laptopToWeb(port = 49152): Flow {
  return {
    protocol: 'tcp',
    source: { ip: '192.168.1.112', port },
    destination: WEB_SERVER,
  };
}

/** The reply that same server sends back to the router's public address. */
function webToRouter(publicPort: number): Flow {
  return {
    protocol: 'tcp',
    source: WEB_SERVER,
    destination: { ip: PUBLIC_IP, port: publicPort },
  };
}

describe('translateOutbound', () => {
  it('rewrites the source address and port, and leaves the destination alone', () => {
    const result = translateOutbound(table(), laptopToWeb(), 0);

    expect(result.kind).toBe('translated');
    if (result.kind !== 'translated') return;

    expect(result.flow.source).toEqual({ ip: PUBLIC_IP, port: 60000 });
    expect(result.flow.destination).toEqual(WEB_SERVER);
    expect(result.created).toBe(true);
  });

  it('records the mapping in both directions', () => {
    const result = translateOutbound(table(), laptopToWeb(), 12);
    if (result.kind !== 'translated') throw new Error('expected translation');

    expect(result.binding).toEqual({
      protocol: 'tcp',
      insideLocal: { ip: '192.168.1.112', port: 49152 },
      insideGlobal: { ip: PUBLIC_IP, port: 60000 },
      outside: WEB_SERVER,
      createdAt: 12,
      lastUsedAt: 12,
    });
  });

  /**
   * The second packet of a connection must get the same translated port as the first,
   * or the server would see two unrelated connections instead of one.
   */
  it('reuses the row for a flow it has already seen', () => {
    const first = translateOutbound(table(), laptopToWeb(), 0);
    if (first.kind !== 'translated') throw new Error('expected translation');

    const second = translateOutbound(first.table, laptopToWeb(), 40);
    if (second.kind !== 'translated') throw new Error('expected translation');

    expect(second.created).toBe(false);
    expect(second.table.bindings).toHaveLength(1);
    expect(second.binding.insideGlobal.port).toBe(60000);
    expect(second.binding.createdAt).toBe(0);
    expect(second.binding.lastUsedAt).toBe(40);
  });

  /**
   * The whole reason NAPT rewrites the *port* and not just the address: two machines in
   * the same house can pick the same ephemeral port, and after translation they must
   * still be distinguishable.
   */
  it('gives two devices that chose the same source port different public ports', () => {
    const first = translateOutbound(table(), laptopToWeb(49152), 0);
    if (first.kind !== 'translated') throw new Error('expected translation');

    const phone: Flow = {
      protocol: 'tcp',
      source: { ip: '192.168.1.140', port: 49152 },
      destination: WEB_SERVER,
    };
    const second = translateOutbound(first.table, phone, 5);
    if (second.kind !== 'translated') throw new Error('expected translation');

    expect(first.binding.insideGlobal.port).toBe(60000);
    expect(second.binding.insideGlobal.port).toBe(60001);
    expect(second.table.bindings).toHaveLength(2);
  });

  it('allocates TCP and UDP ports from separate spaces', () => {
    const tcp = translateOutbound(table(), laptopToWeb(), 0);
    if (tcp.kind !== 'translated') throw new Error('expected translation');

    const dns: Flow = {
      protocol: 'udp',
      source: { ip: '192.168.1.112', port: 49152 },
      destination: { ip: '203.0.113.53', port: 53 },
    };
    const udp = translateOutbound(tcp.table, dns, 1);
    if (udp.kind !== 'translated') throw new Error('expected translation');

    expect(udp.binding.insideGlobal.port).toBe(60000);
  });

  it('keeps the original port when port preservation is switched on', () => {
    const preserving = table({ preservePorts: true, lastPort: 65535 });
    const result = translateOutbound(preserving, laptopToWeb(60123), 0);
    if (result.kind !== 'translated') throw new Error('expected translation');

    expect(result.binding.insideGlobal.port).toBe(60123);
  });

  it('reports exhaustion when every port in the range is bound', () => {
    let current = table({ firstPort: 60000, lastPort: 60001 });
    for (const port of [49152, 49153]) {
      const step = translateOutbound(current, laptopToWeb(port), 0);
      if (step.kind !== 'translated') throw new Error('expected translation');
      current = step.table;
    }

    const overflow = translateOutbound(current, laptopToWeb(49154), 0);
    expect(overflow.kind).toBe('exhausted');
    expect(overflow.table.bindings).toHaveLength(2);
  });
});

describe('translateInbound', () => {
  function withBinding(): NatTable {
    const result = translateOutbound(table(), laptopToWeb(), 0);
    if (result.kind !== 'translated') throw new Error('expected translation');
    return result.table;
  }

  /** The reverse mapping: the reply gets the laptop's private address and port back. */
  it('reverses the row, restoring the private destination', () => {
    const result = translateInbound(withBinding(), webToRouter(60000), 50);

    expect(result.kind).toBe('translated');
    if (result.kind !== 'translated') return;

    expect(result.flow.destination).toEqual({ ip: '192.168.1.112', port: 49152 });
    expect(result.flow.source).toEqual(WEB_SERVER);
    expect(result.binding.lastUsedAt).toBe(50);
  });

  it('round-trips: what goes out translated comes back exactly as it left', () => {
    const original = laptopToWeb();
    const out = translateOutbound(table(), original, 0);
    if (out.kind !== 'translated') throw new Error('expected translation');

    const reply: Flow = {
      protocol: 'tcp',
      source: out.flow.destination,
      destination: out.flow.source,
    };
    const back = translateInbound(out.table, reply, 50);
    if (back.kind !== 'translated') throw new Error('expected translation');

    expect(back.flow.destination).toEqual(original.source);
  });

  /**
   * The port-forwarding lesson: nothing is being blocked on purpose. The router has one
   * public address, several machines behind it, and no row saying which one this packet
   * was for.
   */
  it('drops an unsolicited packet, because there is no row to deliver it by', () => {
    const result = translateInbound(
      withBinding(),
      {
        protocol: 'tcp',
        source: { ip: '203.0.113.99', port: 51000 },
        destination: { ip: PUBLIC_IP, port: 8080 },
      },
      60,
    );

    expect(result.kind).toBe('unmatched');
    if (result.kind !== 'unmatched') return;
    expect(result.reason).toContain('port forwarding');
  });

  /**
   * Endpoint-dependent filtering: a port opened by talking to one host does not let a
   * different host in behind it.
   */
  it('refuses a packet arriving on a bound port from the wrong host', () => {
    const result = translateInbound(
      withBinding(),
      {
        protocol: 'tcp',
        source: { ip: '203.0.113.99', port: 443 },
        destination: { ip: PUBLIC_IP, port: 60000 },
      },
      60,
    );

    expect(result.kind).toBe('unmatched');
    if (result.kind !== 'unmatched') return;
    expect(result.reason).toContain('different host');
  });

  it('refuses a packet whose protocol does not match the row', () => {
    const result = translateInbound(
      withBinding(),
      { ...webToRouter(60000), protocol: 'udp' },
      60,
    );
    expect(result.kind).toBe('unmatched');
  });

  it('refuses a packet that is not addressed to this router at all', () => {
    const result = translateInbound(
      withBinding(),
      { ...webToRouter(60000), destination: { ip: '203.0.113.8', port: 60000 } },
      60,
    );

    expect(result.kind).toBe('unmatched');
    if (result.kind !== 'unmatched') return;
    expect(result.reason).toContain('public address');
  });
});

describe('table lifetime', () => {
  it('is immutable: translating does not touch the table it was given', () => {
    const before = table();
    translateOutbound(before, laptopToWeb(), 0);
    expect(before.bindings).toEqual([]);
  });

  it('expires a UDP row long before a TCP one, which is why keepalives exist', () => {
    const tcp = translateOutbound(table(), laptopToWeb(), 0);
    if (tcp.kind !== 'translated') throw new Error('expected translation');

    const dns: Flow = {
      protocol: 'udp',
      source: { ip: '192.168.1.112', port: 49153 },
      destination: { ip: '203.0.113.53', port: 53 },
    };
    const udp = translateOutbound(tcp.table, dns, 0);
    if (udp.kind !== 'translated') throw new Error('expected translation');

    const result = expireNatBindings(udp.table, NAT_IDLE_TIMEOUT_MS.udp);

    expect(result.expired).toHaveLength(1);
    expect(result.expired[0].protocol).toBe('udp');
    expect(result.table.bindings).toHaveLength(1);
    expect(result.table.bindings[0].protocol).toBe('tcp');
  });

  it('leaves a table alone when nothing has gone quiet yet', () => {
    const out = translateOutbound(table(), laptopToWeb(), 0);
    if (out.kind !== 'translated') throw new Error('expected translation');

    const result = expireNatBindings(out.table, 1000);
    expect(result.expired).toEqual([]);
    expect(result.table).toBe(out.table);
  });

  it('finds the row an outbound flow would use', () => {
    const out = translateOutbound(table(), laptopToWeb(), 0);
    if (out.kind !== 'translated') throw new Error('expected translation');

    expect(findOutboundBinding(out.table, laptopToWeb())).toEqual(out.binding);
    expect(findOutboundBinding(out.table, laptopToWeb(49999))).toBeUndefined();
  });
});

describe('display', () => {
  it('renders the table the way a router status page does', () => {
    const out = translateOutbound(table(), laptopToWeb(), 0);
    if (out.kind !== 'translated') throw new Error('expected translation');

    expect(natTableRows(out.table)).toEqual([
      {
        protocol: 'TCP',
        insideLocal: '192.168.1.112:49152',
        insideGlobal: '203.0.113.7:60000',
        outside: '203.0.113.30:443',
      },
    ]);
  });

  it('summarizes a flow for the event log', () => {
    expect(describeFlow(laptopToWeb())).toBe(
      'tcp 192.168.1.112:49152 -> 203.0.113.30:443',
    );
  });
});

describe('createNatTable', () => {
  it('rejects a public address that is not a dotted quad', () => {
    expect(() => createNatTable({ publicIp: '203.0.113' })).toThrow();
  });

  it('rejects a port range that runs backwards', () => {
    expect(() =>
      createNatTable({ publicIp: PUBLIC_IP, firstPort: 60000, lastPort: 59000 }),
    ).toThrow(RangeError);
  });
});
