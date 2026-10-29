"""Command line: fetch sources, generate grounded candidates, gate them, write them to disk.

    uv run --env-file ../.env prillion-pipeline run \\
        --category space --id space-saturn-moons \\
        --page "Moons of Saturn" --brief "Name a moon of Saturn."

    uv run --env-file ../.env prillion-pipeline run-all --topics topics.json --max-new 3

Nothing here touches the live question bank. Output goes to a candidates folder for review.
"""

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

from pydantic import ValidationError

from .generate import GenerationResult, build_messages, generate_question, input_hash
from .llm import LLM, OpenAILLM
from .promote import BankRejected, PromoteError, promote
from .sources.base import Document, Source, SourceError
from .sources.wikipedia import WikipediaSource
from .topics import CATEGORY_NAMES, Topic, TopicsError, load_topics

DEFAULT_OUT_DIR = Path("candidates")
DEFAULT_TOPICS = Path("topics.json")
REPO_ROOT = Path(__file__).resolve().parents[3]
WEB_GATE_SCRIPT = REPO_ROOT / "web" / "scripts" / "check-candidate.ts"
BANK_GATE_SCRIPT = REPO_ROOT / "web" / "scripts" / "check-bank.ts"
DEFAULT_BANK = REPO_ROOT / "web" / "src" / "content" / "seed-bank.json"

GateRunner = Callable[[Path], tuple[bool, str]]
LLMFactory = Callable[[str], LLM]
Status = Literal["generated", "skipped", "failed", "deferred", "dry-run", "error"]


def _run_node_gate(script: Path, path: Path) -> tuple[bool, str]:
    try:
        done = subprocess.run(
            ["node", str(script), str(path)], capture_output=True, text=True, timeout=60, check=False
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return False, f"could not run the web gate ({exc}); is Node installed?"
    return done.returncode == 0, (done.stdout + done.stderr).strip()


def run_web_gate(path: Path) -> tuple[bool, str]:
    """Ask the web app's own validator whether this candidate is publishable."""
    return _run_node_gate(WEB_GATE_SCRIPT, path)


def run_bank_gate(path: Path) -> tuple[bool, str]:
    """Ask the web app's own validator whether this whole bank is publishable."""
    return _run_node_gate(BANK_GATE_SCRIPT, path)


@dataclass(frozen=True)
class Settings:
    """Everything a run needs. Injected so tests never touch the network or a real LLM."""

    env: Mapping[str, str]
    source: Source
    llm_factory: LLMFactory | None
    gate: GateRunner
    today: date
    out: Callable[[str], None]
    out_dir: Path
    model_override: str | None
    max_attempts: int
    force: bool
    dry_run: bool


@dataclass(frozen=True)
class Outcome:
    topic_id: str
    status: Status
    code: int  # process exit code for a single `run`: 0 ok, 1 rejected, 2 could not run


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="prillion-pipeline")
    commands = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--model", help="overrides PRILLION_OPENAI_MODEL")
        p.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
        p.add_argument("--max-attempts", type=int, default=3)
        p.add_argument(
            "--dry-run", action="store_true", help="fetch and size the prompt, but do not call the LLM"
        )
        p.add_argument(
            "--force", action="store_true", help="regenerate even if an identical candidate exists"
        )

    run = commands.add_parser("run", help="generate one candidate question")
    run.add_argument("--category", required=True, choices=CATEGORY_NAMES)
    run.add_argument("--id", required=True, dest="question_id", help="question id, e.g. space-saturn-moons")
    run.add_argument("--page", required=True, action="append", help="Wikipedia article title (repeatable)")
    run.add_argument("--brief", required=True, help="what the question should ask about")
    common(run)

    run_all = commands.add_parser("run-all", help="work through a topics file")
    run_all.add_argument("--topics", type=Path, default=DEFAULT_TOPICS)
    run_all.add_argument(
        "--max-new",
        type=int,
        default=3,
        help="most topics to send to the LLM in one run (a spending cap); the rest are deferred",
    )
    common(run_all)

    promote_cmd = commands.add_parser(
        "promote", help="add REVIEWED candidates to the live question bank (changes what players see)"
    )
    promote_cmd.add_argument("candidates", nargs="+", type=Path, help="candidate .json files to promote")
    promote_cmd.add_argument("--bank", type=Path, default=DEFAULT_BANK)
    promote_cmd.add_argument(
        "--approved-on", type=date.fromisoformat, help="approval date, YYYY-MM-DD (default: today)"
    )
    promote_cmd.add_argument(
        "--replace", action="store_true", help="allow replacing a live question that has the same id"
    )
    promote_cmd.add_argument(
        "--allow-ai-knowledge",
        action="store_true",
        help="also allow AI-knowledge questions (no cited sources). Only after a human checked each answer",
    )
    promote_cmd.add_argument(
        "--dry-run", action="store_true", help="validate the resulting bank but do not write it"
    )
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


