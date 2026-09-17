'use client';

import { ArrowRight, KeyRound, Mail } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { Popover } from '@/components/ui';
import type { DetailLevel } from '@/components/prefs';
import type { Topology } from '@/core/types/topology';

import { LINK_MEDIA, type LinkMediumToken } from './edges/media';
import { NODE_KINDS, type NodeKindToken } from './nodes/kinds';
import { NODE_STATE_LIST } from './nodes/state';
import { ZONE_KINDS } from './nodes/zones';

/**
 * The canvas's key: a "Key" popover in its corner (uiux-spec.md §5.4).
 *
 * Everything the diagram draws with a symbol is spelled out here in words: the places,
 * the kinds of machine, what a packet is, the kinds of link, and what each state looks
 * like. It lists only what *this* diagram contains -- a key with thirteen kinds of
 * machine for a map that has three is a second puzzle, not an answer to the first --
 * except the states, which any machine can reach during a run.
 *
 * The panel mounts its contents only while it is open (`Popover`), so a closed key adds
 * one button to the document and nothing else.
 */

export interface CanvasLegendProps {
  topology: Topology;
  detail: DetailLevel;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <p className="text-fg text-small font-semibold">{title}</p>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Row({ icon, name, text }: { icon: ReactNode; name: string; text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden="true"
        className="bg-surface-raised border-border text-fg-secondary flex size-7 shrink-0 items-center justify-center rounded-md border"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="text-fg block font-medium">{name}</span>
        <span className="text-fg-muted text-caption block">{text}</span>
      </span>
    </li>
  );
}

/** A short run of the medium's own stroke, so the key shows the line and not only its name. */
function StrokeSample({ token }: { token: LinkMediumToken }) {
  return (
    <svg aria-hidden="true" width="40" height="8" className="shrink-0">
      <line
        x1="0"
        y1="4"
        x2="40"
        y2="4"
        stroke="currentColor"
        strokeWidth={token.width}
        strokeDasharray={token.dash}
      />
    </svg>
  );
}

export function CanvasLegend({ topology, detail }: CanvasLegendProps) {
  const simple = detail === 'simple';

  const { zones, kinds, media } = useMemo(() => {
    const kindSet = new Set(topology.nodes.map((node) => node.kind));
    const mediumSet = new Set(topology.links.map((link) => link.medium));
    return {
      zones: topology.zones ?? [],
      kinds: Object.values(NODE_KINDS).filter((token) => kindSet.has(token.kind)),
      media: Object.values(LINK_MEDIA).filter((token) => mediumSet.has(token.medium)),
    };
  }, [topology]);

  const kindText = (token: NodeKindToken) =>
    simple ? token.plainRole : token.description;

  return (
    <Popover
      trigger={
        <>
          <KeyRound aria-hidden="true" className="size-4" strokeWidth={2} />
          Key
        </>
      }
      label="Key to the diagram"
      side="bottom"
      align="end"
      triggerVariant="secondary"
      triggerClassName="nodrag nopan shadow-lg"
      // Layout goes on the wrapper inside, never on the panel: a `display` class on the
      // panel beats the browser rule that hides a closed popover, and it would show empty.
      className="max-w-[min(22rem,calc(100vw_-_1rem))]"
    >
      <div className="flex flex-col gap-4">
        {zones.length > 0 ? (
          <Section title="Places">
            {zones.map((zone) => {
              const Icon = ZONE_KINDS[zone.kind].icon;
              return (
                <Row
                  key={zone.id}
                  icon={<Icon className="size-4" />}
                  name={zone.label}
                  text={
                    zone.plain ?? 'A place on the map. The machines inside it are there.'
                  }
                />
              );
            })}
          </Section>
        ) : null}

        <Section title="Machines">
          {kinds.map((token) => {
            const Icon = token.icon;
            return (
              <Row
                key={token.kind}
                icon={<Icon className="size-4" />}
                name={token.roleLabel}
                text={kindText(token)}
              />
            );
          })}
        </Section>

        <Section title="Packets">
          <li className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="border-accent bg-surface-raised text-fg flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5"
            >
              <ArrowRight className="size-3" />
              <Mail className="size-3" />
            </span>
            <span className="text-fg-muted text-caption">
              A packet is one small piece of a message, carried from machine to machine.
              Its label says what it is for, the arrow which way it is going, and its
              colour and L2&ndash;L7 tag which layer of the network it belongs to. Select
              one to look inside.
            </span>
          </li>
        </Section>

        {media.length > 0 ? (
          <Section title="Links">
            {media.map((token) => {
              const Icon = token.icon;
              return (
                <li key={token.medium} className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className="text-fg-secondary flex w-16 shrink-0 items-center gap-1.5 pt-1"
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <StrokeSample token={token} />
                  </span>
                  <span className="min-w-0">
                    <span className="text-fg block font-medium">{token.label}</span>
                    <span className="text-fg-muted text-caption block">
                      {token.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </Section>
        ) : null}

        <Section title="What the machines are doing">
          {NODE_STATE_LIST.map((token) => {
            const Icon = token.icon;
            return (
              <Row
                key={token.state}
                icon={<Icon className="size-4" />}
                name={simple ? token.plainLabel : token.label}
                text={token.description}
              />
            );
          })}
        </Section>
      </div>
    </Popover>
  );
}
