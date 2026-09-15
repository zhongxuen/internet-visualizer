# UI/UX restructure — design reference

The prompts, and the order to run them in, are in [uiux.md](./uiux.md). This file is what
they build against: a § number in a prompt means a section here.

Phases 01–14 built the product for "someone competent who has not seen this before"
(`docs/CONTENT-STYLE.md`). This restructure changes who it is for: a **complete
beginner**, someone who uses the Internet every day and has never been shown what it is
made of.

---

## 1. Goal

A beginner opens the site and within two clicks is watching their own message leave a
laptop, cross their home, their Internet provider and an ocean, reach a website's building,
and come back. They are told in plain words what is happening at every step. Every word
they don't know can be tapped and explained. Every screen shows them what to press next.

Nothing that exists today is lost. The technical depth, the RFC citations, the
determinism, the accessibility and the safety boundary all stay. They move one layer down,
behind a **Full detail** setting and "Technical details" disclosures, for the learners who
want them.

---

## 2. Who this is for

**Primary: the curious beginner.** Aged 14 and up. Uses the web, apps and Wi-Fi daily. Has
heard "IP address" and "Wi-Fi" and has never heard "DNS", "TCP", "packet", "TTL" or "TLS".
Is often on a phone or a school Chromebook. May be reading English as a second language.
Will give a page about ten seconds to show them something before leaving. Learns by
watching and poking, not by reading.

What they need from every screen:

1. **Something to look at that looks like a place,** not a diagram of boxes.
2. **One obvious thing to press.**
3. **One sentence at a time** that says what is happening now, in their words.
4. **A way to ask "what's that?"** about anything, without leaving the page.
5. **A way forward:** what to try next when a run ends.

**Secondary: the new developer or student** (bootcamp, first networking course). They
start in Simple view, switch to **Full detail** as they grow, and stay for the header
fields, the RFCs and the experiments.

**Tertiary: today's audience,** practitioners and cybersecurity learners. Full detail must
lose nothing they rely on now.

---

## 3. What is wrong today (the audit)

These findings come from four read-only audits of the code and from the screenshots in
`docs/media/`. The numbers are real and are re-measured at the end (§10).

### 3.1 Getting started

- **The home page has no starting point.** Its hero CTA goes to the most complex module
  (Internet Simulator: 8 scenarios, 4–5 panels). Below that, all ten modules sit in an
  equal grid. The Learning Center, which has the only guided sequence, is one card among
  ten (`src/app/page.tsx`).
- **The navigation is organised the way the code is.** It has Explore (8 items), Tools
  (1) and Learn (1). The glossary is not in it. Every item has a "Ready" status badge,
  which tells a user nothing now that all ten are ready. The motion toggle is labelled
  "Full". There is no mobile menu (`TopNav.tsx`, `MotionToggle.tsx`).
- **Missing entirely:** onboarding, search, and a settings panel. The only preference is
  motion, held in `sessionStorage`.

### 3.2 The module page

- **Play is buried.** It is a 36px icon-only button below a 26–32rem canvas and the
  timeline (`SimulationView.tsx`). At 1366×768 it is below the fold on every module. On
  mobile it is also below the Phases panel and the Inspector. Autoplay is off and nothing
  says "press this".
- **Everything is shown at once.** Before the diagram, HTTP Explorer has about 14 regions
  and 30 controls. DNS Explorer has about 20 controls and Packet Journey 9. Internet
  Simulator's 8 scenario buttons wrap to two rows.
- **The header costs about 300px:** a back link, the h1, the summary, two badges, and a
  row of topic chips. Under it is a second row of "teaches" chips, which are full
  sentences of up to 120 characters. Both rows look like buttons and are not.
- **The story is in small print.** A phase's description is 12px muted text in a side
  column. `PhaseAnnouncer` is screen-reader only, so sighted users never see it.
- **The event log is open by default** and lists the whole run, future included (822
  rows on one run).
- **The same pieces exist in several copies:** the scenario picker in five, the
  label-and-hint control shell in three, and on/off switches in three different styles.

### 3.3 The canvas

- **Long paths can't be read.** Layout places nodes in breadth-first columns in one row
  (`layout.ts`). Packet Journey's path is about 3,500 units wide, so it fits only near
  the 0.25 minimum zoom. Its 14px labels render at about 3.5px (see
  `docs/media/packet-journey.png`).
- **Node cards are overloaded.** Each shows a role in 10px capitals, an "Idle" chip (the
  usual state), a layer note such as "L7 Sends requests", and IPv4/IPv6/MAC addresses.
  Every link carries "3 ms · 1 Gb/s".
- **Packets are labelled by their outermost layer,** so nearly every packet on a LAN reads
  "L2 Ethernet". That says nothing about what the packet is for.
- **There is no sense of place.** Nothing shows a home, an ISP, an ocean or a data centre.
  The Internet is drawn as abstract boxes, and the imagination has nothing to hold.

### 3.4 Words

- **The copy assumes vocabulary.** Examples: "Walk a domain lookup from stub resolver to
  root, TLD, and authoritative server"; "SYN, SYN-ACK, ACK"; "TC and the retry over TCP
  when a response exceeds 512 bytes"; "As authored — 1500 bytes".
- **The glossary is out of reach.** It has 62 entries and a working `<Term>` tooltip, but
  only lesson MDX can use them. Modules cannot import the Learning Center.
- **The first lesson doesn't define its terms.** Track 1 lesson 1 uses "TTL", "DNS" and
  "TCP" in its quiz feedback without defining them.
- **Nothing gives a plain-language version.** `SimEvent`, `PhaseSummary`, `PDU` and
  `SimNode` have no field for one.

### 3.5 Components and tokens

- **Text is small.** About 818 font-size uses are 12px or smaller, against 133 at 14px or
  larger. 311 are 9–10px. There is no type-scale token to change them in one place.
- **Primitives are missing:** no Popover, Dialog, Drawer, Switch, Select or Field, so
  modules build their own. `Tooltip` opens on hover and focus only: it does nothing on
  tap and has no viewport collision handling.

### 3.6 What is good and must be kept

- Deterministic runs.
- The phase stepper and keyboard map.
- `TopologyList`, the route in that needs no canvas.
- Reduced motion.
- The safety badges and the Live-mode gate.
- Network Map's guided tour.
- HTTPS Explorer's Participant/Observer view.
- Internet Simulator's browser viewport.
- `EmbeddedSim`.
- Quizzes that explain every option.
- The honesty rules for simplifications.

The restructure builds on these rather than replacing them.

---

## 4. Design principles

Every prompt is checked against these eight rules.

1. **Show a place, not a diagram.** Machines live somewhere: your home, your provider, the
   ocean floor, a data centre. Draw that.
2. **One obvious next action.** Each screen has exactly one primary button, and it is
   visible without scrolling.
