'use client';

import { useState } from 'react';

import { Badge, Panel } from '@/components/ui';
import { focusRing } from '@/components/ui/styles';
import { cn } from '@/lib/cn';

import {
  describeGap,
  formatDistinguishedName,
  formatInstant,
  primaryFailure,
  type Certificate,
  type CertificateChain as Chain,
  type ChainValidation,
  type TrustStore,
  type ValidationStep,
} from '../sim/certificates';

/**
 * The chain, and the five checks the padlock is actually a claim about.
 *
 * Two halves, in this order on purpose. The verdicts come first, because "is this
 * certificate good?" is five independent questions and almost everyone believes it is
 * one. The chain comes second, because the fields only mean something once you know what
 * is being asked of them.
 *
 * Every one of the five is rendered every time, passing or failing. A list that showed
 * only failures would teach that a good certificate is a certificate with no problems,
 * when what it actually is is a certificate that survived five specific tests — and the
 * three failure scenarios in this module each break exactly one of them, which is only
 * legible if the other four are visibly still green.
 *
 * ## Which failure the browser shows
 *
 * A browser shows one interstitial even when several checks fail, and it shows the first
 * in validation order. `primaryFailure` is that rule, and the panel leads with its
 * `browserError` and plain-language text — so a learner can connect
 * `NET::ERR_CERT_DATE_INVALID` to the row it came from rather than to a vague sense that
 * something was wrong.
 *
 * ## Where the root comes from
 *
 * The presented chain is leaf plus intermediates and never includes the root. The root
 * drawn at the bottom is the one the client found in its own trust store — labelled as
 * such, because a server appending a self-signed root to its own chain would otherwise
 * look like it worked, and that misunderstanding is the entire reason path validation
 * terminates at a locally held anchor.
 */

export interface CertificateChainProps {
  /** The chain the server presented, leaf first. Absent on a resumed handshake. */
  chain?: Chain;
  /** All five verdicts. Absent when no certificate was presented. */
  validation?: ChainValidation;
  /** The roots the client shipped with, named. */
  store: TrustStore;
  /** Why there is no certificate, when there is none. */
  absentReason?: string;
  className?: string;
}

/** Leaf, intermediate, or trust anchor — what a certificate is doing in this chain. */
function roleOf(
  cert: Certificate,
  index: number,
  count: number,
  anchorId: string | undefined,
): string {
  if (cert.id === anchorId) return 'Root — from your trust store';
  if (index === 0) return 'Leaf — speaks for the hostname';
  return `Intermediate ${index} of ${Math.max(count - 2, 1)}`;
}

function StepRow({ step }: { step: ValidationStep }) {
  const [open, setOpen] = useState(false);

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
          focusRing,
          step.passed
            ? 'border-state-ok/40 bg-state-ok/8 hover:border-state-ok/60'
            : 'border-state-error/50 bg-state-error/10 hover:border-state-error/70',
        )}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'font-mono text-xs',
                step.passed ? 'text-state-ok' : 'text-state-error',
              )}
            >
              {step.passed ? '✓' : '✕'}
            </span>
            <span className="text-fg text-xs font-medium">{step.title}</span>
          </span>
          <Badge tone={step.passed ? 'ok' : 'error'}>
            {step.passed ? 'pass' : 'fail'}
          </Badge>
        </span>

        <span className="text-fg-secondary mt-1 block text-[0.625rem] leading-snug">
          {step.detail}
        </span>

        {step.alert ? (
          <span className="text-state-error mt-1 block font-mono text-[0.5625rem]">
            alert {step.alert.name}({step.alert.code})
            {step.browserError ? ` · ${step.browserError}` : ''}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="border-border bg-surface mt-1 rounded-lg border px-2.5 py-2">
          <p className="text-fg-secondary text-[0.625rem] leading-snug">{step.explain}</p>
          {step.userFacing ? (
            <p className="text-fg-muted border-border/60 mt-1.5 border-t pt-1.5 text-[0.625rem] leading-snug italic">
              “{step.userFacing}”
            </p>
          ) : null}
          <p className="text-fg-muted mt-1.5 font-mono text-[0.5625rem]">
            RFC {step.reference.rfc} § {step.reference.section} — {step.reference.title}
          </p>
        </div>
      ) : null}
    </li>
  );
}

