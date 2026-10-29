"""What every research source hands back.

A `Document` is the unit of evidence. The generator may only build questions
from Documents, and every answer must cite one by id. That is how we avoid
invented facts: no Document, no claim.
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Document:
    """One retrieved page, pinned to the exact version we read."""

    id: str
    """Stable slug, becomes `Source.id` in the question bank."""
    title: str
    publisher: str
    url: str
    retrieved_on: str
    """ISO date (YYYY-MM-DD), the `Source.retrievedOn` field."""
    text: str
    version: str
    """Revision/etag so a rerun can tell whether the page changed."""


class SourceError(Exception):
    """A source could not produce a usable Document (missing page, bad response)."""


class Source(Protocol):
    def fetch(self, key: str) -> Document:
        """Return the Document for `key` (a page title, id, ...) or raise SourceError."""
        ...
