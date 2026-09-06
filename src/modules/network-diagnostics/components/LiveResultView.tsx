'use client';

import { AlertTriangle, ShieldX } from 'lucide-react';

import type {
  DiagnosticsMeta,
  DnsLookupPayload,
  LiveOperationId,
  RdapPayload,
  ReachPayload,
} from '@/core/net/diagnostics';
import { Badge, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { LiveFailure } from '../live/client';

/**
 * What came back, and what it is evidence of.
 *
 * Every panel below carries three things the phase doc asks for: the source ("every live
 * response includes the resolver/registry source and a timestamp"), the timestamp, and
 * the caveat that stops the result being over-read. The caveats are not footnotes — a
 * reachability figure with the ICMP sentence removed is a wrong number, and an RDAP
 * record with the redaction note removed reads as missing data rather than as the
 * registry's own choice.
 *
 * Failures get the same treatment as answers: a panel, a reason, and no retry. A refusal
 * by the SSRF guard in particular is shown as a working security boundary rather than an
 * error, because that is what it is, and because the address it names is usually the
 * most interesting thing on the screen.
 */

/** Source and timestamp, under every successful result. */
function SourceLine({ meta }: { meta: DiagnosticsMeta }) {
  return (
    <div className="border-border text-fg-muted flex flex-col gap-1 border-t pt-3 text-xs leading-relaxed">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-fg-secondary font-medium">{meta.source.name}</span>
        <span aria-hidden="true">·</span>
        <span>{new Date(meta.requestedAt).toLocaleString()}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{meta.elapsedMs} ms</span>
      </div>
      <code className="font-mono break-all">{meta.source.endpoint}</code>
      <p>{meta.source.note}</p>
    </div>
  );
}

/** A definition row, used by all three results. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <dt className="text-fg-muted text-xs">{label}</dt>
      <dd className="text-fg min-w-0 font-mono text-xs break-all">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------

function DnsResult({ data }: { data: DiagnosticsMeta & DnsLookupPayload }) {
  const empty = data.answers.length === 0;

  return (
    <Panel
      title={`${data.type} records for ${data.target}`}
      aside={
        <>
          <Badge tone={data.rcodeValue === 0 ? 'ok' : 'warn'}>{data.rcode}</Badge>
          {data.authenticatedData ? <Badge tone="accent">DNSSEC validated</Badge> : null}
        </>
      }
      className="min-w-0"
    >
      <div className="flex min-w-0 flex-col gap-3">
        {empty ? (
          <p className="text-fg-secondary text-sm leading-relaxed">
            {data.rcodeValue === 3
              ? 'NXDOMAIN — the resolver has proof this name does not exist. That is an answer, not a failure; the SOA record below is the proof.'
              : `No ${data.type} records. The name may exist with other record types — an NXDOMAIN would have said it does not exist at all.`}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {data.answers.map((record, index) => (
              <li
                key={`${record.name}-${record.type}-${record.data}-${index}`}
                className="border-border flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2 last:border-b-0 last:pb-0"
              >
                <Badge tone="neutral">
                  <span className="font-mono">{record.type}</span>
                </Badge>
                <code className="text-fg min-w-0 flex-1 font-mono text-sm break-all">
                  {record.data}
                </code>
                <span className="text-fg-muted font-mono text-xs">TTL {record.ttl}s</span>
              </li>
            ))}
          </ol>
        )}

        {data.authority.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="text-fg-secondary text-xs font-medium">Authority section</h4>
            {data.authority.map((record, index) => (
              <code
                key={`${record.name}-${index}`}
                className="text-fg-muted font-mono text-xs break-all"
              >
                {record.name} {record.type} {record.data}
              </code>
            ))}
          </div>
        ) : null}

        <dl className="flex flex-col gap-1">
          <Row label="Question">
            {data.question.name} {data.question.type}
          </Row>
          <Row label="AD (resolver validated DNSSEC)">
            {data.authenticatedData ? 'true' : 'false'}
          </Row>
          {data.truncated ? <Row label="TC (truncated upstream)">true</Row> : null}
        </dl>

        {data.comment ? (
          <p className="text-fg-muted text-xs leading-relaxed">{data.comment}</p>
        ) : null}

        <SourceLine meta={data} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// RDAP
// ---------------------------------------------------------------------------

function RdapResult({ data }: { data: DiagnosticsMeta & RdapPayload }) {
  if (!data.found) {
    return (
      <Panel
        title={`Registration for ${data.target}`}
        aside={<Badge tone="warn">Not registered</Badge>}
        className="min-w-0"
      >
        <div className="flex flex-col gap-3">
          <p className="text-fg-secondary text-sm leading-relaxed">
            The registry answered a structured 404: it holds no record for this target.
            For a domain that usually means it is available; for an address block it means
            the block is not delegated the way you spelled it.
          </p>
          <SourceLine meta={data} />
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Registration for ${data.ldhName ?? data.target}`}
      aside={
        <>
          {data.registrar ? <Badge tone="neutral">{data.registrar.name}</Badge> : null}
          {data.delegationSigned === true ? (
            <Badge tone="accent">DNSSEC signed</Badge>
          ) : null}
        </>
      }
      className="min-w-0"
    >
      <div className="flex min-w-0 flex-col gap-3">
        {data.statuses.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <h4 className="text-fg-secondary text-xs font-medium">EPP status codes</h4>
            <ul className="flex flex-wrap gap-1.5">
              {data.statuses.map((status) => (
                <li key={status}>
                  <Badge tone={status.includes('hold') ? 'warn' : 'neutral'}>
                    <span className="font-mono">{status}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.events.length > 0 ? (
          <dl className="flex flex-col gap-1">
            {data.events.map((event) => (
              <Row key={`${event.action}-${event.date}`} label={event.action}>
                {event.date}
              </Row>
            ))}
          </dl>
        ) : null}

        {data.nameservers.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="text-fg-secondary text-xs font-medium">Nameservers</h4>
            {data.nameservers.map((server) => (
              <code key={server.host} className="text-fg font-mono text-xs break-all">
                {server.host}
                {server.addresses.length > 0 ? ` — ${server.addresses.join(', ')}` : ''}
              </code>
            ))}
          </div>
        ) : null}

        {data.network ? (
          <dl className="flex flex-col gap-1">
            {data.network.name ? <Row label="Block name">{data.network.name}</Row> : null}
            {data.network.startAddress ? (
              <Row label="Range">
                {data.network.startAddress} – {data.network.endAddress ?? '?'}
              </Row>
            ) : null}
            {data.network.country ? (
              <Row label="Country">{data.network.country}</Row>
            ) : null}
          </dl>
        ) : null}

        {data.entities.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="text-fg-secondary text-xs font-medium">Contacts</h4>
            <ul className="flex flex-col gap-0.5">
              {data.entities.map((entity, index) => (
                <li
                  key={`${entity.handle ?? entity.name ?? 'entity'}-${index}`}
                  className="text-fg-secondary text-xs"
                >
                  <span className="font-mono">
                    {entity.roles.join(', ') || 'unknown'}
                  </span>
                  {' — '}
                  {entity.redacted ? (
                    <span className="text-fg-muted">
                      redacted by the registry (the normal answer since GDPR)
                    </span>
                  ) : (
                    (entity.name ?? entity.organization ?? entity.email)
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {data.redirects.length > 0 ? (
          <p className="text-fg-muted text-xs leading-relaxed">
            Redirected {data.redirects.length}{' '}
            {data.redirects.length === 1 ? 'time' : 'times'} — each hop was re-validated
            against the whole SSRF guard, resolution included, before it was followed.
          </p>
        ) : null}

        <SourceLine meta={data} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

function ReachResult({ data }: { data: DiagnosticsMeta & ReachPayload }) {
  return (
    <Panel
      title={`HEAD ${data.hostname}`}
      aside={
        <>
          <Badge tone={data.ok ? 'ok' : 'warn'}>
            {data.status} {data.statusText}
          </Badge>
          <Badge tone="accent">
            <span className="font-mono">{data.responseTimeMs} ms</span>
          </Badge>
        </>
      }
      className="min-w-0"
    >
      <div className="flex min-w-0 flex-col gap-3">
        {/* The caveat is above the number, not below it. It is the number's definition. */}
        <p className="text-state-warn/90 text-xs leading-relaxed">{data.note}</p>

        <dl className="flex flex-col gap-1">
          <Row label="Requested">{data.requestedUrl}</Row>
          <Row label="Method">{data.method}</Row>
          <Row label="Port">{data.port}</Row>
          <Row label="Time to first byte">{data.responseTimeMs} ms</Row>
          {data.tls ? <Row label="TLS">handshake completed</Row> : null}
        </dl>

        {data.addresses.length > 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="text-fg-secondary text-xs font-medium">
              {data.resolved
                ? 'Addresses the name resolved to, each cleared by the guard'
                : 'The address you typed, cleared by the guard'}
            </h4>
            {data.addresses.map((entry) => (
              <code key={entry.address} className="text-fg font-mono text-xs break-all">
                {entry.address}{' '}
                <span className="text-fg-muted">
                  IPv{entry.version} · {entry.scope}
                </span>
              </code>
            ))}
          </div>
        ) : null}

        {Object.keys(data.headers).length > 0 ? (
          <div className="flex flex-col gap-1">
            <h4 className="text-fg-secondary text-xs font-medium">Response headers</h4>
            <dl className="flex flex-col gap-1">
              {Object.entries(data.headers).map(([name, value]) => (
                <Row key={name} label={name}>
                  {value}
                </Row>
              ))}
            </dl>
          </div>
        ) : null}

        {data.redirect ? (
          <p className="text-fg-secondary text-xs leading-relaxed">
            <span className="text-fg font-medium">
              {data.redirect.status} → {data.redirect.location}
            </span>{' '}
            {data.redirect.note}
          </p>
        ) : null}

        {data.tls ? (
          <p className="text-fg-muted text-xs leading-relaxed">{data.tls.note}</p>
        ) : null}

        <SourceLine meta={data} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

