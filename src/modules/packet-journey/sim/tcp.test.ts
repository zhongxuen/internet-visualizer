import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MSS,
  TCP_HEADER_BYTES,
  TCP_SEQ_SPACE,
  buildTcpLayer,
  deliverSegment,
  describeTcpSegment,
  formatTcpFlags,
  nextSeq,
  openTcpConnection,
  retransmitSegment,
  segmentLength,
  sendSegment,
  seqAdd,
  splitForMss,
  tcpExchange,
  tcpFlagBits,
  tcpPdu,
  transmitSegment,
  type TcpConnection,
  type TcpSegment,
} from './tcp';

/**
 * Fixed initial sequence numbers. A real stack picks these unpredictably -- a guessable
 * ISN lets an off-path attacker inject into someone else's connection -- but a
 * simulation has to replay identically, so the scenario supplies them.
 */
const CLIENT_ISN = 1000;
const SERVER_ISN = 5000;

function connection(): TcpConnection {
  return openTcpConnection({
    clientPort: 49152,
    serverPort: 443,
    clientIsn: CLIENT_ISN,
    serverIsn: SERVER_ISN,
  });
}

describe('sequence arithmetic', () => {
  it('counts SYN and FIN as one sequence number each, despite carrying no data', () => {
    const base = { sourcePort: 1, destinationPort: 2, seq: 100, ack: 0, windowSize: 0 };

    expect(segmentLength({ ...base, flags: { syn: true }, payloadBytes: 0 })).toBe(1);
    expect(segmentLength({ ...base, flags: { fin: true }, payloadBytes: 0 })).toBe(1);
    expect(segmentLength({ ...base, flags: { ack: true }, payloadBytes: 0 })).toBe(0);
    expect(segmentLength({ ...base, flags: { psh: true }, payloadBytes: 512 })).toBe(512);
    // A SYN carrying data (TCP Fast Open) consumes both.
    expect(segmentLength({ ...base, flags: { syn: true }, payloadBytes: 40 })).toBe(41);
  });

  it('wraps at 2^32, the way the wire does', () => {
    expect(seqAdd(TCP_SEQ_SPACE - 1, 2)).toBe(1);
    expect(seqAdd(0, 0)).toBe(0);
  });

  it('reports the next sequence number a sender will use', () => {
    const segment: TcpSegment = {
      sourcePort: 49152,
      destinationPort: 443,
      seq: 1000,
      ack: 0,
      flags: { syn: true },
      windowSize: 64240,
      payloadBytes: 0,
    };
    expect(nextSeq(segment)).toBe(1001);
  });
});

describe('three-way handshake', () => {
  it('numbers every segment from the two initial sequence numbers', () => {
    let conn = connection();

    const syn = transmitSegment(conn, 'client', { syn: true });
    conn = syn.connection;
    expect(syn.segment.seq).toBe(CLIENT_ISN);
    expect(syn.segment.flags.ack).toBe(false);

    const synAck = transmitSegment(conn, 'server', { syn: true, ack: true });
    conn = synAck.connection;
    expect(synAck.segment.seq).toBe(SERVER_ISN);
    // The SYN took one sequence number, so the acknowledgement is ISN + 1.
    expect(synAck.segment.ack).toBe(CLIENT_ISN + 1);

    const ack = transmitSegment(conn, 'client', { ack: true });
    conn = ack.connection;
    expect(ack.segment.seq).toBe(CLIENT_ISN + 1);
    expect(ack.segment.ack).toBe(SERVER_ISN + 1);
  });

  it('walks both endpoints through the states in the right order', () => {
    let conn = connection();
    expect([conn.client.state, conn.server.state]).toEqual(['CLOSED', 'LISTEN']);

    conn = transmitSegment(conn, 'client', { syn: true }).connection;
    expect(conn.client.state).toBe('SYN_SENT');

    conn = transmitSegment(conn, 'server', { syn: true, ack: true }).connection;
    // The client is established the moment it has both directions confirmed; the
    // server still needs the final ACK.
    expect([conn.client.state, conn.server.state]).toEqual([
      'ESTABLISHED',
      'SYN_RECEIVED',
    ]);

    conn = transmitSegment(conn, 'client', { ack: true }).connection;
    expect([conn.client.state, conn.server.state]).toEqual([
      'ESTABLISHED',
      'ESTABLISHED',
    ]);
  });

  it('leaves each end expecting the other one past its ISN', () => {
    let conn = connection();
    conn = transmitSegment(conn, 'client', { syn: true }).connection;
    conn = transmitSegment(conn, 'server', { syn: true, ack: true }).connection;
    conn = transmitSegment(conn, 'client', { ack: true }).connection;

    expect(conn.client.sndNxt).toBe(CLIENT_ISN + 1);
    expect(conn.client.rcvNxt).toBe(SERVER_ISN + 1);
    expect(conn.server.sndNxt).toBe(SERVER_ISN + 1);
    expect(conn.server.rcvNxt).toBe(CLIENT_ISN + 1);
  });
});

