/**
 * The playback keyboard map -- one table, read by both the handler and the legend.
 *
 * The rule this file exists to enforce (docs/implementation/04-visualization-layer.md):
 * every module uses the *same* shortcuts, and every shortcut is discoverable. Those two
 * things drift apart the moment the key handler and the printed legend are written
 * separately, so `PLAYBACK_SHORTCUTS` is what `KeyboardLegend` renders and
 * `matchPlaybackKey` is what interprets a key press -- both derived from the list below.
 *
 * Pure and DOM-free: `matchPlaybackKey` takes the four fields it needs off a
 * `KeyboardEvent`, not the event itself, so the whole map is unit-testable without a
 * browser and reusable from a synthetic source (an on-screen keypad, a test).
 */

import { PLAYBACK_SPEEDS } from '@/core/sim/playback';

/** What a key press means. Mapped onto the playback store by `usePlaybackKeys`. */
export type PlaybackCommand =
  | { type: 'toggle' }
  /** One phase boundary, the coarse step. */
  | { type: 'step-phase'; direction: 1 | -1 }
  /** One event, the fine step. */
  | { type: 'step-event'; direction: 1 | -1 }
  | { type: 'jump'; to: 'start' | 'end' }
  | { type: 'speed'; speed: number }
  | { type: 'replay-phase' };

export interface PlaybackShortcut {
  /**
   * The key caps to print. Each inner array is one chord (`['Shift', '→']`); several
   * chords in a row are alternatives and are printed separated by a slash.
   */
  chords: string[][];
  /** What it does, in the words the legend prints. */
  action: string;
}

/** The full map, in the order the legend lists it. */
export const PLAYBACK_SHORTCUTS: readonly PlaybackShortcut[] = [
  { chords: [['Space']], action: 'Play or pause' },
  { chords: [['→'], ['←']], action: 'Step forward or back one phase' },
  {
    chords: [
      ['Shift', '→'],
      ['Shift', '←'],
    ],
    action: 'Step forward or back one event',
  },
  { chords: [['Home'], ['End']], action: 'Jump to the start or the end' },
  {
    chords: [['1'], ['2'], ['3'], ['4'], ['5']],
    action: 'Speed 0.25x, 0.5x, 1x, 2x, 4x',
  },
  { chords: [['.']], action: 'Replay the current phase' },
];

/** The parts of a `KeyboardEvent` the map reads. */
export interface KeyChord {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** `'1'`..`'5'` select the five speeds in `PLAYBACK_SPEEDS` order. */
const SPEED_KEYS = PLAYBACK_SPEEDS.map((_, index) => String(index + 1));

/**
 * The command a key press means, or `null` if it means nothing here.
 *
 * Any modifier other than `Shift` disqualifies the press outright: `Ctrl` + `→` is a
 * word jump, `Cmd` + `←` is browser history, and a visualization has no business
 * shadowing either.
 */
export function matchPlaybackKey(event: KeyChord): PlaybackCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const direction = event.shiftKey ? 'step-event' : 'step-phase';

  switch (event.key) {
    // `' '` in every current browser; `'Spacebar'` is the legacy IE/Edge spelling and
    // costs one comparison to keep working.
    case ' ':
    case 'Spacebar':
      return { type: 'toggle' };
    case 'ArrowRight':
      return { type: direction, direction: 1 };
    case 'ArrowLeft':
      return { type: direction, direction: -1 };
    case 'Home':
      return { type: 'jump', to: 'start' };
    case 'End':
      return { type: 'jump', to: 'end' };
    case '.':
      return { type: 'replay-phase' };
    default:
      break;
  }

  const speedIndex = SPEED_KEYS.indexOf(event.key);
  return speedIndex === -1 ? null : { type: 'speed', speed: PLAYBACK_SPEEDS[speedIndex] };
}

/** Elements the browser already activates with `Space`. */
const SPACE_ACTIVATES = new Set(['button', 'a', 'summary', 'label', 'option']);

/**
 * Should this command be left to the element the key press landed on?
 *
 * Three collisions to avoid, all of them cases where the focused element already owns
 * the key and stealing it would either do the wrong thing or do two things at once:
 *
 * - **Text entry** owns every printable key. Nothing in the map applies inside one.
 * - **The scrubber** is a native range input: its arrow keys and `Home`/`End` already
 *   move the playhead, so those are left to it while `Space` and the speed digits still
 *   work from inside it.
 * - **Buttons and links** are activated by `Space`. A viewer pressing `Space` on the
 *   focused "collapse the log" button means that button, not play/pause.
 */
export function shouldIgnoreKey(
  target: EventTarget | null,
  command: PlaybackCommand,
): boolean {
  if (!(target instanceof Element)) return false;

  const tag = target.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  // The attribute as well as the property: `isContentEditable` is a rendering-time
  // computation that jsdom does not implement, and this has to hold in tests too.
  if (target.getAttribute('contenteditable') === 'true') return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;

  if (tag === 'input') {
    if ((target as HTMLInputElement).type !== 'range') return true;
    return (
      command.type === 'step-phase' ||
      command.type === 'step-event' ||
      command.type === 'jump'
    );
  }

  if (command.type !== 'toggle') return false;
  return SPACE_ACTIVATES.has(tag) || target.getAttribute('role') === 'button';
}
