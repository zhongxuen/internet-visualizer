import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { DetailLevel } from '@/components/prefs';
import { renderWithPreferences } from '@/components/prefs/testing';
import { PLAIN_KINDS } from '@/core/text/kinds';
import type { NodeState } from '@/core/types/events';
import { type NodeKind, type SimNode, type Topology } from '@/core/types/topology';

import { SimulationCanvas } from '../SimulationCanvas';

import { NODE_KINDS } from './kinds';
import { NODE_STATES } from './state';

/**
 * Nodes are exercised through the canvas rather than in isolation: a node component is
 * only meaningful inside React Flow, which owns its focus, its accessible name, and the
 * context its connection handles read.
 *
 * Most of this file is about the Full detail card, so `renderNodes` pins Full detail; the
 * `Simple detail` block at the end is the card a new visitor sees.
 */
function renderNodes(
  nodes: SimNode[],
  nodeStates?: Record<string, NodeState>,
  detail: DetailLevel = 'full',
  zones?: Topology['zones'],
) {
  const topology: Topology = { nodes, links: [], zones };
  return renderWithPreferences(
    <SimulationCanvas topology={topology} nodeStates={nodeStates} />,
    { detail },
  );
}

function node(id: string, kind: NodeKind, extra: Partial<SimNode> = {}): SimNode {
  return { id, kind, label: id, ...extra };
}

const KINDS = Object.keys(NODE_KINDS) as NodeKind[];

describe('every NodeKind', () => {
  it('renders with its icon, its role word, and its label', () => {
    renderNodes(KINDS.map((kind) => node(kind, kind)));

    for (const kind of KINDS) {
      const rendered = screen.getByTestId(`rf__node-${kind}`);
      expect(rendered, kind).toHaveTextContent(NODE_KINDS[kind].roleLabel);
      expect(rendered.querySelector('svg'), `${kind} has no icon`).not.toBeNull();
      expect(rendered.querySelector('[data-kind]')).toHaveAttribute('data-kind', kind);
    }
  });

  it('is a tab stop with a name that says what it is and what it is doing', () => {
    renderNodes([node('gw', 'router', { ipv4: '192.0.2.1' })]);

    const rendered = screen.getByRole('group', {
      name: 'Router: gw. Idle. IPv4 192.0.2.1',
    });
    expect(rendered).toHaveAttribute('tabindex', '0');
  });
});

describe('node state', () => {
  it.each(Object.values(NODE_STATES))(
    'shows "$state" as a word and an icon, not only a colour',
    (token) => {
      renderNodes([node('n', 'server')], { n: token.state });

      const frame = screen.getByTestId('rf__node-n').querySelector('[data-state]');
      expect(frame).toHaveAttribute('data-state', token.state);
      expect(frame).toHaveTextContent(token.label);
      // The chip's icon sits beside the word; the outline is the third signal.
      expect(frame?.className).toContain(token.outline.split(' ')[0]);
    },
  );

  it('gives each state a distinct outline, so the diagram survives greyscale', () => {
    const outlines = Object.values(NODE_STATES).map((token) => token.outline);
    expect(new Set(outlines).size).toBe(outlines.length);
  });

  it('leaves a node the simulation never mentions idle', () => {
    renderNodes([node('a', 'client'), node('b', 'server')], { a: 'error' });

    expect(
      screen.getByTestId('rf__node-a').querySelector('[data-state]'),
    ).toHaveAttribute('data-state', 'error');
    expect(
      screen.getByTestId('rf__node-b').querySelector('[data-state]'),
    ).toHaveAttribute('data-state', 'idle');
  });
});

describe('addresses', () => {
  it('renders every address the SimNode carries, labelled', () => {
    renderNodes([
      node('c', 'client', {
        ipv4: '192.0.2.10',
        ipv6: '2001:db8::10',
        mac: '02:00:5e:10:00:01',
      }),
    ]);

    const rendered = within(screen.getByTestId('rf__node-c'));
    expect(rendered.getByText('IPv4').nextElementSibling).toHaveTextContent('192.0.2.10');
    expect(rendered.getByText('IPv6').nextElementSibling).toHaveTextContent(
      '2001:db8::10',
    );
    expect(rendered.getByText('MAC').nextElementSibling).toHaveTextContent(
      '02:00:5e:10:00:01',
    );
  });

  it('invents nothing: a switch with only a MAC shows only a MAC', () => {
    renderNodes([node('sw', 'switch', { mac: '02:00:5e:00:00:aa' })]);

    const rendered = within(screen.getByTestId('rf__node-sw'));
    expect(rendered.getByText('MAC')).toBeInTheDocument();
    expect(rendered.queryByText('IPv4')).toBeNull();
    expect(rendered.queryByText('IPv6')).toBeNull();
  });
});

