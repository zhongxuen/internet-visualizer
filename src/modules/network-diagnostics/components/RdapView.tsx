'use client';

import { Badge, CodeBlock, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

import {
  describeStatus,
  RDAP_FIELD_NOTES,
  WHOIS_VS_RDAP,
  type RegistrationRun,
} from '../sim/whois';

/**
 * The registration record, in both protocols, with the fields annotated.
 *
 * Two decisions shape this panel.
 *
 * **The status codes come first.** They are the most actionable field on a registration
 * record and the one people scroll past: `clientHold` explains an outage that no amount
 * of DNS debugging will, and `serverTransferProhibited` explains a transfer that keeps
 * failing. Each is shown with who set it -- registrar or registry -- because that decides
 * whether it can be removed by asking.
 *
 * **The two transcripts sit side by side.** The argument for RDAP is not a paragraph, it
 * is the same record printed twice: unstructured text over a cleartext socket on the
 * left, JSON with a defined schema over HTTPS on the right. The comparison table below
 * says why in words, but the two blocks say it first.
 */

export interface RdapViewProps {
  run: RegistrationRun;
  className?: string;
}

/** The dated events, which are the fields most often read wrong. */
function Timeline({ run }: { run: RegistrationRun }) {
  return (
    <ol className="flex flex-col gap-2">
      {run.record.events.map((event) => (
        <li key={`${event.action}-${event.date}`} className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-fg text-sm font-medium capitalize">{event.action}</span>
            <span className="text-fg-secondary font-mono text-xs">{event.date}</span>
          </div>
          {event.note ? (
            <p className="text-fg-muted text-xs leading-relaxed">{event.note}</p>
          ) : null}
          {RDAP_FIELD_NOTES[event.action] ? (
            <p className="text-fg-secondary text-xs leading-relaxed">
              {RDAP_FIELD_NOTES[event.action]}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function RdapView({ run, className }: RdapViewProps) {
  const { record } = run;
  const found = record.found;

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          title="Status codes"
          aside={
            <Badge
              tone={found ? (record.statuses.length > 0 ? 'accent' : 'neutral') : 'warn'}
            >
              {found ? `${record.statuses.length} set` : `HTTP ${run.httpStatus}`}
            </Badge>
          }
        >
          {record.statuses.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-fg-muted text-xs leading-relaxed">
                {RDAP_FIELD_NOTES.statuses}
              </p>
              <ol className="flex flex-col gap-3">
                {record.statuses.map((code) => {
                  const status = describeStatus(code);
                  return (
                    <li key={code} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="text-fg bg-surface-overlay rounded px-1.5 py-0.5 font-mono text-xs">
                          {status.code}
                        </code>
                        <Badge tone={status.setBy === 'client' ? 'neutral' : 'warn'}>
                          set by the{' '}
                          {status.setBy === 'client' ? 'registrar' : 'registry'}
                        </Badge>
                      </div>
                      <p className="text-fg-secondary text-sm leading-relaxed">
                        {status.meaning}
                      </p>
                      <p className="text-fg-muted text-sm leading-relaxed">
                        {status.consequence}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <p className="text-fg-secondary text-sm leading-relaxed">
              No registration, so no statuses. RDAP answered with a structured 404 and
              WHOIS with a sentence &mdash; the same fact, one of them parseable.
            </p>
          )}
        </Panel>

        <Panel title="Dates" scroll className="max-h-[28rem]">
          <Timeline run={run} />
        </Panel>
      </div>

      {found ? (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <Panel title="Delegation and contacts">
            <div className="flex flex-col gap-4">
              {record.nameservers.length > 0 ? (
                <div>
                  <p className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
                    Nameservers
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {record.nameservers.map((ns) => (
                      <li key={ns.host} className="text-fg font-mono text-sm">
                        {ns.host}
                        {ns.addresses ? (
                          <span className="text-fg-muted ml-2 text-xs">
                            glue {ns.addresses.join(', ')}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <p className="text-fg-secondary mt-1.5 text-xs leading-relaxed">
                    {RDAP_FIELD_NOTES.nameservers}
                  </p>
                </div>
              ) : null}

              {record.delegationSigned !== undefined ? (
                <div>
                  <p className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
                    DNSSEC
                  </p>
                  <p className="text-fg mt-1 text-sm">
                    <Badge tone={record.delegationSigned ? 'ok' : 'neutral'}>
                      {record.delegationSigned ? 'signed delegation' : 'unsigned'}
                    </Badge>
                  </p>
                  <p className="text-fg-secondary mt-1.5 text-xs leading-relaxed">
                    {RDAP_FIELD_NOTES.delegationSigned}
                  </p>
                </div>
              ) : null}

              <div>
                <p className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
                  Contacts
                </p>
                <ul className="mt-1 flex flex-col gap-2">
                  {record.entities.map((entity) => (
                    <li key={`${entity.role}-${entity.name}`}>
                      <p className="text-fg text-sm">
                        <span className="text-fg-muted mr-2 text-xs capitalize">
                          {entity.role}
                        </span>
                        {entity.organization ?? entity.name}
                        {entity.redacted ? (
                          <Badge tone="warn" className="ml-2 align-middle">
                            redacted
                          </Badge>
                        ) : null}
                      </p>
                      {entity.email ? (
                        <p className="text-fg-secondary font-mono text-xs">
                          {entity.email}
                        </p>
                      ) : null}
                      {entity.note ? (
                        <p className="text-fg-muted text-xs leading-relaxed">
                          {entity.note}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              {record.registrar ? (
                <div>
                  <p className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
                    Registrar
                  </p>
                  <p className="text-fg mt-1 text-sm">
                    {record.registrar.name}{' '}
                    <span className="text-fg-muted font-mono text-xs">
                      IANA {record.registrar.ianaId}
                    </span>
                  </p>
                  <p className="text-fg-secondary mt-1 text-xs leading-relaxed">
                    {RDAP_FIELD_NOTES.registrar}
                  </p>
                </div>
              ) : null}

              {record.note ? (
                <p className="border-accent/40 bg-accent/8 text-fg-secondary rounded-lg border-l-2 px-3 py-2 text-sm leading-relaxed">
                  {record.note}
                </p>
              ) : null}
            </div>
          </Panel>

          <Panel title="The two requests RDAP made">
            <ol className="flex flex-col gap-3">
              {run.requests.map((request, index) => (
                <li key={request.url} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="text-fg-muted mt-0.5 font-mono text-xs"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-fg font-mono text-xs break-all">
                      {request.method} {request.url}
                    </p>
                    <p className="text-fg-secondary mt-1 text-sm leading-relaxed">
                      {request.why}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      ) : (
        <Panel title="No such registration">
          <p className="text-fg-secondary text-sm leading-relaxed">{record.note}</p>
        </Panel>
      )}

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <CodeBlock
          language="whois"
          caption="Port 43, plain text, in the clear"
          code={run.whois.join('\n')}
          showLineNumbers={false}
          className="max-h-[26rem] overflow-auto"
        />
        <CodeBlock
          language="rdap+json"
          caption={`HTTPS, application/rdap+json, HTTP ${run.httpStatus}`}
          code={run.rdap.join('\n')}
          showLineNumbers={false}
          className="max-h-[26rem] overflow-auto"
        />
      </div>

      <Panel title="Why RDAP replaced WHOIS" scroll className="max-h-[26rem]">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="text-fg-muted text-[0.65rem] tracking-wider uppercase">
              <th scope="col" className="pr-4 pb-2 font-medium">
                Aspect
              </th>
              <th scope="col" className="pr-4 pb-2 font-medium">
                WHOIS (RFC 3912)
              </th>
              <th scope="col" className="pb-2 font-medium">
                RDAP (RFC 9082/9083)
              </th>
            </tr>
          </thead>
          <tbody>
            {WHOIS_VS_RDAP.map((row) => (
              <tr key={row.aspect} className="border-border/60 border-t align-top">
                <th scope="row" className="text-fg py-2 pr-4 text-left font-medium">
                  {row.aspect}
                </th>
                <td className="text-fg-secondary py-2 pr-4 leading-relaxed">
                  {row.whois}
                </td>
                <td className="text-fg-secondary py-2 leading-relaxed">{row.rdap}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
