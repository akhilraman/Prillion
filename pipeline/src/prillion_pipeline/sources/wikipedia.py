"""Wikipedia via the MediaWiki Action API (no key, free, citable).

Why we parse HTML and not use the plain-text `extracts` API: that API silently
drops tables, and the facts we need (winners, filmographies, moon lists) live in
tables. A source that quietly omits the data is worse than one that fails,
because the generator would fill the gap from memory.
"""

from datetime import date
from html.parser import HTMLParser
from urllib.parse import quote

import httpx

from ..text import slugify
from .base import Document, SourceError

API_URL = "https://en.wikipedia.org/w/api.php"
PAGE_URL = "https://en.wikipedia.org/wiki/"
# Wikimedia asks every client to identify itself with contact details.
USER_AGENT = "PrillionPipeline/0.1 (https://github.com/akhilraman/Prillion; akhilraman19@gmail.com)"
# Cap what we pass to the LLM: cost and context size, not correctness.
MAX_TEXT_CHARS = 100_000  # about 25k tokens; long film articles run to ~65k even without references

_VOID_TAGS = frozenset({"br", "hr", "img", "meta", "link", "input", "wbr", "col", "area", "source"})
_SKIP_TAGS = frozenset({"style", "script", "sup", "noscript"})
# Citation lists, nav boxes, edit links, tables of contents: noise, not facts.
_SKIP_CLASSES = frozenset(
    {"navbox", "reflist", "mw-editsection", "toc", "references", "sidebar", "mw-empty-elt"}
)
_BLOCK_TAGS = frozenset({"p", "div", "li", "ul", "ol", "h1", "h3", "h4", "h5", "h6", "table", "caption"})
# Whole sections that are bibliography, not facts. Dropping them first means the size
# cap rarely has to cut real content such as an "Accolades" section near the end.
_DROPPED_SECTIONS = frozenset(
    {"references", "external links", "see also", "notes", "further reading", "bibliography", "footnotes"}
)


class _TextExtractor(HTMLParser):
    """HTML -> plain text where each table row becomes one `a | b | c` line."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._out: list[str] = []
        self._row: list[str] = []
        self._cell: list[str] | None = None
        self._skip_depth = 0
        self._heading: list[str] | None = None
        self._dropping = False
        self._cell_span = (1, 1)  # (rowspan, colspan) of the cell being read
        # column -> [further rows it still covers, its text], for cells that span rows
        self._spans: dict[int, list] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._skip_depth:
            if tag not in _VOID_TAGS:
                self._skip_depth += 1
            return
        attr = dict(attrs)
        classes = set((attr.get("class") or "").split())
        if tag in _SKIP_TAGS or classes & _SKIP_CLASSES:
            self._skip_depth = 1
            return
        if tag == "h2":
            self._heading = []
        elif tag == "table":
            self._spans = {}
            self._out.append("\n")
        elif tag in ("td", "th"):
            self._cell = []
            self._cell_span = (_span(attr.get("rowspan")), _span(attr.get("colspan")))
        elif tag == "br":
            self._append(" ")
        elif tag in _BLOCK_TAGS or tag == "tr":
            self._out.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._skip_depth:
            if tag not in _VOID_TAGS:
                self._skip_depth -= 1
            return
        if tag == "h2" and self._heading is not None:
            name = " ".join("".join(self._heading).split())
            self._heading = None
            self._dropping = name.lower() in _DROPPED_SECTIONS
            if not self._dropping:
                self._out.append(f"\n{name}\n")
        elif tag in ("td", "th") and self._cell is not None:
            self._place(" ".join("".join(self._cell).split()), *self._cell_span)
            self._cell = None
        elif tag == "tr":
            self._fill_spans()  # cells carried down from rows above that sit after the last real cell
            # Keep empty cells: dropping them shifts later cells left, so a row with a blank
            # gross would silently line up under the wrong column header.
            if any(self._row):
                self._out.append(" | ".join(self._row))
            self._out.append("\n")
            self._row = []
        elif tag in _BLOCK_TAGS:
            self._out.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._heading is not None:
            self._heading.append(data)
        else:
            self._append(data)

    def _append(self, text: str) -> None:
        if self._dropping:
            return
        (self._cell if self._cell is not None else self._out).append(text)

    def _fill_spans(self) -> None:
        """Insert cells that a `rowspan` above carries into the current row, at their column."""
        while (col := len(self._row)) in self._spans:
            remaining, text = self._spans[col]
            self._row.append(text)
            if remaining <= 1:
                del self._spans[col]
            else:
                self._spans[col][0] = remaining - 1

    def _place(self, text: str, rowspan: int, colspan: int) -> None:
        """Add a cell. A rowspan cell repeats its text in the rows below it, so a tied
        ranking row ("33 | ... | ₹150 crore" shared by four films) keeps its figure."""
        self._fill_spans()
        for i in range(colspan):
            cell = text if i == 0 else ""
            col = len(self._row)
            self._row.append(cell)
            if rowspan > 1:
                self._spans[col] = [rowspan - 1, cell]

    def text(self) -> str:
        lines = (" ".join(line.split()) for line in "".join(self._out).splitlines())
        return "\n".join(line for line in lines if line)


def _span(value: str | None) -> int:
    """Parse a rowspan/colspan attribute defensively; malformed values mean 1."""
    try:
        return max(1, min(int(value or "1"), 100))
    except ValueError:
        return 1


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
                "prop": "text|revid|properties",
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

        title = parsed["title"]
        # A disambiguation page is a valid page about nothing: a redirect like
        # "Acharya (film)" can land on one. Building a question from it would be wrong.
        if "disambiguation" in (parsed.get("properties") or {}):
            raise SourceError(
                f"Wikipedia page {title!r} (from {key!r}) is a disambiguation page; use a more specific title"
            )

        text = html_to_text(parsed.get("text") or "")
        if not text:
            raise SourceError(f"Wikipedia page {key!r} has no extractable text")

        today = self._today or date.today()
        return Document(
            id=slugify(title),
            title=title,
            publisher=self.publisher,
            url=PAGE_URL + quote(title.replace(" ", "_"), safe="_:()',"),
            retrieved_on=today.isoformat(),
            text=text[:MAX_TEXT_CHARS],
            version=str(parsed["revid"]),
            truncated=len(text) > MAX_TEXT_CHARS,
        )
