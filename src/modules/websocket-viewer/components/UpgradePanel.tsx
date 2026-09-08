'use client';

import { Badge, CodeBlock, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import type { HandshakeRecord } from '../sim/exchange';
import { renderMessage } from '../sim/message';
import type { Requirement } from '../sim/upgrade';

/**
 * The HTTP request that stops being HTTP.
 *
 * Three things are shown together here because they are only convincing together: the two
 * messages as literal CRLF text, the `Sec-WebSocket-Accept` computation with every
 * intermediate value kept, and the specification's checks with a `MUST`/`SHOULD`/`MAY` column.
 *
 * ## Why the raw bytes are shown
 *
 * "This is an ordinary HTTP request" is a claim best made by showing the request. A reader who
 * sees `GET /chat?room=lobby HTTP/1.1` with a `Host` field understands immediately why a
 * WebSocket travels through a corporate proxy that has never heard of WebSockets, and why the
 * handshake can carry cookies, `Authorization`, and everything else HTTP already had. No
 * paraphrase does that.
 *
 * The highlighted lines are the three that make it an upgrade, plus the two `Sec-WebSocket-*`
 * fields that make it a *WebSocket* upgrade. Everything unhighlighted is ordinary HTTP, and
 * that ratio is the lesson.
 *
 * ## Why the derivation is a ladder and not a sentence
 *
 * `Sec-WebSocket-Accept` is four operations, one of which is a string concatenation, and a
 * reader who watches `dGhlIHNhbXBsZSBub25jZQ==` grow a GUID on the end, become twenty bytes
 * of hex, and come back as 28 characters of base64 has understood it permanently. Describing
 * it instead leaves two questions unanswered that the ladder answers by construction: nothing
 * goes between the key and the GUID, and the key is hashed exactly as it was sent.
 *
 * ## Why passing checks are shown too
 *
 * A reader who only ever sees failures learns what breaks a handshake and never learns what
 * one is. The passes are greyed and the failures are not, but they are all there -- and the
 * one `SHOULD` in the table is the most consequential row in it, because `Origin` is the only
 * thing standing between a WebSocket endpoint and any page on the Internet.
 */

export interface UpgradePanelProps {
  /** The handshake to show. */
  handshake: HandshakeRecord;
  /** Every handshake in the run, when there is more than one to choose between. */
  handshakes?: readonly HandshakeRecord[];
  onSelect?: (id: string) => void;
  className?: string;
}

const REQUIREMENT_TONE: Record<Requirement, 'error' | 'warn' | 'neutral'> = {
  MUST: 'error',
  SHOULD: 'warn',
  MAY: 'neutral',
};

/** The field lines that make an ordinary GET into an upgrade request. */
const UPGRADE_FIELDS = [
  'upgrade',
  'connection',
  'sec-websocket-key',
  'sec-websocket-accept',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
];

/** 1-based line numbers of the field lines worth pointing at. */
function upgradeLines(text: string): number[] {
  return text
    .split('\r\n')
    .map((line, index) => {
      const name = line
        .slice(0, Math.max(0, line.indexOf(':')))
        .trim()
        .toLowerCase();
      return UPGRADE_FIELDS.includes(name) ? index + 1 : 0;
    })
    .filter((line) => line > 0);
}

function Derivation({ handshake }: { handshake: HandshakeRecord }) {
  const { steps } = handshake.derivation;

  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="border-border bg-surface flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              aria-hidden="true"
              className="text-accent font-mono text-[0.6875rem] tabular-nums"
            >
              {index + 1}
            </span>
            <h4 className="text-fg text-xs font-medium">{step.label}</h4>
            <span className="text-fg-muted ml-auto font-mono text-[0.625rem] tabular-nums">
              {step.size} {step.unit}
            </span>
          </div>
          <code className="text-fg-secondary block font-mono text-[0.6875rem] leading-relaxed break-all">
            {step.value}
          </code>
          <p className="text-fg-muted text-[0.6875rem] leading-relaxed">{step.explain}</p>
        </li>
      ))}
    </ol>
  );
}

