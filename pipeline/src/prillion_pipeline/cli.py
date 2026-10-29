"""Command line: fetch sources, generate one grounded candidate, gate it, write it to disk.

    uv run --env-file ../.env prillion-pipeline run \\
        --category space --id space-saturn-moons \\
        --page "Moons of Saturn" \\
        --brief "Name a moon of Saturn"

Nothing here touches the live question bank. Output goes to a candidates folder for review.
"""

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from datetime import date
from pathlib import Path
from typing import Any

from .candidate import Category
from .generate import GenerationResult, build_messages, generate_question, input_hash
from .llm import LLM, OpenAILLM
from .sources.base import Document, Source, SourceError
from .sources.wikipedia import WikipediaSource

CATEGORIES = ("tollywood", "space", "us-pop")
DEFAULT_OUT_DIR = Path("candidates")
WEB_GATE_SCRIPT = Path(__file__).resolve().parents[3] / "web" / "scripts" / "check-candidate.ts"

GateRunner = Callable[[Path], tuple[bool, str]]
LLMFactory = Callable[[str], LLM]


def run_web_gate(path: Path) -> tuple[bool, str]:
    """Ask the web app's own validator whether this candidate is publishable."""
    try:
        done = subprocess.run(
            ["node", str(WEB_GATE_SCRIPT), str(path)], capture_output=True, text=True, timeout=60, check=False
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return False, f"could not run the web gate ({exc}); is Node installed?"
    return done.returncode == 0, (done.stdout + done.stderr).strip()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="prillion-pipeline")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run", help="generate one candidate question")
    run.add_argument("--category", required=True, choices=CATEGORIES)
    run.add_argument("--id", required=True, dest="question_id", help="question id, e.g. space-saturn-moons")
    run.add_argument("--page", required=True, action="append", help="Wikipedia article title (repeatable)")
    run.add_argument("--brief", required=True, help="what the question should ask about")
    run.add_argument("--model", help="overrides PRILLION_OPENAI_MODEL")
    run.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    run.add_argument("--max-attempts", type=int, default=3)
    run.add_argument(
        "--dry-run", action="store_true", help="fetch and size the prompt, but do not call the LLM"
    )
    run.add_argument("--force", action="store_true", help="regenerate even if an identical candidate exists")
    return parser


def _approx_tokens(text: str) -> int:
    return len(text) // 4  # rough rule of thumb for English; only used for cost awareness


def _write(path: Path, result: GenerationResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"question": result.question, "provenance": result.provenance}
    # Write-then-rename: a crash never leaves half a file for a later run to trust.
    partial = path.with_suffix(path.suffix + ".part")
    partial.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(partial, path)


def _already_done(path: Path, wanted_hash: str) -> bool:
    if not path.exists():
        return False
    try:
        existing: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    except OSError, json.JSONDecodeError:
        return False
    return existing.get("provenance", {}).get("inputHash") == wanted_hash


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    source: Source | None = None,
    llm_factory: LLMFactory | None = None,
    gate: GateRunner = run_web_gate,
    today: date | None = None,
    out: Callable[[str], None] = print,
) -> int:
    args = _parser().parse_args(argv)
    env = os.environ if env is None else env
    source = source or WikipediaSource()
    category: Category = args.category

    documents: list[Document] = []
    for title in args.page:
        try:
            doc = source.fetch(title)
        except SourceError as exc:
            out(f"error: {exc}")
            return 2
        documents.append(doc)
        flag = "  (TRUNCATED)" if doc.truncated else ""
        out(f"fetched {doc.title!r}: {len(doc.text):,} chars, revision {doc.version}{flag}")

    prompt_tokens = sum(_approx_tokens(m["content"]) for m in build_messages(args.brief, category, documents))
    out(f"prompt is about {prompt_tokens:,} tokens")
    if args.dry_run:
        out("dry run: no LLM call made")
        return 0

    model = args.model or env.get("PRILLION_OPENAI_MODEL", "")
    if not model:
        out("error: no model. Set PRILLION_OPENAI_MODEL in .env or pass --model")
        return 2
    if llm_factory is None and not env.get("OPENAI_API_KEY"):
        out("error: OPENAI_API_KEY is not set. Run with: uv run --env-file ../.env prillion-pipeline ...")
        return 2

    target = args.out_dir / f"{args.question_id}.json"
    wanted = input_hash(model, args.brief, category, documents)
    if not args.force and _already_done(target, wanted):
        out(f"up to date: {target} was generated from identical inputs (use --force to regenerate)")
        return 0

    llm = (llm_factory or OpenAILLM)(model)
    out(f"generating with {model} (up to {args.max_attempts} attempts)...")
    result = generate_question(
        llm,
        documents,
        brief=args.brief,
        category=category,
        question_id=args.question_id,
        today=today or date.today(),
        max_attempts=args.max_attempts,
    )

    for issue in result.issues:
        out(f"  {issue}")
    if not result.ok or result.question is None:
        failed = args.out_dir / f"{args.question_id}.failed.json"
        if result.question is not None:
            _write(failed, result)
            out(f"FAILED grounding after {result.attempts} attempt(s); inspect {failed}")
        else:
            out(f"FAILED after {result.attempts} attempt(s): no question produced")
        return 1

    _write(target, result)
    out(f"grounding passed after {result.attempts} attempt(s); wrote {target}")

    passed, report = gate(target)
    out(report)
    if not passed:
        # Move it aside so a rerun does not mistake a rejected candidate for a finished one.
        failed = args.out_dir / f"{args.question_id}.failed.json"
        os.replace(target, failed)
        out(f"web quality gate FAILED: not publishable as-is; kept for inspection at {failed}")
        return 1
    out("web quality gate passed: ready for human review")
    return 0


def entrypoint() -> None:
    sys.exit(main())
