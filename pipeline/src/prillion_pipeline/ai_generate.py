"""AI-knowledge questions: memes, trolls and hoaxes that no single document lists.

There is no source to quote, so trust has to come from somewhere else. Three filters, each
catching a different failure, and a fourth (a human in the PR) that this module cannot replace:

1. SELF-CONSISTENCY: ask the same question several times independently and keep only answers
   that at least MIN_VOTES samples named. A one-off invention rarely repeats itself.
2. VERIFIER: a second prompt, framed as a strict fact-checker, must call each surviving answer
   "correct". Anything "unsure", "incorrect" or unmentioned is dropped.
3. WEB GATE: the same validator the live bank uses (open set, criteria, no sensitive terms, ...).

Nothing here writes to the live bank. The candidate is marked `basis: "ai-knowledge"` so that
`promote` refuses it without an explicit opt-in.
"""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .candidate import Category, FamiliarityTier, answer_id, shares_from_tier_names
from .generate import GenerationResult
from .grounding import Issue
from .llm import LLM, LLMError, Message
from .text import normalize_key

# Bump when any prompt below changes; it is part of the input hash and the provenance.
AI_PROMPT_VERSION = "2026-10-30.1"
SAMPLES = 3
MIN_VOTES = 2

TIER_ORDER: tuple[FamiliarityTier, ...] = ("very-familiar", "familiar", "niche", "obscure")

SAMPLE_PROMPT = """\
You write trivia questions for Prillion, a game where players type free-text answers and rarer answers score more.
The topic is internet and pop culture: memes, trolls, running jokes, viral moments, and widely documented hoaxes and conspiracy theories.

Rules:
1. Only include answers you are confident are real and widely documented. If you are not sure an answer exists, leave it out. Fewer correct answers beat many with invented ones. Never invent names, quotes, dates or numbers.
2. Stay away from allegations, crimes, scandals, sexual content, and the health, family or private life of real people. Memes and jokes about public work and public moments are fine. For a hoax, describe the hoax as documented, not as if it were true.
3. The question must have MANY valid answers (aim for 12 or more), from household names down to things only devoted fans remember.
4. The answer set is always open. `criteria` is a short, objective rule for what counts.
5. Prefer answers a player can type as a short name (1-4 words). Put alternative names and spellings in `aliases`; never reuse one answer's name as another's alias.
6. `evidence` is one plain sentence saying what the answer is. Include no specifics you are unsure of.
7. `familiarity_tier` is your honest judgement of how likely an average fan is to name that answer: very-familiar, familiar, niche or obscure. Use the whole range.
8. Prefer objective, checkable prompts. Avoid "best" or "funniest".
"""

VERIFY_PROMPT = """\
You are a strict fact-checker for a trivia game. You are given a question and a list of proposed answers written from memory by another model, which may have made things up.

For EACH answer return a verdict:
- "correct": you are certain it is real, widely documented, and satisfies the question and its criteria.
- "incorrect": it is false, invented, or does not fit the question.
- "unsure": anything else. Do NOT give the benefit of the doubt: if you cannot clearly recall it, answer "unsure".
Also mark "incorrect" any answer that depends on an allegation, crime, scandal, sexual content, or the health or private life of a real person.
Give a short reason. Return one verdict per answer, using the answer's name exactly as given.
"""


class AiAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canonical: str = Field(description="Display name of the answer, as a player would type it.")
    aliases: list[str] = Field(description="Other names/spellings a player might type. Empty if none.")
    evidence: str = Field(description="One plain sentence saying what this answer is.")
    familiarity_tier: FamiliarityTier = Field(
        description="How likely an average fan is to name this answer, relative to the others."
    )


class AiQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(description="The question shown to players, e.g. 'Name a famous internet meme.'")
    criteria: str = Field(description="Short, objective rule for what counts as a valid answer.")
    explanation: str = Field(description="Shown after answering: context for the answers.")
    answers: list[AiAnswer]


class AnswerVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canonical: str
    verdict: Literal["correct", "incorrect", "unsure"]
    reason: str


class AiVerification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdicts: list[AnswerVerdict]


