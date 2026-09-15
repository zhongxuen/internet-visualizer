# Writing for Internet Visualizer

How to write an annotation, a log line, a phase description, and a lesson, and the plain
voice that sits beside each of them.

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
| **Plain story**                   | `plain`, `plainLabel`, `plainRole`, `story`, `question`, `plainSummary` — beside the technical slot on the same object | phase ≤ 30 words, annotation ≤ 40, packet ≤ 6, scenario title ≤ 6 | Tell a beginner what is happening now, in their words. Sits on top of the technical slot, never in place of it. |

The annotation is where the teaching happens, and it is the one to get right. Measured
across the note and log text already written into the modules, the median is 61 words,
the ninetieth percentile is 85, and nothing is over 145 — so two to four sentences. If
yours is longer than that, it is doing a lesson's job in an annotation's slot.

## The plain voice

The product speaks in two voices, and every surface that has a technical slot gets a
**plain** one beside it. Plain comes first on screen; the technical text is one click
underneath, and is what **Full detail** shows. Neither replaces the other: the technical
slot stays exactly as precise as it is, keeps its RFC citation, and is never shortened to
make room. Plain words go in the plain field.

| Surface      | Technical slot                    | Plain slot                                      | Plain rules                                   |
| ------------ | --------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| Phase        | `title`, `description`            | `plain`                                         | ≤ 30 words, one idea, present tense           |
| Annotation   | `text` + `reference`              | `plain` (optional)                              | ≤ 40 words                                    |
| Packet (PDU) | `summary` ("TCP SYN 49152 -> 443") | `plainLabel`                                   | ≤ 6 words, what the packet is *for*           |
| Machine      | the kind's `description`          | `plainRole` (per node, or per kind by default)  | one line, plus an optional analogy            |
| Scenario     | `title`, `summary`, `teaches`     | `story: { plainTitle, question, level }`        | title ≤ 6 words; the question ends in "?"     |
| Module       | `summary`, `topics`               | `question`, `plainSummary`, `level`             | `plainSummary` ≤ 30 words                     |

Rules for the plain voice:

- **Keep the real word, and gloss it on first use.** Write "your computer asks a helper
  called a *resolver*", not "your computer asks the phone book". The reader should leave
  knowing the word they will meet everywhere else, and the word links to its glossary
  entry.