describe('data transfer', () => {
  function established(): TcpConnection {
    let conn = connection();
    conn = transmitSegment(conn, 'client', { syn: true }).connection;
    conn = transmitSegment(conn, 'server', { syn: true, ack: true }).connection;
    return transmitSegment(conn, 'client', { ack: true }).connection;
  }

  it('acknowledges exactly the bytes that arrived', () => {
    let conn = established();

    const request = transmitSegment(conn, 'client', { ack: true, psh: true, bytes: 100 });
    conn = request.connection;
    expect(request.segment.seq).toBe(CLIENT_ISN + 1);

    const serverAck = transmitSegment(conn, 'server', { ack: true });
    conn = serverAck.connection;
    // Ack is the client's Seq plus the 100 bytes it sent -- not 101, not 100.
    expect(serverAck.segment.ack).toBe(CLIENT_ISN + 101);
    // A pure ACK carries no data, so the server's own Seq has not moved.
    expect(serverAck.segment.seq).toBe(SERVER_ISN + 1);

    const response = transmitSegment(conn, 'server', {
      ack: true,
      psh: true,
      bytes: 500,
    });
    conn = response.connection;
    expect(response.segment.seq).toBe(SERVER_ISN + 1);
    expect(response.segment.ack).toBe(CLIENT_ISN + 101);

    const clientAck = transmitSegment(conn, 'client', { ack: true });
    expect(clientAck.segment.ack).toBe(SERVER_ISN + 501);
    expect(clientAck.segment.seq).toBe(CLIENT_ISN + 101);
  });

  it('advances the sender past data it has sent but not yet had acknowledged', () => {
    let conn = established();
    conn = sendSegment(conn, 'client', { ack: true, bytes: 100 }).connection;

    expect(conn.client.sndNxt).toBe(CLIENT_ISN + 101);
    expect(conn.client.sndUna).toBe(CLIENT_ISN + 1);
  });

  it('splits a write larger than the MSS, keeping the stream contiguous', () => {
    expect(splitForMss(4000, 1460)).toEqual([1460, 1460, 1080]);
    expect(splitForMss(1460, 1460)).toEqual([1460]);
    expect(splitForMss(0)).toEqual([]);
    expect(splitForMss(3000)).toEqual([DEFAULT_MSS, DEFAULT_MSS, 80]);
  });
});

describe('loss and retransmission', () => {
  function established(): TcpConnection {
    let conn = connection();
    conn = transmitSegment(conn, 'client', { syn: true }).connection;
    conn = transmitSegment(conn, 'server', { syn: true, ack: true }).connection;
    return transmitSegment(conn, 'client', { ack: true }).connection;
  }

  /**
   * A drop is a send with no delivery. The gap it opens between the sender's `sndNxt`
   * and the receiver's `rcvNxt` is exactly what the retransmission timer closes, and is
   * what the lossy-link scenario animates.
   */
  it('leaves the receiver behind when a segment is sent but never delivered', () => {
    let conn = established();
    const sent = sendSegment(conn, 'client', { ack: true, bytes: 200 });
    conn = sent.connection;

    expect(conn.client.sndNxt).toBe(CLIENT_ISN + 201);
    expect(conn.server.rcvNxt).toBe(CLIENT_ISN + 1);

    const again = retransmitSegment(conn, 'client', sent.segment);
    conn = again.connection;

    // The retransmission carries the original numbers -- that is what makes it a
    // retransmission and not new data.
    expect(again.segment.seq).toBe(CLIENT_ISN + 1);
    expect(conn.server.rcvNxt).toBe(CLIENT_ISN + 201);
    expect(conn.client.sndNxt).toBe(CLIENT_ISN + 201);
  });

  it('treats a segment delivered twice as a duplicate and consumes it once', () => {
    let conn = established();
    const sent = transmitSegment(conn, 'client', { ack: true, bytes: 200 });
    conn = sent.connection;
    expect(conn.server.rcvNxt).toBe(CLIENT_ISN + 201);

    const duplicate = deliverSegment(conn, 'server', sent.segment);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.connection.server.rcvNxt).toBe(CLIENT_ISN + 201);
  });
});