def _config_error(s: Settings) -> str | None:
    if not (s.model_override or s.env.get("PRILLION_OPENAI_MODEL")):
        return "no model. Set PRILLION_OPENAI_MODEL in .env or pass --model"
    if s.llm_factory is None and not s.env.get("OPENAI_API_KEY"):
        return "OPENAI_API_KEY is not set. Run with: uv run --env-file ../.env prillion-pipeline ..."
    return None


def process_topic(topic: Topic, s: Settings, *, allow_generation: bool = True) -> Outcome:
    """Fetch, generate, ground-check and gate ONE topic. Never raises for expected failures."""
    out = s.out
    documents: list[Document] = []
    for title in topic.pages:
        try:
            doc = s.source.fetch(title)
        except SourceError as exc:
            out(f"error: {exc}")
            return Outcome(topic.id, "error", 2)
        documents.append(doc)
        flag = "  (TRUNCATED)" if doc.truncated else ""
        out(f"fetched {doc.title!r}: {len(doc.text):,} chars, revision {doc.version}{flag}")

    prompt_tokens = sum(
        _approx_tokens(m["content"]) for m in build_messages(topic.brief, topic.category, documents)
    )
    out(f"prompt is about {prompt_tokens:,} tokens")
    if s.dry_run:
        out("dry run: no LLM call made")
        return Outcome(topic.id, "dry-run", 0)

    problem = _config_error(s)
    if problem:
        out(f"error: {problem}")
        return Outcome(topic.id, "error", 2)
    model = s.model_override or s.env["PRILLION_OPENAI_MODEL"]

    target = s.out_dir / f"{topic.id}.json"
    if not s.force and _already_done(target, input_hash(model, topic.brief, topic.category, documents)):
        out(f"up to date: {target} was generated from identical inputs (use --force to regenerate)")
        return Outcome(topic.id, "skipped", 0)
    if not allow_generation:
        out("deferred: spending cap for this run reached; will be generated on a later run")
        return Outcome(topic.id, "deferred", 0)

    llm = (s.llm_factory or OpenAILLM)(model)
    out(f"generating with {model} (up to {s.max_attempts} attempts)...")
    result = generate_question(
        llm,
        documents,
        brief=topic.brief,
        category=topic.category,
        question_id=topic.id,
        today=s.today,
        max_attempts=s.max_attempts,
    )

    for issue in result.issues:
        out(f"  {issue}")
    failed = s.out_dir / f"{topic.id}.failed.json"
    if not result.ok or result.question is None:
        if result.question is not None:
            _write(failed, result)
            out(f"FAILED grounding after {result.attempts} attempt(s); inspect {failed}")
        else:
            out(f"FAILED after {result.attempts} attempt(s): no question produced")
        return Outcome(topic.id, "failed", 1)

    _write(target, result)
    out(f"grounding passed after {result.attempts} attempt(s); wrote {target}")

    passed, report = s.gate(target)
    out(report)
    if not passed:
        # Move it aside so a rerun does not mistake a rejected candidate for a finished one.
        os.replace(target, failed)
        out(f"web quality gate FAILED: not publishable as-is; kept for inspection at {failed}")
        return Outcome(topic.id, "failed", 1)
    out("web quality gate passed: ready for human review")
    return Outcome(topic.id, "generated", 0)


