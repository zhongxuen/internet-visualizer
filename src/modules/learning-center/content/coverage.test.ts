import { describe, expect, it } from 'vitest';

import { MODULES, SPEC_LEARNING_TOPICS } from '@/modules/registry';

import { LESSONS } from './lessons';
import { TRACKS } from './tracks';

/**
 * The acceptance criterion phase 13 turns on: **every learning topic listed in the
 * project spec appears in at least one lesson.**
 *
 * It is its own file rather than another `describe` in `content.test.ts` because it
 * asserts a different kind of thing. That suite checks the content model is internally
 * consistent -- no dangling slugs, no orphan lessons, no dead links -- all of which are
 * questions about this folder. This one checks the curriculum against something
 * outside it: the list of subjects the product promised to teach. A failure here does
 * not mean a file is wrong, it means something is not taught.
 *
 * `SPEC_LEARNING_TOPICS` is the committed copy of that list (the spec itself is
 * git-ignored -- see the note on the constant). The topics live on `LessonMeta` rather
 * than being scraped out of the MDX for two reasons: prose is not a reliable index of
 * what a lesson covers, and a lesson that merely *mentions* HTTPS should not be able to
 * satisfy a coverage requirement by accident.
 */

/** Every topic string any lesson claims, lowercased for comparison. */
const taught = new Map<string, string[]>();
for (const lesson of LESSONS) {
  for (const topic of lesson.topics) {
    const key = topic.toLowerCase();
    taught.set(key, [...(taught.get(key) ?? []), lesson.slug]);
  }
}

describe('curriculum coverage', () => {
  /** The criterion itself, one case per topic so a failure names the missing subject. */
  it.each(SPEC_LEARNING_TOPICS)('teaches %s in at least one lesson', (topic) => {
    const lessons = taught.get(topic.toLowerCase()) ?? [];
    expect(lessons, `no lesson lists the topic "${topic}"`).not.toHaveLength(0);
  });

  /**
   * The reverse direction, and the reason the assertion above cannot be satisfied by a
   * typo. `topics` is a free-form string array, so `'HTTPs'` or `'Web Sockets'` would
   * sail through everything else in the suite and quietly cover nothing.
   */
  it('invents no topic that no module also declares', () => {
    const known = new Set(
      [...MODULES.flatMap((m) => m.topics), ...SPEC_LEARNING_TOPICS].map((t) =>
        t.toLowerCase(),
      ),
    );

    for (const lesson of LESSONS) {
      for (const topic of lesson.topics) {
        expect(
          known.has(topic.toLowerCase()),
          `${lesson.slug} claims "${topic}", which no module teaches -- a typo, or a topic that needs adding to a registry entry`,
        ).toBe(true);
      }
    }
  });

  /**
   * Spelling, not just presence. `taught` compares case-insensitively so that a
   * mis-cased topic still *counts*, and this is what stops that leniency turning into
   * a licence: the strings a lesson and a module share have to be one string.
   */
  it('spells every spec topic exactly as the spec does', () => {
    const canonical = new Map(SPEC_LEARNING_TOPICS.map((t) => [t.toLowerCase(), t]));

    for (const lesson of LESSONS) {
      for (const topic of lesson.topics) {
        const expected = canonical.get(topic.toLowerCase());
        if (expected) expect(topic, lesson.slug).toBe(expected);
      }
    }
  });

  /**
   * Coverage is necessary and not sufficient. A curriculum that put all fourteen
   * topics on one enormous lesson would pass every assertion above, so the shape the
   * phase doc specifies -- seven tracks of four to eight lessons -- is asserted too.
   */
  it('keeps every track inside the 4-8 lesson budget', () => {
    expect(TRACKS).toHaveLength(7);

    for (const track of TRACKS) {
      expect(
        track.lessons.length,
        `${track.id} has ${track.lessons.length} lessons`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        track.lessons.length,
        `${track.id} has ${track.lessons.length} lessons`,
      ).toBeLessThanOrEqual(8);
    }
  });

  /**
   * The topics that are *not* required here, recorded so the omission is a decision
   * rather than an oversight. ICMP, Traceroute and WHOIS/RDAP belong to Network
   * Diagnostics, which is the one ready module that publishes no embeddable scenario
   * catalogue -- so a lesson on them could not meet the phase's own requirement of at
   * least one live `EmbeddedSim`. They are taught by the module itself, which every
   * relevant lesson links to.
   */
  it('records the module topics the spec does not require a lesson for', () => {
    const uncovered = [...new Set(MODULES.flatMap((m) => m.topics))]
      .filter((topic) => !taught.has(topic.toLowerCase()))
      .sort();

    expect(uncovered).toEqual(['ICMP', 'Traceroute', 'WHOIS/RDAP']);
    for (const topic of uncovered) {
      expect(SPEC_LEARNING_TOPICS, `${topic} is not a spec learning topic`).not.toContain(
        topic,
      );
    }
  });
});