3. **One sentence at a time.** The current step is told in one plain sentence, large, next
   to the picture. Everything else waits until asked for.
4. **Plain first, precise underneath.** Every technical surface has a plain voice on top
   and the exact voice one click below. Neither replaces the other (§5.1).
5. **Every word is tappable.** Any term a beginner might not know opens a short definition
   where it stands (§5.6).
6. **Reveal by choice.** Options, raw headers, bit widths, logs and RFCs are behind "Full
   detail", "Experiment" and "Technical details". They are never removed, only folded.
7. **Every end is a beginning.** A finished run says what just happened and offers the
   next thing.
8. **Same thing, same look, everywhere.** One scenario picker, one control style, one
   analogy per concept (§5.1.1), and one word for each idea.

These don't replace the rules already in force: no meaning in colour alone, one h1, one
live region per view, the canvas never the only route in, nothing per-frame through React,
and the safety language. §6 lists them.

---

## 5. Decisions this plan commits to

### 5.1 Two voices: plain and technical

Every place the product speaks gets a **plain** slot beside the technical one it already
has. Plain text is written for §2's primary reader. The technical text stays exactly as
accurate as it is now, keeps its RFC citations, and is what **Full detail** shows.

| Surface | Technical slot (today) | New plain slot | Plain rules |
| --- | --- | --- | --- |
| Phase | `title`, `description` | `plain` | ≤ 30 words, one idea, present tense |
| Annotation | `text` + `reference` | `plain` (optional) | ≤ 40 words |
| Packet (PDU) | `summary` ("TCP SYN 49152 -> 443") | `plainLabel` | ≤ 6 words, what the packet is *for* |
| Machine | kind `description` | `plainRole` (per node, or per kind by default) | one line + optional analogy |
| Scenario | `title`, `summary`, `teaches` | `story: { plainTitle, question, level }` | title ≤ 6 words; question ends in "?" |
| Module | `summary`, `topics` | `question`, `plainSummary`, `level` | plainSummary ≤ 30 words |

Rules for plain text. `docs/CONTENT-STYLE.md` gains them in UX-0.1.

- **Keep the real word, and gloss it on first use.** Write "your computer asks a helper
  called a *resolver*". Don't write "your computer asks the phone book". The term links to
  the glossary (§5.6).
- **An analogy is marked as one and is never a name.** Write "A router passes messages
  between networks, like a sorting office." Never call a router "the sorting office". This
  keeps the existing rule, "do not name a thing after what it resembles".
- **One idea per sentence, sentences under 20 words, no unexplained capitals.** Every
  acronym in plain text must resolve to a glossary entry. A test checks this (§5.8).
- **Everything already in CONTENT-STYLE still holds.** No "simply" or "just". No colour or
  position. No "as you can see". No exclamation marks. Never soften a refusal. Never imply
  that a simulated surface is live.

Before and after:

| Where | Today | Plain |
| --- | --- | --- |
| DNS Explorer summary | "Walk a domain lookup from stub resolver to root, TLD, and authoritative server." | "Websites have names, but computers need numbers. Watch your computer ask a chain of servers until one knows the number." |
| Packet Journey phase | "SYN, SYN-ACK, ACK. Each end tells the other where its sequence numbers start…" | "Before any data moves, your laptop and the server greet each other three times, so each knows the other is listening." |
| DNS phase | "Nothing is cached, so this costs the full walk from the root. The stub resolver … sends one query with RD set…" | "Your computer has never looked up this name, so it asks a helper, the resolver, to find it from scratch." |
| Packet label | "TCP SYN 49152 -> 443" | "Hello? (start a connection)" |
| Router | "Forwards packets between networks by IP address and decrements TTL." | "Router: passes messages from one network to the next, like a sorting office." |
| Packet Journey control | "Link MTU — As authored — 1500 bytes" | "Biggest packet this road allows (MTU): 1500 bytes, the story's setting" |
| DNS scenario | "NXDOMAIN" | "A name that doesn't exist" |

#### 5.1.1 The shared analogy table

Ten module passes run in parallel (wave 3). If each invents its own metaphors, the product
teaches ten incompatible pictures. So **these are the only analogies**, one per concept.
Each is paired with its real term, and each is dropped the moment it would mislead. The
"where it breaks" column is for authors: if a sentence leans on the broken part, don't use
the analogy there.

| Concept | Analogy | Where it breaks |
| --- | --- | --- |
| Packet | a parcel or envelope with an address label | real packets are copied, not handed over; many can be lost |
| Encapsulation | envelopes inside envelopes | each "envelope" is opened and replaced at every hop (L2) |
| IP address | a street address | addresses can be shared (NAT) or change (DHCP) |
| Port | a flat or apartment number at that address | – |
| Router | a sorting office passing parcels on | it forwards one hop at a time and never sees the whole route |
| Switch | a building's internal mail room | – |
| DNS resolver | a helper who looks up numbers for you | it asks several others; it isn't one directory |
| DNS cache / any cache | writing the answer down to reuse it | answers expire (TTL) |
| TTL (IP) | a hop counter that runs out | – |
| TCP | recorded delivery: every piece is signed for | – |
| UDP | a postcard: sent, not tracked | – |
| TLS / HTTPS | a sealed envelope only the recipient can open | the address on the outside stays readable (Observer view) |
| Certificate | an ID card signed by someone both sides trust | – |
| HTTP request / response | a written order and its reply | – |
| Status code | the stamp on the reply ("done", "moved", "not found") | – |
| CDN | a nearby warehouse holding copies | – |
| Load balancer | a receptionist sending you to a free desk | – |
| NAT | one street address for a whole building, with a front desk that remembers who ordered what | – |
| MTU | the height limit of a tunnel | – |
| Firewall | a guard at the door with a list of who may pass | – |
| API | a menu and a waiter | – |
| WebSocket vs HTTP | a phone call left open vs posting letters | – |

A new analogy may be added to this table only in UX-0.1 or UX-4.3, never inside a module
pass.

### 5.2 Detail level: Simple (default) and Full detail

There is one global preference, `detail: 'simple' | 'full'`, defaulting to **Simple**. The
Settings menu labels it "Simple" and "Full detail". It is never called "beginner" or
"expert", because the product should not label the user. It decides how much each
surface shows:

| Surface | Simple (default) | Full detail |
| --- | --- | --- |
| Step caption and Steps list | `plain` (falls back to `description`) | `title` + `description` |
| Scenario picker | `plainTitle`, level, the question | `title`, `summary`, "What this run teaches" |
| Node card | icon, name, plain role; a state chip only when not idle | today's card: role, layer note, addresses, detail |
| Link | medium drawn by dash pattern and icon; latency and bandwidth on hover, focus or selection | latency · bandwidth pill always |
| Packet sprite | envelope + `plainLabel` | layer + protocol, as today |
| Details panel (was Inspector) | plain summary; "Technical details" closed | "Technical details" open |
| "Experiment" (module knobs) | closed | open |
| "Go deeper" tabs | all present; `advanced` tabs tagged | all present |
| Event log | closed; plain lines | closed; technical lines |
| Topic chips | "Words you'll meet" (glossary chips) | same |

