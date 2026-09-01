import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NETWORK_MAP_SCENARIOS } from '../scenarios';

import { ScenarioPicker } from './ScenarioPicker';

function renderPicker(scenarioId = 'home-lan', onSelect = vi.fn()) {
  render(
    <ScenarioPicker
      scenarios={NETWORK_MAP_SCENARIOS}
      scenarioId={scenarioId}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe('ScenarioPicker', () => {
  it('offers every scenario the module registers, in order', () => {
    renderPicker();

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(
      NETWORK_MAP_SCENARIOS.map((scenario, index) => `${index + 1}${scenario.title}`),
    );
  });

  /** Pressed state, not colour: the choice has to survive greyscale and a screen reader. */
  it('marks the current scenario as pressed and nothing else', () => {
    renderPicker('isp-path');

    expect(screen.getByRole('button', { name: /ISP path/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Home LAN/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('prints the selected scenario summary and what it teaches', () => {
    renderPicker('home-lan');

    expect(screen.getByText(NETWORK_MAP_SCENARIOS[0].summary)).toBeInTheDocument();
    for (const topic of NETWORK_MAP_SCENARIOS[0].teaches) {
      expect(screen.getByText(topic)).toBeInTheDocument();
    }
  });

  it('reports the scenario id when one is chosen', async () => {
    const onSelect = renderPicker();

    await userEvent.click(screen.getByRole('button', { name: /Datacenter/ }));

    expect(onSelect).toHaveBeenCalledWith('datacenter');
  });
});
