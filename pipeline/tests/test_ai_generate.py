from datetime import date

from factories import FakeLLM

from prillion_pipeline.ai_generate import (
    AiAnswer,
    AiQuestion,
    AiVerification,
    AnswerVerdict,
    ai_input_hash,
    build_sample_messages,
    consensus,
    generate_ai_question,
)
from prillion_pipeline.llm import LLMError

TODAY = date(2026, 10, 30)
TIERS = [
    "very-familiar",
    "very-familiar",
    "familiar",
    "familiar",
    "familiar",
    "niche",
    "niche",
    "niche",
    "obscure",
]
NAMES = [
    "Rickroll",
    "Doge",
    "Grumpy Cat",
    "Harambe",
    "Pepe",
    "Nyan Cat",
    "Distracted Boyfriend",
    "Gangnam Style",
]


def ans(name: str, tier: str = "familiar", aliases: list[str] | None = None) -> AiAnswer:
    return AiAnswer(
        canonical=name, aliases=aliases or [], evidence=f"{name} is a meme.", familiarity_tier=tier
    )


def sample(*answers: AiAnswer, prompt: str = "Name a famous internet meme.") -> AiQuestion:
    return AiQuestion(
        prompt=prompt,
        criteria="Any widely documented internet meme.",
        explanation="Memes spread online.",
        answers=list(answers),
    )


def test_keeps_only_answers_named_by_enough_samples() -> None:
    a = sample(ans("Rickroll"), ans("Doge"), ans("Invented Meme"))
    b = sample(ans("Rickroll"), ans("Doge"))
    c = sample(ans("Rickroll"), ans("Other Invention"))

    answers, votes, dropped = consensus([a, b, c])

    assert [x.canonical for x in answers] == ["Rickroll", "Doge"]
    assert votes == {"Rickroll": 3, "Doge": 2}
    assert dropped == {"Invented Meme": 1, "Other Invention": 1}


def test_spelling_differences_count_as_the_same_answer() -> None:
    a = sample(ans("Rickroll", aliases=["Rick Astley prank"]))
    b = sample(ans("Rick Roll"))

    answers, votes, _ = consensus([a, b])

    assert [x.canonical for x in answers] == ["Rickroll"]
    assert votes == {"Rickroll": 2}


def test_one_sample_repeating_an_answer_is_still_one_vote() -> None:
    a = sample(ans("Doge"), ans("doge"))
    b = sample(ans("Pepe"))

    answers, _, dropped = consensus([a, b])

    assert answers == []
    assert dropped == {"Doge": 1, "Pepe": 1}


def test_tier_is_the_median_and_leans_rarer_when_torn() -> None:
    answers, _, _ = consensus(
        [sample(ans("Doge", "very-familiar")), sample(ans("Doge", "niche")), sample(ans("Doge", "familiar"))]
    )
    assert answers[0].familiarity_tier == "familiar"

    torn, _, _ = consensus([sample(ans("Doge", "very-familiar")), sample(ans("Doge", "familiar"))])
    assert torn[0].familiarity_tier == "familiar"


def test_an_alias_that_is_another_answers_name_is_dropped() -> None:
    a = sample(ans("Doge", aliases=["Shiba"]), ans("Shiba", "niche"))
    b = sample(ans("Doge"), ans("Shiba", "niche"))

    answers, _, _ = consensus([a, b])

    by_name = {x.canonical: x for x in answers}
    assert by_name["Doge"].aliases == []


def full_sample() -> AiQuestion:
    return sample(*[ans(n, t) for n, t in zip(NAMES, TIERS, strict=False)])


def all_correct(names: list[str]) -> AiVerification:
    return AiVerification(
        verdicts=[AnswerVerdict(canonical=n, verdict="correct", reason="well known") for n in names]
    )


def test_generates_an_ai_knowledge_question_with_no_sources() -> None:
    llm = FakeLLM(full_sample(), full_sample(), full_sample(), all_correct(NAMES))

    result = generate_ai_question(llm, brief="Famous memes", category="us-pop", question_id="q", today=TODAY)

    assert result.ok and result.question is not None
    q = result.question
    assert q["basis"] == "ai-knowledge"
    assert q["sources"] == [] and q["answerSet"] == "open" and q["criteria"]
    assert q["approvedOn"] == "2026-10-30"
    assert len(q["answers"]) == len(NAMES)
    assert all(a["sourceIds"] == [] and a["familiarityBasis"] == "llm-estimate" for a in q["answers"])
    assert abs(sum(a["familiarity"] for a in q["answers"]) - 0.85) < 0.01
    assert len(llm.calls) == 4  # three samples + one verifier


