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

## Modules (`web/src/domain/`)

| File | Responsibility |
| --- | --- |
| `types.ts` | Data contracts (Question, Answer, Source, ScoreBreakdown) |
| `normalize.ts` | Harmless-difference collapsing (case, punctuation, accents, leading article) |
| `matcher.ts` | Exact + guarded fuzzy matching; returns a typed result with a reason on failure |
| `scoring.ts` | Familiarity prior + optional observed stats -> tier -> points |
| `selection.ts` | Category-balanced, freshness-first question selection with seeded RNG |
| `round.ts` | Round state machine (`idle -> answering -> revealed -> finished`) as a pure reducer |
| `validateBank.ts` | Runtime validation of the content contract |

## Key decisions and trade-offs

### Rarity model
- Rarity is a property of an **answer within a question**: `Answer.familiarity` = estimated share of correct responses to *this* question.
- Tiers: common >= 25% (100 pts), uncommon >= 10% (200), rare >= 3% (350), legendary < 3% (500).
- Observed gameplay is ignored until a question has >= 50 accepted submissions, then blended with the prior as `(count + prior*100) / (total + 100)`. One extra submission moves the share by < 1 percentage point.
- Unknown answers score **0** and are queued for review. Absence from the bank never earns a bonus.
- All current `familiarity` values are `curated-estimate`. They are guesses made by the editor, labelled as such.

### Typo tolerance
Allowed edits: 0 for normalised names < 5 chars, 1 for 5-8, 2 for 9+. Extra guards: digit sequences must match exactly (Apollo 11 vs 12), and ties between different answers are refused. Known false-positive class: a real word one edit from a valid answer (e.g. "Europe" -> "Europa"). Accepted risk for this game; revisit with gameplay data.

### Timer
The deadline is an absolute timestamp stored in state. The UI countdown is derived from it (`remainingMs`). A submission at or after the deadline is a timeout regardless of what the UI showed, so throttled background tabs cannot gain time.

### Selection
Freshness beats category balance: never-played questions are exhausted (balanced across categories) before any replay; replays go least-recently-played first.

## Prototype vs production (current gaps)

| Area | Prototype now | Production would |
| --- | --- | --- |
| Content storage | Static JSON in the bundle | PostgreSQL (Supabase) with a review workflow |
| Scoring/validation | Client-side | Server-authoritative (required before multiplayer/leaderboards) |
| Answers in the bundle | Shipped to the client | Withheld; checked via an API |
| Play history | (M2) localStorage | Per-user rows |
| Rarity data | Curated priors | Aggregated answer-frequency statistics |
| Schema validation | Hand-written | Shared JSON Schema for TS + Python |

## Roadmap

1. **M1 (done):** Domain engine, seed bank, tests.
2. **M2:** Playable solo UI: category select, 15-question round, countdown HUD, reveal, results, play history.
3. **M3:** CI (GitHub Actions) + deployment (Vercel).
4. **M4:** Python content pipeline with review queue.
5. **M5:** Supabase backend, server-authoritative scoring, leaderboards.
6. **M6:** Multiplayer rooms.
7. Visual polish (pixel art, depth parallax, sound) interleaved after M2.
