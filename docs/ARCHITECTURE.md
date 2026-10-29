# Architecture

## Guiding principles

1. **Domain logic is pure.** `web/src/domain/` imports nothing from React, the DOM, the network, or the clock. Time and randomness are passed in. Result: exhaustive tests, and the same code can later run on a server to become authoritative.
2. **Content is data with a contract.** The game consumes `QuestionBank` (`domain/types.ts`), validated at the boundary (`domain/validateBank.ts`). The future Python pipeline's only job is to produce files/rows that satisfy that contract.
3. **Gameplay never waits on research.** Questions are pre-approved and shipped as static data. Research/LLM work happens offline in batch.
4. **Add infrastructure only when a requirement forces it.**

## Data flow (current)

```
seed-bank.json ──validate──▶ QuestionBank ──selectQuestions(history, rng)──▶ Question[]
                                                                               │
 player text ──▶ roundReducer(SUBMIT) ──▶ matchAnswer ──▶ scoreAnswer ──▶ QuestionResult
                    ▲  (nowMs injected)         │               │
                    │                       normalize      rarity tier + points
                 state machine
```

## Layers (dependencies point downward only)

```
ui/            React components. Render state, forward events. No logic, no time, no storage.
game/          useRound (reducer + clock + randomness + history side effect), deadlineTimer.
storage/       localStorage play history, validated on read, failure-tolerant.
content/       loadBank: validate untrusted JSON, return a result (never throws).
domain/        Pure rules. Imports nothing from the layers above.
```

The round's `phase` **is** the screen (`idle` = home, `answering`/`revealed` = round, `finished` = results), so there is no router and no second source of truth to drift out of sync.

## Modules (`web/src/domain/`)

| File | Responsibility |
| --- | --- |
| `types.ts` | Data contracts (Question, Answer, Source, ScoreBreakdown) |
| `normalize.ts` | Harmless-difference collapsing (case, punctuation, accents, leading article) |
| `matcher.ts` | Exact + guarded fuzzy matching; returns a typed result with a reason on failure |
| `scoring.ts` | Familiarity prior + optional observed stats -> share relative to the question's top answer -> tier -> points |
| `selection.ts` | Category-balanced, freshness-first question selection with seeded RNG |
| `round.ts` | Round state machine (`idle -> answering -> revealed -> finished`) as a pure reducer |
| `validateBank.ts` | Runtime validation of the content contract (structure) |
| `quality.ts` | Editorial quality gate (10+ answers, tier spread, no dominant answer, criteria for open sets) |

## Key decisions and trade-offs

### Rarity model
- Rarity is a property of an **answer within a question**: `Answer.familiarity` = estimated share of correct responses to *this* question.
- Tiers are **relative to the most popular answer of the same question**: `relative = share / topShare`.
  common >= 50% of top (100 pts), uncommon >= 20% (200), rare >= 5% (350), legendary < 5% (500).
- Why relative: the first version used absolute shares (common >= 25%). That works for 4 answers and breaks for 37 NBA MVPs, where even LeBron James is ~8% of responses and every answer would be "rare". Comparing to the top answer is scale-free, so the same thresholds work for 10 answers or 100.
- Observed gameplay is ignored until a question has >= 50 accepted submissions, then blended with the prior as `(count + prior*100) / (total + 100)`. One extra submission moves the share by < 1 percentage point. The blended shares of all answers are then compared with the blended top share.
- Unknown answers score **0** and are queued for review. Absence from the bank never earns a bonus.
- All current `familiarity` values are `curated-estimate`. They are guesses made by the editor, labelled as such. Closed sets sum to ~1; open sets sum to less than 1 to leave room for valid answers we have not listed.
- `ScoreBreakdown` carries `effectiveShare`, `topShare` and `relativeShare`, so any score can be explained.

### Question quality gate
Structure and quality are checked separately:
- `validateQuestionBank` (structure) runs at load time. A thin but well-formed question must never crash the game.
- `checkQuestionQuality` (editorial) runs in the seed-bank contract test, and will be the pipeline's publish gate. It requires: at least 10 answers; at least 3 distinct rarity tiers reachable from the priors; no answer above 40% of responses; and `criteria` ("What counts") for every `open` set.

### Subjective questions need a rubric
"Name a Tollywood movie that follows the saviour trope" has no official answer key. Membership is an editorial call, so the question carries `criteria` (shown to the player as "What counts"), every answer carries plot `evidence` with a source, and the explanation says the list is not exhaustive. Unlisted answers go to the review queue instead of being marked wrong.

### Typo tolerance
Allowed edits: 0 for normalised names < 5 chars, 1 for 5-8, 2 for 9+. Extra guards: digit sequences must match exactly (Apollo 11 vs 12), and ties between different answers are refused. Known false-positive class: a real word one edit from a valid answer (e.g. "Europe" -> "Europa"). Accepted risk for this game; revisit with gameplay data.

### Timer
The deadline is an absolute timestamp stored in state. The UI countdown is derived from it (`remainingMs`). A submission at or after the deadline is a timeout regardless of what the UI showed, so throttled background tabs cannot gain time.

### Selection
Freshness beats category balance: never-played questions are exhausted (balanced across categories) before any replay; replays go least-recently-played first.

### Timer (UI)
`Timer` owns its own tick state so only it re-renders ~5x/second; the question panel and the answer input never re-render because of the countdown. It uses `performance.now()` (monotonic: unaffected by the user changing the system clock) and re-checks on `visibilitychange`/`focus`. The reducer, not the UI, decides whether a submit beat the deadline.

### Content-quality finding (resolved in the content revision)
The first seed bank had 2-4 valid answers per question, so most priors landed in one tier (every Eega lead was "Common") and rarity added nothing. The bank was replaced with 15 questions of 10-37 answers each (5 per category), and the quality gate now enforces this. The bank is no longer fixed at 15: reviewed pipeline candidates are added with `prillion-pipeline promote` (the first was Jupiter's moons), and the contract is now "at least 5 per category" so selection can vary what a game plays.

## Prototype vs production (current gaps)

| Area | Prototype now | Production would |
| --- | --- | --- |
| Content storage | Static JSON in the bundle | PostgreSQL (Supabase) with a review workflow |
| Scoring/validation | Client-side | Server-authoritative (required before multiplayer/leaderboards) |
| Answers in the bundle | Shipped to the client | Withheld; checked via an API |
| Play history | localStorage (per browser, forgeable) | Per-user rows |
| Rarity data | Curated priors | Aggregated answer-frequency statistics |
| Schema validation | Hand-written | Shared JSON Schema for TS + Python |

## Roadmap

1. **M1 (done):** Domain engine, seed bank, tests.
2. **M2 (done):** Playable solo UI: category select, round, countdown HUD, reveal, results, play history.
3. **M3 (in progress):** CI (GitHub Actions, done) + branch protection + deployment (Vercel). Done when a failing test blocks a merge and `main` has a live URL.
4. **M4 (in progress):** Python content pipeline with review queue, built in slices: (1) manual single-topic run producing a candidate file (built: Wikipedia and IMDb sources, grounded LLM generation with a verbatim-quote check, the web app's own gate as the publish check; see `pipeline/README.md`); (2) scheduled GitHub Actions run that opens a review PR (never writes to the live bank directly); (3) topic discovery, dedupe, signal-based rarity.
5. **M5:** Supabase backend, server-authoritative scoring, leaderboards.
6. **M6:** Multiplayer rooms.
7. Visual polish (pixel art, depth parallax, sound) interleaved after M2.
