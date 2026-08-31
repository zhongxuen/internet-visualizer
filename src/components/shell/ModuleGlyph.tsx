import type { CSSProperties, ReactElement } from 'react';

import { cn } from '@/lib/cn';

/**
 * The idle animation on a module card (step 5): a small looping diagram that hints at
 * what the module shows before you open it.
 *
 * Two constraints shaped these:
 *
 *  1. **Decorative only.** Every glyph is `aria-hidden` and every card states its
 *     subject in text. Nothing here is the sole carrier of any meaning, so none of it
 *     needs to survive being stopped — which matters because reduced motion parks all
 *     of these on their first frame (see `globals.css`).
 *  2. **Accent and muted only.** The OSI layer palette in `@/lib/theme` means one
 *     specific thing product-wide; spending those hues on decoration would dilute it.
 *
 * Animation comes from the shared `animate-idle-*` utilities in `src/styles/motion.css`.
 * A glyph never defines a keyframe of its own.
 */
export type GlyphVariant =
  'graph' | 'path' | 'resolve' | 'exchange' | 'handshake' | 'stream' | 'ping' | 'lesson';

export interface ModuleGlyphProps {
  variant?: GlyphVariant;
  className?: string;
}

const VIEW_BOX = '0 0 72 36';

/**
 * Custom properties are how a glyph parameterises a shared keyframe. React types
 * `style` as `CSSProperties`, which has no room for them, so they are set through
 * this one helper rather than casting at a dozen call sites.
 */
function vars(properties: Record<string, string>): CSSProperties {
  return properties as CSSProperties;
}

/** Distance the travelling element covers, read by `idle-trace` / `idle-shuttle`. */
function traceStyle(distance: number, delay = 0): CSSProperties {
  return vars({ '--idle-distance': `${distance}px`, animationDelay: `${delay}ms` });
}

const NODE = 'fill-surface-overlay stroke-border';
const LINK = 'stroke-border';
const LIVE = 'fill-accent';

function Graph() {
  return (
    <>
      <path className={LINK} d="M12 26 L30 10 L52 18 L62 8" strokeWidth={1.25} />
      <path className={LINK} d="M12 26 L52 18" strokeWidth={1.25} />
      {[
        [12, 26],
        [30, 10],
        [52, 18],
        [62, 8],
      ].map(([cx, cy], index) => (
        <circle
          key={`${cx}-${cy}`}
          className={cn(NODE, 'animate-idle-pulse')}
          style={{ animationDelay: `${index * 400}ms` }}
          cx={cx}
          cy={cy}
          r={3.5}
          strokeWidth={1.25}
        />
      ))}
      <circle
        className={cn(LIVE, 'animate-idle-trace')}
        style={traceStyle(40)}
        cx={12}
        cy={26}
        r={2}
      />
    </>
  );
}

function Path() {
  return (
    <>
      <path className={LINK} d="M10 18 H62" strokeWidth={1.25} />
      {[10, 26, 46, 62].map((cx) => (
        <circle key={cx} className={NODE} cx={cx} cy={18} r={3.5} strokeWidth={1.25} />
      ))}
      <rect
        className={cn(LIVE, 'animate-idle-trace')}
        style={traceStyle(52)}
        x={7}
        y={15}
        width={6}
        height={6}
        rx={1.5}
      />
    </>
  );
}

function Resolve() {
  return (
    <>
      <path
        className={LINK}
        d="M12 18 H30 M30 18 V7 H50 M30 18 V29 H50"
        strokeWidth={1.25}
      />
      <path className={LINK} d="M30 18 H50" strokeWidth={1.25} />
      <circle className={NODE} cx={12} cy={18} r={3.5} strokeWidth={1.25} />
      {[7, 18, 29].map((cy, index) => (
        <rect
          key={cy}
          className={cn(NODE, 'animate-idle-pulse')}
          style={{ animationDelay: `${index * 500}ms` }}
          x={50}
          y={cy - 4}
          width={12}
          height={8}
          rx={2}
          strokeWidth={1.25}
        />
      ))}
    </>
  );
}

