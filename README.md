# Prillion

An original underwater, pixel-art trivia game. Players answer **open-ended questions in free text**; every valid answer is accepted, and rarer answers earn more points.

> Status: **Milestone 1 complete** (domain engine + seed content, no UI yet). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
web/                    React + TypeScript + Vite frontend
  src/domain/           Pure game logic (no React, no browser APIs) + tests
  src/content/          Question bank (JSON) consumed by the game
docs/ARCHITECTURE.md    Design, data flow, trade-offs, roadmap
.env.example            Environment variables (none required yet)
```

A `pipeline/` (Python) directory will be added in the content-engine milestone.

## Requirements

- Node.js 22+ (developed on 26)
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
| `npm run dev`          | Dev server (still the Vite starter page in M1)      |

## Content rules

- Every answer must cite at least one real source (`sourceIds`). Nothing is invented.
- `familiarity` values are marked `curated-estimate`: editorial priors, not measurements.
- Only questions whose valid answers can be **fully enumerated and verified** are marked `closed`. Questions where valid answers may be missing from the bank must be `open` and route unknown answers to human review.
