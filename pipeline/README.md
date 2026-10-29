# Prillion content pipeline

Generates **candidate** trivia questions from cited sources. It never writes to the live question bank: a human reviews each candidate in a pull request.

## How a candidate is made

```
Wikipedia pages ──► Document (text + revision id, tables kept)
                        │
                        ▼
              LLM (structured output) ──► question + per-answer verbatim quote + familiarity tier
                        │
                        ▼
        grounding check (deterministic, no LLM)
        every quote must appear word-for-word in the cited document;
        failures are fed back to the model (up to 3 attempts)
                        │
                        ▼
          candidates/<id>.json   { question, provenance }
                        │
                        ▼
   web gate: the game's own validator + editorial quality gate
   (`web/scripts/check-candidate.ts`, the single definition of "publishable")
```

Design rules:

- **No document, no claim.** The model may only use fetched documents and must quote them.
- **The LLM never outputs scoring numbers.** It returns a coarse tier (`very-familiar`, `familiar`, `niche`, `obscure`); `candidate.py` maps tiers to shares deterministically. These are labelled `llm-estimate`.
- **Idempotent.** The same inputs (prompt version, model, brief, document revisions) hash to the same `inputHash`; an identical rerun is skipped.
- **Retry-safe.** Files are written to a temp name and renamed, so a crash never leaves a half-written candidate.

## Setup

Needs [uv](https://docs.astral.sh/uv/) and Node (for the web gate).

```
cd pipeline
uv sync
```

Create `../.env` (git-ignored; see `../.env.example`):

```
OPENAI_API_KEY=...
PRILLION_OPENAI_MODEL=...   # the model name is not hard-coded
```

## Run

```
# Free: fetch the pages and size the prompt, no LLM call.
uv run --env-file ../.env prillion-pipeline run --category space --id space-saturn-moons \
  --page "Moons of Saturn" --brief "Name a moon of Saturn." --dry-run

# Real run (costs a few cents).
uv run --env-file ../.env prillion-pipeline run --category space --id space-saturn-moons \
  --page "Moons of Saturn" --brief "Name a moon of Saturn."
```

Flags: `--page` is repeatable, `--model` overrides the env var, `--force` regenerates an identical candidate, `--max-attempts` (default 3), `--out-dir` (default `candidates/`).

Outputs: `candidates/<id>.json` on success. `candidates/<id>.failed.json` if grounding or the web gate rejected it (kept for inspection).

### Working through the topic queue

`topics.json` is the reviewed list of what the pipeline may generate (id, category, Wikipedia pages, brief). Edit it in a PR; nothing else decides topics yet. **Order matters:** `run-all` works through the file top to bottom and `--max-new` stops after N, so keep the queue interleaved across categories to make each batch balanced.

```
uv run --env-file ../.env prillion-pipeline run-all --dry-run          # free
uv run --env-file ../.env prillion-pipeline run-all --max-new 2        # at most 2 LLM-backed topics
```

- **Idempotent:** a topic whose inputs (prompt version, model, brief, source revisions and text) are unchanged is skipped, so reruns cost nothing.
- **Prompt changes invalidate candidates on purpose:** `PROMPT_VERSION` is part of the input hash, so after the prompt changes every topic counts as stale and is regenerated (within `--max-new`) on its next run. Use `run` for a single topic if you only want to refresh one.
- **Spending cap:** `--max-new N` (default 3) limits how many topics reach the LLM in one run; the rest are reported as `deferred` and picked up by the next run.
- **Isolated failures:** one bad topic never stops the others. The run exits 1 if any topic failed or errored, 2 for a bad topics file or missing key.

## Promoting a reviewed candidate to the live game

`promote` is the ONLY command that changes what players see. Run it on candidates you have reviewed (for example after merging a bot review PR), and ship the result as its own PR.

```
uv run prillion-pipeline promote candidates/space-jupiter-moons.json --dry-run   # validate only
uv run prillion-pipeline promote candidates/space-jupiter-moons.json             # write the live bank
cd ../web && npm run check                                                      # then open a PR
```

What it guarantees:
- **All or nothing:** several candidates can be promoted at once; if any is invalid, nothing is written.
- **Validated before saving:** the resulting bank is written to a temp file and must pass the web app's own bank gate (`web/scripts/check-bank.ts`: structural validator plus the quality gate for every question). Only then does it atomically replace `web/src/content/seed-bank.json`.
- **No silent overwrites:** an id that is already live (for example a hand-curated question) is refused. `--replace` swaps it in place, keeping its position, and should be a deliberate editorial decision.
- **Rejected candidates** (`*.failed.json`) are refused.
- **`approvedOn`** is the promotion date (override with `--approved-on YYYY-MM-DD`), not the generation date. `provenance` stays in the candidate file and git history; the live bank carries only what the game needs.
- Quality warnings recorded in a candidate's provenance are printed as notes.
- **AI-knowledge questions** (`basis: "ai-knowledge"`: written from model memory, no cited sources) are refused unless you pass `--allow-ai-knowledge`. Only do that after a human has checked every answer.

Before promoting, review the candidate against its source page (see the checklist in the bot PR). Tiers are `llm-estimate`, not measured popularity.

## Scheduled refresh (GitHub Actions)

`.github/workflows/content-refresh.yml` runs `run-all` in CI and opens a **review PR** with the new files under `pipeline/candidates/`. It never pushes to `main` and never touches the live bank.

One-time setup (repo **Settings**):
- Secrets and variables → Actions → secret `OPENAI_API_KEY`, variable `PRILLION_OPENAI_MODEL`.
- Actions → General → Workflow permissions → tick **Allow GitHub Actions to create and approve pull requests** (without this the PR step fails with a 403).

Run it: **Actions → Content refresh → Run workflow** (optional `max_new`, default 3). The cron schedule is commented out; enable it only after branch protection is on and a manual run has succeeded.

Guard rails:
- **One open bot PR at a time.** If a `bot/content-*` PR is open, the run exits without spending anything (candidates only reach `main` once a review PR is merged, so a second run would regenerate the same topics).
- **Spending cap** per run via `--max-new`; the OpenAI key is visible only to the generate step.
- **Partial failure** still opens a PR for what succeeded, then marks the run red.

Known limitation: PRs opened with the default `GITHUB_TOKEN` do not trigger other workflows, so `CI` will not run on the bot PR by itself. The PR only adds JSON under `pipeline/candidates/`, but if `check`/`pipeline` become *required* checks, close and reopen the PR (a human action) to trigger them.

## Test

```
uv run python -m pytest      # offline: HTTP is mocked, the LLM is a scripted fake
uv run ruff check . && uv run ruff format --check .
```

## Sources

| Source | Use | Notes |
| --- | --- | --- |
| Wikipedia (Action API) | Citable facts. Parses rendered HTML so tables survive; rejects disambiguation pages; drops bibliography sections; flags truncation. | Free, no key. |
| IMDb datasets | Vote counts as a popularity signal (`sources/imdb.py`). | Non-commercial licence; files cached in `.cache/` (git-ignored), never redistributed. Not yet wired into generation. |

Deliberately **not** used: scraping BookMyShow, Instagram or X (terms and bot protection), and TMDB (unavailable in the developer's region).

## Known limitations

- A grounded quote proves the text exists, not that it supports the evidence sentence beside it.
- Four familiarity tiers are coarse: two answers in a tier tie.
- Aliases are only as good as the model's suggestions.