**Rendering rule.** Simple mode must *unmount* what it hides, not `display:none` it. The
Packet Journey fps investigation in `CLAUDE.md` found that document size is what costs
frames. The canvas is client-only (`LazyCanvas`), so it reads the preference directly.
Server-rendered surfaces read it through `useSyncExternalStore`, whose server snapshot is
the default, so hydration never mismatches (§5.7). Keep panel heights stable between
modes, so a Full-detail user sees no layout shift after hydration. UX-4.4 measures CLS to
prove it.

### 5.3 The Stage: one layout for every module

`SimulationView` becomes **the Stage**. It keeps the same component, state model and
performance design, but has a new order and new slots.

Desktop (≥ lg), Packet Journey shown:

```
┌ Home / Explore / How data travels / Packet Journey ───────────────────────────────┐
│ Packet Journey                                     [Simulated]  Beginner · 10 min │
│ How does a message travel across the internet?                                     │
│ Words you'll meet: (packet) (router) (IP address) (TCP)                            │
├────────────────────────────────────────────────────────────────────────────────────┤
│ Story: [● Loading a web page] [A quick question] [Too big for the road] [More ▾] (?)│
├───────────────────────────────────────────────────────┬────────────────────────────┤
│ ┌ Your home ───────┐  ┌ Internet provider ┐  ┌ Website's data centre ┐ │ Steps     │
│ │ 💻 ── 📶 ── 🏠    │══│ 🗼 ── 🗼           │≈≈│ 🖥                     │ │ 1 ✓ Hello │
│ └──────────────────┘  └───────────────────┘  └───────────────────────┘ │ 2 ▶ Ask   │
│              ✉ Please send the page →                                  │ 3   Reply │
│ ┌────────────────────────────────────────────────────────────┐        │ 4   Bye   │
│ │ Step 2 of 4 · Your laptop asks the server for the page …   │        ├───────────┤
│ └────────────────────────────────────────────────────────────┘        │ Details   │
│                                        [Follow the action ◎] [Key ?]  │ Click …   │
├───────────────────────────────────────────────────────┴────────────────────────────┤
│ [◀ Back]  [ ▶  Play ]  [Next step ▶]   ● ● ○ ○   ━━━━━━━○──────   1x ▾   ☑ Pause after each step │
├────────────────────────────────────────────────────────────────────────────────────┤
│ ▸ What you'll learn            ▸ Experiment: message size, road limit, lost packets │
│ [ Envelopes inside envelopes ] [ Hop by hop ] [ Address swap (NAT) ]                │
│   …only the active tab is mounted…                                                  │
│ ▸ Everything that happened            ▸ The map as a list                           │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Mobile (< lg):

```
┌ ☰  Internet Visualizer    ⚙ ┐
│ Packet Journey    Beginner  │
│ How does a message travel…? │
│ Story [Loading a web page ▾](?)│
│ ┌─────────────────────────┐ │
│ │ canvas, 60svh           │ │
│ │ ✉ Please send the page  │ │
│ │ Step 2 of 4 · Your …    │ │
│ └─────────────────────────┘ │
│ [Steps] [Details] [Go deeper]│
│ …                           │
│▐ ◀ Back ▐  ▶ Play  ▐ Next ▶ ▐│ ← sticky while the stage is in view
└─────────────────────────────┘
```

Stage rules:

1. **Before the first play,** a large "▶ Watch it happen" button and the scenario's
   question sit over the canvas. They are absolutely positioned inside the canvas box, so
   they cause zero layout shift. The Play control is inside the first viewport at 1366×768
   and at 390×844.
2. **The step caption is the visible form of `PhaseAnnouncer`,** and it stays the view's
   one `aria-live` region.
3. **The transport bar** sits directly under the canvas and is sticky while the stage is in
   view. It has labelled Back, Play and Next step buttons, step dots with text ("Step 2 of
   4"), a speed menu, and "Pause after each step" (on by default in Simple mode). Primary
   buttons are ≥ 44px. The visible label is always inside the accessible name (WCAG 2.5.3).
4. **When the run ends,** an overlay titled "What just happened" appears: one line per step,
   plus Play again and Next story. It causes no layout shift and can be dismissed.
5. **"How to use this page"** is a "?" button and the `?` key. It opens a Dialog with three
   steps, the module's own lines, and the keyboard map.
6. **Below the stage, in order:** What you'll learn (Disclosure), Experiment (Disclosure),
   Go deeper (Tabs, mounting only the active tab), Everything that happened (the event log,
   closed, rows mounted only when open), and The map as a list (`TopologyList`).

### 5.4 Seeing the invisible: the canvas visual language

This part addresses the user's brief most directly: *the Internet can't be seen, so the
screen has to make it imaginable.*

| Idea | Visual | Where it's built |
| --- | --- | --- |
| **Places** | Nodes sit inside labelled **zones** with an icon: Your home, Your office, Internet provider (ISP), The internet, Nearby copy (CDN), The website's data centre, The cloud | `Topology.zones`, UX-2.5 |
| **Roads** | the link medium is drawn as itself: Wi-Fi waves, a copper line, a glowing fibre, an ocean-cable crossing, a satellite arc (dash pattern + icon; never colour alone) | `edges/media.ts`, UX-2.5 |
| **Things that travel** | a packet is an envelope labelled with its purpose ("Where is example.com?"); encapsulation is envelopes inside envelopes | `PDU.plainLabel`, `PacketSprite`, `PacketLayerStack`, UX-2.4/2.5 |
| **Distance and time** | every delay has a human scale: "12 ms — much quicker than a blink"; on fibre, "roughly 2,400 km of cable" (light in glass covers about 200 km per millisecond) | `core/text/humanScale.ts`, UX-1.3 |
| **Where am I** | the camera follows the action when the whole map would be unreadable; "Show whole map" gets the overview back | UX-2.5 |
| **Who is who** | one consistent illustrated icon per machine kind, at 32px, with the plain role under the name | `core/text/kinds.ts`, UX-1.3/2.5 |
| **What is happening now** | the machine doing something has a glow, an icon and a chip in words ("Working", "Active", "Problem"); idle machines are quiet | `nodes/state.ts`, UX-2.5 |

Any fibre distance or human-scale claim is a simplification. It gets a row in
`docs/ACCURACY.md` (UX-2.5), following the honesty rules in CONTENT-STYLE.

### 5.5 Information architecture

**Chapters replace groups.** The navigation and the home page organise modules by the
beginner's question, not by kind of code.

| Chapter | Question | Modules, in order |
| --- | --- | --- |
| `basics` — How data travels | How does data get from one place to another? | Network Map, Packet Journey |
| `websites` — Opening a website | What happens when I open a website? | Internet Simulator, DNS Explorer, HTTP Explorer, HTTPS Explorer |
| `apps` — Apps and servers | How do apps talk to servers? | API Visualizer, WebSocket Viewer |
| `tools` — Real tools | How do people check a network? | Network Diagnostics (the Live exception) |
| `learn` — Lessons | Where do I start? | Learning Center |

**Registry copy.** UX-1.3 writes this. Wording may change only if a test forces it.

| id | level | question | plainSummary | min |
| --- | --- | --- | --- | --- |
| network-map | beginner | What is a network made of? | See what's inside a network (laptops, phones, routers and cables) from one home to a whole data centre, and what each one does. | 8 |
| packet-journey | beginner | How does a message travel across the internet? | Follow one small piece of data from your laptop, through your router and your internet provider, to a website's server and back. | 10 |
| internet-simulator | beginner | What happens when you type a web address and press Enter? | Type a web address and watch every step your browser takes: finding the site, connecting, locking the line, and drawing the page. | 10 |
| dns-explorer | beginner | How does your computer find a website's address? | Websites have names, but computers need numbers. Watch your computer ask a chain of servers until one knows the number. | 8 |
| http-explorer | intermediate | What does your browser actually say to a website? | Read the real messages your browser and a website send each other: the request, the reply, and the notes attached to both. | 10 |
| https-explorer | intermediate | How does the padlock keep what you send private? | Watch your browser and a website agree on a secret, check the site's ID, and see what a snooper can and can't read. | 10 |
| api-visualizer | intermediate | How do apps ask servers for data? | Watch an app ask a server for data, prove who it is, and handle the answers, including the ones that say no. | 10 |
| websocket-viewer | advanced | How do chat apps get new messages instantly? | See how a chat app keeps a line open to the server, so a message arrives the moment it is sent. | 8 |
| network-diagnostics | intermediate | How do people check whether a website is reachable? | Learn the tools people use to test a connection: ping, traceroute, DNS lookup and WHOIS. Simulated unless you switch on Live mode. | 8 |
| learning-center | beginner | Where do I start? | Short lessons that explain one idea at a time, each with a simulation you can play. | – |

The Network Diagnostics sentence must keep naming the Live exception (CLAUDE.md,
"Documentation").

**Navigation** (UX-2.1):

```
◈ Internet Visualizer   Start here   Explore ▾   Lessons   Glossary          🔍   ⚙
```

- **Explore** opens a menu grouped by chapter. Each item shows the module's title, its
  question and its level. No status badges.
- **Start here** is `/start`, which redirects to the first lesson of the First steps track
  (§7.7).
- **Under md,** a menu button opens a Drawer containing the same items.

**Home** (UX-2.2):

```
How does the internet actually work?
Watch your message leave your laptop, cross the world, and come back.
[ ▶ Start here · 6 short steps ]     [ Type a website and watch → ]