- **An analogy is marked as one and is never a name.** See [Analogies](#analogies).
- **One idea per sentence, sentences under 20 words, no unexplained capitals.** Every
  acronym in plain text must resolve to a glossary entry; a test checks this
  (`docs/implementation/uiux-spec.md` §5.8).
- **Everything else in this file still holds.** No "simply" or "just". No colour or
  position. No "as you can see". No exclamation marks. Never soften a refusal. Never imply
  that a simulated surface is live.

Before and after:

| Where                     | Technical (today)                                                                 | Plain                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| DNS Explorer summary      | "Walk a domain lookup from stub resolver to root, TLD, and authoritative server." | "Websites have names, but computers need numbers. Watch your computer ask a chain of servers until one knows the number." |
| Packet Journey phase      | "SYN, SYN-ACK, ACK. Each end tells the other where its sequence numbers start…"   | "Before any data moves, your laptop and the server greet each other three times, so each knows the other is listening."   |
| DNS phase                 | "Nothing is cached, so this costs the full walk from the root. The stub resolver … sends one query with RD set…" | "Your computer has never looked up this name, so it asks a helper, the resolver, to find it from scratch." |
| Packet label              | "TCP SYN 49152 -> 443"                                                            | "Hello? (start a connection)"                                                                                              |
| Router                    | "Forwards packets between networks by IP address and decrements TTL."             | "Router: passes messages from one network to the next, like a sorting office."                                             |
| Packet Journey control    | "Link MTU — As authored — 1500 bytes"                                             | "Biggest packet this road allows (MTU): 1500 bytes, the story's setting"                                                  |
| DNS scenario              | "NXDOMAIN"                                                                        | "A name that doesn't exist"                                                                                                |

The technical column is not wrong, and it does not go away. It is what a reader sees after
switching on Full detail or opening "Technical details".

## Tone

**Say the thing, then say why.** "AA is clear: the root server is not authoritative for
this name and is not pretending to be" is the shape. State the fact you can point at on
screen, then the consequence a learner could not have derived.

**Write first for a complete beginner, and never down to them.** The primary reader is 14
or older, uses the web, apps and Wi-Fi every day, and has never been shown what the
Internet is made of. They have heard "IP address" and "Wi-Fi"; they have not heard "DNS",
"TCP", "packet", "TTL" or "TLS". They are often on a phone or a school Chromebook, may be
reading English as a second language, and give a page about ten seconds before leaving.
They learn by watching and poking, not by reading. New is not the same as slow: give them
the real words, one at a time, and trust them with the idea. The developer who switches on
Full detail and the practitioner who came for the header fields are still readers; the
technical slots are written for them and stay exactly as precise (see [The plain
voice](#the-plain-voice)). No "simply", "just", "of course", "obviously" — each one tells a
reader who did not find it obvious that they are the problem.

**Second person for what the reader does; third person for what the protocol does.** "Press
play to watch the resolver ask the root" — the reader presses, the resolver asks. Never
"we send a query": nobody in this product sends anything.

**No exclamation marks, no rhetorical questions, no jokes at the reader's expense.** A
learner who has just failed a quiz should not be met with cheerfulness. A module's or a
story's `question` is not rhetorical: it is the real question the run answers, and the
run answers it.

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

## Analogies

The Internet cannot be seen, so a beginner needs a picture to hold. An analogy gives them
one — on two conditions. **It is marked with "like", and it is always paired with the real
term.** "A router passes messages between networks, *like* a sorting office" teaches the
word *router* and hands the reader a picture for it.

That is the opposite of naming a thing after what it resembles, which stays forbidden (see
[Naming things](#naming-things)). "The sorting office forwards your message" puts the
resemblance where the name should be: the reader leaves with a word that appears nowhere
else, and believes the router *is* a sorting office, broken parts included. The analogy
sits beside the name and says "like"; the forbidden version replaces the name and says
"is". Labelling the reachability check "ping" fails for the same reason.

**These are the only analogies**, one per concept. Ten modules are written in parallel, and
ten sets of private metaphors would teach ten incompatible pictures. Drop an analogy the
moment a sentence leans on the part where it breaks — that column is for the author, not
the reader. A new row is added here on purpose, in its own change, never inside a module's
copy.

| Concept                 | Analogy                                                                                   | Where it breaks                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Packet                  | a parcel or envelope with an address label                                                | real packets are copied, not handed over; many can be lost          |
| Encapsulation           | envelopes inside envelopes                                                                | each "envelope" is opened and replaced at every hop (L2)            |
| IP address              | a street address                                                                          | addresses can be shared (NAT) or change (DHCP)                      |
| Port                    | a flat or apartment number at that address                                                | –                                                                   |
| Router                  | a sorting office passing parcels on                                                       | it forwards one hop at a time and never sees the whole route        |
| Switch                  | a building's internal mail room                                                           | –                                                                   |
| DNS resolver            | a helper who looks up numbers for you                                                     | it asks several others; it isn't one directory                      |
| DNS cache / any cache   | writing the answer down to reuse it                                                       | answers expire (TTL)                                                |
| TTL (IP)                | a hop counter that runs out                                                               | –                                                                   |
| TCP                     | recorded delivery: every piece is signed for                                              | –                                                                   |
| UDP                     | a postcard: sent, not tracked                                                             | –                                                                   |
| TLS / HTTPS             | a sealed envelope only the recipient can open                                             | the address on the outside stays readable (Observer view)           |
| Certificate             | an ID card signed by someone both sides trust                                             | –                                                                   |
| HTTP request / response | a written order and its reply                                                             | –                                                                   |
| Status code             | the stamp on the reply ("done", "moved", "not found")                                     | –                                                                   |
| CDN                     | a nearby warehouse holding copies                                                         | –                                                                   |
| Load balancer           | a receptionist sending you to a free desk                                                 | –                                                                   |
| NAT                     | one street address for a whole building, with a front desk that remembers who ordered what | –                                                                 |
| MTU                     | the height limit of a tunnel                                                              | –                                                                   |
| Firewall                | a guard at the door with a list of who may pass                                           | –                                                                   |
| API                     | a menu and a waiter                                                                       | –                                                                   |
| WebSocket vs HTTP       | a phone call left open vs posting letters                                                 | –                                                                   |

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
- [ ] The plain slot is filled wherever the technical one is.
- [ ] Every acronym in the plain slot is glossed, and resolves to a glossary entry.
- [ ] No colour, position, or "as you can see".
- [ ] Every term is the protocol's own, and matches the glossary.
- [ ] Every assertion is either cited, arithmetic, or explicitly "in practice".
- [ ] Every new RFC is in `ACCURACY.md`.
- [ ] Any gap in the model is visible on the screen that could mislead, not only here.
- [ ] Nothing implies a simulated surface is live, or a live surface is simulated.
- [ ] `npm test` — the authoring and RFC tests are the ones that will catch you.
