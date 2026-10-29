"""Wikipedia via the MediaWiki Action API (no key, free, citable).

Why we parse HTML and not use the plain-text `extracts` API: that API silently
drops tables, and the facts we need (winners, filmographies, moon lists) live in
tables. A source that quietly omits the data is worse than one that fails,
because the generator would fill the gap from memory.
"""

import re
from datetime import date
from html.parser import HTMLParser
from urllib.parse import quote

import httpx

from .base import Document, SourceError

API_URL = "https://en.wikipedia.org/w/api.php"
PAGE_URL = "https://en.wikipedia.org/wiki/"
# Wikimedia asks every client to identify itself with contact details.
USER_AGENT = "PrillionPipeline/0.1 (https://github.com/akhilraman/Prillion; akhilraman19@gmail.com)"
# Cap what we pass to the LLM: cost and context size, not correctness.
MAX_TEXT_CHARS = 60_000

_VOID_TAGS = frozenset({"br", "hr", "img", "meta", "link", "input", "wbr", "col", "area", "source"})
_SKIP_TAGS = frozenset({"style", "script", "sup", "noscript"})
# Citation lists, nav boxes, edit links, tables of contents: noise, not facts.
_SKIP_CLASSES = frozenset(
    {"navbox", "reflist", "mw-editsection", "toc", "references", "sidebar", "mw-empty-elt"}
)
_BLOCK_TAGS = frozenset(
    {"p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "table", "caption"}
)


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


class _TextExtractor(HTMLParser):
    """HTML -> plain text where each table row becomes one `a | b | c` line."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._out: list[str] = []
        self._row: list[str] = []
        self._cell: list[str] | None = None
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._skip_depth:
            if tag not in _VOID_TAGS:
                self._skip_depth += 1
            return
        classes = set((dict(attrs).get("class") or "").split())
        if tag in _SKIP_TAGS or classes & _SKIP_CLASSES:
            self._skip_depth = 1
            return
        if tag in ("td", "th"):
            self._cell = []
        elif tag == "br":
            self._append(" ")
        elif tag in _BLOCK_TAGS or tag == "tr":
            self._out.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._skip_depth:
            if tag not in _VOID_TAGS:
                self._skip_depth -= 1
            return
        if tag in ("td", "th") and self._cell is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr":
            cells = [c for c in self._row if c]
            if cells:
                self._out.append(" | ".join(cells))
            self._out.append("\n")
            self._row = []
        elif tag in _BLOCK_TAGS:
            self._out.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self._append(data)

    def _append(self, text: str) -> None:
        (self._cell if self._cell is not None else self._out).append(text)

    def text(self) -> str:
        lines = (" ".join(line.split()) for line in "".join(self._out).splitlines())
        return "\n".join(line for line in lines if line)


def html_to_text(html: str) -> str:
    extractor = _TextExtractor()
    extractor.feed(html)
    extractor.close()
    return extractor.text()


class WikipediaSource:
    publisher = "Wikipedia"

    def __init__(self, client: httpx.Client | None = None, today: date | None = None) -> None:
        # Injected so tests can pass a mock transport and a fixed date.
        self._client = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30)
        self._today = today

    def fetch(self, key: str) -> Document:
        """`key` is an article title, e.g. "NBA Most Valuable Player Award"."""
        response = self._client.get(
            API_URL,
            params={
                "action": "parse",
                "format": "json",
                "formatversion": 2,
                "redirects": 1,
                "page": key,
                "prop": "text|revid",
                "disablelimitreport": 1,
                "disableeditsection": 1,
            },
        )
        response.raise_for_status()
        body = response.json()

        if "error" in body:
            code = body["error"].get("code", "unknown")
            if code == "missingtitle":
                raise SourceError(f"Wikipedia has no page titled {key!r}")
            raise SourceError(f"Wikipedia API error {code!r} for {key!r}")
        parsed = body.get("parse")
        if not parsed or "revid" not in parsed:
            raise SourceError(f"Wikipedia returned no revision id for {key!r}")

        text = html_to_text(parsed.get("text") or "")
        if not text:
            raise SourceError(f"Wikipedia page {key!r} has no extractable text")

        title = parsed["title"]
        today = self._today or date.today()
        return Document(
            id=slugify(title),
            title=title,
            publisher=self.publisher,
            url=PAGE_URL + quote(title.replace(" ", "_"), safe="_:()',"),
            retrieved_on=today.isoformat(),
            text=text[:MAX_TEXT_CHARS],
            version=str(parsed["revid"]),
        )