┌ You 💻 ── Wi-Fi 📶 ── Home router 🏠 ── Internet provider 🗼 ≈ ocean cable ≈ Website 🖥 ┐
│            an envelope travels there and back, each place captioned                  │
└──────────────────────────────────────────────────────────────────────────────────────┘

Your path   ①───②───③───④───⑤───⑥     (ticks from lesson progress, client-only)

Explore by question
  How does data get from one place to another?   [Network Map] [Packet Journey]
  What happens when I open a website?            [Internet Simulator] [DNS] [HTTP] [HTTPS]
  How do apps talk to servers?                   [API Visualizer] [WebSocket Viewer]
  How do people check a network?                 [Network Diagnostics · can go live]
  Want it explained step by step?                [Learning Center]

Everything here runs in your browser, except Network Diagnostics' Live mode, which only
runs when you switch it on.
```

**Learning.** A new first track, **First steps** (§7.7), is the beginner path. It
reuses the lesson machinery rather than building a second onboarding system. Its lessons
embed the modules' own runs, so the path can't drift from what it teaches. Each track also
gets its own page, `/learn/[track]` (UX-3.10).

### 5.6 Glossary everywhere

- **The data moves to `src/core/glossary/`** (UX-1.3). It is plain data, which `src/core`
  may hold, and `components` and every module may import `core`. This is the one move that
  lets a module screen define a word without breaking boundary rule 2 (modules may not
  import each other).
- **`GlossaryTerm`** (UX-1.5) is a dotted-underline button that opens a Popover with the
  definition and a link to the glossary entry. It works by tap, click and keyboard. It
  imports only a compact term → short-definition index (`inline.ts`); the full entries
  stay on the glossary page. Budget: under 4 KB gzipped added to a module route.
- **`TermText`** links the first occurrence of each glossary term in a plain string. It
  is used in step captions, the Steps list, Details summaries and scenario questions. It
  is never used in log rows, which are too many to match text against.
- **The Learning Center's `<Term>`** becomes a thin wrapper, so lesson MDX doesn't change.

### 5.7 Preferences and type

- **One store, `iv:preferences`, in `localStorage`.** It holds `detail`, `motion` (system /
  full / reduced), `textSize` (normal / large), `pauseAtSteps`, `seenCoachMarks` and
  `lastVisited`. It never stores Live mode, which must reset on reload (Network
  Diagnostics invariant), and never stores anything personal.
- **A pre-paint inline script** sets `data-detail`, `data-motion` and `data-text-size` on
  `<html>` before first paint. The existing CSP already allows inline scripts. No host and
  no `unsafe-eval` may be added.
- **A Settings popover** (⚙) replaces the "Full" motion toggle.
- **Type floor and scale:** nothing below 12px anywhere, body text 16px, step caption 20px.
  "Large text" scales the root font size to 112.5%. Primary controls are ≥ 44px; the
  absolute floor for any target is 24px (WCAG 2.5.8).

### 5.8 Tests as ratchets, not as checklists

Following the repo's habit ("coverage is asserted, not assumed"), every new promise gets a
test:

- `tests/type-scale.test.ts`: no font size under 12px anywhere in `src` (UX-1.1).
- `src/core/text/plain.ts`: word counts, sentence length, and acronyms that must resolve
  to the glossary (UX-1.3). Each module's pass adds a per-module plain-language test
  (wave 3). UX-4.3 adds the cross-cutting one over every scenario, the way
  `tests/rfc-references.test.ts` already works.
- `tests/registry.test.ts` gains the new fields (tightened, never relaxed).
- `e2e/beginner.spec.ts` (UX-4.4) checks: Play is above the fold at two viewports,
  Simple is the default, the glossary popover works, and a new visitor reaches a playing
  simulation in two clicks or fewer.

---

## 6. Invariants that must survive

Every prompt is responsible for these. Any change that breaks one gets reverted, not
argued for.

**Safety**

- Exactly one module has `usesRealNetwork: true`. `tests/registry.test.ts` is only ever
  tightened.
- Network Diagnostics starts in Learn mode. Live mode needs the acknowledgement gate, lives
  only in component state, and is never persisted. The `live` badge shows whenever Live
  mode is active. There are exactly three live operations, and the reachability check is
  never called "ping". `LiveConsole` is not mounted in Learn mode.
  `src/app/api/diagnostics/**`, `src/core/net/**` and `live/client.ts` are not touched by
  this plan at all.
- `connect-src 'self'` stays and no host is added. There is no `unsafe-eval`. The one
  known zod CSP report stays exactly one.
- Every simulated input keeps its Simulated badge and its "never sent" sentence, which
  tests match by regex. The `fetch`-spy tests in DNS Explorer and HTTP Explorer are never
  relaxed.
- "Everything is simulated" is never written without naming the Live exception.

**Accessibility**

- One h1 per page, and no skipped heading levels.
- One `aria-live` region per view: the step caption *is* the `PhaseAnnouncer`.
- `TopologyList` stays, so the canvas is never the only route in.
- A `Panel` that scrolls keeps its tab stop. `.state-dim`, not opacity, is used for
  recession.
- No meaning in colour alone. `tests/non-colour-signals.test.ts` is tightened only.
- Every text token clears 4.5:1 and every border 3:1 (`tests/tokens-contrast.test.ts`),
  including new tokens.
- Reduced motion collapses tweening and never removes function. Autoplay stays off.
- New overlays and dialogs return focus, close on Escape, and trap focus only when modal.

**Performance**

- Nothing that changes per frame goes through React. Packet position stays on
  `FrameClock`, and camera moves happen only when `projectionKey` changes.
- `"sideEffects": ["*.css"]` stays. The canvas stays lazy, with a same-height placeholder.
- No new runtime dependency without `perf:bundles` before and after, reported in the
  prompt's result. The home route and lesson routes must not gain React Flow.
- Measure, don't reason (CLAUDE.md). Record every fps or KB change: a parallel prompt in
  `perf/uiux/ux-<id>.md`, which its wave's merge folds into `perf/uiux-baseline.md`;
  anything else in `perf/uiux-baseline.md` directly (§8.1). Restart `next start` after
  every build.

**Architecture**

- The three lint boundaries hold. `src/modules/registry.ts` keeps its exemption.
- Visualization stays separate from networking. Plain text is data emitted by a sim (the
  `plain` fields); how it is shown is the viz layer's business.
- A lesson embeds a module's own run and never a copy. The Learning Center contains no
  animation code.

**Content**

- Technical text is not shortened, deleted or made less precise. Scenario tests enforce
  minimum summary lengths and "teaches" counts; plain text goes in the new fields instead.
- Every RFC citation still resolves (`tests/rfc-references.test.ts`).
- Module-specific wording invariants stay:
  - Internet Simulator's waterfall uses Chrome's names verbatim.
  - HTTPS Explorer shows all five certificate checks and the `PLACEHOLDER-` notice.
  - API Visualizer shows `JWT_PAYLOAD_NOT_ENCRYPTED` above every decoded token, not in a
    disclosure.

---

## 7. Data contracts

Every prompt builds against these. They are additive. Nothing existing is renamed at the
type level.

### 7.1 `src/core/types/story.ts` (UX-1.3)

```ts
export type Level = 'beginner' | 'intermediate' | 'advanced';

/** The beginner-facing face of a scenario. Required on every scenario after its module's wave-3 pass. */
export interface StoryMeta {
  /** ≤ 6 words, no unglossed jargon. e.g. 'Visiting a site for the first time'. */
  plainTitle: string;
  /** The question this run answers, ending in '?', ≤ 16 words. */
  question: string;
  level: Level;
}
```

### 7.2 Additive fields on existing core types (UX-1.3)

```ts
// src/core/types/events.ts
| { kind: 'phase'; at: number; id: string; title: string; description: string; plain?: string }
| { kind: 'annotate'; at: number; targetId: string; text: string; reference?: RfcRef; plain?: string }