def _run_all(args: argparse.Namespace, s: Settings) -> int:
    try:
        topics = load_topics(args.topics)
    except TopicsError as exc:
        s.out(f"error: {exc}")
        return 2
    if not s.dry_run and (problem := _config_error(s)):
        s.out(f"error: {problem}")  # fail fast: do not fetch a dozen pages just to learn the key is missing
        return 2

    outcomes: list[Outcome] = []
    spent = 0  # topics sent to the LLM this run
    for n, topic in enumerate(topics, start=1):
        s.out(f"\n[{n}/{len(topics)}] {topic.id}")
        outcome = process_topic(topic, s, allow_generation=spent < args.max_new)
        if outcome.status in ("generated", "failed"):
            spent += 1
        outcomes.append(outcome)

    s.out("\nsummary")
    for status in ("generated", "skipped", "deferred", "dry-run", "failed", "error"):
        ids = [o.topic_id for o in outcomes if o.status == status]
        if ids:
            s.out(f"  {status:<9} {len(ids)}: {', '.join(ids)}")
    # One bad topic must not hide the others, but the run as a whole must still look failed.
    return 1 if any(o.status in ("failed", "error") for o in outcomes) else 0


def _promote(args: argparse.Namespace, bank_gate: GateRunner, today: date, out: Callable[[str], None]) -> int:
    approved_on = args.approved_on or today
    try:
        promotions = promote(
            args.candidates,
            args.bank,
            approved_on=approved_on,
            gate=bank_gate,
            replace=args.replace,
            dry_run=args.dry_run,
            allow_ai_knowledge=args.allow_ai_knowledge,
        )
    except BankRejected as exc:
        out(f"error: {exc}")
        return 1
    except PromoteError as exc:
        out(f"error: {exc}")
        return 2

    for p in promotions:
        out(f"{p.action:<8} {p.question_id} ({p.answers} answers, approvedOn {approved_on.isoformat()})")
        for warning in p.warnings:
            out(f"           note: {warning}")
    if args.dry_run:
        out(f"dry run: the resulting bank passed the web gate; {args.bank} was NOT changed")
    else:
        out(f"wrote {args.bank}")
        out("next: review `git diff`, run `npm run check` in web/, then open a PR")
        out("      (this changes what players see)")
    return 0


def main(
    argv: Sequence[str] | None = None,
    *,
    env: Mapping[str, str] | None = None,
    source: Source | None = None,
    llm_factory: LLMFactory | None = None,
    gate: GateRunner = run_web_gate,
    bank_gate: GateRunner = run_bank_gate,
    today: date | None = None,
    out: Callable[[str], None] = print,
) -> int:
    args = _parser().parse_args(argv)
    if args.command == "promote":
        return _promote(args, bank_gate, today or date.today(), out)
    settings = Settings(
        env=os.environ if env is None else env,
        source=source or WikipediaSource(),
        llm_factory=llm_factory,
        gate=gate,
        today=today or date.today(),
        out=out,
        out_dir=args.out_dir,
        model_override=args.model,
        max_attempts=args.max_attempts,
        force=args.force,
        dry_run=args.dry_run,
    )
    if args.command == "run-all":
        return _run_all(args, settings)
    try:
        topic = Topic(id=args.question_id, category=args.category, pages=args.page, brief=args.brief)
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        out(f"error: invalid arguments: {problems}")
        return 2
    return process_topic(topic, settings).code


def entrypoint() -> None:
    sys.exit(main())
