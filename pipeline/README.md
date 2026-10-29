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
