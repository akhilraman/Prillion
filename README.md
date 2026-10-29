# Prillion

An original underwater, pixel-art trivia game. Players answer **open-ended questions in free text**; every valid answer is accepted, and rarer answers earn more points.

[![CI](https://github.com/akhilraman/Prillion/actions/workflows/ci.yml/badge.svg)](https://github.com/akhilraman/Prillion/actions/workflows/ci.yml)

> Status: **Milestone 2 complete** (a playable solo game; plain styling, pixel-art theme comes later), content revision done, **Milestone 3 (CI + deploy) in progress**. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
web/                    React + TypeScript + Vite frontend
  src/domain/           Pure game logic (no React, no browser APIs) + tests
  src/game/             React glue: round hook, deadline timer
  src/storage/          localStorage play history
  src/content/          Question bank (JSON) + validated loader
  src/ui/               Screens and components
docs/ARCHITECTURE.md    Design, data flow, trade-offs, roadmap
.env.example            Environment variables (pipeline only: OPENAI_API_KEY, PRILLION_OPENAI_MODEL)
```

`pipeline/` is the Python content pipeline (candidate-question generation); see [pipeline/README.md](pipeline/README.md).

## Requirements

- Node.js 24.15+ (CI uses the version in `web/.nvmrc`; developed on 26). `jsdom` and `vitest` need Node >= 22.22 / 24.15 / 26.
- npm

## Commands (run inside `web/`)

| Command                | What it does                                        |
| ---------------------- | --------------------------------------------------- |
| `npm install`          | Install dependencies                                |
| `npm test`             | Run unit tests once                                 |
| `npm run test:watch`   | Re-run tests on change                              |
| `npm run typecheck`    | Strict TypeScript check                             |
| `npm run lint`         | oxlint                                              |
| `npm run format`       | Format with Prettier                                |
| `npm run check`        | Typecheck + lint + format check + tests (CI-style)  |
| `npm run dev`          | Dev server at http://localhost:5173                 |
| `npm run build`        | Typecheck + production build into `web/dist`        |

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`: `npm ci`, then `npm run check` (typecheck, lint, format check, all tests including the seed-bank contract tests), then `npm run build`. The job is named `check`; that is the required status check for branch protection. To reproduce a CI run locally:

```
cd web && npm ci && npm run check && npm run build
```

## Content rules

- Every answer must cite at least one real source (`sourceIds`). Nothing is invented.
- `familiarity` values are marked `curated-estimate`: editorial priors, not measurements.
- Only questions whose valid answers can be **fully enumerated and verified** are marked `closed`. Questions where valid answers may be missing from the bank must be `open` and route unknown answers to human review.
- Every question needs **10+ valid answers** spread across at least 3 rarity tiers (enforced by `checkQuestionQuality`). Rarity is relative to the most popular answer of the same question, so a question with 3 answers cannot rank anything.
- Subjective questions (for example "follows the saviour trope") must be `open` and carry `criteria`, shown to players as "What counts".