// src/core/sim/result.ts -- copied by summarizePhases
interface PhaseSummary { /* … */ plain?: string }

// src/core/types/pdu.ts
interface PDU { /* … */ plainLabel?: string } // ≤ 6 words: 'Hello? (start a connection)'

// src/core/types/topology.ts
type ZoneKind = 'home' | 'office' | 'isp' | 'internet' | 'cdn' | 'datacenter' | 'cloud';
interface TopologyZone { id: string; label: string; kind: ZoneKind; plain?: string }
interface SimNode { /* … */ plainRole?: string; zone?: string } // zone = TopologyZone.id
interface Topology { /* … */ zones?: TopologyZone[] }
```

- **`src/core/text/kinds.ts`** exports `PLAIN_KINDS: Record<NodeKind, { plainRole: string;
  analogy?: string }>`, using §5.1.1's analogies.
- **`src/core/text/humanScale.ts`** exports:
  - `describeDuration(ms)`: "much quicker than a blink", "about a blink", "under a
    second", "N seconds".
  - `describeSize(bytes)`: a plain comparison plus the exact number.
  - `fibreDistanceKm(ms)`: about 200 km per ms, labelled "roughly".
- **`src/core/text/plain.ts`** exports `wordCount`, `sentences`,
  `findUnglossedJargon(text)` and `checkPlainStory(text, { maxWords = 30 })`.

### 7.3 Registry (UX-1.3)

```ts
export type ModuleChapter = 'basics' | 'websites' | 'apps' | 'tools' | 'learn';
export interface ModuleChapterMeta { key: ModuleChapter; label: string; question: string }
export const MODULE_CHAPTERS: readonly ModuleChapterMeta[]; // §5.5, in that order

export interface ModuleMeta {
  // …existing fields unchanged (group stays until UX-4.3)…
  question: string;
  plainSummary: string;
  level: Level;
  chapter: ModuleChapter;
  minutes?: number;
}
```

### 7.4 The Stage contract (UX-2.3 builds it; wave 3 consumes it)

```ts
// src/components/viz/stage.ts
export interface StoryOption {
  id: string;
  title: string;                    // technical title (existing)
  summary: string;                  // existing
  teaches?: readonly string[];      // existing
  story?: StoryMeta;                // §7.1
  group?: string;                   // e.g. 'When things go wrong'
}
export interface StoriesProp {
  options: readonly StoryOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  label?: string;                   // default 'Story'; Diagnostics uses 'Network'
}
export interface DeeperTab {
  id: string;
  title: string;                    // plain title with the term, e.g. 'Address swap (NAT)'
  hint?: string;                    // one plain line shown at the top of the tab
  level?: Level;                    // 'advanced' tabs are tagged and ordered last
  render: () => ReactNode;          // called only while the tab is active
}

