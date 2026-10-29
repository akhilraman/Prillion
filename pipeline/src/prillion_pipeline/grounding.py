"""Deterministic grounding checks: the guard against hallucinated evidence.

An LLM can write a convincing quote that the source never contained. These checks
need no LLM and no network: every claim must point at a document we actually
fetched, and the quote must literally appear in it.

`error` issues block publication. `warning` issues are shown to the human reviewer.
"""

from dataclasses import dataclass
from typing import Literal

from .candidate import GeneratedQuestion
from .sources.base import Document
from .text import normalize_key, normalize_quote

MIN_QUOTE_CHARS = 15  # "RRR" appearing in a page proves nothing
MAX_QUOTE_CHARS = 400  # a quote is an excerpt, not the whole page


@dataclass(frozen=True)
class Issue:
    severity: Literal["error", "warning"]
    code: str
    message: str
    answer: str | None = None

    def __str__(self) -> str:
        where = f" [{self.answer}]" if self.answer else ""
        return f"{self.severity}:{self.code}{where}: {self.message}"


def check_grounding(question: GeneratedQuestion, documents: list[Document]) -> list[Issue]:
    issues: list[Issue] = []
    docs = {d.id: d for d in documents}
    haystacks = {d.id: normalize_quote(d.text) for d in documents}

    if question.answer_set == "open" and not (question.criteria or "").strip():
        issues.append(Issue("error", "missing-criteria", "an open answer set needs `criteria`"))

    owners: dict[str, str] = {}
    for answer in question.answers:
        name = answer.canonical

        # Two different answers sharing a name/alias would make a submission ambiguous.
        for form_text in [answer.canonical, *answer.aliases]:
            key = normalize_key(form_text)
            if not key:
                issues.append(Issue("error", "empty-name", f"{form_text!r} normalises to nothing", name))
            elif owners.get(key, name) != name:
                issues.append(
                    Issue("error", "name-collision", f"{form_text!r} collides with {owners[key]!r}", name)
                )
            else:
                owners[key] = name

        doc = docs.get(answer.source_id)
        if doc is None:
            issues.append(
                Issue("error", "unknown-source", f"cites {answer.source_id!r}, which was not provided", name)
            )
            continue

        quote = normalize_quote(answer.quote)
        if not MIN_QUOTE_CHARS <= len(quote) <= MAX_QUOTE_CHARS:
            issues.append(
                Issue(
                    "error",
                    "bad-quote-length",
                    f"quote is {len(quote)} chars; must be {MIN_QUOTE_CHARS}-{MAX_QUOTE_CHARS}",
                    name,
                )
            )
        elif quote not in haystacks[doc.id]:
            issues.append(
                Issue(
                    "error",
                    "quote-not-in-source",
                    f"quote does not appear verbatim in {doc.id!r}: {answer.quote[:80]!r}",
                    name,
                )
            )
        else:
            # The quote is real; does it actually concern this answer? Plot excerpts
            # often omit the film's title, so this is advisory, not blocking.
            mentioned = normalize_key(quote)
            forms = [normalize_key(f) for f in [answer.canonical, *answer.aliases]]
            titled = normalize_key(doc.title)
            if not any(f and (f in mentioned or f in titled) for f in forms):
                issues.append(
                    Issue(
                        "warning",
                        "quote-does-not-name-answer",
                        "quote and source title never mention this answer; reviewer should confirm",
                        name,
                    )
                )

    return issues


def has_errors(issues: list[Issue]) -> bool:
    return any(i.severity == "error" for i in issues)
