import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { HOME_LAN, noteFor } from '@/core/topologies';

import { NetworkMapModule } from './NetworkMapModule';
import { buildTour } from './tour';

/**
 * The phase-05 acceptance test, driven through the surfaces a learner uses.
 *
 * Everything is asserted from the rendered page rather than from module state: the
 * scenarios switch without a reload, the filter dims rather than deletes, the addresses
 * leave the diagram but not the product, and the tour walks the topology through the same
 * phase mechanism a packet simulation uses.
 */

function canvas() {
  return within(screen.getByRole('region', { name: /topology/i }));
}

function phasePanel() {
  return within(screen.getByRole('region', { name: 'Phases' }));
}

function inspector() {
  return within(screen.getByRole('region', { name: 'Inspector' }));
}

/** The node card for a machine, by the label printed on it. */
function card(label: string): HTMLElement {
  const heading = canvas().getAllByTitle(label)[0];
  const shell = heading.closest('[data-kind]');
  if (!shell) throw new Error(`no node card for ${label}`);
  return shell as HTMLElement;
}

describe('NetworkMapModule', () => {
  it('opens on the home LAN, drawn and captioned', () => {
    render(<NetworkMapModule />);

    expect(screen.getByRole('region', { name: 'Home LAN topology' })).toBeInTheDocument();
    expect(screen.getByText(HOME_LAN.summary)).toBeInTheDocument();
    expect(card('Home router (NAPT)')).toBeInTheDocument();
  });

  it('switches scenarios in place, with no navigation', async () => {
    render(<NetworkMapModule />);

    await userEvent.click(screen.getByRole('button', { name: /Datacenter/ }));

    expect(
      screen.getByRole('region', { name: 'Datacenter topology' }),
    ).toBeInTheDocument();
    expect(card('Origin load balancer')).toBeInTheDocument();
    expect(canvas().queryAllByTitle('Home router (NAPT)')).toHaveLength(0);
  });

  /**
   * The accuracy rule the layer filter exists to make visible: a switch forwards frames
   * and a router forwards packets, and choosing L3 says so without a word of prose.
   */
  it('dims the machines that do not work at the chosen layer, and keeps them on screen', async () => {
    render(<NetworkMapModule />);

    await userEvent.click(screen.getByRole('button', { name: /L3 Network/ }));

    expect(card('Home router (NAPT)')).not.toHaveAttribute('data-dimmed');
    expect(card('LAN switch')).toHaveAttribute('data-dimmed');
    // Dimmed, not deleted: still drawn, still clickable, still in the tab order.
    expect(card('LAN switch')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(card('LAN switch')).not.toHaveAttribute('data-dimmed');
  });

  it('resets the layer filter when the scenario changes', async () => {
    render(<NetworkMapModule />);

    await userEvent.click(screen.getByRole('button', { name: /L3 Network/ }));
    await userEvent.click(screen.getByRole('button', { name: /Small office/ }));

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('takes the addresses off the diagram without taking them out of the product', async () => {
    render(<NetworkMapModule />);

    expect(canvas().getAllByText('192.168.1.1')[0]).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: 'Addresses' }));
    expect(canvas().queryByText('192.168.1.1')).toBeNull();

    // Still one click away, and still in the accessible name of the machine itself.
    fireEvent.click(card('Home router (NAPT)'));
    expect(inspector().getByText('192.168.1.1')).toBeInTheDocument();
    expect(canvas().getAllByLabelText(/IPv4 192\.168\.1\.1/).length).toBeGreaterThan(0);
  });

  it('explains whatever is selected, with the standard that defines it', () => {
    render(<NetworkMapModule />);

    fireEvent.click(card('LAN switch'));

    expect(
      inspector().getByText(noteFor(HOME_LAN, 'lan-switch')!.text),
    ).toBeInTheDocument();
    expect(inspector().getByText('IEEE 802.1D')).toBeInTheDocument();
  });

  it('inspects a machine from the keyboard alone', () => {
    render(<NetworkMapModule />);

    const laptop = card('Laptop').closest('.react-flow__node') as HTMLElement;
    laptop.focus();
    fireEvent.keyDown(laptop, { key: 'Enter' });

    expect(inspector().getByText(noteFor(HOME_LAN, 'laptop')!.text)).toBeInTheDocument();
  });

  describe('guided tour', () => {
    it('is a phase per machine, in the order the scenario introduces them', () => {
      render(<NetworkMapModule />);

      const steps = buildTour(HOME_LAN).steps;
      const buttons = phasePanel().getAllByRole('button');

      expect(buttons).toHaveLength(steps.length);
      expect(buttons[0].textContent).toContain('Laptop');
      expect(buttons[0].textContent).toContain(noteFor(HOME_LAN, 'laptop')!.text);
    });

    it('selects and explains the machine at each stop once it is following', async () => {
      render(<NetworkMapModule />);

      await userEvent.click(screen.getByRole('switch', { name: 'Guided tour' }));
      expect(
        inspector().getByText(noteFor(HOME_LAN, 'laptop')!.text),
      ).toBeInTheDocument();

      // Stepping is the reduced-motion path through the tour, and the ordinary one.
      fireEvent.keyDown(window, { key: 'ArrowRight' });

      expect(screen.getByText(/Stop 2\//)).toBeInTheDocument();
      expect(inspector().getByText(noteFor(HOME_LAN, 'phone')!.text)).toBeInTheDocument();
    });

    it('leaves the map alone until it is switched on', () => {
      render(<NetworkMapModule />);

      fireEvent.keyDown(window, { key: 'ArrowRight' });

      expect(screen.getByText(/Stop 2\//)).toBeInTheDocument();
      expect(inspector().getByText('Nothing selected')).toBeInTheDocument();
    });

    it('lights the machine the current stop is about', async () => {
      render(<NetworkMapModule />);

      await userEvent.click(screen.getByRole('switch', { name: 'Guided tour' }));

      expect(card('Laptop')).toHaveAttribute('data-state', 'active');
      expect(card('Phone')).toHaveAttribute('data-state', 'idle');

      fireEvent.keyDown(window, { key: 'ArrowRight' });

      expect(card('Laptop')).toHaveAttribute('data-state', 'idle');
      expect(card('Phone')).toHaveAttribute('data-state', 'active');
    });

    it('sends no traffic across the map', () => {
      render(<NetworkMapModule />);

      fireEvent.keyDown(window, { key: 'End' });

      // A packet chip would be a `pdu` selection waiting to happen; there are none.
      expect(canvas().queryByRole('button', { name: /packet/i })).toBeNull();
    });
  });
});