def test_verifier_drops_answers_it_does_not_confirm() -> None:
    names = [a.canonical for a in full_sample().answers]
    verdict = AiVerification(
        verdicts=[
            AnswerVerdict(canonical=names[0], verdict="correct", reason="yes"),
            AnswerVerdict(canonical=names[1], verdict="unsure", reason="cannot recall"),
            AnswerVerdict(canonical=names[2], verdict="incorrect", reason="invented"),
            # names[3:] get no verdict at all, which must not count as a pass
        ]
    )
    llm = FakeLLM(full_sample(), full_sample(), full_sample(), verdict)

    result = generate_ai_question(llm, brief="Famous memes", category="us-pop", question_id="q", today=TODAY)

    assert result.question is not None
    assert [a["canonical"] for a in result.question["answers"]] == [names[0]]
    recorded = result.provenance["verdicts"]
    assert recorded[names[1]]["verdict"] == "unsure"
    assert recorded[names[3]] == {"verdict": "unsure", "reason": "no verdict"}


def test_provenance_records_how_the_answers_were_chosen() -> None:
    llm = FakeLLM(full_sample(), full_sample(), sample(ans("Only One")), all_correct(NAMES))

    result = generate_ai_question(llm, brief="Famous memes", category="us-pop", question_id="q", today=TODAY)

    p = result.provenance
    assert p["mode"] == "ai-knowledge" and p["model"] == "fake-model"
    assert p["samplesRequested"] == 3 and p["samplesReceived"] == 3
    assert p["votes"]["Rickroll"] == 2 and p["droppedForVotes"] == {"Only One": 1}
    assert p["inputHash"] == ai_input_hash("fake-model", "Famous memes", "us-pop")


def test_a_failed_sample_is_tolerated_when_two_remain() -> None:
    llm = FakeLLM(full_sample(), LLMError("boom"), full_sample(), all_correct(NAMES))

    result = generate_ai_question(llm, brief="b", category="us-pop", question_id="q", today=TODAY)

    assert result.ok
    assert result.provenance["samplesReceived"] == 2
    assert any(i.code == "sample-failed" for i in result.issues)


def test_fails_when_too_few_samples_succeed() -> None:
    llm = FakeLLM(full_sample(), LLMError("a"), LLMError("b"))

    result = generate_ai_question(llm, brief="b", category="us-pop", question_id="q", today=TODAY)

    assert not result.ok and result.question is None
    assert any(i.code == "too-few-samples" for i in result.issues)
    assert len(llm.calls) == 3  # never reaches the verifier


def test_fails_when_samples_share_no_answers() -> None:
    llm = FakeLLM(sample(ans("A")), sample(ans("B")), sample(ans("C")))

    result = generate_ai_question(llm, brief="b", category="us-pop", question_id="q", today=TODAY)

    assert not result.ok
    assert any(i.code == "no-consensus" for i in result.issues)


def test_fails_when_the_verifier_confirms_nothing_or_errors() -> None:
    nothing = FakeLLM(full_sample(), full_sample(), full_sample(), AiVerification(verdicts=[]))
    broken = FakeLLM(full_sample(), full_sample(), full_sample(), LLMError("down"))

    r1 = generate_ai_question(nothing, brief="b", category="us-pop", question_id="q", today=TODAY)
    r2 = generate_ai_question(broken, brief="b", category="us-pop", question_id="q", today=TODAY)

    assert any(i.code == "none-verified" for i in r1.issues) and r1.question is None
    assert any(i.code == "verify-failed" for i in r2.issues) and r2.question is None


def test_the_prompt_forbids_the_risky_territory_and_states_the_brief() -> None:
    system, user = build_sample_messages("Famous memes", "us-pop")

    assert "allegations" in system["content"] and "invent" in system["content"]
    assert "Famous memes" in user["content"] and "us-pop" in user["content"]


def test_input_hash_changes_with_model_and_brief() -> None:
    base = ai_input_hash("m", "brief", "space")
    assert base == ai_input_hash("m", "brief", "space")
    assert base != ai_input_hash("m2", "brief", "space")
    assert base != ai_input_hash("m", "other", "space")


def test_samples_are_requested_concurrently() -> None:
    """Each sample waits at a barrier that only opens when all three are in flight at once.
    Run one after another, the first would time out and the test would fail."""
    import threading

    barrier = threading.Barrier(3, timeout=5)

    class BarrierLLM(FakeLLM):
        def parse(self, messages, schema=None):  # type: ignore[override]
            if schema is AiQuestion:
                barrier.wait()
            return super().parse(messages, schema)

    llm = BarrierLLM(full_sample(), full_sample(), full_sample(), all_correct(NAMES))

    result = generate_ai_question(llm, brief="b", category="us-pop", question_id="q", today=TODAY)

    assert result.ok
    assert result.provenance["samplesReceived"] == 3
