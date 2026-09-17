/**
 * What the browser suites share: the Stage's selectors, the layout checks, preferences,
 * and the module contract. Specs import from here, so a renamed button is one edit.
 */

export { clickableNode, nodes, scrollsSideways, STICKY_NAV_PX } from './layout';
export { moduleContract } from './modules';
export {
  playButton,
  playheadMs,
  playToEnd,
  playUntilEnded,
  setSpeed,
  transport,
  type PlaybackSpeedLabel,
} from './playback';
export { setPreferences } from './preferences';