function CertificateCard({
  cert,
  role,
  validatedAt,
  expanded,
  onToggle,
}: {
  cert: Certificate;
  role: string;
  /** Epoch ms the validity window was judged against. */
  validatedAt: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const expired = validatedAt > cert.notAfter;
  const notYet = validatedAt < cert.notBefore;

  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          'rounded-lg border px-2.5 py-2 text-left transition-colors',
          focusRing,
          expanded
            ? 'border-border-strong bg-surface-overlay'
            : 'border-border bg-surface hover:border-border-strong',
        )}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
            {role}
          </span>
          <span className="text-fg-muted font-mono text-[0.5625rem]">
            {cert.publicKey.algorithm} {cert.publicKey.sizeBits}
            {cert.publicKey.curve ? ` · ${cert.publicKey.curve}` : ''}
          </span>
        </span>
        <span className="text-fg mt-0.5 block font-mono text-[0.6875rem] break-all">
          {cert.subject.commonName}
        </span>
        <span
          className={cn(
            'mt-0.5 block font-mono text-[0.5625rem]',
            expired || notYet ? 'text-state-error' : 'text-fg-muted',
          )}
        >
          {formatInstant(cert.notBefore)} → {formatInstant(cert.notAfter)}
          {expired ? ` · expired ${describeGap(validatedAt - cert.notAfter)} ago` : ''}
          {notYet
            ? ` · not valid for another ${describeGap(cert.notBefore - validatedAt)}`
            : ''}
        </span>
      </button>

      {expanded ? (
        <dl className="border-border bg-surface mt-1 grid gap-x-3 gap-y-1 rounded-lg border px-2.5 py-2 sm:grid-cols-2">
          <Row label="Subject" value={formatDistinguishedName(cert.subject)} wide />
          <Row label="Issuer" value={formatDistinguishedName(cert.issuer)} wide />
          <Row label="Serial number" value={cert.serialNumber} />
          <Row label="Signature algorithm" value={cert.signatureAlgorithm} />
          <Row
            label="Subject alternative names"
            value={
              cert.subjectAltNames.length > 0
                ? cert.subjectAltNames
                    .map((san) => `${san.kind.toUpperCase()}:${san.value}`)
                    .join(', ')
                : '(none — this certificate speaks for no hostname)'
            }
            wide
          />
          <Row
            label="Basic constraints"
            value={`cA = ${cert.basicConstraints.ca}${
              cert.basicConstraints.pathLenConstraint === undefined
                ? ''
                : `, pathLenConstraint = ${cert.basicConstraints.pathLenConstraint}`
            }`}
          />
          <Row label="Key usage" value={cert.keyUsage.join(', ') || '(none asserted)'} />
          <Row
            label="Extended key usage"
            value={cert.extendedKeyUsage.join(', ') || '(none asserted)'}
          />
          <Row
            label="Revocation"
            value={
              cert.revocation
                ? `${cert.revocation.status}${
                    cert.revocation.stapled ? ' (stapled by the server)' : ' (fetched)'
                  } · produced ${formatInstant(
                    cert.revocation.producedAt,
                  )}, next update ${formatInstant(cert.revocation.nextUpdate)}${
                    cert.revocation.reason ? ` · ${cert.revocation.reason}` : ''
                  }`
                : 'no status available'
            }
            wide
          />
          <Row label="SHA-256 fingerprint" value={cert.fingerprint} wide />
          {cert.tampered ? (
            <Row
              label="Integrity"
              value="Bytes altered after signing — the issuer signature does not verify."
              wide
            />
          ) : null}
        </dl>
      ) : null}
    </li>
  );
}