describe('layer badge', () => {
  it('distinguishes a switch from a router by layer, with its short label', () => {
    renderNodes([node('sw', 'switch'), node('gw', 'router')]);

    const sw = within(screen.getByTestId('rf__node-sw'));
    expect(sw.getByText('L2')).toBeInTheDocument();
    expect(sw.getByText('Forwards frames')).toBeInTheDocument();

    const gw = within(screen.getByTestId('rf__node-gw'));
    expect(gw.getByText('L3')).toBeInTheDocument();
    expect(gw.getByText('Routes packets')).toBeInTheDocument();
  });
});

describe('DnsNode', () => {
  it('marks which rung of the delegation chain a server is', () => {
    renderNodes([node('tld', 'dns-tld')]);

    const chain = within(screen.getByTestId('rf__node-tld')).getByRole('list', {
      name: 'DNS hierarchy: TLD',
    });
    const rungs = within(chain).getAllByRole('listitem');

    expect(rungs.map((rung) => rung.textContent)).toEqual(['Root', 'TLD', 'Zone']);
    expect(rungs[1]).toHaveAttribute('aria-current', 'step');
    expect(rungs[0]).not.toHaveAttribute('aria-current');
  });

  it('gives a recursive resolver no rung, because it is not on the chain', () => {
    renderNodes([node('r', 'dns-resolver')]);

    expect(within(screen.getByTestId('rf__node-r')).queryByRole('list')).toBeNull();
  });
});

describe('MiddleboxNode', () => {
  it('prints the rule the box decides with, when the scenario sets one', () => {
    renderNodes([node('fw', 'firewall', { detail: { policy: 'drop inbound 22' } })]);

    expect(screen.getByTestId('rf__node-fw')).toHaveTextContent('drop inbound 22');
  });

  it('prints nothing when the scenario states no rule', () => {
    renderNodes([node('fw', 'firewall', { detail: { vendor: 'example' } })]);

    expect(screen.getByTestId('rf__node-fw')).not.toHaveTextContent('example');
  });
});

describe('Simple detail', () => {
  const simple = (nodes: SimNode[], states?: Record<string, NodeState>) =>
    renderNodes(nodes, states, 'simple');

  it('draws an icon, the name, and the plain role -- and nothing else', () => {
    simple([
      node('gw', 'router', {
        label: 'Home router',
        ipv4: '192.0.2.1',
        mac: '00:00:5e:00:53:01',
      }),
    ]);
    const card = screen.getByTestId('rf__node-gw').querySelector('[data-detail]');
    expect(card).toHaveAttribute('data-detail', 'simple');
    expect(card).toHaveTextContent('Home router');
    expect(card).toHaveTextContent(PLAIN_KINDS.router.plainRole);
    expect(card?.querySelector('svg')).not.toBeNull();
    // Unmounted, not hidden: no address, no layer note, no role word in capitals.
    expect(card).not.toHaveTextContent('192.0.2.1');
    expect(card).not.toHaveTextContent('IPv4');
    expect(card).not.toHaveTextContent('L3');
    expect(card).not.toHaveTextContent('Routes packets');
  });

  it("prefers the node's own plain role to its kind's", () => {
    simple([node('gw', 'router', { plainRole: 'Joins your home to the internet' })]);
    expect(screen.getByTestId('rf__node-gw')).toHaveTextContent(
      'Joins your home to the internet',
    );
  });

  it('shows no chip while a machine is idle', () => {
    simple([node('n', 'server')]);
    expect(screen.getByTestId('rf__node-n')).not.toHaveTextContent('Idle');
  });

  it.each(
    Object.values(NODE_STATES)
      .filter((token) => token.state !== 'idle')
      .map((token) => [token.state, token] as const),
  )('says "%s" in plain words, with its icon and outline', (_state, token) => {
    simple([node('n', 'server')], { n: token.state });
    const frame = screen.getByTestId('rf__node-n').querySelector('[data-state]');
    expect(frame).toHaveTextContent(token.plainLabel);
    expect(frame?.className).toContain(token.outline.split(' ')[0]);
  });

  it('calls an error a problem', () => {
    expect(NODE_STATES.error.plainLabel).toBe('Problem');
    expect(NODE_STATES.processing.plainLabel).toBe('Working');
    expect(NODE_STATES.active.plainLabel).toBe('Active');
  });

  it('still names the machine, its place and its addresses for a screen reader', () => {
    simple(
      [node('gw', 'router', { label: 'Home router', ipv4: '192.0.2.1', zone: 'home' })],
      undefined,
    );
    // No zones declared: the name says nothing about a place it cannot resolve.
    expect(
      screen.getByRole('group', { name: 'Router: Home router. Idle. IPv4 192.0.2.1' }),
    ).toBeInTheDocument();
  });
});

describe('zones', () => {
  it('joins the zone name to each machine name', () => {
    renderNodes(
      [node('gw', 'router', { label: 'Home router', zone: 'home' })],
      undefined,
      'simple',
      [{ id: 'home', label: 'Your home', kind: 'home' }],
    );
    expect(
      screen.getByRole('group', { name: 'Router: Home router, in Your home. Idle' }),
    ).toHaveAttribute('tabindex', '0');
  });
});
