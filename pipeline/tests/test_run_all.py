import json
from datetime import date
from pathlib import Path

import pytest
from factories import FakeLLM, make_doc, make_question
from test_cli import ENV, FakeSource, failing_gate, passing_gate

from prillion_pipeline.cli import main
from prillion_pipeline.llm import LLMError
from prillion_pipeline.topics import TopicsError, load_topics

TODAY = date(2026, 10, 29)


def topic(topic_id: str, page: str, category: str = "space") -> dict:
    return {"id": topic_id, "category": category, "pages": [page], "brief": f"Name something from {page}."}


def write_topics(tmp_path: Path, *topics: dict) -> Path:
    path = tmp_path / "topics.json"
    path.write_text(json.dumps({"topics": list(topics)}), encoding="utf-8")
    return path


class RunAll:
    def __init__(
        self, tmp_path: Path, topics_path: Path, llm: FakeLLM, *, gate=passing_gate, env=ENV
    ) -> None:
        self.tmp_path = tmp_path
        self.topics_path = topics_path
        self.llm = llm
        self.gate = gate
        self.env = env
        self.lines: list[str] = []
        self.out_dir = tmp_path / "candidates"

    def __call__(self, *extra: str, pages: tuple[str, ...] = ("Page A", "Page B", "Page C")) -> int:
        source = FakeSource(*(make_doc(title=p) for p in pages))
        return main(
            ["run-all", "--topics", str(self.topics_path), "--out-dir", str(self.out_dir), *extra],
            env=self.env,
            source=source,
            llm_factory=lambda model: self.llm,
            gate=self.gate,
            today=TODAY,
            out=self.lines.append,
        )

    @property
    def text(self) -> str:
        return "\n".join(self.lines)


def three_topics(tmp_path: Path) -> Path:
    return write_topics(tmp_path, topic("a", "Page A"), topic("b", "Page B"), topic("c", "Page C"))


def test_generates_every_topic_within_the_cap(tmp_path: Path) -> None:
    run = RunAll(tmp_path, three_topics(tmp_path), FakeLLM(*[make_question() for _ in range(3)]))

    assert run("--max-new", "3") == 0
    assert sorted(p.name for p in run.out_dir.glob("*.json")) == ["a.json", "b.json", "c.json"]
    assert "generated 3: a, b, c" in run.text


def test_spending_cap_defers_the_rest_and_a_later_run_picks_them_up(tmp_path: Path) -> None:
    topics = three_topics(tmp_path)
    first = RunAll(tmp_path, topics, FakeLLM(make_question(), make_question()))

    assert first("--max-new", "2") == 0
    assert len(first.llm.calls) == 2
    assert "deferred  1: c" in first.text and not (first.out_dir / "c.json").exists()

    second = RunAll(tmp_path, topics, FakeLLM(make_question()))
    assert second("--max-new", "2") == 0
    assert len(second.llm.calls) == 1  # a and b were up to date; only c cost money
    assert "skipped   2: a, b" in second.text and (second.out_dir / "c.json").exists()


def test_one_failing_topic_does_not_stop_the_others_but_fails_the_run(tmp_path: Path) -> None:
    llm = FakeLLM(make_question(), LLMError("boom"), make_question())  # transport errors are not retried here
    run = RunAll(tmp_path, three_topics(tmp_path), llm)

    assert run("--max-new", "3") == 1
    assert (run.out_dir / "a.json").exists() and (run.out_dir / "c.json").exists()
    assert not (run.out_dir / "b.json").exists()
    assert "failed    1: b" in run.text


def test_gate_rejection_counts_as_failed(tmp_path: Path) -> None:
    run = RunAll(
        tmp_path, write_topics(tmp_path, topic("a", "Page A")), FakeLLM(make_question()), gate=failing_gate
    )

    assert run() == 1
    assert (run.out_dir / "a.failed.json").exists() and not (run.out_dir / "a.json").exists()


def test_unfetchable_page_is_an_error_for_that_topic_only(tmp_path: Path) -> None:
    topics = write_topics(tmp_path, topic("a", "Page A"), topic("x", "No Such Page"))
    run = RunAll(tmp_path, topics, FakeLLM(make_question()))

    assert run() == 1
    assert (run.out_dir / "a.json").exists()
    assert "error     1: x" in run.text


def test_dry_run_calls_nothing_and_needs_no_key(tmp_path: Path) -> None:
    run = RunAll(tmp_path, three_topics(tmp_path), FakeLLM(), env={})

    assert run("--dry-run") == 0
    assert run.llm.calls == [] and not run.out_dir.exists()
    assert "dry-run   3: a, b, c" in run.text


def test_missing_key_fails_fast_before_fetching(tmp_path: Path) -> None:
    lines: list[str] = []
    code = main(
        ["run-all", "--topics", str(three_topics(tmp_path)), "--out-dir", str(tmp_path / "c")],
        env={"PRILLION_OPENAI_MODEL": "m"},  # no OPENAI_API_KEY, and no injected LLM factory
        source=FakeSource(make_doc(title="Page A")),
        today=TODAY,
        out=lines.append,
    )

    text = "\n".join(lines)
    assert code == 2 and "OPENAI_API_KEY" in text and "fetched" not in text


def test_bad_topics_file_is_a_usage_error(tmp_path: Path) -> None:
    bad = tmp_path / "topics.json"
    bad.write_text("{not json", encoding="utf-8")
    run = RunAll(tmp_path, bad, FakeLLM())

    assert run() == 2 and "not valid JSON" in run.text


def test_invalid_id_on_run_is_a_usage_error_not_a_traceback(tmp_path: Path) -> None:
    lines: list[str] = []
    code = main(
        ["run", "--category", "space", "--id", "Bad Id", "--page", "P", "--brief", "b"],
        env=ENV,
        source=FakeSource(),
        today=TODAY,
        out=lines.append,
    )

    assert code == 2 and "invalid arguments" in "\n".join(lines)


def test_load_topics_rejects_duplicates_unknown_fields_and_bad_categories(tmp_path: Path) -> None:
    cases = {
        "duplicate": [topic("a", "P"), topic("a", "Q")],
        "category": [topic("a", "P", category="sports")],
        "extra": [{**topic("a", "P"), "colour": "blue"}],
        "no pages": [{**topic("a", "P"), "pages": []}],
        "id": [topic("Not Slug", "P")],
    }
    for name, topics in cases.items():
        with pytest.raises(TopicsError):
            load_topics(write_topics(tmp_path, *topics))
        assert name  # label for readable failures
