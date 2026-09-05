# Architecture

The guiding rule: **the engine is generic, the story is data.** Nothing under
`engine/` or `src/` knows about any particular story. Everything a story
contributes arrives as text and leaves as a plan.

```
                    ┌──────────────┐
   story text  ───► │   analysis   │  characters, scenes, dialogue, locations
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │     plan     │  identities, voices, timings, transitions
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │    assets    │  plates, portraits, music, sounds, speech
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │    retime    │  re-fit the timeline to the real audio
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │    render    │  Remotion → H.264
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │    verify    │  probe the file, check it against the plan
                    └──────────────┘
```

---

## 1. Analysis — `engine/analysis/`

Turns arbitrary English into a `StoryPlan`.

| File | Responsibility |
| --- | --- |
| `lexicon.mjs` | Domain-neutral vocabulary: role nouns, speech verbs, location words, discourse markers, style presets. A word earns its place here only if it helps parse English generally. |
| `text.mjs` | Sentence segmentation (quote-aware), quote extraction, noun-phrase handling, location detection, speech/read time estimates. |
| `heuristic.mjs` | The deterministic analyser. No network, no key — the guaranteed path. |
| `llm.mjs` | Optional model-backed analyser. Emits the **same shape**, validated and normalised, so nothing downstream can tell which one ran. |

### Inside the heuristic analyser

1. **Segment** into sentence records, separating each sentence's narrative frame
   from its quoted spans.
2. **Find confident proper names** — capitalised, not a common sentence starter,
   not immediately followed by a role noun (so "Request" in "Request Manager"
   stays part of the title). Only narrative frames are scanned, so a name inside
   dialogue never becomes a character.
3. **Find mentions** per sentence: role nouns with their capitalised prefixes and
   numeric suffixes, system nouns, and confident names. Counted groups ("two
   students") expand into numbered siblings.
4. **Resolve pronouns.** A sentence-initial pronoun refers to the previous
   sentence's subject; a mid-sentence one to the nearest preceding mention.
   Gender flows from the resolved referent.
5. **Merge aliases.** A shorter name that is a contiguous run of words inside a
   longer one folds into it. "Operator" → "COE Operator 1". Equal-length names
   never merge, which keeps "Student 1" and "Student 2" apart.
6. **Group into scenes.** Explicit headings win and hold their whole paragraph.
   Otherwise a scene breaks on a location change, an arrival, or a discourse
   marker — but never in the middle of a conversation.
7. **Build beats.** Each quoted span is attributed from the narrative
   *immediately before it*, which is what keeps `A types: "…" B replies: "…"`
   correctly split between two speakers.

Beat kinds: `dialogue` (a person speaking), `system` (an interface responding),
`narration` (the story describing events), `action` (a brief caption).

---

## 2. Plan — `engine/plan/`

`compile.mjs` turns a `StoryPlan` into a `RenderPlan`: the frame-accurate
document every later stage reads.

- **Identities** (`engine/cast/identity.mjs`) — colour, initials, voice, skin,
  hair, build and clothing are all derived from a hash of the character's key.
  This is what makes consistency structural rather than best-effort.
- **Voices** — pooled by gender, taken in appearance order. An unstated gender is
  resolved deterministically so every character still gets a distinguishable
  voice. The narrator has its own.
- **Timing** — each beat is estimated against its *spoken* form. If a duration
  was requested, the compiler solves for a speech rate and a pacing scale that
  fit; if the story cannot fit, `meta.targetMet` records that honestly.
- **Transitions** — chosen from context: a location change announces the new
  place, a final scene resolves, otherwise a quiet fade.

`store.mjs` loads, saves and validates the plan, and flattens it into a timeline
shared by the renderer, the composition and the verifier — so all three agree.

---

## 3. Assets — `engine/assets/`, `engine/audio/`, `engine/world/`, `engine/cast/`

| Asset | Source | Fallback |
| --- | --- | --- |
| Scene plates | OpenAI image API | procedural SVG (`world/backdrops.mjs` + `cast/figures.mjs`) |
| Speech | `edge-tts` neural voices | Windows SAPI → silent placeholder |
| Music & UI sounds | synthesised from oscillators and envelopes (`audio/synth.mjs`) | — |
| Typefaces | Google Fonts, downloaded once | system font stack |

Music and sound effects are generated from first principles: no downloads, no
licensing questions, byte-reproducible.

Backdrops cover eight location families — office, café, medical, classroom,
retail, home, outdoor, generic — composited with the scene's cast between the
background and the foreground layer, so furniture correctly occludes people.

---

## 4. Retiming — `engine/plan/retime.mjs`

The compiler estimates before any audio exists. Estimates are good but never
exact, and identifier-heavy lines are read far more slowly than a word count
suggests.

Once the voices exist, retiming replaces every estimate with the measured
duration, re-lays each scene's timeline, rebuilds the audio cue sheet, and pads
back to the requested runtime if the real speech came in short.

This is the step that makes audio and picture *exactly* aligned, and the reason
no line is ever clipped by its own scene ending.

---

## 5. Render — `src/` and `engine/render/render.mjs`

A Remotion composition driven entirely by the plan. `src/plan.ts` imports the
plan and exposes its types; no component contains story knowledge.

- `scenes/NarrativeScene.tsx` — scene plate, cast strip, speech cards, captions
- `scenes/InterfaceScene.tsx` — application panel with a composer and transcript
- `scenes/TransitionSegment.tsx` — the beat between scenes, carrying the rail
- `components/Stage.tsx` — title block and the scene progress rail
- `AudioTrack.tsx` — music, cues and speech, positioned from the same plan

The presentation is selected by the plan's style, so adding a style is adding a
palette and pointing it at a presentation.

---

## 6. Verification — `engine/render/verify.mjs`

Every expectation is derived from the plan, so the verifier works for any story.
It probes the container, measures duration against the timeline, confirms the
audio carries signal and does not clip, checks that every planned line was
synthesised and fits its scene, confirms every character holds one identity,
asserts that **all on-screen text appears verbatim in the source story**, and
samples one frame from every segment to prove nothing rendered blank.

---

## Design decisions worth knowing

**Why a rule-based analyser rather than only an LLM?**
It is the guaranteed path — no key, no network, no cost, fully deterministic and
testable. The LLM analyser is a strict upgrade when available, and produces the
same shape so it can never destabilise anything downstream.

**Why procedural visuals?**
They make character consistency free and exact, need no assets or licensing, and
keep the whole pipeline runnable offline. The image API is tried first when a key
is configured.

**Why re-time after synthesis instead of estimating better?**
Because no estimate is exact. Measuring is cheap once the audio exists, and it
turns "approximately aligned" into "exactly aligned".

**Why is the plan a file on disk?**
It is the contract between stages. The asset builders, the Remotion bundle, the
renderer and the verifier all read the same document, so they cannot disagree
about what is being made — and you can inspect it between any two stages.
