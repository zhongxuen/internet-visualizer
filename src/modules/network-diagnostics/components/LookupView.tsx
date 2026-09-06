'use client';

import { Badge, CodeBlock, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import { LOOKUP_CAVEATS, type LookupRun } from '../sim/lookup';

/**
 * The lookup result: the answer, the walk that produced it, and the second run that
 * proves the first one filled a cache.
 *
 * A DNS lookup tool's output is easy to show and easy to misread, so the panels are
 * arranged around the two things it does not say out loud. The **warm run** is given its
 * own panel rather than a footnote, because "0 queries, 3 ms" beside "3 queries, 76 ms"
 * is caching demonstrated rather than asserted. The **caveats** are permanent, and the
 * first of them is the one that costs people afternoons: this answer came from walking
 * the hierarchy directly, and it is not necessarily the answer the machine's own resolver
 * would give.
 */

export interface LookupViewProps {
  run: LookupRun;
  className?: string;
}

/** One rung of the ladder, in the order the resolver climbed it. */
function Ladder({ run }: { run: LookupRun }) {
  return (
    <ol className="flex flex-col gap-2">
      {run.resolution.steps.map((step) => (
        <li
          key={step.index}
          className="border-border bg-surface-overlay/40 flex flex-col gap-1 rounded-md border px-3 py-2"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-fg-muted font-mono text-[0.65rem]">
              {step.index + 1}
            </span>
            <span className="text-fg text-sm font-medium">{step.to.label}</span>
            <Badge tone={toneFor(step.outcome)}>{step.outcome}</Badge>
            <span className="text-fg-muted ml-auto font-mono text-[0.65rem]">
              {step.durationMs.toFixed(1)} ms
              {step.transport === 'tcp' ? ' · TCP' : ''}
            </span>
          </div>
          <p className="text-fg-secondary text-xs leading-relaxed">{step.note}</p>
        </li>
      ))}
    </ol>
  );
}

function toneFor(outcome: string): 'ok' | 'warn' | 'error' | 'accent' | 'neutral' {
  switch (outcome) {
    case 'answer':
      return 'ok';
    case 'cache-hit':
      return 'accent';
    case 'nxdomain':
    case 'nodata':
      return 'warn';
    case 'servfail':
    case 'refused':
    case 'timeout':
      return 'error';
    default:
      return 'neutral';
  }
}

export function LookupView({ run, className }: LookupViewProps) {
  const { resolution, warm } = run;
  const failed = resolution.rcode !== 'NOERROR';

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <Panel
          title="The answer"
          aside={<Badge tone={failed ? 'warn' : 'ok'}>{resolution.rcode}</Badge>}
        >
          {run.answers.length > 0 ? (
            <ol className="flex flex-col gap-2">
              {run.answers.map((entry, index) => (
                <li key={`${entry.record.name}-${entry.record.type}-${index}`}>
                  <p className="text-fg font-mono text-sm break-all">{entry.text}</p>
                  <p className="text-fg-muted mt-0.5 text-xs leading-relaxed">
                    <span className="text-fg-secondary font-medium">
                      {entry.record.type}
                    </span>{' '}
                    &mdash; {entry.note} TTL {entry.record.ttl} s: how long a resolver may
                    reuse this without asking again.
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-fg-secondary text-sm leading-relaxed">
              No records.{' '}
              {resolution.rcode === 'NXDOMAIN'
                ? 'The name does not exist, and RFC 2308 says the absence is cached too -- which is why correcting a typo can appear not to work for several minutes.'
                : 'The query did not produce an answer. The ladder beside this says where it stopped.'}
            </p>
          )}
        </Panel>

        {/*
          Caching, as an observation rather than a claim. The two numbers are the panel.
        */}
        <Panel
          title="Asked again, immediately"
          aside={
            <Badge tone={warm.servedFromCache ? 'accent' : 'neutral'}>
              {warm.queryCount} queries
            </Badge>
          }
        >
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
                  Cold
                </dt>
                <dd className="text-fg font-mono text-sm">
                  {resolution.queryCount} queries · {Math.round(resolution.elapsedMs)} ms
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
                  Warm
                </dt>
                <dd className="text-accent font-mono text-sm">
                  {warm.queryCount} queries · {Math.round(warm.elapsedMs)} ms
                </dd>
              </div>
            </dl>
            <p className="text-fg-secondary text-sm leading-relaxed">{warm.summary}</p>
            <p className="text-fg-muted text-xs leading-relaxed">
              {warm.cacheEntries} entries in the resolver&rsquo;s cache afterwards. Each
              expires on its own TTL, so the next lookup may be part cached and part not.
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="How the resolver got there" scroll className="max-h-[28rem]">
          <Ladder run={run} />
        </Panel>

        <div className="flex min-w-0 flex-col gap-3">
          <CodeBlock
            language="dig"
            caption={`Simulated transcript for ${run.example.name}`}
            code={run.output.join('\n')}
            showLineNumbers={false}
            className="overflow-x-auto"
          />
          <Panel title="What a lookup does not tell you">
            <ol className="flex flex-col gap-3">
              {LOOKUP_CAVEATS.map((caveat) => (
                <li key={caveat.title}>
                  <p className="text-fg text-sm font-medium">{caveat.title}</p>
                  <p className="text-fg-secondary mt-1 text-sm leading-relaxed">
                    {caveat.detail}
                  </p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