/** Headings that name what happened, rather than "Error". */
const FAILURE_TITLE: Readonly<Record<LiveFailure['code'], string>> = {
  'invalid-target': 'That is not one valid target',
  'blocked-target': 'Refused: the guard will not go there',
  'rate-limited': 'Rate limited',
  'not-found': 'Nothing to look up',
  'upstream-failed': 'The resolver, registry, or target answered badly',
  timeout: 'Nothing answered in time',
  network: 'The request never completed',
  aborted: 'Cancelled',
};

export function LiveFailureNotice({
  failure,
  className,
}: {
  failure: LiveFailure;
  className?: string;
}) {
  const blocked = failure.code === 'blocked-target';

  return (
    <Panel
      title={FAILURE_TITLE[failure.code]}
      aside={
        <>
          {failure.httpStatus ? (
            <Badge tone={blocked ? 'warn' : 'error'}>HTTP {failure.httpStatus}</Badge>
          ) : null}
          {failure.reason ? (
            <Badge tone="neutral">
              <span className="font-mono">{failure.reason}</span>
            </Badge>
          ) : null}
        </>
      }
      className={cn(
        'min-w-0',
        blocked ? 'border-state-warn/40' : 'border-state-error/40',
        className,
      )}
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg-secondary flex items-start gap-2 text-sm leading-relaxed">
          {blocked ? (
            <ShieldX
              aria-hidden="true"
              className="text-state-warn mt-0.5 size-4 shrink-0"
            />
          ) : (
            <AlertTriangle
              aria-hidden="true"
              className="text-state-error mt-0.5 size-4 shrink-0"
            />
          )}
          <span>{failure.message}</span>
        </p>

        {failure.address ? (
          <dl className="flex flex-col gap-1">
            <Row label="Address that caused the refusal">{failure.address}</Row>
            {failure.metadataEndpoint ? (
              <Row label="Cloud metadata endpoint">{failure.metadataEndpoint}</Row>
            ) : null}
          </dl>
        ) : null}

        {blocked ? (
          <p className="text-fg-muted text-xs leading-relaxed">
            This is the SSRF guard working, not a bug. Private, loopback, link-local,
            multicast, reserved, and cloud metadata addresses are refused — and the check
            runs again on every address the name resolved to, so a public name pointing at
            a private address is refused at that point too.
          </p>
        ) : null}

        <p className="text-fg-muted text-xs leading-relaxed">
          Nothing was retried. Change the target or press Run again if you want a second
          attempt.
        </p>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

/** A successful response for any of the three operations, envelope included. */
export type LiveResultData = DiagnosticsMeta &
  (DnsLookupPayload | RdapPayload | ReachPayload);

export interface LiveResultViewProps {
  operation: LiveOperationId;
  data: LiveResultData;
}

/** Render whichever payload came back. */
export function LiveResultView({ operation, data }: LiveResultViewProps) {
  if (operation === 'dns') {
    return <DnsResult data={data as DiagnosticsMeta & DnsLookupPayload} />;
  }
  if (operation === 'rdap') {
    return <RdapResult data={data as DiagnosticsMeta & RdapPayload} />;
  }
  return <ReachResult data={data as DiagnosticsMeta & ReachPayload} />;
}
