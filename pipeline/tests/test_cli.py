import json
from datetime import date
from pathlib import Path

import pytest
from factories import FakeLLM, make_answer, make_doc, make_question

from prillion_pipeline.cli import main
from prillion_pipeline.sources.base import Document, SourceError

TODAY = date(2026, 10, 29)
ENV = {"OPENAI_API_KEY": "sk-test", "PRILLION_OPENAI_MODEL": "fake-model"}


class FakeSource:
    def __init__(self, *docs: Document) -> None:
        self.docs = {d.title: d for d in docs}

    def fetch(self, key: str) -> Document:
        if key not in self.docs:
            raise SourceError(f"Wikipedia has no page titled {key!r}")
        return self.docs[key]


def passing_gate(path: Path) -> tuple[bool, str]:
    return True, f"PASS {path}"


def failing_gate(path: Path) -> tuple[bool, str]:
    return False, f"FAIL {path}\n  quality too-few-answers"


class Run:
    """Invokes the CLI with fakes and captures output."""

    def __init__(self, tmp_path: Path, llm: FakeLLM | None = None, gate=passing_gate, env=ENV) -> None:
        self.out_dir = tmp_path / "candidates"
        self.lines: list[str] = []
        self.llm = llm or FakeLLM(make_question())
        self.gate = gate
        self.env = env

    def __call__(self, *extra: str, pages: tuple[str, ...] = ("Moons of Saturn",)) -> int:
        argv = ["run", "--category", "space", "--id", "q1", "--brief", "Moons of Saturn"]
        argv += [a for page in pages for a in ("--page", page)]
        argv += ["--out-dir", str(self.out_dir), *extra]
        return main(
            argv,
            env=self.env,
            source=FakeSource(make_doc(title="Moons of Saturn")),
            llm_factory=lambda model: self.llm,
            gate=self.gate,
            today=TODAY,
            out=self.lines.append,
        )

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


def test_happy_path_writes_a_candidate_with_provenance(tmp_path: Path) -> None:
    run = Run(tmp_path)

    assert run() == 0
    written = json.loads((run.out_dir / "q1.json").read_text())
    assert written["question"]["id"] == "q1" and written["question"]["category"] == "space"
    assert written["provenance"]["model"] == "fake-model"
    assert "ready for human review" in run.text
    assert not list(run.out_dir.glob("*.part"))


def test_identical_rerun_is_skipped_without_calling_the_llm(tmp_path: Path) -> None:
    run = Run(tmp_path, llm=FakeLLM(make_question()))
    assert run() == 0 and len(run.llm.calls) == 1

    again = Run(tmp_path, llm=FakeLLM())  # no responses scripted: any call would raise
    assert again() == 0
    assert "up to date" in again.text and again.llm.calls == []


def test_force_regenerates(tmp_path: Path) -> None:
    Run(tmp_path)()
    second = Run(tmp_path, llm=FakeLLM(make_question()))

    assert second("--force") == 0 and len(second.llm.calls) == 1


def test_changed_brief_regenerates(tmp_path: Path) -> None:
    Run(tmp_path)()
    run = Run(tmp_path, llm=FakeLLM(make_question()))
    argv = [
        "run",
        "--category",
        "space",
        "--id",
        "q1",
        "--brief",
        "A different brief",
        "--page",
        "Moons of Saturn",
    ]
    code = main(
        [*argv, "--out-dir", str(run.out_dir)],
        env=ENV,
        source=FakeSource(make_doc(title="Moons of Saturn")),
        llm_factory=lambda m: run.llm,
        gate=passing_gate,
        today=TODAY,
        out=run.lines.append,
    )

    assert code == 0 and len(run.llm.calls) == 1


def test_dry_run_fetches_but_never_calls_the_llm_or_writes(tmp_path: Path) -> None:
    run = Run(tmp_path, llm=FakeLLM())

    assert run("--dry-run") == 0
    assert "dry run" in run.text and "tokens" in run.text
    assert run.llm.calls == [] and not run.out_dir.exists()


def test_dry_run_needs_no_key_or_model(tmp_path: Path) -> None:
    assert Run(tmp_path, env={})("--dry-run") == 0


def test_missing_model_or_key_is_a_clear_error(tmp_path: Path) -> None:
    no_model = Run(tmp_path, env={"OPENAI_API_KEY": "sk-test"})
    assert no_model() == 2 and "PRILLION_OPENAI_MODEL" in no_model.text

    argv = ["run", "--category", "space", "--id", "q1", "--brief", "b", "--page", "Moons of Saturn"]
    lines: list[str] = []
    code = main(
        [*argv, "--out-dir", str(tmp_path / "c")],
        env={"PRILLION_OPENAI_MODEL": "m"},
        source=FakeSource(make_doc(title="Moons of Saturn")),
        out=lines.append,
    )
    assert code == 2 and "OPENAI_API_KEY" in "\n".join(lines)


def test_model_flag_overrides_the_environment(tmp_path: Path) -> None:
    run = Run(tmp_path, env={"OPENAI_API_KEY": "sk-test"})

    assert run("--model", "cli-model") == 0


def test_unknown_wikipedia_page_stops_before_any_llm_call(tmp_path: Path) -> None:
    run = Run(tmp_path, llm=FakeLLM())

    assert run(pages=("No Such Page",)) == 2
    assert "no page titled" in run.text and run.llm.calls == []


def test_ungrounded_output_is_kept_for_inspection_and_exits_nonzero(tmp_path: Path) -> None:
    bad = make_question([make_answer("Rhea", "Rhea has a thin oxygen atmosphere and rings of ice.")])
    run = Run(tmp_path, llm=FakeLLM(bad, bad, bad))

    assert run() == 1
    assert (run.out_dir / "q1.failed.json").exists() and not (run.out_dir / "q1.json").exists()
    assert "FAILED grounding after 3" in run.text


def test_gate_failure_moves_the_candidate_aside_so_reruns_do_not_skip_it(tmp_path: Path) -> None:
    run = Run(tmp_path, gate=failing_gate)

    assert run() == 1
    assert (run.out_dir / "q1.failed.json").exists() and not (run.out_dir / "q1.json").exists()
    assert "gate FAILED" in run.text

    retry = Run(tmp_path, llm=FakeLLM(make_question()))
    assert retry() == 0 and len(retry.llm.calls) == 1  # not "up to date"


def test_candidate_passes_through_the_real_web_gate_script_contract(tmp_path: Path) -> None:
    """The file we write must be the `{question, provenance}` shape the TS gate reads."""
    run = Run(tmp_path)
    run()
    written = json.loads((run.out_dir / "q1.json").read_text())

    assert set(written) == {"question", "provenance"}
    assert {
        "id",
        "category",
        "prompt",
        "answerSet",
        "answers",
        "explanation",
        "sources",
        "approvedOn",
    } <= set(written["question"])


@pytest.mark.parametrize("flag", ["--category", "--id", "--brief"])
def test_required_arguments(flag: str, tmp_path: Path) -> None:
    argv = ["run", "--category", "space", "--id", "q", "--page", "p", "--brief", "b"]
    i = argv.index(flag)
    with pytest.raises(SystemExit):
        main(argv[:i] + argv[i + 2 :], env={}, source=FakeSource(), out=lambda s: None)