def build_sample_messages(brief: str, category: Category) -> list[Message]:
    user = f"Category: {category}\nBrief: {brief}\n\nWrite one question for this brief."
    return [{"role": "system", "content": SAMPLE_PROMPT}, {"role": "user", "content": user}]


def build_verify_messages(question: AiQuestion, answers: list[AiAnswer]) -> list[Message]:
    listing = "\n".join(f"- {a.canonical}: {a.evidence}" for a in answers)
    user = f"Question: {question.prompt}\nCriteria: {question.criteria}\n\nProposed answers:\n{listing}"
    return [{"role": "system", "content": VERIFY_PROMPT}, {"role": "user", "content": user}]


def ai_input_hash(model: str, brief: str, category: str) -> str:
    """Identifies WHAT was asked, so identical reruns can be recognised (idempotency)."""
    payload = {
        "mode": "ai-knowledge",
        "promptVersion": AI_PROMPT_VERSION,
        "model": model,
        "samples": SAMPLES,
        "minVotes": MIN_VOTES,
        "brief": brief,
        "category": category,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


@dataclass
class _Cluster:
    """Answers from different samples that are the same thing."""

    key: str  # normalised canonical name; what every member must share
    members: list[tuple[int, AiAnswer]] = field(default_factory=list)

    @property
    def votes(self) -> int:
        return len({sample for sample, _ in self.members})


def cluster_answers(samples: list[AiQuestion]) -> list[_Cluster]:
    """Group answers across samples by normalised canonical name, so "Rick Roll" and "Rickroll"
    are one answer. Aliases deliberately do NOT merge answers: a vague shared alias would chain two
    different answers together and fake a vote. A real answer the samples name differently loses
    votes and is dropped, which errs toward fewer, safer answers."""
    clusters: dict[str, _Cluster] = {}
    for index, sample in enumerate(samples):
        for answer in sample.answers:
            key = normalize_key(answer.canonical)
            if not key:
                continue
            clusters.setdefault(key, _Cluster(key=key)).members.append((index, answer))
    return list(clusters.values())


def _median_tier(answers: list[AiAnswer]) -> FamiliarityTier:
    ranks = sorted(TIER_ORDER.index(a.familiarity_tier) for a in answers)
    return TIER_ORDER[ranks[len(ranks) // 2]]  # upper median: when torn, the rarer tier


def merge_cluster(cluster: _Cluster) -> AiAnswer:
    """One answer from the cluster: the first sample's wording, the median tier, the union of aliases."""
    first = cluster.members[0][1]
    members = [m for _, m in cluster.members]
    aliases: list[str] = []
    seen = {normalize_key(first.canonical)}
    for member in members:
        for alias in member.aliases:
            key = normalize_key(alias)
            if key and key not in seen:
                seen.add(key)
                aliases.append(alias)
    return AiAnswer(
        canonical=first.canonical,
        aliases=aliases,
        evidence=first.evidence,
        familiarity_tier=_median_tier(members),
    )


def consensus(samples: list[AiQuestion]) -> tuple[list[AiAnswer], dict[str, int], dict[str, int]]:
    """Answers named by at least MIN_VOTES samples, plus the votes for kept and for dropped answers."""
    kept: list[tuple[int, int, AiAnswer]] = []
    kept_votes: dict[str, int] = {}
    dropped: dict[str, int] = {}
    for order, cluster in enumerate(cluster_answers(samples)):
        merged = merge_cluster(cluster)
        if cluster.votes >= MIN_VOTES:
            kept.append((-cluster.votes, order, merged))
            kept_votes[merged.canonical] = cluster.votes
        else:
            dropped[merged.canonical] = cluster.votes
    kept.sort(key=lambda item: item[:2])
    answers = _without_alias_clashes([a for _, _, a in kept])
    return answers, kept_votes, dropped


def _without_alias_clashes(answers: list[AiAnswer]) -> list[AiAnswer]:
    """An alias that is another answer's name (or an earlier alias) would make a player's reply ambiguous."""
    taken = {normalize_key(a.canonical) for a in answers}
    out: list[AiAnswer] = []
    for answer in answers:
        aliases = []
        for alias in answer.aliases:
            key = normalize_key(alias)
            if key and key not in taken:
                taken.add(key)
                aliases.append(alias)
        out.append(answer.model_copy(update={"aliases": aliases}))
    return out


def to_ai_bank_question(
    question: AiQuestion,
    answers: list[AiAnswer],
    *,
    question_id: str,
    category: Category,
    approved_on: date,
) -> dict[str, Any]:
    """Convert to the exact JSON shape of `web/src/domain/types.ts` `Question`, flagged `ai-knowledge`."""
    shares = shares_from_tier_names([a.familiarity_tier for a in answers], "open")
    taken: set[str] = set()
    return {
        "id": question_id,
        "category": category,
        "basis": "ai-knowledge",
        "prompt": question.prompt,
        "answerSet": "open",
        "criteria": question.criteria,
        "answers": [
            {
                "id": answer_id(a.canonical, taken),
                "canonical": a.canonical,
                "aliases": a.aliases,
                "familiarity": share,
                "familiarityBasis": "llm-estimate",
                "evidence": a.evidence,
                "sourceIds": [],
            }
            for a, share in zip(answers, shares, strict=True)
        ],
        "explanation": question.explanation,
        "sources": [],
        "approvedOn": approved_on.isoformat(),
    }


def _take_samples(llm: LLM, messages: list[Message]) -> tuple[list[AiQuestion], list[Issue]]:
    """Ask SAMPLES times at once. The calls are independent and each waits on the network, so
    threads cut the wall-clock time to about one call. Results come back in sample order."""

    def one(_: int) -> AiQuestion | LLMError:
        try:
            return llm.parse(messages, AiQuestion)
        except LLMError as exc:
            return exc

    with ThreadPoolExecutor(max_workers=SAMPLES) as pool:
        results = list(pool.map(one, range(SAMPLES)))
    samples = [r for r in results if isinstance(r, AiQuestion)]
    issues = [
        Issue("warning", "sample-failed", f"sample {n}: {r}")
        for n, r in enumerate(results, start=1)
        if isinstance(r, LLMError)
    ]
    return samples, issues


def generate_ai_question(
    llm: LLM,
    *,
    brief: str,
    category: Category,
    question_id: str,
    today: date,
) -> GenerationResult:
    messages = build_sample_messages(brief, category)
    samples, issues = _take_samples(llm, messages)

    provenance: dict[str, Any] = {
        "model": llm.model,
        "mode": "ai-knowledge",
        "promptVersion": AI_PROMPT_VERSION,
        "inputHash": ai_input_hash(llm.model, brief, category),
        "brief": brief,
        "samplesRequested": SAMPLES,
        "samplesReceived": len(samples),
    }

    def fail(code: str, message: str) -> GenerationResult:
        issues.append(Issue("error", code, message))
        provenance["issues"] = [str(i) for i in issues]
        return GenerationResult(question=None, issues=issues, attempts=len(samples), provenance=provenance)

    if len(samples) < MIN_VOTES:
        return fail("too-few-samples", f"only {len(samples)} sample(s) succeeded; need at least {MIN_VOTES}")

    answers, votes, dropped = consensus(samples)
    provenance["votes"] = votes
    provenance["droppedForVotes"] = dropped
    if not answers:
        return fail("no-consensus", "no answer was named by enough samples")

    # The first sample that succeeded defines the question wording; the answers are the consensus.
    head = samples[0]
    try:
        verification = llm.parse(build_verify_messages(head, answers), AiVerification)
    except LLMError as exc:
        return fail("verify-failed", f"verifier call failed: {exc}")

    verdicts = {normalize_key(v.canonical): v for v in verification.verdicts}
    verified: list[AiAnswer] = []
    record: dict[str, dict[str, str]] = {}
    for answer in answers:
        verdict = verdicts.get(normalize_key(answer.canonical))
        label = verdict.verdict if verdict else "unsure"  # no verdict is not a pass
        record[answer.canonical] = {"verdict": label, "reason": verdict.reason if verdict else "no verdict"}
        if label == "correct":
            verified.append(answer)
    provenance["verdicts"] = record
    if not verified:
        return fail("none-verified", "the verifier did not confirm any answer")
    provenance["issues"] = [str(i) for i in issues]

    question = to_ai_bank_question(
        head, verified, question_id=question_id, category=category, approved_on=today
    )
    return GenerationResult(question=question, issues=issues, attempts=len(samples), provenance=provenance)
