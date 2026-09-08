# Writing for Internet Visualizer

How to write an annotation, a log line, a phase description, and a lesson.

Almost all of this product's words are written in four places, and they are not
interchangeable. Getting the wrong kind of sentence into the wrong slot is the most
common way a screen ends up unreadable, so this file starts there.

## The four slots

| Slot                              | Where it lives                            | Length          | Job                                                    |
| --------------------------------- | ----------------------------------------- | --------------- | ------------------------------------------------------ |
| **Phase description**             | `{ kind: 'phase', title, description }`   | one sentence    | Name the chapter. What is about to happen, and why now. |
| **Log line**                      | `{ kind: 'log', level, text }`            | one clause      | Narrate. What just happened, in the order it happened.  |
| **Annotation**                    | `{ kind: 'annotate', text, reference? }`  | 40–90 words     | Teach. Why the thing on screen is the way it is.        |
| **Lesson prose**                  | `content/lessons/*.mdx`                   | ≤150 words per run | Connect. What all of this is for.                    |
| **Scenario `summary` / `teaches`**| a scenario file                            | one sentence / short phrases | Let a reader choose this run over another.  |

The annotation is where the teaching happens, and it is the one to get right. Measured
across the note and log text already written into the modules, the median is 61 words,
the ninetieth percentile is 85, and nothing is over 145 — so two to four sentences. If
yours is longer than that, it is doing a lesson's job in an annotation's slot.

## Tone

**Say the thing, then say why.** "AA is clear: the root server is not authoritative for
this name and is not pretending to be" is the shape. State the fact you can point at on
screen, then the consequence a learner could not have derived.

**Write to someone competent who has not seen this before.** Not to a beginner who needs
reassurance, and not to a peer who needs no explanation. No "simply", "just", "of course",
"obviously" — each one tells a reader who did not find it obvious that they are the
problem.

**Second person for what the reader does; third person for what the protocol does.** "Press
play to watch the resolver ask the root" — the reader presses, the resolver asks. Never
"we send a query": nobody in this product sends anything.

**No exclamation marks, no rhetorical questions, no jokes at the reader's expense.** A
learner who has just failed a quiz should not be met with cheerfulness.

**Never refer to position or colour.** "The node on the left" is wrong on a narrow screen
and meaningless to a screen reader; "the amber link" is meaningless in greyscale. Name the
thing: "the recursive resolver", "the satellite link". This is a hard rule, not a
preference — `tests/non-colour-signals.test.ts` enforces the same property in the UI, and
the prose has to hold it too.

**Never say "as you can see".** Half the audience for this text is a reader who has the
animation switched off. If the sentence only works alongside the picture, rewrite it so it
works alone.

## Naming things

**Use the protocol's own word, and use it every time.** A learner who meets "resolver" on
one screen and "DNS server" on the next has to work out whether those are the same thing.
`content/glossary.ts` is the list; `<Term>` links a word in a lesson to its entry.

**Never invent a name for something that has one.** If a concept has no standard name, say
what it does rather than coining a term the reader will not find anywhere else.

**Do not name a thing after what it resembles.** Live mode's reachability check is a TCP
connect plus an HTTP `HEAD`. It is *like* ping, and it is not ping, so it is labelled
_Reachability (TCP + HTTP timing)_ everywhere it appears. A learner who leaves believing
they ran a ping has been taught something false, which is worse than having been taught
nothing.

## When to cite an RFC

Attach an `RfcRef` when the annotation asserts something a reader might reasonably doubt,
or would want to look up:

- **a required behaviour** — "a router must discard a datagram whose TTL reaches zero",
- **an exact field or format** — header layouts, status-code meanings, attribute syntax,
- **a claim about what is or is not allowed** — "a wildcard matches only one label, and
  only in the leftmost position".

Do **not** cite one for:

- **arithmetic the reader can do** — "1500 − 20 − 20 = 1460" needs the MSS citation, not a
  citation for the subtraction,
- **operational practice** — anycast root servers, CDN behaviour, and what browsers
  actually do are real and are not in an RFC. Say "in practice" and mean it,
- **a design opinion** — "putting a token in the query string ends up in logs" is true and
  is advice, not a specification.

