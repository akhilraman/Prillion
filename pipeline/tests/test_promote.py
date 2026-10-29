import json
from datetime import date
from pathlib import Path

from factories import make_doc, make_question

from prillion_pipeline.candidate import to_bank_question
from prillion_pipeline.cli import main

TODAY = date(2026, 10, 30)
GENERATED = date(2026, 10, 29)


def bank_question(question_id: str, **overrides: object) -> dict:
    generated = make_question(**overrides)
    return to_bank_question(
        generated, [make_doc()], question_id=question_id, category="space", approved_on=GENERATED
    )


def write_bank(tmp_path: Path, *questions: dict) -> Path:
    path = tmp_path / "bank.json"
    path.write_text(
        json.dumps({"schemaVersion": 1, "questions": list(questions)}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return path


def write_candidate(tmp_path: Path, question_id: str, *, name: str | None = None, issues=(), **kw) -> Path:
    path = tmp_path / (name or f"{question_id}.json")
    payload = {"question": bank_question(question_id, **kw), "provenance": {"issues": list(issues)}}
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


class Gate:
    """Records what bank it was asked to check; passes unless told to fail."""

    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.seen: list[dict] = []

    def __call__(self, path: Path) -> tuple[bool, str]:
        self.seen.append(json.loads(path.read_text(encoding="utf-8")))
        return self.ok, ("PASS" if self.ok else "FAIL bank\n  quality q-new too-few-tiers")


def run(tmp_path: Path, bank: Path, *args: str, gate: Gate | None = None) -> tuple[int, str, Gate]:
    gate = gate or Gate()
    lines: list[str] = []
    code = main(["promote", *args, "--bank", str(bank)], bank_gate=gate, today=TODAY, out=lines.append)
    return code, "\n".join(lines), gate


def live(bank: Path) -> dict:
    return json.loads(bank.read_text(encoding="utf-8"))


def test_adds_the_question_with_todays_approval_date_and_no_provenance(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))
    candidate = write_candidate(tmp_path, "q-new")

    code, text, _ = run(tmp_path, bank, str(candidate))

    assert code == 0 and "added" in text and "q-new" in text
    questions = live(bank)["questions"]
    assert [q["id"] for q in questions] == ["existing", "q-new"]
    assert questions[1]["approvedOn"] == "2026-10-30"  # promotion date, not the generation date
    assert "provenance" not in questions[1]
    assert questions[0] == bank_question("existing")  # untouched
    assert not list(tmp_path.glob("*.part"))


def test_approved_on_can_be_set_explicitly(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))

    code, _, _ = run(tmp_path, bank, str(write_candidate(tmp_path, "q-new")), "--approved-on", "2026-11-02")

    assert code == 0 and live(bank)["questions"][1]["approvedOn"] == "2026-11-02"


def test_output_keeps_the_banks_formatting_and_non_ascii_text(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))
    candidate = write_candidate(tmp_path, "q-new", explanation="\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41")

    run(tmp_path, bank, str(candidate))

    raw = bank.read_text(encoding="utf-8")
    assert "\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41" in raw  # not escaped to \uXXXX
    assert raw.endswith("}\n") and raw.startswith('{\n  "schemaVersion": 1,')
    assert json.dumps(json.loads(raw), indent=2, ensure_ascii=False) + "\n" == raw


def test_the_gate_sees_the_whole_resulting_bank(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))

    _, _, gate = run(tmp_path, bank, str(write_candidate(tmp_path, "q-new")))

    assert [q["id"] for q in gate.seen[0]["questions"]] == ["existing", "q-new"]


def test_gate_failure_leaves_the_live_bank_untouched(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))
    before = bank.read_text(encoding="utf-8")

    code, text, _ = run(tmp_path, bank, str(write_candidate(tmp_path, "q-new")), gate=Gate(ok=False))

    assert code == 1 and "nothing was written" in text and "too-few-tiers" in text
    assert bank.read_text(encoding="utf-8") == before
    assert not list(tmp_path.glob("*.part"))


def test_dry_run_validates_but_never_writes(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))
    before = bank.read_text(encoding="utf-8")

    code, text, gate = run(tmp_path, bank, str(write_candidate(tmp_path, "q-new")), "--dry-run")

    assert code == 0 and "NOT changed" in text and len(gate.seen) == 1
    assert bank.read_text(encoding="utf-8") == before and not list(tmp_path.glob("*.part"))


