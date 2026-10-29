"""The topic queue: a reviewed, version-controlled list of what the pipeline may generate.

A human edits `topics.json` in a PR. The scheduled job only works through this list,
so what gets researched is itself reviewed (no LLM decides topics until slice 3).
"""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

CATEGORY_NAMES = ("tollywood", "space", "us-pop")  # keep in step with web/src/domain/types.ts CATEGORIES


class TopicsError(Exception):
    """The topics file is unreadable, malformed, or inconsistent."""


class Topic(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", description="question id; also the output filename")
    category: Literal["tollywood", "space", "us-pop"]
    pages: list[str] = Field(min_length=1, description="Wikipedia article titles to read")
    brief: str = Field(min_length=1, description="what the question should ask about")


class TopicsFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topics: list[Topic]


def load_topics(path: Path) -> list[Topic]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise TopicsError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise TopicsError(f"{path} is not valid JSON: {exc}") from exc

    try:
        topics = TopicsFile.model_validate(raw).topics
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
        raise TopicsError(f"{path} is invalid: {problems}") from exc

    seen: set[str] = set()
    for topic in topics:
        if topic.id in seen:
            raise TopicsError(f"{path}: duplicate topic id {topic.id!r}")
        seen.add(topic.id)
    return topics
