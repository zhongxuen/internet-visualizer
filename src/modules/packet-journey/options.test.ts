import { describe, expect, it } from 'vitest';

import {
  AUTHORED_OPTIONS,
  authoredPayload,
  isAuthored,
  journeyOverrides,
  lossiestLink,
  narrowestMtu,
} from './options';
import {
  FRAGMENTED_PACKET,
  LOSSY_LINK,
  TCP_WEB_REQUEST,
  UDP_DNS_QUERY,
} from './scenarios';
import { runJourney } from './sim/journey';

/**
 * The knobs, tested against the engine rather than against themselves.
 *
 * Three of these assert a property of the *resulting run* -- that untouched controls
 * change nothing, that a lower MTU actually splits a packet, that switching loss off
 * leaves an otherwise identical run -- because that is what a viewer is being told the
 * controls do, and the mapping is where it could quietly stop being true.
 */

describe('journeyOverrides', () => {
  it('overrides nothing while every knob is untouched', () => {
    expect(journeyOverrides(TCP_WEB_REQUEST, AUTHORED_OPTIONS)).toEqual({});
    expect(isAuthored(AUTHORED_OPTIONS)).toBe(true);
  });

  it('leaves the authored run byte-for-byte identical', () => {
    const authored = runJourney(TCP_WEB_REQUEST);
    const through = runJourney(
      TCP_WEB_REQUEST,
      journeyOverrides(TCP_WEB_REQUEST, AUTHORED_OPTIONS),
    );

    expect(through).toEqual(authored);
  });

  it('applies one payload size to every write in the run', () => {
    const overrides = journeyOverrides(TCP_WEB_REQUEST, {
      ...AUTHORED_OPTIONS,
      payloadBytes: 900,
    });

    expect(overrides.writes?.map((write) => write.bytes)).toEqual([900, 900]);
    // The rest of each write -- its application header, its phase, its note -- survives.
    expect(overrides.writes?.[0].application?.protocol).toBe(
      TCP_WEB_REQUEST.writes[0].application?.protocol,
    );
    expect(overrides.writes?.[0].phase).toBe(TCP_WEB_REQUEST.writes[0].phase);
  });

  /**
   * The knob that would otherwise appear to do nothing on the one scenario it matters
   * most for: `fragmented-packet` pins the access line at 1492, so a new default of 1280
   * has to be pushed down onto it as well.
   */
  it('caps a scenario per-link MTU at the chosen value', () => {
    const overrides = journeyOverrides(FRAGMENTED_PACKET, {
      ...AUTHORED_OPTIONS,
      mtu: 1280,
    });

    expect(overrides.mtu).toBe(1280);
    expect(overrides.linkMtu).toEqual({ 'access-uplink': 1280 });
  });

  it('leaves a link that was authored narrower than the new default alone', () => {
    const overrides = journeyOverrides(FRAGMENTED_PACKET, {
      ...AUTHORED_OPTIONS,
      mtu: 1500,
    });

    expect(overrides.linkMtu).toEqual({ 'access-uplink': 1492 });
  });

  it('actually fragments a packet that no longer fits', () => {
    const roomy = runJourney(UDP_DNS_QUERY, {
      ...journeyOverrides(UDP_DNS_QUERY, { ...AUTHORED_OPTIONS, payloadBytes: 1200 }),
    });
    const narrow = runJourney(
      UDP_DNS_QUERY,
      journeyOverrides(UDP_DNS_QUERY, {
        ...AUTHORED_OPTIONS,
        payloadBytes: 1200,
        mtu: 576,
      }),
    );

    const fragments = (result: typeof narrow) =>
      Object.keys(result.pdus).filter((id) => /-f\d+$/.test(id)).length;

    expect(fragments(roomy)).toBe(0);
    expect(fragments(narrow)).toBeGreaterThan(0);
  });

  it('switches a scenario own loss off without disturbing anything else', () => {
    const reliable = runJourney(
      LOSSY_LINK,
      journeyOverrides(LOSSY_LINK, { ...AUTHORED_OPTIONS, lossy: false }),
    );
    const lossy = runJourney(LOSSY_LINK);

    expect(reliable.events.some((event) => event.kind === 'drop')).toBe(false);
    expect(lossy.events.some((event) => event.kind === 'drop')).toBe(true);
    // Nothing was retransmitted, so the reliable run is the shorter one.
    expect(reliable.durationMs).toBeLessThan(lossy.durationMs);
  });

  it('keeps the scenario own rate when loss is switched back on', () => {
    const overrides = journeyOverrides(LOSSY_LINK, {
      ...AUTHORED_OPTIONS,
      lossy: true,
    });

    expect(overrides.loss).toEqual(LOSSY_LINK.loss);
  });

  it('puts hand-thrown loss on a link the packet actually crosses', () => {
    const overrides = journeyOverrides(TCP_WEB_REQUEST, {
      ...AUTHORED_OPTIONS,
      lossy: true,
    });
    const linkIds = TCP_WEB_REQUEST.topology.links.map((link) => link.id);

    expect(overrides.loss?.rate).toBeGreaterThan(0);
    expect(linkIds).toContain(overrides.loss?.linkId);
    expect(
      runJourney(TCP_WEB_REQUEST, overrides).events.some(
        (event) => event.kind === 'drop',
      ),
    ).toBe(true);
  });

  it('runs a TCP scenario over UDP when the transport is changed', () => {
    const result = runJourney(
      TCP_WEB_REQUEST,
      journeyOverrides(TCP_WEB_REQUEST, { ...AUTHORED_OPTIONS, transport: 'udp' }),
    );

    expect(Object.values(result.pdus).some((pdu) => pdu.summary.startsWith('UDP'))).toBe(
      true,
    );
    // No connection, so no handshake to open one.
    expect(result.phases.some((phase) => phase.title.includes('handshake'))).toBe(false);
  });
});

describe('reading the scenario back for the controls', () => {
  it('starts the payload slider at the largest thing the scenario sends', () => {
    expect(authoredPayload(TCP_WEB_REQUEST)).toBe(1180);
  });

  it('reports the narrowest link on the path, not the default', () => {
    expect(narrowestMtu(FRAGMENTED_PACKET, null)).toBe(1492);
    expect(narrowestMtu(FRAGMENTED_PACKET, 1280)).toBe(1280);
    // A scenario that pins no link is Ethernet the whole way, as authored.
    expect(narrowestMtu(TCP_WEB_REQUEST, null)).toBe(1500);
  });

  it('picks the slowest link on the path for hand-thrown loss', () => {
    // The intercontinental backbone hop, which is where packets really go missing.
    expect(lossiestLink(TCP_WEB_REQUEST)).toBe('backbone');
  });
});
