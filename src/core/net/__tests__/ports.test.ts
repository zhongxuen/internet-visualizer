import { describe, expect, it } from 'vitest';
import {
  EPHEMERAL_PORT_RANGE,
  MAX_PORT,
  WELL_KNOWN_PORTS,
  describePort,
  isEphemeralPort,
  isValidPort,
  lookupPort,
  lookupService,
  parsePort,
  portRange,
  serviceName,
} from '../ports';

describe('the port table', () => {
  it('has one entry per port number', () => {
    const numbers = WELL_KNOWN_PORTS.map((info) => info.port);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('has one entry per service name', () => {
    const services = WELL_KNOWN_PORTS.map((info) => info.service);
    expect(new Set(services).size).toBe(services.length);
  });

  it('is sorted by port number, so it can be rendered directly', () => {
    const numbers = WELL_KNOWN_PORTS.map((info) => info.port);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it('describes every entry: legal port, lower-case service, transport, prose', () => {
    for (const info of WELL_KNOWN_PORTS) {
      expect(isValidPort(info.port)).toBe(true);
      expect(info.service).toBe(info.service.toLowerCase());
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.transports.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it('carries the ports the modules are built around', () => {
    expect(lookupPort(53)?.label).toBe('DNS');
    expect(lookupPort(80)?.label).toBe('HTTP');
    expect(lookupPort(443)?.label).toBe('HTTPS');
  });
});

describe('lookupPort', () => {
  it('finds a port and its service', () => {
    expect(lookupPort(443)?.service).toBe('https');
    expect(serviceName(22)).toBe('ssh');
  });

  it('returns undefined for a port nothing standard listens on', () => {
    expect(lookupPort(51820)).toBeUndefined();
    expect(serviceName(51820)).toBeUndefined();
  });

  it('narrows by transport when one is given', () => {
    // DNS answers on both; HTTP over UDP is not a thing.
    expect(lookupPort(53, 'udp')?.service).toBe('domain');
    expect(lookupPort(53, 'tcp')?.service).toBe('domain');
    expect(lookupPort(80, 'tcp')?.service).toBe('http');
    expect(lookupPort(80, 'udp')).toBeUndefined();
    expect(serviceName(123, 'tcp')).toBeUndefined();
  });

  it('records UDP on 443, because that is where HTTP/3 lives', () => {
    expect(lookupPort(443, 'udp')?.service).toBe('https');
  });

  it('looks an entry up by service name, case-insensitively', () => {
    expect(lookupService('https')?.port).toBe(443);
    expect(lookupService('HTTPS')?.port).toBe(443);
    expect(lookupService('not-a-service')).toBeUndefined();
  });
});

describe('describePort', () => {
  it('names a known port', () => {
    expect(describePort(443)).toBe('443 (https)');
    expect(describePort(443, 'tcp')).toBe('443/tcp (https)');
  });

  it('still returns something useful for an unknown port', () => {
    expect(describePort(51820)).toBe('51820');
    expect(describePort(51820, 'udp')).toBe('51820/udp');
  });

  it('drops the service name when the transport does not match', () => {
    expect(describePort(80, 'udp')).toBe('80/udp');
  });
});

describe('parsePort', () => {
  it('parses a decimal port', () => {
    expect(parsePort('443')).toEqual({ ok: true, value: 443 });
    expect(parsePort('1')).toEqual({ ok: true, value: 1 });
    expect(parsePort('65535')).toEqual({ ok: true, value: 65535 });
  });

  it.each([
    ['0', 'port 0 is reserved'],
    ['65536', 'one past the 16-bit maximum'],
    ['99999', 'far out of range'],
    ['080', 'leading zero'],
    ['00', 'leading zero'],
    ['', 'empty string'],
    ['443 ', 'trailing whitespace'],
    [' 443', 'leading whitespace'],
    ['-1', 'negative'],
    ['+443', 'sign'],
    ['4.43', 'not an integer'],
    ['0x1bb', 'hexadecimal'],
    ['443443443', 'too many digits'],
    ['https', 'a service name'],
  ])('rejects %s (%s)', (input) => {
    expect(parsePort(input).ok).toBe(false);
  });

  it('explains why port 0 is refused', () => {
    const result = parsePort('0');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('reserved');
  });

  it('rejects a non-string at runtime', () => {
    const result = parsePort(443 as unknown as string);
    expect(result.ok ? '' : result.error).toBe('expected a string');
  });
});

describe('port ranges', () => {
  it('accepts every 16-bit value as a port number, including 0', () => {
    expect(isValidPort(0)).toBe(true);
    expect(isValidPort(MAX_PORT)).toBe(true);
    expect(isValidPort(-1)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(80.5)).toBe(false);
    expect(isValidPort(Number.NaN)).toBe(false);
  });

  it('splits the space into the three IANA ranges', () => {
    expect(portRange(0)).toBe('well-known');
    expect(portRange(443)).toBe('well-known');
    expect(portRange(1023)).toBe('well-known');
    expect(portRange(1024)).toBe('registered');
    expect(portRange(49151)).toBe('registered');
    expect(portRange(49152)).toBe('dynamic');
    expect(portRange(65535)).toBe('dynamic');
  });

  it('refuses to classify something that is not a port', () => {
    expect(() => portRange(70000)).toThrow(RangeError);
    expect(() => portRange(-1)).toThrow(RangeError);
  });

  it('recognises the ephemeral source ports a kernel hands out', () => {
    expect(isEphemeralPort(EPHEMERAL_PORT_RANGE.first)).toBe(true);
    expect(isEphemeralPort(EPHEMERAL_PORT_RANGE.last)).toBe(true);
    expect(isEphemeralPort(EPHEMERAL_PORT_RANGE.first - 1)).toBe(false);
    expect(isEphemeralPort(443)).toBe(false);
    expect(isEphemeralPort(70000)).toBe(false);
  });
});