describe('teardown', () => {
  it('closes each direction separately, with arithmetically correct numbers', () => {
    const { steps, connection: closed } = tcpExchange({
      clientPort: 49152,
      serverPort: 443,
      clientIsn: CLIENT_ISN,
      serverIsn: SERVER_ISN,
      payloads: [
        { from: 'client', bytes: 100 },
        { from: 'server', bytes: 500 },
      ],
    });

    const teardown = steps.slice(-4);
    expect(
      teardown.map((step) => `${step.from}:${formatTcpFlags(step.segment.flags)}`),
    ).toEqual(['client:FIN, ACK', 'server:ACK', 'server:FIN, ACK', 'client:ACK']);

    const [fin, ackOfFin, serverFin, finalAck] = teardown;

    // 1 SYN + 100 data bytes puts the client's FIN at ISN + 101.
    expect(fin.segment.seq).toBe(CLIENT_ISN + 101);
    // A FIN takes a sequence number, so it is acknowledged with one more.
    expect(ackOfFin.segment.ack).toBe(CLIENT_ISN + 102);
    expect(serverFin.segment.seq).toBe(SERVER_ISN + 501);
    expect(finalAck.segment.ack).toBe(SERVER_ISN + 502);

    expect(closed.client.state).toBe('TIME_WAIT');
    expect(closed.server.state).toBe('CLOSED');
  });

  it('passes through the half-closed states on the way', () => {
    const { steps } = tcpExchange({
      clientPort: 49152,
      serverPort: 443,
      clientIsn: CLIENT_ISN,
      serverIsn: SERVER_ISN,
      payloads: [],
    });

    const teardown = steps.slice(-4);
    expect(teardown.map((step) => step.clientState)).toEqual([
      'FIN_WAIT_1',
      'FIN_WAIT_2',
      'TIME_WAIT',
      'TIME_WAIT',
    ]);
    expect(teardown.map((step) => step.serverState)).toEqual([
      'CLOSE_WAIT',
      'CLOSE_WAIT',
      'LAST_ACK',
      'CLOSED',
    ]);
  });

  it('lets the server close first when the scenario says so', () => {
    const { steps } = tcpExchange({
      clientPort: 49152,
      serverPort: 443,
      clientIsn: CLIENT_ISN,
      serverIsn: SERVER_ISN,
      payloads: [],
      closedBy: 'server',
    });

    expect(steps.slice(-4).map((step) => step.from)).toEqual([
      'server',
      'client',
      'client',
      'server',
    ]);
  });
});

describe('tcpExchange', () => {
  const options = {
    clientPort: 49152,
    serverPort: 443,
    clientIsn: CLIENT_ISN,
    serverIsn: SERVER_ISN,
    payloads: [
      { from: 'client' as const, bytes: 3000, preview: 'GET / HTTP/1.1' },
      { from: 'server' as const, bytes: 500 },
    ],
    mss: 1460,
  };

  it('segments a write larger than the MSS and acknowledges each segment', () => {
    const { steps } = tcpExchange(options);
    const data = steps.filter((step) => step.segment.payloadBytes > 0);

    expect(data.map((step) => step.segment.payloadBytes)).toEqual([1460, 1460, 80, 500]);
    expect(data.map((step) => step.segment.seq)).toEqual([
      CLIENT_ISN + 1,
      CLIENT_ISN + 1461,
      CLIENT_ISN + 2921,
      SERVER_ISN + 1,
    ]);
  });

  it('sets PSH only on the last segment of a write', () => {
    const { steps } = tcpExchange(options);
    const clientData = steps.filter(
      (step) => step.from === 'client' && step.segment.payloadBytes > 0,
    );
    expect(clientData.map((step) => Boolean(step.segment.flags.psh))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('is deterministic: two runs of the same options are deep-equal', () => {
    expect(tcpExchange(options)).toEqual(tcpExchange(options));
  });

  it('ends with every byte acknowledged at both ends', () => {
    const { connection: done } = tcpExchange(options);
    expect(done.client.sndUna).toBe(done.client.sndNxt);
    expect(done.server.sndUna).toBe(done.server.sndNxt);
  });
});

describe('rendering', () => {
  it('formats flags the way a capture does', () => {
    expect(formatTcpFlags({ syn: true, ack: true })).toBe('SYN, ACK');
    expect(formatTcpFlags({ psh: true, ack: true })).toBe('PSH, ACK');
    expect(formatTcpFlags({})).toBe('none');
    expect(tcpFlagBits({ syn: true, ack: true })).toBe(0x012);
  });

  it('summarizes a segment as a tcpdump one-liner', () => {
    const { steps } = tcpExchange({
      clientPort: 49152,
      serverPort: 443,
      clientIsn: CLIENT_ISN,
      serverIsn: SERVER_ISN,
      payloads: [],
    });

    expect(describeTcpSegment(steps[0].segment)).toBe(
      '49152 -> 443 [SYN] Seq=1000 Win=64240 Len=0',
    );
  });

  it('does not fake a checksum it cannot compute', () => {
    const { steps } = tcpExchange({
      clientPort: 49152,
      serverPort: 443,
      clientIsn: CLIENT_ISN,
      serverIsn: SERVER_ISN,
      payloads: [],
    });
    const layer = buildTcpLayer(steps[0].segment);
    const checksum = layer.fields.find((entry) => entry.name === 'Checksum');

    expect(checksum?.value).toContain('not modelled');
  });

  it('sizes the innermost PDU as header plus payload', () => {
    const segment: TcpSegment = {
      sourcePort: 49152,
      destinationPort: 443,
      seq: 1001,
      ack: 5001,
      flags: { ack: true, psh: true },
      windowSize: 64240,
      payloadBytes: 517,
    };
    const pdu = tcpPdu('request', segment);

    expect(pdu.sizeBytes).toBe(TCP_HEADER_BYTES + 517);
    expect(pdu.layers).toHaveLength(1);
    expect(pdu.layers[0].layer).toBe('transport');
  });
});
