"""Candidate questions: what the LLM may return, and what we write to disk.

The LLM never outputs numbers that drive scoring. It outputs a coarse
`familiarity_tier`; this module turns tiers into shares deterministically, so the
same input always yields the same scores and the reasoning is explainable.
"""

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .sources.base import Document
from .text import slugify

Category = Literal["tollywood", "space", "us-pop"]
FamiliarityTier = Literal["very-familiar", "familiar", "niche", "obscure"]

# Relative weights, chosen so the web app's relative-tier thresholds (0.5 / 0.2 / 0.05)
# land each tier in its own rarity band: 1.0 -> common, 0.4 -> uncommon,
# 0.12 -> rare, 0.03 -> legendary. Change these only together with scoring.ts.
TIER_WEIGHTS: dict[str, float] = {"very-familiar": 1.0, "familiar": 0.4, "niche": 0.12, "obscure": 0.03}
# Open sets must sum to < 1 (unlisted valid answers exist); closed sets sum to ~1.
OPEN_SET_COVERAGE = 0.85


class GeneratedAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canonical: str = Field(description="Display name of the answer, as it appears in the source.")
    aliases: list[str] = Field(description="Other names/spellings a player might type. Empty if none.")
    evidence: str = Field(description="One sentence: why this answer satisfies the prompt/criteria.")
    quote: str = Field(
        description=(
            "A VERBATIM excerpt (15-400 chars) copied exactly from the cited document "
            "that supports the answer."
        )
    )
    source_id: str = Field(description="The id of the document the quote was copied from.")
    familiarity_tier: FamiliarityTier = Field(
        description="How likely an average fan is to name this answer, relative to the others."
    )


class GeneratedQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(description="The question shown to players, e.g. 'Name a moon of Saturn.'")
    answer_set: Literal["closed", "open"]
    criteria: str | None = Field(
        description="'What counts' rule. Required when answer_set is open, else null."
    )
    explanation: str = Field(description="Shown after answering: context for the answers.")
    answers: list[GeneratedAnswer]


def answer_id(canonical: str, taken: set[str]) -> str:
    base = slugify(canonical) or "answer"
    candidate, n = base, 2
    while candidate in taken:
        candidate, n = f"{base}-{n}", n + 1
    taken.add(candidate)
    return candidate


def shares_from_tier_names(tiers: list[str], answer_set: str) -> list[float]:
    """Tier weights normalised to a share per answer (sums to 1, or OPEN_SET_COVERAGE if open)."""
    weights = [TIER_WEIGHTS[t] for t in tiers]
    total = sum(weights)
    scale = OPEN_SET_COVERAGE if answer_set == "open" else 1.0
    return [round(w / total * scale, 4) for w in weights]


def shares_from_tiers(question: GeneratedQuestion) -> list[float]:
    return shares_from_tier_names([a.familiarity_tier for a in question.answers], question.answer_set)


def to_bank_question(
    generated: GeneratedQuestion,
    documents: list[Document],
    *,
    question_id: str,
    category: Category,
    approved_on: date,
) -> dict[str, Any]:
    """Convert to the exact JSON shape of `web/src/domain/types.ts` `Question`."""
    by_id = {d.id: d for d in documents}
    cited = {a.source_id for a in generated.answers}
    taken: set[str] = set()
    shares = shares_from_tiers(generated)

    answers = [
        {
            "id": answer_id(a.canonical, taken),
            "canonical": a.canonical,
            "aliases": a.aliases,
            "familiarity": share,
            "familiarityBasis": "llm-estimate",
            "evidence": a.evidence,
            "sourceIds": [a.source_id],
        }
        for a, share in zip(generated.answers, shares, strict=True)
    ]
    question: dict[str, Any] = {
        "id": question_id,
        "category": category,
        "prompt": generated.prompt,
        "answerSet": generated.answer_set,
        "answers": answers,
        "explanation": generated.explanation,
        "sources": [
            {
                "id": d.id,
                "title": d.title,
                "publisher": d.publisher,
                "url": d.url,
                "retrievedOn": d.retrieved_on,
            }
            for d in documents
            if d.id in cited and d.id in by_id
        ],
        # Set to the generation date. The pipeline only proposes; a reviewer approves in the PR.
        "approvedOn": approved_on.isoformat(),
    }
    if generated.criteria:
        question["criteria"] = generated.criteria
    return question
