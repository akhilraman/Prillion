from datetime import date

import pytest
from factories import make_answer, make_doc, make_question

from prillion_pipeline.candidate import (
    OPEN_SET_COVERAGE,
    TIER_WEIGHTS,
    answer_id,
    shares_from_tiers,
    to_bank_question,
)


def test_open_sets_sum_below_one_and_closed_sets_to_one() -> None:
    open_total = sum(shares_from_tiers(make_question(answer_set="open")))
    closed_total = sum(shares_from_tiers(make_question(answer_set="closed")))

    assert open_total == pytest.approx(OPEN_SET_COVERAGE, abs=1e-3)
    assert closed_total == pytest.approx(1.0, abs=1e-3)


def test_tiers_are_ordered_by_share() -> None:
    q = make_question()  # very-familiar, familiar, niche
    a, b, c = shares_from_tiers(q)

    assert a > b > c
    assert b / a == pytest.approx(TIER_WEIGHTS["familiar"], rel=1e-2)


def test_tier_ratios_land_in_distinct_rarity_bands() -> None:
    """Pins the contract with web/src/domain/scoring.ts (0.5 / 0.2 / 0.05 thresholds)."""
    w = TIER_WEIGHTS
    assert w["very-familiar"] / w["very-familiar"] >= 0.5  # common
    assert 0.2 <= w["familiar"] / w["very-familiar"] < 0.5  # uncommon
    assert 0.05 <= w["niche"] / w["very-familiar"] < 0.2  # rare
    assert w["obscure"] / w["very-familiar"] < 0.05  # legendary


def test_answer_ids_are_unique_slugs() -> None:
    taken: set[str] = set()
    assert answer_id("Baahubali: The Beginning", taken) == "baahubali-the-beginning"
    assert answer_id("Baahubali: The Beginning", taken) == "baahubali-the-beginning-2"
    assert answer_id("???", taken) == "answer"


def test_to_bank_question_matches_the_web_schema() -> None:
    docs = [make_doc(), make_doc(id="unused", title="Unused page")]
    question = to_bank_question(
        make_question(),
        docs,
        question_id="space-saturn-moons",
        category="space",
        approved_on=date(2026, 10, 29),
    )

    assert question["id"] == "space-saturn-moons"
    assert question["category"] == "space"
    assert question["answerSet"] == "open"
    assert question["criteria"] == "Any confirmed natural satellite of Saturn."
    assert question["approvedOn"] == "2026-10-29"
    titan = question["answers"][0]
    assert titan["id"] == "titan"
    assert titan["familiarityBasis"] == "llm-estimate"
    assert titan["sourceIds"] == ["list-of-saturn-s-moons"]
    assert set(titan) == {
        "id",
        "canonical",
        "aliases",
        "familiarity",
        "familiarityBasis",
        "evidence",
        "sourceIds",
    }


def test_only_cited_documents_become_sources() -> None:
    docs = [make_doc(), make_doc(id="unused", title="Unused page")]
    question = to_bank_question(
        make_question(), docs, question_id="q", category="space", approved_on=date(2026, 10, 29)
    )

    assert [s["id"] for s in question["sources"]] == ["list-of-saturn-s-moons"]
    assert question["sources"][0]["retrievedOn"] == "2026-10-29"


def test_closed_set_omits_empty_criteria() -> None:
    q = make_question(
        answer_set="closed",
        criteria=None,
        answers=[make_answer("Titan", "Titan is the largest moon of Saturn.")],
    )
    question = to_bank_question(
        q, [make_doc()], question_id="q", category="space", approved_on=date(2026, 10, 29)
    )

    assert "criteria" not in question
