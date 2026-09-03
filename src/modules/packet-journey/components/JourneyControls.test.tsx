import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AUTHORED_OPTIONS, type JourneyOptions } from '../options';
import { PACKET_JOURNEY_SCENARIOS, TCP_WEB_REQUEST } from '../scenarios';

import { JourneyControls } from './JourneyControls';

function setup(
  options: JourneyOptions = AUTHORED_OPTIONS,
  scenarioId = 'tcp-web-request',
) {
  const onOptionsChange = vi.fn();
  const onScenarioChange = vi.fn();

  render(
    <JourneyControls
      scenarios={PACKET_JOURNEY_SCENARIOS}
      scenarioId={scenarioId}
      onScenarioChange={onScenarioChange}
      options={options}
      onOptionsChange={onOptionsChange}
    />,
  );

  return { onOptionsChange, onScenarioChange };
}

describe('JourneyControls', () => {
  it('offers every scenario and says which one is selected', () => {
    setup();

    for (const scenario of PACKET_JOURNEY_SCENARIOS) {
      expect(
        screen.getByRole('button', { name: new RegExp(scenario.title) }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /TCP web request/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(TCP_WEB_REQUEST.summary)).toBeInTheDocument();
  });

  it('reports a scenario change without changing it itself', async () => {
    const { onScenarioChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /Lossy link/ }));

    expect(onScenarioChange).toHaveBeenCalledWith('lossy-link');
  });

  /** Nothing is pre-selected: the scenario is what it says it is until a knob is turned. */
  it('starts every knob at "as authored" and says what the scenario chose', () => {
    setup();

    expect(screen.getByLabelText('Transport')).toHaveValue('authored');
    expect(screen.getByLabelText('Link MTU')).toHaveValue('authored');
    expect(screen.getByText('As authored: TCP')).toBeInTheDocument();
    expect(screen.getByText('As authored: 412, 1180 bytes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset to the scenario/ })).toBeDisabled();
  });

  it('changes the transport', async () => {
    const { onOptionsChange } = setup();

    await userEvent.selectOptions(screen.getByLabelText('Transport'), 'udp');

    expect(onOptionsChange).toHaveBeenCalledWith({
      ...AUTHORED_OPTIONS,
      transport: 'udp',
    });
  });

  it('changes the MTU', async () => {
    const { onOptionsChange } = setup();

    await userEvent.selectOptions(screen.getByLabelText('Link MTU'), '1280');

    expect(onOptionsChange).toHaveBeenCalledWith({ ...AUTHORED_OPTIONS, mtu: 1280 });
  });

  it('prints the narrowest link on the path, which is not always the one chosen', () => {
    setup(AUTHORED_OPTIONS, 'fragmented-packet');

    expect(
      screen.getByText(/Narrowest link on the path: 1492 bytes/),
    ).toBeInTheDocument();
  });

  it('sets one payload size for every write', () => {
    const { onOptionsChange } = setup({ ...AUTHORED_OPTIONS, payloadBytes: 2048 });

    expect(
      screen.getByText('Every write in the run sends 2048 bytes.'),
    ).toBeInTheDocument();
    expect(onOptionsChange).not.toHaveBeenCalled();
  });

  it('toggles loss, and shows a scenario that already loses packets as on', async () => {
    const { onOptionsChange } = setup(AUTHORED_OPTIONS, 'lossy-link');

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);
    expect(onOptionsChange).toHaveBeenCalledWith({ ...AUTHORED_OPTIONS, lossy: false });
  });

  it('starts a reliable scenario with the loss switch off', () => {
    setup();

    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.getByText('Every packet that is sent arrives.')).toBeInTheDocument();
  });

  it('resets every knob at once', async () => {
    const { onOptionsChange } = setup({
      transport: 'udp',
      payloadBytes: 2048,
      mtu: 576,
      lossy: true,
    });

    await userEvent.click(screen.getByRole('button', { name: /Reset to the scenario/ }));

    expect(onOptionsChange).toHaveBeenCalledWith(AUTHORED_OPTIONS);
  });
});
