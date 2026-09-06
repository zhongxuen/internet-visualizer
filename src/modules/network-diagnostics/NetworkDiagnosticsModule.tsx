'use client';

import { useMemo, useState } from 'react';

import { SafetyBadge } from '@/components/shell';
import { Badge } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import {
  SimulationView,
  usePlaybackContext,
  usePlaybackState,
  type VisualizedRun,
} from '@/components/viz';
import { cn } from '@/lib/cn';

import { LiveConsole } from './components/LiveConsole';
import { LookupView } from './components/LookupView';
import { ModeSwitch, type DiagnosticsMode } from './components/ModeSwitch';
import { PingView } from './components/PingView';
import { RdapView } from './components/RdapView';
import { TracerouteView } from './components/TracerouteView';
import { liveOperationForTool } from './live/operations';
import { DEFAULT_LOOKUP, LOOKUP_EXAMPLES, runLookup } from './sim/lookup';
import { DEFAULT_PATH_ID, DIAGNOSTIC_PATHS, getPath, LOCAL_CDN } from './sim/paths';
import { runPing } from './sim/ping';
import { runTraceroute, type ProbeMethod } from './sim/traceroute';
import {
  DEFAULT_RECORD_ID,
  EXAMPLE_COM,
  getRecord,
  REGISTRATION_RECORDS,
  runRegistrationLookup,
} from './sim/whois';

/**
 * Network Diagnostics: four simulated tools, and — behind an explicit gate — three real
 * read-only lookups beside three of them.
 *
 * ## The safety property this file rests on
 *
 * There are two halves, and the boundary between them is a `mode` state that starts at
 * `'learn'` and is only moved by {@link ModeSwitch}, which will not move it without the
 * acknowledgement. The Learn half is everything below `SimulationView`: every run is a
 * pure function of a bundled fixture, none of those functions takes a host name from a
 * caller, and there is no `fetch` behind any of it. The Live half is
 * {@link LiveConsole}, which is not rendered at all in Learn mode, so in Learn mode
 * there is no mounted component in this tree that can cause a request.
 *
 * The badge follows the mode rather than the module. `usesRealNetwork: true` in the
 * registry is a statement about what this module *can* do; the badge inside the mode
 * switch, and the second one inside the live console, say what it is doing right now.
 * That is the distinction CLAUDE.md's rule turns on — "a user should never be unsure
 * whether an action touches a real network" is about the action, not the page.
 *
 * ## What this file is
 *
 * A composition root and two switches: the mode, and the tool. The tool strip sits above
 * both halves because it selects the subject rather than the surface: choosing
 * `DNS lookup` picks the simulated walk *and*, in Live mode, the live lookup shown above
 * it, so a live answer always appears next to the simulation that explains what it is.
 * `traceroute` is the one tool with no live counterpart — a TTL probe needs a raw socket
 * a serverless runtime does not grant — and the console says so in that position rather
 * than quietly offering something else.
 *
 * Each tool owns a scenario picker, a pure `run*` function in `sim/`, and one view; this
 * file chooses which is on screen and hands the run to `SimulationView`, which supplies
 * the diagram, the timeline, playback, the inspector, and the log.
 */

/** The four tools, in the order the concepts build. */
const TOOLS = [
  {
    id: 'ping',
    label: 'ping',
    blurb:
      'Eight bytes of ICMP, and why the answer proves less than it looks like it does.',
  },
  {
    id: 'traceroute',
    label: 'traceroute',
    blurb: 'A list of routers, obtained by deliberately expiring the TTL at each one.',
  },
  {
    id: 'lookup',
    label: 'DNS lookup',
    blurb: 'The recursive walk, the answer, and the cache the walk left behind.',
  },
  {
    id: 'rdap',
    label: 'WHOIS / RDAP',
    blurb: 'Who registered a name, in the protocol that replaced the one everyone names.',
  },
] as const;

type ToolId = (typeof TOOLS)[number]['id'];

/** The playhead, as the panels below the timeline read it. */
function useNow(): number {
  const store = usePlaybackContext();
  return usePlaybackState(store, (state) => state.virtualTime);
}