function Checks({ handshake }: { handshake: HandshakeRecord }) {
  return (
    <table className="w-full border-collapse text-left text-xs">
      <caption className="text-fg-muted pb-2 text-left text-[0.6875rem] leading-snug">
        Every check the server runs, in specification order — passes included, because the
        passes are what a handshake <em>is</em>.
      </caption>
      <thead>
        <tr className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
          <th scope="col" className="py-1 pr-3 font-medium">
            Requirement
          </th>
          <th scope="col" className="py-1 pr-3 font-medium">
            Check
          </th>
          <th scope="col" className="py-1 font-medium">
            Found
          </th>
        </tr>
      </thead>
      <tbody>
        {handshake.checks.map((check) => (
          <tr
            key={check.id}
            className={cn(
              'border-border/60 border-t align-top',
              check.passed && 'state-dim',
            )}
          >
            <td className="py-2 pr-3 whitespace-nowrap">
              <Badge tone={check.passed ? 'ok' : REQUIREMENT_TONE[check.requirement]}>
                <span aria-hidden="true">{check.passed ? '✓' : '✕'}</span>
                {check.requirement}
              </Badge>
              <span className="sr-only">{check.passed ? 'passed' : 'failed'}</span>
            </td>
            <td className="py-2 pr-3">
              <span className="text-fg">{check.title}</span>
              <p className="text-fg-muted mt-1 text-[0.6875rem] leading-relaxed">
                {check.detail}
              </p>
              <p className="text-fg-muted mt-1 text-[0.625rem]">
                RFC {check.reference.rfc}
                {check.reference.section ? ` § ${check.reference.section}` : ''}
              </p>
            </td>
            <td className="py-2">
              <code className="text-fg-secondary font-mono text-[0.6875rem] break-all">
                {check.found ?? '(absent)'}
              </code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UpgradePanel({
  handshake,
  handshakes,
  onSelect,
  className,
}: UpgradePanelProps) {
  const requestText = renderMessage(handshake.request);
  const responseText = renderMessage(handshake.response);
  const many = handshakes !== undefined && handshakes.length > 1;

  return (
    <Panel
      title="The upgrade"
      aside={
        <>
          <Badge tone={handshake.accepted ? 'ok' : 'error'}>
            {handshake.response.status} {handshake.response.reason}
          </Badge>
          <Badge tone="neutral">{handshake.cost.totalBytes} B, 1 request</Badge>
        </>
      }
      className={cn('min-w-0', className)}
    >
      <div className="flex min-w-0 flex-col gap-4">
        {many ? (
          <div role="group" aria-label="Handshake" className="flex flex-wrap gap-1.5">
            {handshakes.map((entry) => {
              const active = entry.id === handshake.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect?.(entry.id)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                    focusRing,
                    active
                      ? 'border-accent/60 bg-accent/12 text-fg'
                      : 'border-border bg-surface text-fg-secondary hover:border-border-strong hover:text-fg',
                  )}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          <CodeBlock
            code={requestText}
            language="http"
            caption="Client → server. An ordinary GET, on port 443, that every proxy on the path routes and logs as one."
            highlightLines={upgradeLines(requestText)}
            className="min-w-0"
          />
          <CodeBlock
            code={responseText}
            language="http"
            caption={
              handshake.accepted
                ? 'Server → client. The blank line at the end is the exact byte where HTTP stops and frames begin.'
                : 'Server → client. A refused handshake is still HTTP — the connection never switched protocols.'
            }
            highlightLines={upgradeLines(responseText)}
            className="min-w-0"
          />
        </div>

        <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-border bg-surface rounded-lg border px-3 py-2">
            <dt className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              Connection tokens
            </dt>
            <dd className="text-fg-secondary mt-1 font-mono text-[0.6875rem]">
              {handshake.tokens.requestConnection.join(', ') || '(none)'}
            </dd>
            <dd className="text-fg-muted mt-1 text-[0.6875rem] leading-relaxed">
              A token <em>list</em>. Browsers send <code>keep-alive, Upgrade</code>, and a
              server comparing the whole value to <code>&quot;Upgrade&quot;</code> rejects
              them.
            </dd>
          </div>

          <div className="border-border bg-surface rounded-lg border px-3 py-2">
            <dt className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              Subprotocol
            </dt>
            <dd className="text-fg mt-1 font-mono text-[0.6875rem]">
              {handshake.subprotocol ?? '(none agreed)'}
            </dd>
            <dd className="text-fg-muted mt-1 text-[0.6875rem] leading-relaxed">
              The server chooses, applying its own preference order to what the client
              offered. Agreeing on nothing is a success, not a failure.
            </dd>
          </div>

          <div className="border-border bg-surface rounded-lg border px-3 py-2">
            <dt className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              Extensions
            </dt>
            <dd className="text-fg mt-1 font-mono text-[0.6875rem]">
              {handshake.extensions.length === 0
                ? '(none granted)'
                : handshake.extensions.join(', ')}
            </dd>
            <dd className="text-fg-muted mt-1 text-[0.6875rem] leading-relaxed">
              An extension changes how frames are read — <code>permessage-deflate</code>{' '}
              claims RSV1. A server may never grant one that was not offered.
            </dd>
          </div>

          <div
            className={cn(
              'rounded-lg border px-3 py-2',
              handshake.resource.credentialInQuery
                ? 'border-state-warn/50 bg-state-warn/10'
                : 'border-border bg-surface',
            )}
          >
            <dt className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              Request target
            </dt>
            <dd className="text-fg mt-1 font-mono text-[0.6875rem] break-all">
              {handshake.resource.path}
              {handshake.resource.query === '' ? '' : `?${handshake.resource.query}`}
            </dd>
            <dd
              className={cn(
                'mt-1 text-[0.6875rem] leading-relaxed',
                handshake.resource.credentialInQuery
                  ? 'text-state-warn'
                  : 'text-fg-muted',
              )}
            >
              {handshake.resource.credentialInQuery
                ? 'A credential in the query string lands in every access log on the path. The browser WebSocket constructor takes a URL and a subprotocol list and nothing else, which is why this happens.'
                : 'No credential in the query — which is worth noticing, because page script cannot set an Authorization header on a WebSocket handshake and the query is where tokens usually end up.'}
            </dd>
          </div>
        </dl>

        <section
          aria-label="Sec-WebSocket-Accept derivation"
          className="flex flex-col gap-2"
        >
          <h3 className="text-fg-secondary text-xs font-medium tracking-widest uppercase">
            Deriving Sec-WebSocket-Accept
          </h3>
          <p className="text-fg-muted text-[0.6875rem] leading-relaxed">
            A proof of comprehension, not a secret. Nothing authenticates on this digest,
            which is why SHA-1 is not a mistake here — a collision buys an attacker
            nothing. What it proves is that the responder read the request and knew what
            was being asked for, so a cached <code>101</code> from an earlier connection
            cannot answer this one.
          </p>
          <Derivation handshake={handshake} />
        </section>

        <section aria-label="Handshake checks">
          <Checks handshake={handshake} />
        </section>
      </div>
    </Panel>
  );
}
