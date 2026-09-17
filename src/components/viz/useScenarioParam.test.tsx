import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { scenarioHref, useScenarioParam } from './useScenarioParam';

const IDS = ['cold-cache', 'warm-cache', 'nxdomain'] as const;

function at(path: string) {
  window.history.replaceState(null, '', path);
}

afterEach(() => {
  at('/');
});

describe('scenarioHref', () => {
  it('sets the parameter and keeps everything else', () => {
    expect(scenarioHref('http://x.test/dns?detail=1#log', 'nxdomain', 'cold-cache')).toBe(
      '/dns?detail=1&scenario=nxdomain#log',
    );
  });

  it('writes the default story as no parameter at all', () => {
    expect(
      scenarioHref('http://x.test/dns?scenario=nxdomain', 'cold-cache', 'cold-cache'),
    ).toBe('/dns');
  });
});

describe('useScenarioParam', () => {
  it('reads the story from ?scenario=', () => {
    at('/dns-explorer?scenario=warm-cache');
    const { result } = renderHook(() => useScenarioParam(IDS, 'cold-cache'));
    expect(result.current[0]).toBe('warm-cache');
  });

  it('falls back to the default without a parameter, or with one it does not know', () => {
    at('/dns-explorer');
    const { result, unmount } = renderHook(() => useScenarioParam(IDS, 'cold-cache'));
    expect(result.current[0]).toBe('cold-cache');
    unmount();

    at('/dns-explorer?scenario=renamed-long-ago');
    const { result: unknown } = renderHook(() => useScenarioParam(IDS, 'cold-cache'));
    expect(unknown.current[0]).toBe('cold-cache');
  });

  it('writes with replaceState, adding no history entry', () => {
    at('/dns-explorer');
    const length = window.history.length;
    const { result } = renderHook(() => useScenarioParam(IDS, 'cold-cache'));

    act(() => result.current[1]('nxdomain'));
    expect(window.location.search).toBe('?scenario=nxdomain');
    expect(result.current[0]).toBe('nxdomain');

    act(() => result.current[1]('cold-cache'));
    expect(window.location.search).toBe('');
    expect(result.current[0]).toBe('cold-cache');

    expect(window.history.length).toBe(length);
  });

  it('follows Back and Forward', () => {
    at('/dns-explorer');
    const { result } = renderHook(() => useScenarioParam(IDS, 'cold-cache'));

    act(() => {
      at('/dns-explorer?scenario=warm-cache');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0]).toBe('warm-cache');
  });

  it('renders the default on the server, whatever the URL says', () => {
    at('/dns-explorer?scenario=nxdomain');

    function Probe() {
      return <>{useScenarioParam(IDS, 'cold-cache')[0]}</>;
    }

    expect(renderToString(<Probe />)).toBe('cold-cache');
  });
});
