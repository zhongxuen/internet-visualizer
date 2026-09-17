import {
  Building2,
  Laptop,
  Mail,
  RadioTower,
  Router,
  Waves,
  Wifi,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/cn';

/**
 * The home page's picture of the whole internet: six places, left to right, and an
 * envelope that travels out to the website and back (docs/implementation/uiux-spec.md
 * §5.4 "Places", §5.5 "Home").
 *
 * A server component with no client JavaScript and no React Flow. Everything that
 * moves is CSS: the `animate-hero-*` utilities in `src/styles/motion.css`, which is
 * where its keyframes live, like every other ambient loop in the shell.
 *
 * Three things it must stay true to:
 *
 *  1. **The words are the content, the motion is decoration.** The places and their
 *     captions are a real list, and the `<figcaption>` tells the whole journey in one
 *     sentence. The track, the envelope and the glows are `aria-hidden`.
 *  2. **Reduced motion gets a still picture, not a frozen frame.** Under the OS query or
 *     `data-motion="reduced"` (the `still:` variant in motion.css) the envelope is
 *     removed and every place shows its number, so the order survives without movement.
 *  3. **No horizontal scroll at 390px.** Below `md` the same six places stack as rows
 *     and the envelope travels down the line instead of across it.
 *
 * The envelope's travel is `transform` only: an inner box as long as the track moves by
 * `translate(100%)` of itself, which is exactly the track's length, so the loop never
 * touches layout. Rows and columns are equal-sized for the same reason -- evenly spaced
 * places are what let one linear keyframe pass each of them on time.
 */

interface Place {
  name: string;
  caption: string;
  icon: LucideIcon;
}

/** Left to right, and top to bottom on a phone. */
const PLACES: readonly Place[] = [
  { name: 'You', caption: 'Your laptop sends a message.', icon: Laptop },
  { name: 'Wi-Fi', caption: 'Radio waves carry it across the room.', icon: Wifi },
  { name: 'Home router', caption: 'It leaves your house here.', icon: Router },
  {
    name: 'Internet provider',
    caption: 'Your provider points it the right way.',
    icon: RadioTower,
  },
  { name: 'Ocean cable', caption: 'Light in glass crosses the sea.', icon: Waves },
  {
    name: "The website's data centre",
    caption: 'A computer reads it and replies.',
    icon: Building2,
  },
];

/**
 * The road between each pair of neighbours, drawn as itself (§5.4 "Roads"): the two
 * hops through the air are dotted, the cables are solid, and the long-distance glass is
 * the accent. Decorative, so colour is allowed to be one of two signals here.
 */
const ROADS: readonly string[] = [
  'border-dotted border-border-strong',
  'border-dotted border-border-strong',
  'border-solid border-border-strong',
  'border-solid border-accent/70',
  'border-solid border-accent/70',
];

/** Rows on a phone are this tall, so the vertical track can be measured in rem. */
const ROW = 'h-20 md:h-auto';

export interface HeroJourneyProps {
  className?: string;
}

export function HeroJourney({ className }: HeroJourneyProps) {
  const last = PLACES.length - 1;

  return (
    <figure
      className={cn(
        'border-border bg-surface-raised rounded-2xl border px-4 py-6 md:px-6 md:py-8',
        className,
      )}
    >
      <div className="relative">
        {/*
          The track. Horizontal from `md`: it runs from the centre of the first column to
          the centre of the last, level with the middle of the icons (size-12, so 1.5rem
          down). Vertical below `md`: from the middle of the first row's icon to the
          middle of the last, 1.5rem from the top of a 5rem row.
        */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute',
            'top-6 bottom-14 left-6 w-0',
            'md:top-6 md:right-[calc(100%/12)] md:bottom-auto md:left-[calc(100%/12)] md:h-0 md:w-auto',
          )}
        >
          <div className="flex h-full w-full flex-col md:flex-row">
            {ROADS.map((road, index) => (
              <span
                key={index}
                className={cn(
                  '-ml-px flex-1 border-l-2 md:-mt-px md:ml-0 md:border-t-2 md:border-l-0',
                  road,
                )}
              />
            ))}
          </div>

          {/* Two tracks for one envelope: only the one for this layout is displayed. */}
          <Envelope axis="y" className="md:hidden" />
          <Envelope axis="x" className="hidden md:block" />
        </div>

        <ol className="relative grid grid-cols-1 md:grid-cols-6 md:gap-3">
          {PLACES.map((place, index) => (
            <li
              key={place.name}
              className={cn(
                'flex items-start gap-4 md:flex-col md:items-center md:gap-3 md:text-center',
                ROW,
              )}
            >
              <PlaceIcon
                place={place}
                number={index + 1}
                glow={index === last ? 'arrive' : index === 0 ? 'return' : undefined}
              />
              <div className="min-w-0 pt-1 md:pt-0">
                <p className="text-fg text-sm font-medium">{place.name}</p>
                <p className="text-fg-muted mt-0.5 text-sm leading-snug">
                  {place.caption}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <figcaption className="text-fg-secondary border-border mt-6 border-t pt-4 text-sm leading-relaxed">
        Your message leaves your laptop, crosses the room over Wi-Fi, goes out through
        your home router to your internet provider, and travels along a cable under the
        ocean to the website&rsquo;s data centre. The reply comes back the same way.
      </figcaption>
    </figure>
  );
}

interface PlaceIconProps {
  place: Place;
  number: number;
  /** Which end of the loop lights this place up, if either. */
  glow?: 'arrive' | 'return';
}

function PlaceIcon({ place, number, glow }: PlaceIconProps) {
  const Icon = place.icon;

  return (
    <span className="relative inline-flex shrink-0">
      <span
        aria-hidden="true"
        className="border-border-strong bg-surface-overlay text-fg-secondary relative z-10 inline-flex size-12 items-center justify-center rounded-full border"
      >
        <Icon className="size-6" strokeWidth={1.75} />
        {glow ? (
          <span
            className={cn(
              'border-accent absolute -inset-1 rounded-full border-2 opacity-0',
              glow === 'arrive' ? 'animate-hero-arrive' : 'animate-hero-return',
            )}
          />
        ) : null}
      </span>
      {/*
        The still picture's numbers. Hidden while the envelope moves, because then the
        movement is what shows the order; shown under reduced motion, where nothing does.
        Read out in both cases through the list's own order, so this stays decorative.
      */}
      <span
        aria-hidden="true"
        className="bg-accent text-accent-ink text-caption still:inline-flex absolute -top-1 -right-1 z-20 hidden size-5 items-center justify-center rounded-full font-semibold"
      >
        {number}
      </span>
    </span>
  );
}

interface EnvelopeProps {
  axis: 'x' | 'y';
  className?: string;
}

function Envelope({ axis, className }: EnvelopeProps) {
  return (
    <div className={cn('absolute inset-0', className)}>
      {/*
        As long as the track on its own axis, so `translate(100%)` in the keyframe is the
        whole distance from the first place to the last.
      */}
      <div
        className={cn(
          'absolute top-0 left-0',
          // On this box rather than the one above, whose `display` is already the layout's.
          'still:hidden will-change-transform',
          axis === 'x' ? 'animate-hero-travel-x w-full' : 'animate-hero-travel-y h-full',
        )}
      >
        <span className="bg-accent text-accent-ink absolute top-0 left-0 z-20 inline-flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md shadow-lg">
          <Mail className="size-4" strokeWidth={2.25} />
        </span>
      </div>
    </div>
  );
}