function Exchange() {
  return (
    <>
      <rect
        className={NODE}
        x={6}
        y={8}
        width={10}
        height={20}
        rx={2}
        strokeWidth={1.25}
      />
      <rect
        className={NODE}
        x={56}
        y={8}
        width={10}
        height={20}
        rx={2}
        strokeWidth={1.25}
      />
      <path className={LINK} d="M18 13 H54 M18 23 H54" strokeWidth={1.25} />
      <circle
        className={cn(LIVE, 'animate-idle-shuttle')}
        style={traceStyle(34)}
        cx={20}
        cy={13}
        r={2}
      />
      <circle
        className={cn('fill-accent-strong animate-idle-shuttle')}
        style={traceStyle(-34, 400)}
        cx={52}
        cy={23}
        r={2}
      />
    </>
  );
}

function Handshake() {
  return (
    <>
      <circle
        className="stroke-accent animate-idle-ring fill-none"
        style={{ transformOrigin: '36px 18px' }}
        cx={36}
        cy={18}
        r={12}
        strokeWidth={1.25}
      />
      <rect
        className={NODE}
        x={28}
        y={16}
        width={16}
        height={12}
        rx={2.5}
        strokeWidth={1.25}
      />
      <path
        className="stroke-accent fill-none"
        d="M31.5 16 v-3.5 a4.5 4.5 0 0 1 9 0 V16"
        strokeWidth={1.5}
      />
    </>
  );
}

function Stream() {
  return (
    <>
      <rect
        className={NODE}
        x={6}
        y={10}
        width={9}
        height={16}
        rx={2}
        strokeWidth={1.25}
      />
      <rect
        className={NODE}
        x={57}
        y={10}
        width={9}
        height={16}
        rx={2}
        strokeWidth={1.25}
      />
      <path
        className="stroke-accent animate-idle-flow"
        style={vars({ '--idle-dashoffset': '-12' })}
        d="M17 14 H55"
        strokeWidth={1.5}
        strokeDasharray="4 8"
      />
      <path
        className="stroke-accent animate-idle-flow"
        style={vars({ '--idle-dashoffset': '12' })}
        d="M17 22 H55"
        strokeWidth={1.5}
        strokeDasharray="4 8"
      />
    </>
  );
}

function Ping() {
  return (
    <>
      {[0, 900].map((delay) => (
        <circle
          key={delay}
          className="stroke-accent animate-idle-ring fill-none"
          style={{ transformOrigin: '20px 18px', animationDelay: `${delay}ms` }}
          cx={20}
          cy={18}
          r={9}
          strokeWidth={1.25}
        />
      ))}
      <circle className={LIVE} cx={20} cy={18} r={3} />
      <path className={LINK} d="M32 18 H58" strokeWidth={1.25} strokeDasharray="3 4" />
      <circle className={NODE} cx={62} cy={18} r={3.5} strokeWidth={1.25} />
    </>
  );
}

function Lesson() {
  return (
    <>
      {[7, 16, 25].map((y, index) => (
        <g key={y}>
          <rect
            className="fill-surface-overlay stroke-border"
            x={10}
            y={y}
            width={52}
            height={5}
            rx={2.5}
            strokeWidth={1}
          />
          <rect
            className="fill-accent animate-idle-fill"
            style={{ transformOrigin: `10px ${y}px`, animationDelay: `${index * 600}ms` }}
            x={10}
            y={y}
            width={52}
            height={5}
            rx={2.5}
          />
        </g>
      ))}
    </>
  );
}

const GLYPHS: Record<GlyphVariant, () => ReactElement> = {
  graph: Graph,
  path: Path,
  resolve: Resolve,
  exchange: Exchange,
  handshake: Handshake,
  stream: Stream,
  ping: Ping,
  lesson: Lesson,
};

export function ModuleGlyph({ variant = 'path', className }: ModuleGlyphProps) {
  const Shape = GLYPHS[variant];

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={VIEW_BOX}
      role="presentation"
      className={cn('text-fg-muted h-9 w-18 overflow-visible fill-none', className)}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Shape />
    </svg>
  );
}
