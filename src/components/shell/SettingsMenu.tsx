'use client';

import { Settings } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { useSystemReducedMotion } from '@/components/motion';
import {
  usePauseAtSteps,
  usePreference,
  type DetailLevel,
  type MotionSetting,
  type TextSize,
} from '@/components/prefs';
import { Popover } from '@/components/ui/Popover';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/cn';

/**
 * The ⚙ in the navigation: every preference the viewer can set, in one place
 * (docs/implementation/uiux-spec.md §5.7).
 *
 * A `Popover`, not a page -- each setting takes effect the moment it is chosen, so there
 * is nothing to save and nothing to navigate back from. Every control writes the one
 * preferences store, which `MotionProvider`, the pre-paint attributes and playback all
 * read, so a choice here reaches the whole product at once and survives a reload.
 *
 * Live mode is deliberately not here. It must come back off after a reload (the Network
 * Diagnostics invariant), and a switch beside settings that *do* persist would suggest
 * otherwise.
 */

const DETAIL_OPTIONS = [
  { value: 'simple', label: 'Simple' },
  { value: 'full', label: 'Full detail' },
] as const satisfies readonly { value: DetailLevel; label: string }[];

/** What each detail level means, one line each, both always visible. */
export const DETAIL_EXPLANATIONS: Record<DetailLevel, string> = {
  simple: 'One plain sentence at a time. The technical parts wait until you open them.',
  full: 'Every header, field and log line, open from the start.',
};

const MOTION_OPTIONS = [
  { value: 'full', label: 'On' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'system', label: 'Match my device' },
] as const satisfies readonly { value: MotionSetting; label: string }[];

const TEXT_SIZE_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
] as const satisfies readonly { value: TextSize; label: string }[];

function SettingGroup({
  label,
  children,
  hint,
}: {
  label: string;
  children: (labelId: string) => ReactNode;
  hint?: ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <p id={labelId} className="text-fg text-small font-medium">
        {label}
      </p>
      {children(labelId)}
      {hint ? (
        <div className="text-fg-muted text-caption leading-snug">{hint}</div>
      ) : null}
    </div>
  );
}

function SettingsPanel() {
  const [detail, setDetail] = usePreference('detail');
  const [motion, setMotion] = usePreference('motion');
  const [textSize, setTextSize] = usePreference('textSize');
  const [, setPauseAtSteps] = usePreference('pauseAtSteps');
  const pauseAtSteps = usePauseAtSteps();
  const systemReduced = useSystemReducedMotion();

  return (
    <div className="flex flex-col gap-4">
      <SettingGroup
        label="Detail level"
        hint={
          <dl className="flex flex-col gap-1">
            {DETAIL_OPTIONS.map((option) => (
              <div key={option.value}>
                <dt className="text-fg-secondary inline font-medium">{option.label}: </dt>
                <dd className="inline">{DETAIL_EXPLANATIONS[option.value]}</dd>
              </div>
            ))}
          </dl>
        }
      >
        {(labelId) => (
          <SegmentedControl
            aria-labelledby={labelId}
            size="sm"
            options={DETAIL_OPTIONS}
            value={detail}
            onValueChange={setDetail}
            className="w-full"
          />
        )}
      </SettingGroup>

      <SettingGroup
        label="Animation"
        hint={
          <>
            Reduced still shows every step; only the movement between steps goes.
            {motion === 'system'
              ? ` Your device is asking for ${systemReduced ? 'reduced' : 'full'} motion.`
              : null}
          </>
        }
      >
        {(labelId) => (
          <SegmentedControl
            aria-labelledby={labelId}
            size="sm"
            options={MOTION_OPTIONS}
            value={motion}
            onValueChange={setMotion}
            className="w-full"
          />
        )}
      </SettingGroup>

      <SettingGroup label="Text size">
        {(labelId) => (
          <SegmentedControl
            aria-labelledby={labelId}
            size="sm"
            options={TEXT_SIZE_OPTIONS}
            value={textSize}
            onValueChange={setTextSize}
            className="w-full"
          />
        )}
      </SettingGroup>

      <Switch
        label="Pause after each step"
        description="Playback waits for you at the end of every step."
        checked={pauseAtSteps}
        onCheckedChange={setPauseAtSteps}
        className="-mx-2"
      />
    </div>
  );
}

export interface SettingsMenuProps {
  className?: string;
}

export function SettingsMenu({ className }: SettingsMenuProps) {
  return (
    <Popover
      trigger={<Settings aria-hidden="true" className="size-5" />}
      label="Settings"
      side="bottom"
      align="end"
      triggerVariant="ghost"
      triggerClassName={cn('size-target px-0', className)}
      triggerProps={{ 'aria-label': 'Settings' }}
      className="w-[min(22rem,calc(100vw_-_1rem))] max-w-none p-4"
    >
      <SettingsPanel />
    </Popover>
  );
}