function Row({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-fg-muted text-[0.5625rem] tracking-wide uppercase">{label}</dt>
      <dd className="text-fg-secondary font-mono text-[0.5625rem] break-all">{value}</dd>
    </div>
  );
}

export function CertificateChain({
  chain,
  validation,
  store,
  absentReason,
  className,
}: CertificateChainProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!validation || !chain) {
    return (
      <Panel title="Certificate chain" className={className}>
        <p className="text-fg-secondary text-[0.6875rem] leading-snug">
          {absentReason ??
            'No certificate was presented on this connection. A resumed handshake authenticates with the pre-shared key from the ticket instead — the server proves it is the same server by proving it holds a secret only the previous, certificate-authenticated handshake could have produced.'}
        </p>
      </Panel>
    );
  }

  const failure = primaryFailure(validation);
  // The path when one was built, else the presented chain, so a run that never reached a
  // trusted root still draws what the server actually sent.
  const shown = validation.path.length > 0 ? validation.path : chain.presented;

  return (
    <Panel
      title="Certificate chain and validation"
      aside={
        <Badge tone={validation.trusted ? 'ok' : 'error'}>
          {validation.trusted
            ? 'trusted'
            : `${validation.failures.length} of 5 checks failed`}
        </Badge>
      }
      scroll
      className={cn('max-h-[46rem]', className)}
    >
      <div className="flex flex-col gap-3">
        <p className="text-fg-secondary text-[0.6875rem] leading-snug">
          The client asked for{' '}
          <span className="text-fg font-mono">{validation.host}</span> and judged the
          chain as of{' '}
          <span className="text-fg font-mono">{formatInstant(validation.at)}</span>{' '}
          against the <span className="text-fg">{store.name}</span> ({store.roots.length}{' '}
          root{store.roots.length === 1 ? '' : 's'}).
        </p>

        {failure ? (
          <div className="border-state-error/50 bg-state-error/10 rounded-lg border px-2.5 py-2">
            <h3 className="text-state-error text-xs font-medium">
              This is the warning the browser would show
            </h3>
            {failure.browserError ? (
              <p className="text-state-error mt-0.5 font-mono text-[0.625rem]">
                {failure.browserError}
              </p>
            ) : null}
            <p className="text-fg-secondary mt-1 text-[0.625rem] leading-snug">
              {failure.userFacing ?? failure.detail}
            </p>
            <p className="text-fg-muted mt-1 text-[0.5625rem] leading-snug">
              A browser shows one interstitial even when several checks fail, and it shows
              the first failure in validation order. The other verdicts are all still
              below.
            </p>
          </div>
        ) : null}

        <section aria-labelledby="cert-checks">
          <h3
            id="cert-checks"
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            Five checks, each independent
          </h3>
          <ol className="mt-1.5 flex flex-col gap-1.5">
            {validation.steps.map((step) => (
              <StepRow key={step.id} step={step} />
            ))}
          </ol>
        </section>

        <section aria-labelledby="cert-path">
          <h3
            id="cert-path"
            className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase"
          >
            The path, leaf first
          </h3>
          <ol className="mt-1.5 flex flex-col gap-1.5">
            {shown.map((cert, index) => (
              <CertificateCard
                key={cert.id}
                cert={cert}
                role={roleOf(cert, index, shown.length, validation.anchor?.id)}
                validatedAt={validation.at}
                expanded={expanded === cert.id}
                onToggle={() => setExpanded(expanded === cert.id ? null : cert.id)}
              />
            ))}
          </ol>

          {validation.anchor ? (
            <p className="text-fg-muted mt-1.5 text-[0.5625rem] leading-snug">
              The root above came from your trust store, not from the wire. A server may
              send its root and many do, but the client ignores that copy — otherwise
              anyone could append a self-signed root and vouch for themselves.
            </p>
          ) : (
            <p className="text-state-error mt-1.5 text-[0.5625rem] leading-snug">
              No path to a trusted root exists, so there is no anchor to draw. The chain
              above is only what the server presented.
            </p>
          )}
        </section>
      </div>
    </Panel>
  );
}
