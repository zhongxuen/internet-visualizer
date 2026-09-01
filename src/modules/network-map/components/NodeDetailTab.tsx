'use client';

import { BookOpen, ExternalLink, Route } from 'lucide-react';

import { usePlaybackContext, type CanvasSelection } from '@/components/viz';
import { focusRing } from '@/components/ui/styles';
import {
  formatStandardRef,
  noteFor,
  type ScenarioTopology,
  type StandardRef,
} from '@/core/topologies';
import { cn } from '@/lib/cn';

import { tourStepFor, type GuidedTour } from '../tour';

/**
 * The Network Map's own section of the inspector.
 *
 * The shared `Inspector` answers *what* a machine is: its kind, its layer, its addresses,
 * what it is wired to. This answers *why it is here* -- the two or three sentences the
 * scenario wrote about it, and the document that says it has to behave that way. That
 * split is the reason the inspector has a module slot at all: the standard detail is the
 * same in every module, and the teaching is not.
 *
 * The citation is printed, not hidden behind a hover. It is what turns "the router
 * rewrites the port as well as the address" from something a website said into something
 * a learner can go and check, and RFCs are free and permanently addressable, so it is a
 * link. IEEE and ITU-T documents are not, so those are printed as plain text rather than
 * as a link that lands on a paywall.
 *
 * Rendered through `SimulationView`'s `inspectorExtra` slot, which only appears once
 * something is selected -- so there is no empty state to design here.
 */

export interface NodeDetailTabProps {
  scenario: ScenarioTopology;
  /** What the canvas has selected. */
  selection: CanvasSelection | null;
  tour: GuidedTour;
  className?: string;
}

function Citation({ reference }: { reference: StandardRef }) {
  const label = formatStandardRef(reference);

  return (
    <p className="text-fg-muted flex items-start gap-1.5 text-xs leading-snug">
      <BookOpen aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        {reference.url ? (
          <a
            href={reference.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'text-accent hover:text-accent-strong inline-flex items-center gap-1 rounded-sm font-medium underline underline-offset-2',
              focusRing,
            )}
          >
            {label}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : (
          <span className="text-fg-secondary font-medium">{label}</span>
        )}{' '}
        {reference.title}
      </span>
    </p>
  );
}

export function NodeDetailTab({
  scenario,
  selection,
  tour,
  className,
}: NodeDetailTabProps) {
  const store = usePlaybackContext();

  // A packet cannot be selected here: this module draws no traffic. Phase 06 is what
  // sends it across these same topologies.
  if (!selection || selection.type === 'pdu') return null;

  const note = noteFor(scenario, selection.id);
  const step = tourStepFor(tour, selection.id);

  if (!note && !step) return null;

  return (
    <section className={cn('border-border flex flex-col gap-2 border-t pt-3', className)}>
      <h3 className="text-fg-muted text-[0.625rem] font-medium tracking-widest uppercase">
        Why it is here
      </h3>

      {note ? (
        <>
          <p className="text-fg-secondary text-xs leading-relaxed">{note.text}</p>
          {note.reference ? <Citation reference={note.reference} /> : null}
        </>
      ) : (
        <p className="text-fg-muted text-xs leading-snug">
          This scenario has no note for this one.
        </p>
      )}

      {step ? (
        <button
          type="button"
          onClick={() => store.getState().seek(step.startMs)}
          className={cn(
            'border-border bg-surface hover:border-border-strong hover:bg-surface-overlay text-fg-secondary mt-1 flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
            focusRing,
          )}
        >
          <Route aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Go to this stop on the tour</span>
          <span className="text-fg-muted shrink-0 font-mono text-[0.6875rem]">
            {step.index + 1}/{tour.steps.length}
          </span>
        </button>
      ) : null}
    </section>
  );
}
