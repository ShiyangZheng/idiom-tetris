# 🧩 Idiom Tetris — V-det-N

> A single-file HTML5 game for psycholinguistics research on English
> verb–determiner–noun idiom acquisition.
---
**Play it now:**

[![Play on itch.io](https://img.shields.io/badge/Play-itch.io-FA5C5C?logo=itch.io)](https://shiyang-zheng.itch.io/idiom-tetris)

Each falling block is one English word tagged with its part of speech
(verb / determiner / noun). When three blocks line up in the canonical
**V–det–N** order to form a known English idiom, they clear with a
flourish and the idiom's full form, Chinese gloss, and English example
flash on screen.

- **Pool size**: 611 idioms, 241 verbs, 6 determiners, 442 nouns
- **No build step required to play** — just open `index.html`
- **Ongoing developmental version:** https://shiyangzheng.github.io/idiom-tetris/

---

## ▶️ Play

The fastest way:

```sh
# Easiest: open in a browser
open index.html
```

Or serve it locally:

```sh
python3 -m http.server 8765
# then visit http://localhost:8765/index.html
```

### Controls

| Key | Action |
| --- | --- |
| ← → | Move left / right |
| ↓ | Soft drop |
| ↑ or Space | Hard drop |
| P | Pause / resume |

The pool is embedded directly in `index.html`, so the game runs from
`file://` with no static server.

### Idiom clear: the pause-and-read modal

When a v-d-n cluster clears, a small modal pops up over the board
with the idiom and both meaning translations (the primary language
is the one selected by the `Meaning` pill — default English, toggle
to 中文 with one click). The game pauses while the modal is up, so
the learner has a moment to read instead of a "good job" flicker.

A `Modal` pill in the right HUD controls how long the modal stays
up before auto-closing: **1s · 2.5s · 5s · ∞**. The default is
2.5s. The **∞** (manual) option leaves the modal up until the user
dismisses it via X / Got it / Esc / P. The choice persists across
page reloads via `localStorage` under
`idiom-tetris.pause-dur-ms`. The two HUD pills (`Meaning` and
`Modal`) stay clickable while the modal is up — flipping the
meaning language or changing the duration live-re-renders the
currently-visible modal without needing a new clear.

### Game over & sharing

When you die, a modal pops up with three options:

- **Submit to leaderboard** — sends `{name, score, cleared}` to a
  Cloudflare Worker + KV (see [the leaderboard section](#-leaderboard)
  below). The worker replies with the player's rank and the
  total submission count, which we show inline. Names are
  1–12 letters / digits / space / `_` / `-` / emoji, and the
  server enforces 5 submits per IP per hour.
- **Share** — hands a text+url payload
  (`I just scored X in Idiom Tetris (cleared Y idioms)! Think
  you can beat me? Play here: <url>`) to the **native OS share
  sheet** via `navigator.share()`. The system sheet
  auto-lists every installed app that accepts the share
  extension, so on iOS / macOS / Android you'll see WeChat,
  X, Instagram, LinkedIn, Messages, Mail, etc. without any
  per-platform code. Browsers that don't support `navigator.share`
  fall back to copying the same text to the clipboard.
- **Skip** — close the modal.

The side panel also has a **🏆 Leaderboard** button that opens
the global top-50 at any time (not just after a death). It
shows `rank · name · score · cleared` with 🥇/🥈/🥉 medals on
the top 3, and highlights your own row if you've submitted
under a name that's still in the top 50.

---

## 🧠 Why gamification for language acquisition?

Second-language idiom learning has a long-standing problem: the
**idiomaticity gap**. Learners can usually parse the literal meaning
of *"hold your horses"* (verb "hold" + possessive determiner "your" + plural noun "horses") but cannot retrieve the figurative meaning
("be patient") under production pressure. This is true even at high
proficiency, and it survives years of classroom exposure. Standard
declarative study — flashcards, vocabulary lists, glosses — produces
*recognition* of idioms in context but rarely *production*.

Gamification tries to close that gap by exploiting a few properties
of gameplay that declarative study doesn't:

- **Massed production under low cognitive load.** In an Anki deck, a
  learner is asked to *recognize* a target. In a game, the learner
  is asked to *produce* — to drop a verb in the right column, to
  align three cells in a v-det-n pattern, to choose where a
  determiner belongs. The motor act of placing a tile is a tiny
  act of production, and repeating it a hundred times in a session
  builds the procedural memory that idiom use actually depends on.
- **Feedback with semantic content.** When a v-d-n cluster clears,
  a small modal pops up — not a flicker — that surfaces the idiom
  itself (`hold your horses`) and its meaning in the learner's
  preferred language (default: English; toggleable to 中文 via the
  `Meaning` pill in the right HUD). The learner sees the productive
  act (placing tiles) immediately rewarded with the linguistic
  form they were trying to produce. The reward is the language.
- **Spacing + retrieval practice at scale.** A 22-minute session
  produces ~80–100 piece placements, of which 5–15 are v-d-n
  clusters that clear. The learner never *decides* to drill the
  same idiom twice; the game's difficulty curve does it for them.
  This is the same mechanism that makes Anki effective
  (retrieval practice under expanding intervals), but the
  *retrieval cue* is procedural (a falling piece) rather than
  declarative (a flashcard prompt).
- **Affective lift.** Games are motivating; flashcards aren't.
  Learners who would abandon a 30-minute SRS session will play
  for an hour. The implicit-explicit literature consistently
  shows that the bottleneck on idiom acquisition is not exposure
  but **engagement with the input**; gamification buys engagement
  cheaply.

This is a small research artefact, not a finished pedagogical
product. The most interesting open question is whether the gains
in engagement translate to gains in **production** (the actual
behaviour we want to change), or only in **recognition** (which
flashcards already do). My Stage 2 PhD work will probe that
empirically; see the call for collaborators below.

---

## 🔬 What these idioms are

The 611 idioms in the pool are a curated subset of English
**verb–determiner–noun** expressions — a specific sub-class
within the broader "English idioms" literature. They have three
properties that make them interesting for psycholinguistic study:

1. **Strict surface form.** The three words appear in a fixed
   order, with the determiner slot filled by a small closed-class
   set (mostly `a`, `the`, `your`, `my`, `one`'s). The verb and
   noun are content-class, but the idiom is *ungrammatical* if
   the determiner is dropped (`hold horses`) or substituted
   (`hold a horse`).
2. **Compositional gap.** The figurative meaning is not derivable
   from the literal meanings of the parts. `bite the bullet` does
   not involve bullets; `kick the bucket` does not involve
   buckets; `spill the beans` does not spill beans. The
   conventionalised mapping is the whole point of the idiom.
3. **Frequency gradient.** Some (e.g. `break the ice`, `do the
   dishes`) are high-frequency, fully lexicalised, and known to
   most B2+ learners. Others (e.g. `cut the cackle`, `bust a
   gut`) are lower-frequency, region-specific, or dated, and are
   more typical of C1+ productive vocabulary.

That frequency gradient is why I included idioms across the BNC
frequency bins (the `(Based on BNC)` suffix on a few entries
marks items whose canonical form is in the British National
Corpus but where orthographic variation exists in the wild —
`cut the cackle` vs. `cut the crap`, for example).

The broader research programme this sits inside looks at how
non-literal multi-word expressions are stored, accessed, and
produced by L2 speakers. V–det–N is one of several idiom
sub-classes I work with (others include verb–particle, similes,
and binomial pairs). V–det–N is the easiest to study under a
falling-block metaphor because of property (1): the surface form
is rigid enough to render on a 1-cell-per-word grid without
ambiguity.

---

## 🎮 Why not match-3?

I tried. The first published variant of this project was a
**match-3** game: an 8×12 grid, swap two adjacent cells, three
matching types in a row clear. Mechanically it was clean; the
detection logic was simpler than the tetris variant. I built a
working version, played it for an hour, and scrapped it.

The reason is purely visual. V–det–N idioms are *linear*
expressions: three words that the speaker produces in sequence
and the listener parses in sequence. They have a strong
left-to-right reading direction. Stacking them in a 2D grid
breaks that reading direction: when the grid has eight columns
and twelve rows, the player's eye scans a tidied cluster
(`verb det noun`) and the question "is this an idiom?" becomes
a pattern-recognition task, not a production task. The learner
sees a *colour shape* before they see the *words*.

With the falling-block layout, the production sequence is
preserved: a verb falls, then a determiner falls next to it,
then a noun falls next to the determiner. The player is, in a
literal sense, **producing the idiom in order**. The eye reads
left to right because the game moves left to right. The
match-3 layout forced a 2D scan that broke that, and the
result was a game that *looked* like a word game but felt like
a Bejeweled clone.

There is a deeper methodological point here, too. V–det–N
idioms are stored in the mental lexicon as linearised sequences
(`hold-your-horses` is one entry, not three). If the
intervention is to change how the learner *produces* the idiom,
the practice condition should mirror that storage format.
Falling blocks do. Match-3 doesn't.

So the tetris variant won. The match-3 code is in `_archive/`
in the git history (commit `a8c1f0d`) if you want to see the
implementation — but I do not recommend it as a study tool.

---

## 🚧 What's missing

The current state of the project is: a game you can play. The
next layer is the research layer, and **that is where I have no
idea what I'm doing yet**.

Specifically, I have no worked-out algorithm for the central
mechanic: **how should falling pieces be sequenced to support
production practice rather than just occupy the player's time?**

The current approach is a probability knob called
`window.__DIFFICULTY__` (default 0.20). With probability
0.20, the next 3 drops come from a single curated idiom in
V → det → N order — so the player *knows* the cluster will
clear if they place it correctly. With probability 0.80, the
next piece is a random word of the right type. This produces
playable sessions but the pedagogical logic is ad hoc:

- **No model of which idioms the player has seen.** Every
  drop is a fresh random pick, so the same idiom can clear
  twice in a row or never appear in a 30-minute session.
- **No adaptation to player performance.** A learner who is
  reliably clearing idioms gets the same difficulty curve as
  one who is just stacking `the` on top of `the`.
- **No integration of the frequency gradient.** The pool has
  611 idioms but the game treats them as one undifferentiated
  mass. A motivated learner who wants to drill the bottom
  10% (rare idioms) has no way to ask for that.
- **No measurement of what is being learned.** The game tracks
  score and clears. It does not track which idioms the player
  *missed* (placed a tile that didn't form a cluster), reaction
  times, or transfer to a post-test.

I have thoughts on each of these but no conviction. If you are
a learning scientist, an HCI researcher, an applied linguist
who works on L2 idiom acquisition, or a serious game designer
who has built research-grade gamified practice, I would very
much like to talk to you. The contact form is at the bottom of
this README.

---

## 🤝 Call for collaborators

Two kinds:

### 1. Algorithm design for piece sequencing

If you are interested in **adaptive sequencing of falling
pieces for L2 idiom practice**, the codebase is small enough
to read in an afternoon (`index.html` is the whole game; the
key functions are `randomWord`, `spawnNext`, and
`checkIdiomClear`). A reasonable thesis chapter, workshop
paper, or RA project would be:

> *"Design and evaluate an adaptive piece-sequencing algorithm
> for verb–determiner–noun idiom practice that integrates (a)
> the COCA/BNC corpus frequency gradient, (b) a player-performance model,
> and (c) spaced retrieval."*

I'm at the University of Nottingham, School of English, and
I'm funded by an ESRC (Economic and Social Research Council) through 2028. Happy to
co-author, share the pool, share the codebase, or co-supervise
a small project.

### 2. Empirical study using the game

If you want to use the game as the practice condition in an
L2 idiom acquisition study — comparing it against Anki
flashcards, against a pure-text reading condition, against
shadowing, or anything else — the game is already
deployment-ready. The README and `build_pool.py` together
document everything you'd need to set up a between-subjects
design. I can share the post-test materials I use for my own
Stage 2 work; they cover production (oral and written),
recognition (forced choice), and a delayed recall probe.

If either of these is interesting to you, please email
me at the address in my GitHub profile, or open an issue
on this repo.

---

## 📂 Repository layout

```
.
├── index.html              # The whole game (HTML + CSS + JS + pool)
├── idioms_compact.json     # Same pool as JSON (fallback / source-of-truth)
├── build_pool.py           # Re-embed idioms_compact.json into index.html
├── worker/                 # Optional Cloudflare Worker for the leaderboard
│   ├── index.js            # The Worker (3 endpoints, no npm deps)
│   └── wrangler.toml       # KV bindings + deploy config
├── LICENSE                 # MIT for code, CC-BY 4.0 for the idiom pool
└── README.md               # You are here
```

---

## 🏆 Leaderboard

The game has an optional global leaderboard backed by a
[Cloudflare Worker](https://workers.cloudflare.com/) + KV.
It's enabled by setting one config string in `index.html` and
deploying the worker in `worker/` to your own Cloudflare
account. The game runs fine without it — when `WORKER_URL` is
empty, the leaderboard modal shows a local-only mock from
`localStorage` so you can still see the UI work end-to-end
during development.

### API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `GET`  | `/healthz`     | — | `{ok, count, lastTs}` |
| `GET`  | `/leaderboard` | — | `{entries: [{rank, name, score, cleared, when}]}` (top 50) |
| `POST` | `/submit`      | `{name, score, cleared}` | `200 {rank, total}` · `400 {error}` · `429 {error}` |

### Anti-spam

- Per IP: 5 submits per rolling hour (KV `RATE` namespace).
- Per name: 1–12 letters / digits / space / `_` / `-` / emoji.
- Per score: integer in `[0, 9_999_999]`; per cleared: `[0, 9_999]`.
- Global cap: keep top 200 entries; older / lower entries are
  trimmed on submit (background via `ctx.waitUntil`).

### CORS

`Access-Control-Allow-Origin: *` (with the request `Origin`
mirrored back). The game is a public static page; the worker
only stores public data.

### Deploy

```sh
# 1. install wrangler (one-time)
npm install -g wrangler
wrangler login

# 2. create three KV namespaces
wrangler kv:namespace create LEADERBOARD_SCORES
wrangler kv:namespace create LEADERBOARD_RATE
wrangler kv:namespace create LEADERBOARD_META

# 3. paste the three printed IDs into worker/wrangler.toml

# 4. deploy
cd worker
wrangler deploy

# 5. paste the printed *.workers.dev URL into index.html
#    (the WORKER_URL config near the top of the second <script>).
```

The free tier (100K Worker requests/day, 100K KV reads/day)
is more than enough for a personal leaderboard. If you self-
host, any KV-compatible backend (Vercel KV, Upstash Redis)
can be adapted with the same shape.

The 611 idioms are released under **CC-BY 4.0** — if you use
them in a derivative study, please cite the original source
(the BNC frequency list) and acknowledge this repository.

The code (everything in `build_pool.py` and the JS in
`index.html` outside the embedded pool script) is released
under **MIT**.

---

## 🛠 Editing the pool

The pool is the source of truth. Two ways to change it:

### 1. Edit `idioms_compact.json`, then re-embed

```sh
# 1. edit idioms_compact.json
# 2. re-embed into index.html
python3 build_pool.py
# Output: "loaded: 241 verbs, 6 dets, 442 nouns, 611 idioms"
```

`build_pool.py` is idempotent — running it on an unchanged
file produces byte-identical output.

### 2. Edit `index.html` directly

Find the `<!-- EMBEDDED IDIOM POOL -->` comment. The pool is
the JSON literal that follows. Add or remove entries from
`verbs`, `dets`, `nouns`, and `lookup` (`lookup` keys are
`"verb|det|noun"`). Run `build_pool.py` afterwards to sync
the JSON file.

---

## ✅ Sanity-checking the JS

Before committing changes to `index.html`, run a syntax check:

```sh
node -e '
  const fs = require("fs");
  const html = fs.readFileSync("index.html", "utf8");
  const re = /<script>[\s\S]*?<\/script>/g;
  let last, m; while ((m = re.exec(html)) !== null) last = m;
  const main = last[0].replace(/^<script>/, "").replace(/<\/script>$/, "");
  fs.writeFileSync("/tmp/_idiom_main.js", main);
'
node --check /tmp/_idiom_main.js && echo "JS OK"
```

(This is also the workflow I use. Save it as a git pre-commit
hook if you want it automatic.)

---

## 🏗 GitHub Pages

This repository is served at
**<https://shiyangzheng.github.io/idiom-tetris/>** via GitHub
Pages from the `main` branch root. No build step, no
`_config.yml`, no Jekyll theme. Pages serves `index.html`
directly.

To deploy your own fork:

1. Fork the repo
2. Settings → Pages → Build and deployment → Deploy from a
   branch → `main` / `(root)`
3. Wait ~60 s
4. Your fork is live at `https://<your-username>.github.io/idiom-tetris/`

---

## 📄 License

- **Code** (the JavaScript, CSS, HTML structure, and Python
  tooling): MIT
- **Idiom pool** (the 611 entries in `idioms_compact.json` and
  the embedded `__IDIOMS_POOL__` literal): CC-BY 4.0

Both attributions are recorded in `LICENSE`.
