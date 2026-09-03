'use client';

import type { ReactNode } from 'react';

import { Badge, Panel, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/cn';

import {
  describeFlags,
  displayName,
  rdataText,
  RR_TYPE_NOTES,
  type DnsMessage,
  type Rcode,
  type ResourceRecord,
} from '../sim/records';

/**
 * One DNS message, in the three sections it actually has.
 *
 * The section structure is not presentation -- it is the teaching point. A referral and
 * an answer are the same message with the records in different boxes, and until you have
 * seen that you have not understood what a root server does. So the sections are always
 * all three, always in wire order, and an empty one says why it is empty rather than
 * disappearing:
 *
 * - **Answer** -- what you asked for. Empty on a referral, which is the whole story.
 * - **Authority** -- who to ask instead (the NS records of the child zone), or, on a
 *   negative reply, the SOA whose MINIMUM decides how long "no" may be remembered.
 * - **Additional** -- glue: the addresses of the nameservers just named, because a
 *   delegation to a server inside the zone being delegated is unfollowable without them.
 *
 * The header strip above them carries the fields people quote at each other and rarely
 * see: the transaction id that matches a reply to its question, the flag letters, and the
 * three section counts. AA is the flag worth watching -- it is set by the server that
 * holds the zone, and clear on every referral and every cached answer. The RCODE is in
 * the badge rather than the strip, because it is the one field a reader looks for first
 * and printing it twice would only invite the question of which one is authoritative.
 */

export interface RecordTableProps {
  /** The message to show. Query or response; the header says which. */
  message: DnsMessage;
  /** Panel heading -- usually the rung's own label. */
  title: string;
  /** A sentence under the heading: the resolver's note about this exchange. */
  note?: string;
  /** Right-aligned header slot, for the transport or an RFC citation. */
  aside?: ReactNode;
  className?: string;
}

/** NOERROR is not success and NXDOMAIN is not an error; both are answers. */
const RCODE_TONES: Readonly<Record<Rcode, BadgeTone>> = {
  NOERROR: 'ok',
  NXDOMAIN: 'error',
  SERVFAIL: 'error',
  REFUSED: 'error',
  FORMERR: 'error',
  NOTIMP: 'warn',
};

interface SectionSpec {
  readonly key: 'answer' | 'authority' | 'additional';
  readonly title: string;
  /** What it means that this section is empty -- shown instead of a blank row. */
  readonly empty: string;
}

const SECTIONS: readonly SectionSpec[] = [
  {
    key: 'answer',
    title: 'Answer',
    empty:
      'Empty. Nothing here answered the question — on a referral that is correct, and the authority section says who to ask next.',
  },
  {
    key: 'authority',
    title: 'Authority',
    empty: 'Empty. Nobody was named to ask instead.',
  },
  {
    key: 'additional',
    title: 'Additional',
    empty: 'Empty. No glue was needed, or none could be supplied.',
  },
];

const HEADINGS = ['Name', 'TTL', 'Class', 'Type', 'Data'];

function RecordRows({ records }: { records: readonly ResourceRecord[] }) {
  return (
    <>
      {records.map((record, index) => (
        <tr
          key={`${record.name}:${record.type}:${index}`}
          className="border-border/40 border-t align-top"
        >
          <td className="text-fg px-2 py-1.5 font-mono break-all">
            {displayName(record.name)}
          </td>
          <td className="text-fg-muted px-2 py-1.5 text-right font-mono tabular-nums">
            {record.ttl}
          </td>
          <td className="text-fg-muted px-2 py-1.5 font-mono">{record.class}</td>
          <td className="px-2 py-1.5">
            <span className="text-accent font-mono" title={RR_TYPE_NOTES[record.type]}>
              {record.type}
            </span>
          </td>
          <td className="text-fg-secondary px-2 py-1.5 font-mono break-all">
            {rdataText(record.data)}
          </td>
        </tr>
      ))}
    </>
  );
}

function Section({
  spec,
  records,
}: {
  spec: SectionSpec;
  records: readonly ResourceRecord[];
}) {
  return (
    <div className="flex flex-col">
      <div className="bg-surface/60 border-border/60 flex items-baseline justify-between gap-2 border-t px-2 py-1.5">
        <h4 className="text-fg-secondary text-[0.6875rem] font-medium tracking-wider uppercase">
          {spec.title}
        </h4>
        <span className="text-fg-muted font-mono text-[0.625rem]">{records.length}</span>
      </div>

      {records.length === 0 ? (
        <p className="text-fg-muted px-2 py-2 text-[0.6875rem] leading-snug">
          {spec.empty}
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">{`${spec.title} section`}</caption>
          <thead>
            <tr className="text-fg-muted text-[0.625rem] tracking-wider uppercase">
              {HEADINGS.map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className={cn(
                    'px-2 pb-1 font-medium whitespace-nowrap',
                    heading === 'TTL' && 'text-right',
                  )}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <RecordRows records={records} />
          </tbody>
        </table>
      )}
    </div>
  );
}

/** One header field: the label people quote, and the value this message carries. */
function Field({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col" title={title}>
      <dt className="text-fg-muted text-[0.5625rem] tracking-widest uppercase">
        {label}
      </dt>
      <dd className="text-fg-secondary truncate font-mono text-[0.6875rem]">{value}</dd>
    </div>
  );
}

export function RecordTable({
  message,
  title,
  note,
  aside,
  className,
}: RecordTableProps) {
  const isResponse = message.flags.qr;
  const flags = describeFlags(message.flags);

  return (
    <Panel
      title={title}
      aside={
        aside ?? (
          <Badge tone={isResponse ? RCODE_TONES[message.rcode] : 'neutral'}>
            {isResponse ? message.rcode : 'Query'}
          </Badge>
        )
      }
      scroll
      flush
      className={cn('max-h-[26rem]', className)}
    >
      <div className="flex flex-col">
        {note ? (
          <p className="text-fg-secondary border-border/60 border-b px-3 py-2 text-xs leading-relaxed">
            {note}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-4">
          <Field
            label="ID"
            value={`0x${message.id.toString(16).padStart(4, '0')}`}
            title="The transaction id. A reply is matched to its question by this and the question itself — which is also why guessing it is the classic cache-poisoning attack."
          />
          <Field
            label="Flags"
            value={flags || '—'}
            title="QR: this is a reply. AA: it came from the zone itself. TC: truncated. RD: recursion desired. RA: recursion available. AD: validated. DO: signatures wanted."
          />
          <Field
            label="An/Ns/Ar"
            value={`${message.answer.length}/${message.authority.length}/${message.additional.length}`}
            title="The three section counts from the header. A referral is the one with a zero answer count and a non-zero authority count — the RCODE alone cannot tell you that."
          />
          <Field
            label="Size"
            value={`${message.sizeBytes} B`}
            title="Over 512 bytes a plain UDP reply is truncated and the query is re-sent over TCP, unless EDNS(0) raised the ceiling."
          />
        </dl>

        <div className="bg-surface/60 border-border/60 border-t px-2 py-1.5">
          <h4 className="text-fg-secondary text-[0.6875rem] font-medium tracking-wider uppercase">
            Question
          </h4>
        </div>
        <p className="text-fg px-2 py-1.5 font-mono text-xs break-all">
          {displayName(message.question.name)}{' '}
          <span className="text-fg-muted">{message.question.class}</span>{' '}
          <span className="text-accent">{message.question.type}</span>
        </p>

        {SECTIONS.map((spec) => (
          <Section key={spec.key} spec={spec} records={message[spec.key]} />
        ))}
      </div>
    </Panel>
  );
}
