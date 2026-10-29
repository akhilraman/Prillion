"""Test builders shared across test modules."""

from prillion_pipeline.candidate import GeneratedAnswer, GeneratedQuestion
from prillion_pipeline.llm import LLMError, Message
from prillion_pipeline.sources.base import Document

SATURN_TEXT = (
    "Saturn has 274 moons. Titan is the largest moon of Saturn. "
    "Enceladus is an icy moon with geysers at its south pole. "
    "Hyperion has a chaotic rotation and a sponge-like appearance."
)


def make_doc(**overrides: object) -> Document:
    fields: dict = {
        "id": "list-of-saturn-s-moons",
        "title": "Moons of Saturn",
        "publisher": "Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Moons_of_Saturn",
        "retrieved_on": "2026-10-29",
        "text": SATURN_TEXT,
        "version": "42",
    }
    return Document(**{**fields, **overrides})


def make_answer(canonical: str, quote: str, tier: str = "familiar", **overrides: object) -> GeneratedAnswer:
    fields: dict = {
        "canonical": canonical,
        "aliases": [],
        "evidence": f"{canonical} is a moon of Saturn.",
        "quote": quote,
        "source_id": "list-of-saturn-s-moons",
        "familiarity_tier": tier,
    }
    return GeneratedAnswer(**{**fields, **overrides})


def make_question(answers: list[GeneratedAnswer] | None = None, **overrides: object) -> GeneratedQuestion:
    fields: dict = {
        "prompt": "Name a moon of Saturn.",
        "answer_set": "open",
        "criteria": "Any confirmed natural satellite of Saturn.",
        "explanation": "Saturn has many moons.",
        "answers": answers
        if answers is not None
        else [
            make_answer("Titan", "Titan is the largest moon of Saturn.", "very-familiar"),
            make_answer("Enceladus", "Enceladus is an icy moon with geysers at its south pole.", "familiar"),
            make_answer("Hyperion", "Hyperion has a chaotic rotation and a sponge-like appearance.", "niche"),
        ],
    }
    return GeneratedQuestion(**{**fields, **overrides})


class FakeLLM:
    """Returns scripted responses in order and records every call's messages."""

    model = "fake-model"

    def __init__(self, *responses: GeneratedQuestion | LLMError) -> None:
        self._responses = list(responses)
        self.calls: list[list[Message]] = []

    def generate(self, messages: list[Message]) -> GeneratedQuestion:
        self.calls.append(messages)
        response = self._responses.pop(0)
        if isinstance(response, LLMError):
            raise response
        return response
