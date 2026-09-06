'use client';

import { ArrowRight, Globe, Monitor, ServerCog } from 'lucide-react';

import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { LivePlan, PlannedRequest } from '../live/operations';

/**
 * Exactly what will be requested, shown before it is requested.
 *
 * The phase doc asks for three things by name — "the exact URL that will be requested,
 * the method, and where the request originates (the server, not the browser)" — and the
 * layout is built around the third, because it is the one people get wrong. Two rows:
 * what *your browser* calls, which is always a path on this app, and what *this app's
 * server* then calls, which is the only thing that leaves for the wider internet.
 *
 * The URLs are not descriptions of the request. They come from
 * {@link planLiveRequest}, and `client.ts` fetches `plan.fromBrowser.url` — the same
 * string, from the same object — so this panel cannot show one URL while another is
 * requested. The server side is the same story one level down: the handler builds its
 * upstream URL with `dohUrlFor` / `normalizeReachTarget` / `rdapUrlFor`, which is what
 * the rows below print.
 *
 * The one honest gap is RDAP's second step. Which registry answers is decided by IANA's
 * bootstrap file, and that file has not been read yet when this panel is drawn, so the
 * base is shown as a placeholder rather than a guess. Saying so is better than being
 * confidently wrong, and the two-step mechanism is worth seeing anyway.
 */

export interface LiveDisclosureProps {
  plan: LivePlan;
  className?: string;
}

/** One request line: method, URL, and what the step is for. */
function RequestLine({ request }: { request: PlannedRequest }) {
  return (
    <li className="flex flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge tone="neutral">
          <span className="font-mono">{request.method}</span>
        </Badge>
        <code className="text-fg bg-surface-overlay min-w-0 rounded px-1.5 py-0.5 font-mono text-xs break-all">
          {request.url}
        </code>
      </div>
      <p className="text-fg-muted flex items-center gap-1.5 pl-1 text-xs leading-relaxed">
        <ArrowRight aria-hidden="true" className="size-3 shrink-0" />
        {request.purpose}
      </p>
    </li>
  );
}

export function LiveDisclosure({ plan, className }: LiveDisclosureProps) {
  const { operation, target } = plan;

  return (
    <Panel
      title="Before you press Run"
      aside={<Badge tone="warn">Nothing sent yet</Badge>}
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-fg-secondary flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
            <Monitor aria-hidden="true" className="size-3.5" />
            Your browser requests
          </h3>
          <ul className="flex flex-col gap-2">
            <RequestLine request={plan.fromBrowser} />
          </ul>
          <p className="text-fg-muted text-xs leading-relaxed">
            Same origin, and the only request your browser makes. Your address is never
            given to the target, and no third-party host is contacted from this page.
          </p>
        </div>

        <div className="border-border flex min-w-0 flex-col gap-2 border-t pt-4">
          <h3 className="text-fg-secondary flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
            <ServerCog aria-hidden="true" className="size-3.5" />
            This app’s server then requests
            {plan.fromServer.length > 1 ? (
              <span className="text-fg-muted normal-case">
                ({plan.fromServer.length} steps, in order)
              </span>
            ) : null}
          </h3>
          <ol className="flex flex-col gap-3">
            {plan.fromServer.map((request) => (
              <RequestLine key={`${request.method} ${request.url}`} request={request} />
            ))}
          </ol>
          <p className="text-fg-muted text-xs leading-relaxed">
            {plan.reachesTheTarget
              ? 'This is the one operation where a socket is opened to the address you typed. The name is resolved first and every address it resolves to is re-checked against the block list — a name that points at a private or metadata address is refused at that point, not before.'
              : `Your target is a parameter of this request, not its destination: the socket opens to ${operation.answeredBy}, and would still open there if the target were nonsense.`}
          </p>
        </div>

        {target.assumedScheme ? (
          <p className="text-fg-secondary border-border border-t pt-4 text-xs leading-relaxed">
            You typed a bare host, so <code className="font-mono">https://</code> was
            assumed. Type the scheme yourself to request{' '}
            <code className="font-mono">http://</code> instead.
          </p>
        ) : null}

        {operation.warning ? (
          <p className="text-fg-secondary border-border flex items-start gap-2 border-t pt-4 text-xs leading-relaxed">
            <Globe
              aria-hidden="true"
              className="text-state-warn mt-0.5 size-3.5 shrink-0"
            />
            <span>{operation.warning}</span>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