/** Seek the playhead. Stable for the life of the store. */
function useSeek(): (time: number) => void {
  return usePlaybackContext().getState().seek;
}

/** A row of pill buttons. The same control for tools and for scenarios. */
function PillGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  numbered = false,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  numbered?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option, index) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
              focusRing,
              active
                ? 'border-accent/60 bg-accent/12 text-fg'
                : 'border-border bg-surface-raised text-fg-secondary hover:border-border-strong hover:bg-surface-overlay hover:text-fg',
            )}
          >
            {numbered ? (
              <span
                aria-hidden="true"
                className={cn(
                  'font-mono text-[0.6875rem]',
                  active ? 'text-accent' : 'text-fg-muted',
                )}
              >
                {index + 1}
              </span>
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The ping footer, wired to the playhead so the chart fills in with the animation. */
function PingFooter({ run }: { run: ReturnType<typeof runPing> }) {
  return <PingView run={run} now={useNow()} onSeek={useSeek()} />;
}

/** The traceroute footer, with the hop table doubling as an index into the timeline. */
function TracerouteFooter({
  run,
  selectedTtl,
  onSelect,
}: {
  run: ReturnType<typeof runTraceroute>;
  selectedTtl: number;
  onSelect: (ttl: number) => void;
}) {
  return (
    <TracerouteView
      run={run}
      selectedTtl={selectedTtl}
      onSelect={onSelect}
      now={useNow()}
      onSeek={useSeek()}
    />
  );
}

export function NetworkDiagnosticsModule() {
  const [mode, setMode] = useState<DiagnosticsMode>('learn');
  const [acknowledged, setAcknowledged] = useState(false);
  const [tool, setTool] = useState<ToolId>('ping');
  const [pathId, setPathId] = useState<string>(DEFAULT_PATH_ID);
  const [method, setMethod] = useState<ProbeMethod>('udp');
  const [lookupIndex, setLookupIndex] = useState(0);
  const [recordId, setRecordId] = useState<string>(DEFAULT_RECORD_ID);
  const [selectedTtl, setSelectedTtl] = useState(1);

  const path = useMemo(() => getPath(pathId) ?? LOCAL_CDN, [pathId]);
  const example = useMemo(
    () => LOOKUP_EXAMPLES[lookupIndex] ?? DEFAULT_LOOKUP,
    [lookupIndex],
  );
  const record = useMemo(() => getRecord(recordId) ?? EXAMPLE_COM, [recordId]);

  // One run per tool per scenario. Each is a pure function of its fixture, so memoizing on
  // the fixture is enough -- and necessary, because this tree re-renders every animation
  // frame while the timeline plays.
  const ping = useMemo(() => runPing(path), [path]);
  const trace = useMemo(() => runTraceroute(path, { method }), [path, method]);
  const lookup = useMemo(() => runLookup(example), [example]);
  const registration = useMemo(() => runRegistrationLookup(record), [record]);

  const active =
    tool === 'ping'
      ? ping
      : tool === 'traceroute'
        ? trace
        : tool === 'lookup'
          ? lookup
          : registration;

  const simulation = useMemo<VisualizedRun>(
    () => ({ topology: active.topology, result: active.result }),
    [active],
  );

  // A TTL selected against the previous trace means nothing on this one, so it is clamped
  // during render rather than reset by an effect -- an effect would show one frame of a
  // panel describing a hop that is not there.
  const ttl = Math.min(selectedTtl, trace.hops.length) || 1;

  const scenarioPicker =
    tool === 'ping' || tool === 'traceroute' ? (
      <div className="flex flex-col gap-2">
        <PillGroup
          label="Network"
          numbered
          value={pathId}
          onChange={(id) => {
            setPathId(id);
            setSelectedTtl(1);
          }}
          options={DIAGNOSTIC_PATHS.map((entry) => ({
            id: entry.id,
            label: entry.title,
          }))}
        />
        {tool === 'traceroute' ? (
          <PillGroup
            label="Probe type"
            value={method}
            onChange={setMethod}
            options={[
              { id: 'udp' as const, label: 'UDP probes (traceroute)' },
              { id: 'icmp' as const, label: 'ICMP probes (tracert)' },
            ]}
          />
        ) : null}
      </div>
    ) : tool === 'lookup' ? (
      <PillGroup
        label="Question"
        numbered
        value={String(lookupIndex)}
        onChange={(id) => setLookupIndex(Number(id))}
        options={LOOKUP_EXAMPLES.map((entry, index) => ({
          id: String(index),
          label: `${entry.name} ${entry.type}`,
        }))}
      />
    ) : (
      <PillGroup
        label="Record"
        numbered
        value={recordId}
        onChange={setRecordId}
        options={REGISTRATION_RECORDS.map((entry) => ({
          id: entry.id,
          label: entry.target,
        }))}
      />
    );

  const summary =
    tool === 'ping' || tool === 'traceroute'
      ? path.summary
      : tool === 'lookup'
        ? `${example.note}. ${LOOKUP_CAPTION}`
        : record.summary;

  const teaches =
    tool === 'ping' || tool === 'traceroute'
      ? path.teaches
      : tool === 'rdap'
        ? record.teaches
        : LOOKUP_TEACHES;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ModeSwitch
        mode={mode}
        onModeChange={setMode}
        acknowledged={acknowledged}
        onAcknowledge={() => setAcknowledged(true)}
      />

      {/*
        Above both halves, because it selects the subject rather than the surface: in
        Live mode it chooses the live lookup and the simulation that explains it at once.
      */}
      <PillGroup
        label="Tool"
        value={tool}
        onChange={setTool}
        options={TOOLS.map((entry) => ({ id: entry.id, label: entry.label }))}
      />

      {/*
        Not rendered at all in Learn mode. `key` remounts it when the tool changes, which
        clears the target box and aborts anything in flight rather than carrying a result
        across to an operation it does not belong to.
      */}
      {mode === 'live' ? (
        <LiveConsole key={tool} operation={liveOperationForTool(tool)} />
      ) : null}

      <SimulationView
        simulation={simulation}
        // The probe tools spend most of their virtual time waiting between probes, because a
        // real ping waits a second between them. Playing at 2x keeps that fact true while
        // making the animation watchable; the speed control is right there to slow it down.
        speed={tool === 'ping' || tool === 'traceroute' ? 2 : 1}
        label={`${TOOLS.find((entry) => entry.id === tool)?.label} run`}
        controlPanel={
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-fg text-sm font-semibold">
                Simulated {TOOLS.find((entry) => entry.id === tool)?.label}
              </h2>
              {/*
                This badge labels the simulation, not the page. It stays `simulated` in
                Live mode on purpose: the panels below it are the same pure functions of
                the same fixtures either way, and the live console above carries its own
                `live` badge. Two surfaces, two badges, neither of them ambiguous.
              */}
              <SafetyBadge variant="simulated" />
            </div>

            {scenarioPicker}

            <div className="flex flex-col gap-2">
              <p className="text-fg-secondary max-w-3xl text-sm leading-relaxed">
                {summary}
              </p>
              <ul aria-label="What this run teaches" className="flex flex-wrap gap-1.5">
                {teaches.map((topic) => (
                  <li key={topic}>
                    <Badge tone="neutral">{topic}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        }
        footer={
          tool === 'ping' ? (
            <PingFooter run={ping} />
          ) : tool === 'traceroute' ? (
            <TracerouteFooter run={trace} selectedTtl={ttl} onSelect={setSelectedTtl} />
          ) : tool === 'lookup' ? (
            <LookupView run={lookup} />
          ) : (
            <RdapView run={registration} />
          )
        }
      />
    </div>
  );
}

const LOOKUP_CAPTION =
  'Every server below is a fixture, and the walk is the same one the DNS Explorer animates -- this is the tool-shaped view of it.';

const LOOKUP_TEACHES: readonly string[] = [
  'The recursive walk: root, TLD, authoritative',
  'What a cache hit removes from it',
  'Why your resolver may answer differently',
];