def test_an_id_that_is_already_live_is_refused_without_replace(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("q-live", prompt="Hand curated."))
    before = bank.read_text(encoding="utf-8")

    code, text, gate = run(tmp_path, bank, str(write_candidate(tmp_path, "q-live")))

    assert code == 2 and "already in the live bank" in text and "--replace" in text
    assert bank.read_text(encoding="utf-8") == before and gate.seen == []


def test_replace_swaps_in_place_and_keeps_the_order(tmp_path: Path) -> None:
    bank = write_bank(
        tmp_path, bank_question("a"), bank_question("q-live", prompt="Old."), bank_question("c")
    )

    code, text, _ = run(
        tmp_path, bank, str(write_candidate(tmp_path, "q-live", prompt="New prompt.")), "--replace"
    )

    assert code == 0 and "replaced" in text
    questions = live(bank)["questions"]
    assert [q["id"] for q in questions] == ["a", "q-live", "c"]
    assert questions[1]["prompt"] == "New prompt."


def test_a_batch_is_all_or_nothing(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))
    before = bank.read_text(encoding="utf-8")
    good = write_candidate(tmp_path, "q-new")
    not_a_candidate = tmp_path / "junk.json"
    not_a_candidate.write_text('{"hello": 1}', encoding="utf-8")

    code, text, _ = run(tmp_path, bank, str(good), str(not_a_candidate))

    assert code == 2 and "not a candidate file" in text
    assert bank.read_text(encoding="utf-8") == before


def test_the_same_id_twice_in_one_batch_is_refused(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))
    one = write_candidate(tmp_path, "q-new")
    two = write_candidate(tmp_path, "q-new", name="copy.json")

    code, text, _ = run(tmp_path, bank, str(one), str(two))

    assert code == 2 and "appears twice" in text


def test_rejected_candidates_cannot_be_promoted(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))
    rejected = write_candidate(tmp_path, "q-new", name="q-new.failed.json")

    code, text, _ = run(tmp_path, bank, str(rejected))

    assert code == 2 and "REJECTED" in text


def test_unreadable_inputs_are_clean_errors(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))

    missing_candidate, text1, _ = run(tmp_path, bank, str(tmp_path / "nope.json"))
    missing_bank, text2, _ = run(tmp_path, tmp_path / "no-bank.json", str(write_candidate(tmp_path, "q")))

    assert missing_candidate == 2 and "cannot read candidate" in text1
    assert missing_bank == 2 and "cannot read bank" in text2


def test_warnings_from_provenance_are_shown_but_do_not_block(tmp_path: Path) -> None:
    bank = write_bank(tmp_path, bank_question("existing"))
    warning = {
        "severity": "warning",
        "code": "quote-does-not-name-answer",
        "message": "quote never mentions Titan",
        "answer": "Titan",
    }
    candidate = write_candidate(tmp_path, "q-new", issues=[warning])

    code, text, _ = run(tmp_path, bank, str(candidate))

    assert code == 0 and "quote-does-not-name-answer" in text


def write_ai_candidate(tmp_path: Path, question_id: str) -> Path:
    question = {**bank_question(question_id), "basis": "ai-knowledge", "sources": []}
    path = tmp_path / f"{question_id}.json"
    path.write_text(json.dumps({"question": question, "provenance": {"issues": []}}), encoding="utf-8")
    return path


def test_ai_knowledge_questions_are_refused_without_an_explicit_opt_in(tmp_path: Path) -> None:
    bank = write_bank(tmp_path)
    candidate = write_ai_candidate(tmp_path, "us-pop-meme")
    before = bank.read_text(encoding="utf-8")

    code, output, gate = run(tmp_path, bank, str(candidate))

    assert code == 2
    assert "AI-knowledge" in output and "--allow-ai-knowledge" in output
    assert bank.read_text(encoding="utf-8") == before
    assert gate.seen == []  # refused before the bank was even built


def test_ai_knowledge_questions_promote_with_the_opt_in_and_keep_their_basis(tmp_path: Path) -> None:
    bank = write_bank(tmp_path)
    candidate = write_ai_candidate(tmp_path, "us-pop-meme")

    code, _output, _gate = run(tmp_path, bank, str(candidate), "--allow-ai-knowledge")

    assert code == 0
    [promoted] = live(bank)["questions"]
    assert promoted["basis"] == "ai-knowledge" and promoted["sources"] == []


def test_sourced_questions_never_need_the_opt_in(tmp_path: Path) -> None:
    bank = write_bank(tmp_path)
    candidate = write_candidate(tmp_path, "space-plain")
    code, _output, _gate = run(tmp_path, bank, str(candidate))
    assert code == 0
