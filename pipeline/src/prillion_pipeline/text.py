"""Text helpers shared by sources and checks."""

import re
import unicodedata


def normalize_key(text: str) -> str:
    """Lowercase, accent-free, letters and digits only.

    "Hanu-Man", "HanuMan" and "hanu man" all become "hanuman", so punctuation and
    casing never decide whether two names are "the same".
    """
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return "".join(c for c in stripped.lower() if c.isalnum())


def normalize_quote(text: str) -> str:
    """Whitespace- and compatibility-insensitive form used to find a quote in a document.

    Deliberately NOT case-insensitive and NOT punctuation-stripping: a quote must
    reproduce the source's words, not merely resemble them.
    """
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