Cite the **section**, not just the document, unless the claim really is about the whole
thing. Quote the RFC's own title in `title`, because the UI shows it and a reader should be
able to search for it. Then add the RFC to a table in [`ACCURACY.md`](./ACCURACY.md) —
`tests/rfc-references.test.ts` fails if you do not.

## How to phrase a simplification honestly

Every model stops somewhere. The rule is that the reader finds out from the product, not
from reading the source. Four patterns, in order of preference:

**1. Name the gap and why it exists.**

> The download is `bytes × 8 / bandwidth`, which assumes the connection is already running
> at the link's capacity. A real connection starts at roughly ten segments and doubles each
> round trip, so the first ~14 KB arrives at one round trip's cost regardless of bandwidth.

**2. Mark the value, not just the paragraph.** Every fake cryptographic value in this
product is rendered with a `PLACEHOLDER-` prefix. A reader who lands on that screen without
reading anything else still cannot mistake it for output.

**3. Say what is missing rather than showing a plausible substitute.** The TCP checksum
renders as `0x0000 (not modelled)`. A computed-looking number that means nothing is worse
than an admission.

**4. Refuse to model it at all.** There is no live traceroute, because a serverless runtime
cannot send one, and a version that quietly fell back to the simulation would be exactly
the ambiguity the safety badges exist to remove.

What is not acceptable: a simplification that appears only in a source comment, only in
`ACCURACY.md`, or only in a tooltip nobody opens. If the gap changes what a reader would
conclude, it goes on the screen that could mislead them.

## Safety language

The product's one non-negotiable claim is that a reader always knows whether something
touched a real network. So:

- **Never write a global "nothing here contacts a real host".** It is false — Network
  Diagnostics' Live mode exists. Write the per-surface claim, or write the exception into
  the global one.
- **A simulated surface says so.** The `simulated` `SafetyBadge` is the standard way; prose
  beside it should be specific ("every zone, server and address here comes from a bundled
  fixture") rather than reassuring.
- **A live surface says what will happen before it happens.** Which URL, which method, who
  answers, and what the answer will *not* mean. `LiveDisclosure` is that, and its text
  comes from the same function that builds the request.
- **Never soften a refusal into a failure.** "Refused: the guard will not go there" is a
  different sentence from "could not connect", and conflating them teaches a learner that a
  policy decision is a network condition.

## Lessons

The mechanics are in `src/modules/learning-center/README.md`; this is the writing half.
`content/authoring.test.ts` enforces the shape, so these are checked, not suggested:

- **One `h1`, and it opens the file.** It is the lesson title.
- **At least one `<EmbeddedSim>`**, naming a scenario that really exists. It is the
  module's own run, never a copy — which is what makes a lesson unable to contradict the
  thing it teaches.
- **At least one `<Quiz>`.**
- **Three to five `<KeyTakeaways>`, last.** Nothing follows them.
- **No more than 150 words of continuous prose between two visual elements.** A heading
  does not count as a visual, so subheadings will not buy you room.

Beyond the shape:

**Open with the question, not the definition.** "You typed a name. Something has to turn it
into an address" beats "DNS is a hierarchical distributed naming system".

**One idea per lesson, and say which one at the top.** A lesson that teaches three things
teaches none of them; the track is what carries a sequence.

**Every quiz option explains itself, right and wrong alike.** A quiz that only says "wrong"
has taught nothing. The explanation for a wrong answer should say what would make it right,
because a plausible wrong answer is usually a true statement about something else.

**Assume the track above, and nothing from any other track.** Lessons within a track build;
tracks do not. That is what lets a reader start at track 4 because they came for cookies.

**Do not restate the diagram.** The embed already carries the scenario's summary, what it
teaches, and every phase of the run as text. Prose that narrates the animation is prose the
reader has already read.

## Before you commit

- [ ] The sentence works with the animation switched off.
- [ ] No colour, position, or "as you can see".
- [ ] Every term is the protocol's own, and matches the glossary.
- [ ] Every assertion is either cited, arithmetic, or explicitly "in practice".
- [ ] Every new RFC is in `ACCURACY.md`.
- [ ] Any gap in the model is visible on the screen that could mislead, not only here.
- [ ] Nothing implies a simulated surface is live, or a live surface is simulated.
- [ ] `npm test` — the authoring and RFC tests are the ones that will catch you.
