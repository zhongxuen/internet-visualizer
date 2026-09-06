'use client';

import { Radio, Route } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { SafetyBadge } from '@/components/shell';
import { Panel } from '@/components/ui';
import type { SupportedType } from '@/core/net/diagnostics';
import { cn } from '@/lib/cn';

import { runLiveRequest, type LiveFailure, type LiveQuota } from '../live/client';
import {
  checkLiveTarget,
  LIVE_TRACEROUTE_NOTE,
  planLiveRequest,
  type CheckedTarget,
  type LiveOperation,
  type LivePlan,
} from '../live/operations';
import { LiveDisclosure } from './LiveDisclosure';
import { LiveFailureNotice, LiveResultView, type LiveResultData } from './LiveResultView';
import { RateLimitNotice, useRetryCountdown } from './RateLimitNotice';
import { TargetInput } from './TargetInput';

/**
 * The live half of the module: one operation, one target, one request per press.
 *
 * The state machine is deliberately three states and no queue. There is no list of
 * pending requests, no debounce that could fire one the user did not ask for, and no
 * retry — each of those turns "a tool that makes a request when you press a button" into
 * "a tool that makes requests", which is the thing this module is not allowed to be.
 *
 *   idle    — nothing valid typed, nothing disclosed, nothing sent
 *   running — exactly one fetch in flight, to this app's own origin
 *   done    — an answer or a failure, both shown, neither retried
 *
 * The disclosure is not a confirmation dialog in front of the request; it is a panel that
 * is already on screen by the time the button becomes pressable, filling in as the target
 * is typed. That ordering matters: a modal that appears after the intent is formed gets
 * clicked through, while a panel that was already being read does not need to be.
 *
 * A run in flight is aborted when this console unmounts — switching mode or tool — and
 * the abandoned answer is dropped rather than being rendered under a heading that no
 * longer describes it.
 */

export interface LiveConsoleProps {
  /** The live operation, or `undefined` for a Learn tool that has no live counterpart. */
  operation: LiveOperation | undefined;
  className?: string;
}

type RunState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly plan: LivePlan }
  | {
      readonly kind: 'done';
      readonly plan: LivePlan;
      readonly data?: LiveResultData;
      readonly failure?: LiveFailure;
      readonly quota?: LiveQuota;
      /** Epoch ms the limiter said to wait until. Only set on a 429. */
      readonly retryAt?: number;
    };

/** The panel that stands where a live traceroute would be, explaining why it is not. */
function NoLiveTraceroute() {
  return (
    <Panel
      title="No live traceroute"
      aside={<SafetyBadge variant="simulated" />}
      className="min-w-0"
    >
      <p className="text-fg-secondary flex items-start gap-2 text-sm leading-relaxed">
        <Route aria-hidden="true" className="text-fg-muted mt-0.5 size-4 shrink-0" />
        <span>{LIVE_TRACEROUTE_NOTE}</span>
      </p>
    </Panel>
  );
}

/** The plan for what is typed now, or `undefined` when it would be refused. */
function planFor(
  operation: LiveOperation | undefined,
  raw: string,
  recordType: SupportedType,
): LivePlan | undefined {
  if (!operation) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const checked = checkLiveTarget(operation.id, trimmed);
  return checked.allowed
    ? planLiveRequest(operation, checked.value, recordType)
    : undefined;
}

export function LiveConsole({ operation, className }: LiveConsoleProps) {
  const [target, setTarget] = useState('');
  const [recordType, setRecordType] = useState<SupportedType>('A');
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = abortRef;
    return () => controller.current?.abort();
  }, []);

  const retryAt = run.kind === 'done' ? run.retryAt : undefined;
  const secondsRemaining = useRetryCountdown(retryAt);

  if (!operation) return <NoLiveTraceroute />;

  const busy = run.kind === 'running';

  async function start(checked: CheckedTarget) {
    if (!operation) return;
    const plan = planLiveRequest(operation, checked, recordType);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRun({ kind: 'running', plan });

    const outcome = await runLiveRequest(plan, { signal: controller.signal });

    // An abort is this console going away, not a result worth showing.
    if (controller.signal.aborted) return;

    if (outcome.status === 'ok') {
      setRun({
        kind: 'done',
        plan,
        data: outcome.data as LiveResultData,
        ...(outcome.quota ? { quota: outcome.quota } : {}),
      });
      return;
    }

    const { failure } = outcome;
    setRun({
      kind: 'done',
      plan,
      failure,
      ...(failure.quota ? { quota: failure.quota } : {}),
      // The countdown is anchored the moment the refusal arrives, so it measures the
      // wait rather than the time since the page loaded.
      ...(failure.code === 'rate-limited' && failure.retryAfterSeconds
        ? { retryAt: Date.now() + failure.retryAfterSeconds * 1000 }
        : {}),
    });
  }

  // The plan on screen is built from what is in the box *now*; the plan a result is filed
  // under is the one that was actually sent. Two separate values on purpose, so editing
  // the target after a run cannot silently relabel the answer already displayed.
  const plan = planFor(operation, target, recordType);

  return (
    <section
      aria-label="Live diagnostics"
      className={cn(
        'border-state-warn/40 bg-state-warn/5 flex min-w-0 flex-col gap-4 rounded-xl border p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-fg flex items-center gap-2 text-sm font-semibold">
            <Radio aria-hidden="true" className="text-state-warn size-4" />
            Live: {operation.label}
          </h2>
          <p className="text-fg-secondary mt-1 max-w-2xl text-sm leading-relaxed">
            {operation.blurb} Answered by {operation.answeredBy}.
          </p>
        </div>
        {/* The badge is on the live surface itself, not only in the mode switch: this is
            the box where a real request is caused, so this is a box that must say so. */}
        <SafetyBadge variant="live" />
      </div>

      <TargetInput
        operation={operation}
        value={target}
        onValueChange={setTarget}
        recordType={recordType}
        onRecordTypeChange={setRecordType}
        onSubmit={start}
        busy={busy}
        cooldownSeconds={secondsRemaining}
      />

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        {plan ? (
          <LiveDisclosure plan={plan} />
        ) : (
          <Panel title="Before you press Run" className="min-w-0">
            <p className="text-fg-muted text-sm leading-relaxed">
              Type a target above. The exact URL that will be requested, the method, and
              which machine makes the request all appear here before anything is sent.
            </p>
          </Panel>
        )}

        {run.kind === 'running' ? (
          <Panel
            title="Running"
            aside={<SafetyBadge variant="live" compact />}
            className="min-w-0"
          >
            <p role="status" className="text-fg-secondary text-sm leading-relaxed">
              One request is in flight, made by this app’s server. It times out after five
              seconds, and it will not be retried.
            </p>
          </Panel>
        ) : null}

        {run.kind === 'done' && run.data ? (
          <LiveResultView operation={run.plan.operation.id} data={run.data} />
        ) : null}

        {run.kind === 'done' && run.failure ? (
          run.failure.code === 'rate-limited' ? (
            <RateLimitNotice
              secondsRemaining={secondsRemaining}
              message={run.failure.message}
              {...(run.quota ? { quota: run.quota } : {})}
            />
          ) : (
            <LiveFailureNotice failure={run.failure} />
          )
        ) : null}
      </div>
    </section>
  );
}