// SimulationViewProps gains (all optional):
stories?: StoriesProp;
input?: ReactNode;                  // the typed input that IS the module (DNS name, URL bar, diagnostics target)
experiment?: ReactNode;             // knobs, inside the "Experiment" disclosure
deeper?: readonly DeeperTab[];
help?: readonly string[];           // module lines for "How to use this page"
/** @deprecated removed in UX-4.3 */ controlPanel?: ReactNode;
/** @deprecated removed in UX-4.3 */ footer?: ReactNode;

// hooks
useScenarioParam(ids: readonly string[], defaultId: string): [string, (id: string) => void]; // ?scenario=
useDetail(): 'simple' | 'full';     // from src/components/prefs
```

Panel components keep their prop signatures, and changes to them are additive only.
`SimulationView` (UX-2.3), the panels (UX-2.4) and the canvas (UX-2.5) are built in
parallel against these signatures.

### 7.5 Preferences (UX-1.4)

```ts
interface Preferences {
  version: 1;
  detail: 'simple' | 'full';
  motion: 'system' | 'full' | 'reduced';
  textSize: 'normal' | 'large';
  pauseAtSteps: boolean | null; // null = follow detail (on in simple, off in full)
  seenCoachMarks: boolean;
  lastVisited?: string;         // a module route; nothing else
}
// localStorage key 'iv:preferences'; bad or missing data → defaults; a server render always uses defaults.
```

### 7.6 Glossary layout (UX-1.3)

```
src/core/glossary/
  terms.ts            # the 62 entries, moved from learning-center/content/glossary.ts
  extra/<module-id>.ts  # ten files, each exporting an empty array to start
  index.ts            # merges terms + all ten extras; unique terms/aliases asserted by test
  lookup.ts           # lookupTerm (case- and alias-insensitive), moved
  inline.ts           # term/alias → { slug, term, short }: the only thing popovers import
