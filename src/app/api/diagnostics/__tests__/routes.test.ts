/**
 * The wiring, as distinct from the logic: what each `route.ts` actually exports.
 *
 * "`GET` only" is one of the four things that make this module structurally incapable
 * of taking a list of targets -- a `GET` has no body -- and Next enforces it by
 * answering 405 for the methods a `route.ts` does not export. Which means the invariant
 * lives in the *absence* of an export, and the only way to test an absence is to look.
 */

import { describe, expect, it } from 'vitest';

import * as dnsRoute from '../dns/route';
import * as rdapRoute from '../rdap/route';
import * as reachRoute from '../reach/route';

const ROUTES: [string, Record<string, unknown>][] = [
  ['dns', dnsRoute],
  ['rdap', rdapRoute],
  ['reach', reachRoute],
];

/** Everything Next itself may be handed. Anything else here would be a mistake. */
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];

describe('the diagnostics route modules', () => {
  for (const [name, route] of ROUTES) {
    describe(`/api/diagnostics/${name}`, () => {
      it('exports a GET handler', () => {
        expect(route.GET).toBeTypeOf('function');
      });

      it('exports no other HTTP method, so Next answers 405 for them', () => {
        for (const method of WRITE_METHODS) {
          expect(route[method], method).toBeUndefined();
        }
      });

      it('runs on the Node runtime, because the guard resolves names with node:dns', () => {
        expect(route.runtime).toBe('nodejs');
      });

      it('is never prerendered or cached', () => {
        expect(route.dynamic).toBe('force-dynamic');
      });
    });
  }

  it('exports nothing Next would not recognise', () => {
    const allowed = ['GET', 'runtime', 'dynamic'];
    for (const [name, route] of ROUTES) {
      expect(Object.keys(route).sort(), name).toEqual(allowed.sort());
    }
  });
});
