"""Promote reviewed candidates into the LIVE question bank.

This is the only code path that changes what players see, so it is deliberately strict:

- All or nothing: a batch is either fully applied or the bank is left untouched.
- Validate before saving: the new bank is written to a temp file and must pass the web
  app's own bank gate (structure + quality for every question) before it replaces the
  live file. A bad promotion can never be saved.
- No silent overwrites: an id that is already live is refused unless `replace` is set.
- Rejected candidates (`*.failed.json`) are refused outright.
- `basis: "ai-knowledge"` questions (written from model memory, no sources) are refused unless the
  caller opts in with `allow_ai_knowledge`, so they can never reach players by accident.

The candidate's `provenance` stays in the candidate file (and git history); the live bank
carries only what the game needs. `approvedOn` is set to the date of THIS promotion, i.e.
the day a human approved the question for play, not the day it was generated.
"""

import json
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal

BankGate = Callable[[Path], tuple[bool, str]]


class PromoteError(Exception):
    """The promotion cannot proceed (bad input). Nothing was written."""


class BankRejected(PromoteError):  # noqa: N818 - reads better than BankRejectedError
    """The resulting bank failed the web gate. Nothing was written."""


@dataclass(frozen=True)
class Promotion:
    question_id: str
    action: Literal["added", "replaced"]
    answers: int
    warnings: tuple[str, ...]


def _read_json(path: Path, what: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise PromoteError(f"cannot read {what} {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PromoteError(f"{what} {path} is not valid JSON: {exc}") from exc


def _describe(issue: Any) -> str:
    if isinstance(issue, dict):
        return f"{issue.get('severity', '?')} {issue.get('code', '?')}: {issue.get('message', '')}".strip()
    return str(issue)


def _load_candidate(path: Path) -> tuple[dict[str, Any], tuple[str, ...]]:
    if path.name.endswith(".failed.json"):
        raise PromoteError(f"{path.name} is a REJECTED candidate; fix and regenerate it instead")
    data = _read_json(path, "candidate")
    question = data.get("question") if isinstance(data, dict) else None
    if not isinstance(question, dict) or not isinstance(question.get("id"), str):
        raise PromoteError(
            f"{path} is not a candidate file (expected an object with a `question` that has an id)"
        )
    provenance = data.get("provenance")
    issues = provenance.get("issues", []) if isinstance(provenance, dict) else []
    warnings = tuple(
        _describe(i) for i in issues if not (isinstance(i, dict) and i.get("severity") == "error")
    )
    return question, warnings


def serialize(bank: dict[str, Any]) -> str:
    """The exact formatting of web/src/content/seed-bank.json (it is excluded from Prettier)."""
    return json.dumps(bank, indent=2, ensure_ascii=False) + "\n"


def promote(
    candidates: Sequence[Path],
    bank_path: Path,
    *,
    approved_on: date,
    gate: BankGate,
    replace: bool = False,
    dry_run: bool = False,
    allow_ai_knowledge: bool = False,
) -> list[Promotion]:
    bank = _read_json(bank_path, "bank")
    if not isinstance(bank, dict) or not isinstance(bank.get("questions"), list):
        raise PromoteError(f"{bank_path} is not a question bank (expected an object with a `questions` list)")

    questions: list[dict[str, Any]] = list(bank["questions"])
    position = {q.get("id"): i for i, q in enumerate(questions)}
    promotions: list[Promotion] = []
    batch: set[str] = set()

    for path in candidates:
        question, warnings = _load_candidate(path)
        question_id = question["id"]
        if question_id in batch:
            raise PromoteError(f"{question_id!r} appears twice in this batch")
        batch.add(question_id)

        if question.get("basis") == "ai-knowledge" and not allow_ai_knowledge:
            raise PromoteError(
                f"{question_id!r} is an AI-knowledge question (no cited sources). Promote it only after "
                "a human has checked every answer, and say so with --allow-ai-knowledge."
            )

        question = {**question, "approvedOn": approved_on.isoformat()}
        if question_id in position:
            if not replace:
                raise PromoteError(
                    f"{question_id!r} is already in the live bank. Pass --replace only if you mean to "
                    "swap the live question for this candidate."
                )
            questions[position[question_id]] = question
            action: Literal["added", "replaced"] = "replaced"
        else:
            position[question_id] = len(questions)
            questions.append(question)
            action = "added"
        promotions.append(Promotion(question_id, action, len(question.get("answers", [])), warnings))

    # Validate the RESULT, not the inputs: a candidate can be fine alone and still break the bank.
    partial = bank_path.with_suffix(bank_path.suffix + ".part")
    partial.write_text(serialize({**bank, "questions": questions}), encoding="utf-8")
    try:
        passed, report = gate(partial)
        if not passed:
            raise BankRejected(f"the resulting bank failed the web gate; nothing was written.\n{report}")
        if dry_run:
            return promotions
        os.replace(partial, bank_path)  # atomic: readers see the old bank or the new one, never half
    finally:
        partial.unlink(missing_ok=True)
    return promotions