```

During wave 3, a module adds glossary entries **only** to its own `extra/<module-id>.ts`.
That is what lets ten module passes run in parallel without conflicting.

### 7.7 The First steps track (UX-2.6)

Track id `first-steps`, title "First steps", level `beginner`, listed first. `/start`
redirects to lesson 1.

| # | slug | title | embeds (module / scenario) |
| --- | --- | --- | --- |
| 1 | `what-happens-when-you-open-a-website` | What happens when you open a website? | internet-simulator / first-visit-https |
| 2 | `your-devices-are-on-a-network` | Your devices are on a network | network-map / home-lan |
| 3 | `messages-travel-in-packets` | Messages travel in small packets | packet-journey / tcp-web-request |
| 4 | `finding-a-websites-address` | Finding a website's address | dns-explorer / cold-cache |
| 5 | `asking-for-the-page` | Asking for the page | http-explorer / simple-get |
| 6 | `keeping-it-private` | Keeping it private with HTTPS | https-explorer / tls13-fresh |

---

## 8. Execution rules

### 8.1 File ownership

A prompt edits **only** the files in its row. If it needs a change outside them, it
stops and lists the change under "Needs from other prompts" in its report instead of
making it. The next merge prompt or wave picks it up.

Three things every prompt may touch beyond its row:

- **Its own perf notes.** A parallel prompt writes its measurements to
  `perf/uiux/ux-<id>.md` (e.g. `perf/uiux/ux-2.3.md`), never to `perf/uiux-baseline.md`:
  ten branches appending to one file would conflict at every merge. The merge prompt folds
  those notes into `perf/uiux-baseline.md`. Alone prompts write the baseline file
  directly.
- **An assertion on copy it changed on purpose** (§8.3 rule 3), in a test file outside its
  row. Test files only, never another prompt's source, and each one is listed in the
  report.
- **Nothing in `e2e/` during wave 2 except by its owner.** UX-2.3 splits
  `e2e/modules.spec.ts` in that wave, so an edit to the old file from another branch is a
  conflict with a deleted file. UX-2.4 and UX-2.5 list the e2e selectors they break under
  "Needs from other prompts", and UX-W2 applies them to the split files.

**Wave 0**

| Prompt | Owns |
| --- | --- |
| 0.1 | `docs/CONTENT-STYLE.md`; `CLAUDE.md` ("UI philosophy" only); `docs/implementation/00-overview.md` |
| 0.2 | `scripts/uiux-screens.mjs` (new); `package.json` (the `uiux:screens` script only); `.gitignore`; `perf/uiux-baseline.md` (new) |

**Wave 1**

| Prompt | Owns |
| --- | --- |
| 1.1 | `src/styles/*`; `src/app/globals.css`; the Tailwind theme; `ui/Button.tsx`, `ui/Badge.tsx`, `ui/Kbd.tsx`; the sub-12px codemod across `src/` (excluding 1.2's files); `tests/type-scale.test.ts`; `tests/tokens-contrast.test.ts` |
| 1.2 | new files in `src/components/ui/`; `ui/Tooltip.tsx`; `ui/index.ts` |
| 1.3 | `src/core/types/*`; `src/core/sim/result.ts`; `src/core/text/*` (new); `src/core/glossary/*` (new); `src/modules/registry.ts`; `tests/registry.test.ts`; the Learning Center's glossary import sites and `content/glossary.ts` (removed) |
| 1.4 | `src/components/prefs/*` (new); `src/components/motion/*`; `src/app/layout.tsx` (script and `<html>` attributes only); `src/core/sim/playback.ts`; `src/components/viz/hooks/usePlayback.ts` |
| 1.5 | `src/components/glossary/*` (new); `learning-center/components/Term.tsx`; the glossary page's anchors |

**Wave 2**

| Prompt | Owns |
| --- | --- |
| 2.1 | `components/shell/{TopNav, MobileNav*, SettingsMenu*, MotionToggle (delete), ModuleChrome, RouteError, SafetyBadge (copy only), SkipLink}`; `app/layout.tsx` (nav/footer markup); `app/error.tsx`, `app/global-error.tsx`, `app/(modules)/error.tsx`, `app/learn/error.tsx`; the `/start` redirect; `e2e/smoke.spec.ts`, `e2e/a11y.spec.ts` |
| 2.2 | `app/page.tsx`, `app/not-found.tsx`; `components/shell/{ModuleCard, ModuleGrid, ModuleGlyph, HeroJourney*, StartPath*, QuickStart*}`; `src/styles/motion.css` |
| 2.3 | `components/viz/{SimulationView, stage.ts*, StoryPicker*, StepCaption*, PhaseAnnouncer, PlaybackControls, Timeline, KeyboardLegend, keymap, StartOverlay*, RunRecap*, StageHelp*, useScenarioParam*, hooks/*}`; `components/shell/ModuleSkeleton`; `app/(modules)/loading.tsx`; `learning-center/components/EmbeddedSim.tsx` (compatibility only); `e2e/modules/**` (created by splitting `e2e/modules.spec.ts`); `e2e/a11y-manual.spec.ts`; `e2e/helpers/*` |
| 2.4 | `components/viz/{PhaseStepper, Inspector, PacketLayerStack, HeaderTable, EventLog, TopologyList, events.ts}` |
| 2.5 | `components/viz/{SimulationCanvas, LazyCanvas, nodes/**, edges/**, PacketSprite, packetPath, packetSelection, layout, graph, display, CanvasLegend*, CameraToggle*}`; `src/core/topologies/*` (zones and `plainRole`); `tests/non-colour-signals.test.ts`; `tests/setup.ts` (only if `LazyCanvas` export names change); one `docs/ACCURACY.md` row |
| 2.6 | `learning-center/content/{tracks.ts, lessons.ts, lessons/*.mdx (new files only)}`; `core/glossary/extra/learning-center.ts`; `src/modules/scenarios.ts` (optional `story` passthrough); the Learning Center's track and navigation tests |

`*` marks a new file. Two files are touched by two prompts, and each is a one-line
conflict the merge prompt resolves: `components/shell/index.ts` (2.1 and 2.2 both add
exports) and `app/layout.tsx` (1.4 in wave 1, 2.1 in wave 2, so different waves).

**Wave 3.** Prompt 3.x owns:

- `src/modules/<id>/**`;
- `src/app/(modules)/<route>/page.tsx`;
- `src/core/glossary/extra/<id>.ts`;
- `e2e/modules/<id>.spec.ts`.

Four prompts own a little more, or less:

- **3.1** also owns `src/core/topologies/*` in this wave. Network Map's four scenarios
  *are* the shared `ScenarioTopology` objects there, so their `story`, the tour notes'
  `plain`, and the optional fields that need (`story?` on `ScenarioTopology`, `plain?` on
  `TeachingNote`, in `types.ts`) are all written there.
- **3.2** composes its topology from `HOME_LAN` and `ISP_PATH` in
  `packet-journey/scenarios/topology.ts`. Zones and `plainRole` for that composed
  topology go in that file; `src/core/topologies/*` belongs to 3.1.
- **3.10** also owns `app/learn/**`, `src/app/sitemap.ts` and `e2e/routes.ts` (for track
  pages).
- **3.9** owns nothing under `src/app/api/` or `src/core/net/`.

**Wave 4**

| Prompt | Owns |
| --- | --- |
| 4.1 | `components/viz/CoachMarks*`; `components/viz/{SimulationView, StageHelp}` (mounting coach marks, reopening them, setting `lastVisited`); `app/page.tsx` (the Continue section); `app/(modules)/_components/*`; every `app/(modules)/<route>/page.tsx` (one line to render `KeepGoing`); `e2e/onboarding.spec.ts`* |
| 4.2 | `components/search/*`; `components/shell/TopNav` (the search slot only) and `components/shell/index.ts`; the search index in `app/` (e.g. `app/_search/*`); `e2e/search.spec.ts`* |

4.3 and 4.4 run alone and may touch anything their prompt names.

### 8.2 Merge order and wave gates

**Merge order within a wave** (it keeps conflicts in the files that are easiest to
resolve):

- **Wave 0:** 0.1 → 0.2.
- **Wave 1:** 1.3 → 1.2 → 1.4 → 1.1. The codemod goes last because it touches the most
  lines.
- **Wave 2:** 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6.
- **Wave 3:** 3.1 → 3.9 in any order, then 3.10 last, because its track pages link to
  every module.
- **Wave 4:** 4.1 → 4.2.

**The wave gate** must be green before the next step starts. It is CI's own sequence plus
the UX checks, run from the main checkout with nothing else listening on port 3100:

```bash
npm ci && npm run lint && npm run build && npm run typecheck && npm run format:check \
  && npm run test:coverage && npm run test:e2e
npx next start --port 3100 &      # a fresh server for the fresh build (CLAUDE.md says why)
npm run uiux:screens -- wave-<n>  # <n> is the wave; compare against .uiux/baseline
npm run perf:bundles
ROUTES=/,/network-map,/packet-journey,/dns-explorer,/http-explorer,/https-explorer,/api-visualizer,/websocket-viewer,/internet-simulator,/network-diagnostics \
  npm run perf:vitals             # perf/vitals.mjs measures only three routes by default
```

Append the `perf:bundles` and `perf:vitals` output to `perf/uiux-baseline.md` under a
heading for the step. Stop the server afterwards.

A wave that makes `perf:bundles` or `perf:vitals` worse than baseline (beyond the ±0.5 fps
noise on Packet Journey) does not pass the gate until the regression is explained and
accepted, or fixed.

### 8.3 Rules every prompt follows

1. Read `CLAUDE.md`, this file's §4–§7, and the README of every folder you edit before
   writing code. `CLAUDE.md` also points at `md-files/internet-visualizer.md`; it is
   git-ignored, so a worktree doesn't have it. `uiux.md`, this file and `CLAUDE.md` are
   enough.
2. Edit only the files you own (§8.1).
3. When copy that a test pins changes on purpose, change the assertion in the same commit.
   List every changed assertion in your report with a reason. Never delete or weaken a
   test in `tests/registry.test.ts`, `tests/security-headers.test.ts`,
   `e2e/security.spec.ts`, the `fetch`-spy tests, Network Diagnostics' mode tests,
   `tokens-contrast`, `non-colour-signals`, or the a11y specs. Where possible, replace a
   hard-coded string assertion with one that reads the data (the scenario's own
   `story.plainTitle`), so the next copy edit doesn't break it.
4. Plain words go in the new plain fields. Don't shorten or delete technical text (§6
   Content).
5. Unit tests that need Full detail wrap the component with the test helper from UX-1.4.
   E2E tests set preferences with the helper from UX-2.3. Jsdom and a fresh browser both
   default to Simple.
6. No new runtime dependency without `perf:bundles` before and after.
7. **Use only your port** (the prompt's first line). Playwright reuses whatever server
   already answers on its port, so on a shared port it silently tests another worktree's
   build. With port `P`:
   - `npx next start --port P`, restarted after every build;
   - `PLAYWRIGHT_PORT=P npx playwright test <specs>`;
   - `PLAYWRIGHT_PORT=P npm run uiux:screens -- <label>`;
   - `BASE=http://127.0.0.1:P ROUTES=<routes> npm run perf:vitals`.
   `npm run perf:bundles` reads `.next` and needs no port. Stop your servers before you
   finish.
8. In a fresh worktree, run `npm ci` and then `npm run build` once before anything else:
   the build generates the route types `npm run typecheck` needs.
9. Verify with `npm run lint && npm run typecheck && npm test`, plus the e2e specs for the
   routes you touched.
10. Commit on the current branch, as `uiux(<id>): <what>`. Don't create, switch or merge
    branches; the run sheet in `uiux.md` has already put you on the right one (a
    worktree's `uiux/<id>`, or `main`). End your report with three lists: files changed, assertions
    changed (with why), and any "Needs from other prompts". Put the same three lists in
    the body of your last commit message: the merge prompt runs in another session and
    reads them from `git log`, not from your report.

---

## 9. The module pass checklist

Every wave-3 prompt does all of it.

1. **Stories.** Every scenario gets `story: StoryMeta` (§7.1). Make the module's scenario
   type require it.
2. **Phases.** Every phase event gets `plain`, and `checkPlainStory` finds nothing wrong.
   Add annotation `plain` wherever the technical text is the only explanation of
   something a beginner would click.
3. **Packets.** Every PDU gets a `plainLabel` of six words or fewer, saying what it is
   *for*.
4. **Topology.** Give the module's own topologies zones, and `plainRole` wherever the
   kind's default doesn't fit the story.
5. **Stage slots.** Move to the new slots:
   - replace the inline picker with `stories`;
   - put the module's typed input in `input`;
   - put the knobs in `experiment`, built from ui Field / Switch / Select /
     SegmentedControl;
   - put the footer panels in `deeper` tabs, beginner-first, each with a one-line `hint`;
   - delete the module's private Control shell and picker;
   - stop using `controlPanel` and `footer`.
6. **Words.** Every visible label, heading and hint in the module becomes plain wording.
   Keep the technical term in parentheses, or as a `GlossaryTerm`. Jargon inside
   Experiment and Go deeper is fine, but gloss it on first use in each panel. Add glossary
   entries only to `src/core/glossary/extra/<id>.ts`, and use only §5.1.1's analogies.
7. **Density.** Re-lay out the dense panels for the 12px floor, since the UX-1.1 codemod
   left them cramped. No horizontal scroll at 390 wide.
8. **Help.** Add two or three module-specific `help` lines.
9. **Tests.** Add a module plain-language test covering every scenario:
   - the story is present;
   - every phase's `plain` passes `checkPlainStory`;
   - every PDU has a `plainLabel`.
   Update string assertions per §8.3 rule 3, keep every safety and `fetch`-spy test, and
   update `e2e/modules/<id>.spec.ts`.
10. **README.** Describe the new layout. Every invariant the README lists still holds; if
    one had to change, stop and report it rather than editing the README to fit.
11. **Check.** Build, start `npx next start --port <your port>`, and run
    `PLAYWRIGHT_PORT=<your port> npm run uiux:screens -- ux-3-<id>`:
    - Play is inside the first viewport at both sizes;
    - in Simple mode, no more than 6 interactive controls sit above the canvas.
    Measure perf:vitals for the route
    (`BASE=http://127.0.0.1:<your port> ROUTES=<your route> npm run perf:vitals`) and
    write the result to `perf/uiux/ux-3.<n>.md`.

---

## 10. Acceptance criteria (the whole restructure)

Automated items are asserted in `e2e/beginner.spec.ts`, `tests/plain-language.test.ts`,
`tests/type-scale.test.ts` and `tests/registry.test.ts`.

**Getting started**

- [ ] A first-time visitor reaches a playing simulation from `/` in two clicks or fewer.
- [ ] `/start` leads to First steps lesson 1. The home page shows the six-step path.
- [ ] Every nav destination is reachable from a phone-width Drawer.

**The Stage**

- [ ] On every module at 1366×768 and 390×844, Play is inside the first viewport.
- [ ] In Simple mode, no more than 6 interactive controls sit above the canvas.
- [ ] Every module has "How to use this page", a start overlay, a run recap, and "Pause
      after each step" (on by default in Simple mode).
- [ ] At default zoom, every canvas node label renders at 12px or larger. Long paths
      follow the action; "Show whole map" works.

**Words**

- [ ] Every scenario has `story`. Every phase has `plain`, and `checkPlainStory` finds
      nothing wrong. Every PDU has a `plainLabel`. Every module has `question`,
      `plainSummary` and `level`.
- [ ] Every acronym in plain text resolves to a glossary entry. `GlossaryTerm` works by
      tap, click and keyboard on module pages and in lessons.
- [ ] The only analogies in the product are in §5.1.1.

**Look and feel**

- [ ] No text renders below 12px. Body text is 16px and the step caption 20px. "Large
      text" works.
- [ ] Primary controls are at least 44px, and every target at least 24px.
- [ ] Simple is the default. Full detail shows everything the pre-restructure UI showed:
      no technical content was lost. Compare against the baseline screenshots.

**Unchanged guarantees**

- [ ] Every invariant in §6 holds. The full CI sequence is green, with no
      `continue-on-error`.
- [ ] axe finds zero serious or critical violations on every route. There is one h1 and
      one live region per view.
- [ ] No module route's first-load JS grows by more than 10 KB gzipped against baseline,
      and the home and lesson routes carry no React Flow. LCP and CLS still pass.
      `/packet-journey` fps is no worse than baseline, and is recorded.

---

## 11. Check it with real beginners

Tests prove the promises were kept. Only people prove the promises were the right ones.
After UX-4.4, run this with three to five people who match §2's primary reader: a
teenager, a relative, a non-technical friend.

**Setup.** Use their own phone or laptop, a fresh browser profile, and the production URL.
Say "think out loud", and don't help.

| # | Task (read aloud) | Success looks like |
| --- | --- | --- |
| 1 | "Find out what happens when you visit a website." | reaches a playing Stage and watches at least 3 steps without asking |
| 2 | "What is a router? Use the site to find out." | opens a glossary popover or the Details panel on a router |
| 3 | "Why does a website load faster the second time?" | finds a "Coming back" or "Second lookup" story and can say why in their own words |
| 4 | "On public Wi-Fi, can someone see what you type on an HTTPS site?" | uses HTTPS Explorer's "See it as" switch and answers correctly |
| 5 | "Pause it, go back one step, and read it again." | uses Back and Pause without hunting for them |

**Record** success or failure, time, and every moment of hesitation, with where it
happened. Then ask the ten System Usability Scale questions. Write the findings to
`docs/uiux-findings.md`. Any task with fewer than 4 out of 5 successes becomes a follow-up
prompt written in `uiux.md`'s format.

---

## 12. Out of scope

- A light theme, i18n, sound or narration audio, and accounts or any backend. The product
  stays dark, English-only, and without a database, as CLAUDE.md says.
- New modules, new scenarios (other than the First steps lessons), and changes to what any
  simulation computes.
- Any change to Network Diagnostics' Live capability, the diagnostics Route Handlers, the
  SSRF guard or the rate limiter.
- The zod bundle migration and the open Packet Journey fps investigation. Both stay as
  CLAUDE.md describes them. This plan measures its own effect on them and records it; it
  doesn't try to close them.
