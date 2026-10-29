from factories import SATURN_TEXT, make_answer, make_doc, make_question

from prillion_pipeline.grounding import check_grounding, has_errors

DOCS = [make_doc()]


def codes(issues) -> list[str]:
    return [i.code for i in issues]


def test_well_grounded_question_has_no_issues() -> None:
    assert check_grounding(make_question(), DOCS) == []


def test_fabricated_quote_is_an_error() -> None:
    bad = make_answer("Rhea", "Rhea is the second largest moon and has a thin oxygen atmosphere.")
    issues = check_grounding(make_question([bad]), DOCS)

    assert codes(issues) == ["quote-not-in-source"]
    assert has_errors(issues)


def test_quote_matching_ignores_whitespace_but_not_wording() -> None:
    spaced = make_answer("Titan", "Titan   is the\nlargest moon of Saturn.")
    paraphrased = make_answer("Titan", "Titan is the biggest moon of Saturn.")

    assert check_grounding(make_question([spaced]), DOCS) == []
    assert codes(check_grounding(make_question([paraphrased]), DOCS)) == ["quote-not-in-source"]


def test_quote_is_case_sensitive() -> None:
    shouting = make_answer("Titan", "TITAN IS THE LARGEST MOON OF SATURN.")
    assert codes(check_grounding(make_question([shouting]), DOCS)) == ["quote-not-in-source"]


def test_too_short_and_too_long_quotes_are_errors() -> None:
    short = make_answer("Titan", "Titan")
    long = make_answer("Titan", SATURN_TEXT * 5)

    assert codes(check_grounding(make_question([short]), DOCS)) == ["bad-quote-length"]
    assert codes(check_grounding(make_question([long]), DOCS)) == ["bad-quote-length"]


def test_citing_a_document_we_did_not_provide_is_an_error() -> None:
    answer = make_answer("Titan", "Titan is the largest moon of Saturn.", source_id="made-up-page")
    assert codes(check_grounding(make_question([answer]), DOCS)) == ["unknown-source"]


def test_quote_that_never_names_the_answer_is_only_a_warning() -> None:
    # Real quote, but it is about Enceladus and the answer claimed is Mimas.
    answer = make_answer("Mimas", "Enceladus is an icy moon with geysers at its south pole.")
    issues = check_grounding(make_question([answer]), DOCS)

    assert codes(issues) == ["quote-does-not-name-answer"]
    assert not has_errors(issues)


def test_source_title_counts_as_naming_the_answer() -> None:
    # The document IS about the answer (plot excerpts often omit the title).
    doc = make_doc(
        id="rrr", title="RRR", text="Bheem travels to Delhi to rescue a Gond girl from the Governor."
    )
    answer = make_answer(
        "RRR", "Bheem travels to Delhi to rescue a Gond girl from the Governor.", source_id="rrr"
    )

    assert check_grounding(make_question([answer]), [doc]) == []


def test_open_set_without_criteria_is_an_error() -> None:
    issues = check_grounding(make_question(criteria=None), DOCS)
    assert codes(issues) == ["missing-criteria"]


def test_closed_set_does_not_need_criteria() -> None:
    assert check_grounding(make_question(answer_set="closed", criteria=None), DOCS) == []


def test_alias_that_collides_with_another_answer_is_an_error() -> None:
    titan = make_answer("Titan", "Titan is the largest moon of Saturn.", aliases=["Enceladus"])
    enceladus = make_answer("Enceladus", "Enceladus is an icy moon with geysers at its south pole.")
    issues = check_grounding(make_question([titan, enceladus]), DOCS)

    assert "name-collision" in codes(issues)


def test_collisions_are_detected_after_normalisation() -> None:
    a = make_answer("Hanu-Man", "Hyperion has a chaotic rotation and a sponge-like appearance.")
    b = make_answer("HanuMan", "Titan is the largest moon of Saturn.")

    assert "name-collision" in codes(check_grounding(make_question([a, b]), DOCS))


def test_alias_may_repeat_within_its_own_answer() -> None:
    answer = make_answer("Titan", "Titan is the largest moon of Saturn.", aliases=["titan", "TITAN"])
    assert check_grounding(make_question([answer]), DOCS) == []
