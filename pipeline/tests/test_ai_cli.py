import json
from datetime import date
from pathlib import Path

import pytest
from factories import FakeLLM
from test_ai_generate import NAMES, all_correct, full_sample
from test_cli import ENV, FakeSource, failing_gate, passing_gate
from test_run_all import write_topics

from prillion_pipeline.cli import main
from prillion_pipeline.topics import TopicsError, load_topics

TODAY = date(2026, 10, 30)


def ai_topic(topic_id: str = "us-pop-memes") -> dict:
    return {
        "id": topic_id,
        "category": "us-pop",
        "mode": "ai-knowledge",
        "brief": "Name a famous internet meme.",
    }


def good_llm() -> FakeLLM:
    return FakeLLM(full_sample(), full_sample(), full_sample(), all_correct(NAMES))


def run(
    tmp_path: Path, *argv: str, llm: FakeLLM | None = None, gate=passing_gate, env=ENV
) -> tuple[int, str]:
    lines: list[str] = []
    code = main(
        [*argv, "--out-dir", str(tmp_path / "c")],
        env=env,
        source=FakeSource(),  # an AI topic must never fetch anything
        llm_factory=lambda model: llm or good_llm(),
        gate=gate,
        today=TODAY,
        out=lines.append,
    )
    return code, "\n".join(lines)


RUN_ARGS = (
    "run",
    "--category",
    "us-pop",
    "--id",
    "us-pop-memes",
    "--brief",
    "Famous memes",
    "--ai-knowledge",
)


def test_run_writes_an_ai_knowledge_candidate(tmp_path: Path) -> None:
    code, text = run(tmp_path, *RUN_ARGS)

    assert code == 0, text
    written = json.loads((tmp_path / "c" / "us-pop-memes.json").read_text())
    assert written["question"]["basis"] == "ai-knowledge"
    assert written["question"]["sources"] == []
    assert written["provenance"]["votes"]
    assert "Check EVERY answer yourself" in text


def test_dry_run_makes_no_llm_call(tmp_path: Path) -> None:
    llm = FakeLLM()

    code, text = run(tmp_path, *RUN_ARGS, "--dry-run", llm=llm)

    assert code == 0 and llm.calls == []
    assert "3 samples + 1 verifier" in text


def test_identical_rerun_is_skipped(tmp_path: Path) -> None:
    run(tmp_path, *RUN_ARGS)
    llm = FakeLLM()

    code, text = run(tmp_path, *RUN_ARGS, llm=llm)

    assert code == 0 and llm.calls == []
    assert "up to date" in text


def test_gate_rejection_moves_the_candidate_aside(tmp_path: Path) -> None:
    code, _ = run(tmp_path, *RUN_ARGS, gate=failing_gate)

    assert code == 1
    assert not (tmp_path / "c" / "us-pop-memes.json").exists()
    assert (tmp_path / "c" / "us-pop-memes.failed.json").exists()


def test_a_sourced_run_still_needs_a_page(tmp_path: Path) -> None:
    code, text = run(tmp_path, "run", "--category", "us-pop", "--id", "q", "--brief", "b")

    assert code == 2
    assert "at least one page" in text


def test_an_ai_run_rejects_pages(tmp_path: Path) -> None:
    code, text = run(tmp_path, *RUN_ARGS, "--page", "Some Page")

    assert code == 2
    assert "no pages" in text


def test_run_all_mixes_ai_topics_into_the_queue(tmp_path: Path) -> None:
    topics = write_topics(tmp_path, ai_topic())
    lines: list[str] = []

    code = main(
        ["run-all", "--topics", str(topics), "--out-dir", str(tmp_path / "c")],
        env=ENV,
        source=FakeSource(),
        llm_factory=lambda model: good_llm(),
        gate=passing_gate,
        today=TODAY,
        out=lines.append,
    )

    assert code == 0, "\n".join(lines)
    assert (tmp_path / "c" / "us-pop-memes.json").exists()


def test_topics_file_validates_mode_and_pages(tmp_path: Path) -> None:
    ok = write_topics(tmp_path, ai_topic())
    assert load_topics(ok)[0].mode == "ai-knowledge"

    with_pages = tmp_path / "bad1.json"
    with_pages.write_text(json.dumps({"topics": [{**ai_topic(), "pages": ["X"]}]}))
    no_pages = tmp_path / "bad2.json"
    no_pages.write_text(json.dumps({"topics": [{"id": "a", "category": "space", "brief": "b"}]}))
    for bad in (with_pages, no_pages):
        with pytest.raises(TopicsError):
            load_topics(bad)
