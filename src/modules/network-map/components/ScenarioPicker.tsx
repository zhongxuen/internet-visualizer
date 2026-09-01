'use client';

import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import type { ScenarioTopology } from '@/core/topologies';
import { cn } from '@/lib/cn';

/**
 * Which network you are looking at.
 *
 * The four scenarios are ordered smallest to largest because that order *is* the lesson:
 * the small office is the home LAN segmented, the ISP path starts where the home LAN
 * ends, and the datacenter is what the ISP path arrives at. The buttons print that order
 * with a number, so the sequence is visible rather than implied by position alone.
 *
 * Switching is state, not navigation -- no route change, no reload -- which is the whole
 * point of the picker: comparing two networks should cost one click, and losing the
 * playhead between them is fine because each scenario has its own tour.
 *
 * The selected scenario's `summary` and `teaches` are printed here rather than in the
 * module, because they are how a learner decides which button to press next.
 */

export interface ScenarioPickerProps {
  scenarios: readonly ScenarioTopology[];
  scenarioId: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function ScenarioPicker({
  scenarios,
  scenarioId,
  onSelect,
  className,
}: ScenarioPickerProps) {
  const selected = scenarios.find((scenario) => scenario.id === scenarioId);

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div role="group" aria-label="Scenario" className="flex flex-wrap gap-1.5">
        {scenarios.map((scenario, index) => {
          const active = scenario.id === scenarioId;

          return (
            <button
              key={scenario.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(scenario.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                focusRing,
                active
                  ? 'border-accent/60 bg-accent/12 text-fg'
                  : 'border-border bg-surface-raised text-fg-secondary hover:border-border-strong hover:bg-surface-overlay hover:text-fg',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'font-mono text-[0.6875rem]',
                  active ? 'text-accent' : 'text-fg-muted',
                )}
              >
                {index + 1}
              </span>
              {scenario.title}
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className="flex flex-col gap-2">
          <p className="text-fg-secondary max-w-3xl text-sm leading-relaxed">
            {selected.summary}
          </p>
          <ul aria-label="What this scenario teaches" className="flex flex-wrap gap-1.5">
            {selected.teaches.map((topic) => (
              <li key={topic}>
                <Badge tone="neutral">{topic}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
