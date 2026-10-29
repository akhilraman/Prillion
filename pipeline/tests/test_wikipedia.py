from datetime import date

import httpx
import pytest

from prillion_pipeline.sources.base import SourceError
from prillion_pipeline.sources.wikipedia import (
    MAX_TEXT_CHARS,
    USER_AGENT,
    WikipediaSource,
    html_to_text,
    slugify,
)

TODAY = date(2026, 10, 29)

HTML = """
<style>.x{color:red}</style>
<div class="mw-parser-output">
  <p>The award is given annually.<sup class="reference">[1]</sup> See <a href="/x">Titan</a>.</p>
  <h2>Winners</h2>
  <table class="wikitable">
    <caption>Winners by season</caption>
    <tr><th>Season</th><th>Player</th></tr>
    <tr><td>2021&ndash;22</td><td><a href="/j">Nikola Jokić</a><sup>[a]</sup></td></tr>
    <tr><td>2022&ndash;23</td><td>Joel Embiid</td></tr>
    <tr><td></td><td></td></tr>
  </table>
  <div class="navbox"><table><tr><td>Unrelated navigation</td></tr></table></div>
  <div class="reflist"><ol class="references"><li>A citation</li></ol></div>
</div>
"""


def api_payload(**overrides: object) -> dict:
    parse = {"title": "NBA Most Valuable Player", "revid": 123456, "text": HTML}
    return {"parse": {**parse, **overrides}}


def client_for(payload: dict, seen: list[httpx.Request] | None = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(200, json=payload)

    return httpx.Client(headers={"User-Agent": USER_AGENT}, transport=httpx.MockTransport(handler))


def fetch(payload: dict, key: str = "NBA Most Valuable Player Award"):
    return WikipediaSource(client=client_for(payload), today=TODAY).fetch(key)


def test_table_rows_survive_as_pipe_separated_lines() -> None:
    text = html_to_text(HTML)

    assert "Season | Player" in text.splitlines()
    assert "2021–22 | Nikola Jokić" in text.splitlines()
    assert "2022–23 | Joel Embiid" in text.splitlines()


def test_noise_is_dropped() -> None:
    text = html_to_text(HTML)

    assert "[1]" not in text and "[a]" not in text  # citation markers
    assert "Unrelated navigation" not in text  # navbox
    assert "A citation" not in text  # reference list
    assert "color:red" not in text  # style
    assert "The award is given annually. See Titan." in text  # inline links keep their text


def test_empty_table_rows_are_skipped() -> None:
    rows = [line for line in html_to_text(HTML).splitlines() if "|" in line]
    assert rows == ["Season | Player", "2021–22 | Nikola Jokić", "2022–23 | Joel Embiid"]


def test_blank_cells_keep_their_column_position() -> None:
    html = (
        "<table>"
        "<tr><th>Rank</th><th>Title</th><th>Gross</th><th>Year</th></tr>"
        "<tr><td>1</td><td>RRR</td><td>1,300 crore</td><td>2022</td></tr>"
        "<tr><td></td><td>Janatha Garage</td><td></td><td>2016</td></tr>"
        "</table>"
    )
    rows = [[c.strip() for c in line.split("|")] for line in html_to_text(html).splitlines()]

    assert rows[0] == ["Rank", "Title", "Gross", "Year"]
    assert rows[1] == ["1", "RRR", "1,300 crore", "2022"]
    assert rows[2] == ["", "Janatha Garage", "", "2016"]  # blank rank and gross stay in place


def _cells(html: str) -> list[list[str]]:
    return [[c.strip() for c in line.split("|")] for line in html_to_text(html).splitlines()]


def test_rowspan_cells_repeat_in_the_rows_they_cover() -> None:
    """Tied films share one rank and gross cell: every tied row must still carry both."""
    html = (
        "<table>"
        "<tr><th>Rank</th><th>Title</th><th>Gross</th><th>Year</th></tr>"
        '<tr><td rowspan="3">33</td><td>Gabbar Singh</td><td rowspan="3">₹150 crore</td><td>2012</td></tr>'
        "<tr><td>Janatha Garage</td><td>2016</td></tr>"
        "<tr><td>Akhanda</td><td>2021</td></tr>"
        "<tr><td>34</td><td>Next Film</td><td>₹149 crore</td><td>2018</td></tr>"
        "</table>"
    )

    assert _cells(html) == [
        ["Rank", "Title", "Gross", "Year"],
        ["33", "Gabbar Singh", "₹150 crore", "2012"],
        ["33", "Janatha Garage", "₹150 crore", "2016"],
        ["33", "Akhanda", "₹150 crore", "2021"],
        ["34", "Next Film", "₹149 crore", "2018"],  # the span ended; no leakage
    ]


def test_colspan_keeps_later_cells_in_their_columns() -> None:
    html = (
        "<table><tr><th>A</th><th>B</th><th>C</th></tr>"
        '<tr><td colspan="2">wide</td><td>last</td></tr></table>'
    )

    assert _cells(html)[1] == ["wide", "", "last"]


def test_trailing_rowspan_cell_is_carried_past_the_last_explicit_cell() -> None:
    html = '<table><tr><td>a</td><td rowspan="2">shared</td></tr><tr><td>b</td></tr></table>'

    assert _cells(html) == [["a", "shared"], ["b", "shared"]]


def test_spans_do_not_leak_between_tables_and_bad_values_are_tolerated() -> None:
    html = (
        '<table><tr><td rowspan="5">x</td><td>1</td></tr></table>'
        '<table><tr><td rowspan="oops">y</td><td colspan="-3">2</td></tr><tr><td>z</td></tr></table>'
    )

    assert _cells(html) == [["x", "1"], ["y", "2"], ["z"]]


def test_fetch_builds_a_pinned_document() -> None:
    doc = fetch(api_payload())

    assert doc.id == "nba-most-valuable-player"
    assert doc.publisher == "Wikipedia"
    assert doc.url == "https://en.wikipedia.org/wiki/NBA_Most_Valuable_Player"
    assert doc.retrieved_on == "2026-10-29"
    assert doc.version == "123456"
    assert "Nikola Jokić" in doc.text


def test_request_asks_for_parsed_html_with_redirects_and_identifies_the_client() -> None:
    seen: list[httpx.Request] = []
    WikipediaSource(client=client_for(api_payload(), seen), today=TODAY).fetch("NBA MVP")

    params = seen[0].url.params
    assert params["action"] == "parse" and params["redirects"] == "1" and params["page"] == "NBA MVP"
    assert "akhilraman19@gmail.com" in seen[0].headers["User-Agent"]


def test_missing_page_is_a_source_error() -> None:
    with pytest.raises(SourceError, match="no page titled"):
        fetch({"error": {"code": "missingtitle", "info": "The page you specified doesn't exist."}})


def test_other_api_errors_are_source_errors() -> None:
    with pytest.raises(SourceError, match="API error 'badtitle'"):
        fetch({"error": {"code": "badtitle"}})


def test_empty_text_is_a_source_error() -> None:
    with pytest.raises(SourceError, match="no extractable text"):
        fetch(api_payload(text="<div class='navbox'>only nav</div>"))


def test_missing_revision_is_a_source_error() -> None:
    payload = {"parse": {"title": "X", "text": HTML}}
    with pytest.raises(SourceError, match="revision id"):
        fetch(payload)


def test_http_errors_propagate_so_the_caller_can_retry() -> None:
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(503)))
    with pytest.raises(httpx.HTTPStatusError):
        WikipediaSource(client=client, today=TODAY).fetch("X")


def test_text_is_capped_and_flagged_as_truncated() -> None:
    doc = fetch(api_payload(text="<p>" + "a" * (MAX_TEXT_CHARS + 500) + "</p>"))

    assert len(doc.text) == MAX_TEXT_CHARS
    assert doc.truncated is True


def test_short_pages_are_not_flagged_as_truncated() -> None:
    assert fetch(api_payload()).truncated is False


SECTIONS = """
<h2>Box office</h2><p>It grossed 1,300 crore.</p>
<h2>Notes</h2><p>Note a: a long footnote about currency conversion.</p>
<h2>References</h2><p>A very long bibliography entry.</p>
<h2>External links</h2><ul><li>Official website</li></ul>
<h2>Accolades</h2><p>It won the National Film Award.</p>
"""


def test_bibliography_sections_are_dropped_and_real_sections_after_them_are_kept() -> None:
    text = html_to_text(SECTIONS)

    assert "It grossed 1,300 crore." in text
    assert "It won the National Film Award." in text  # sits AFTER the dropped sections
    assert "footnote" not in text and "bibliography" not in text and "Official website" not in text
    assert "Box office" in text.splitlines() and "Accolades" in text.splitlines()
    assert "References" not in text.splitlines()


def test_dropping_bibliography_keeps_late_sections_inside_the_cap() -> None:
    filler = "<h2>References</h2><p>" + "r" * (MAX_TEXT_CHARS * 2) + "</p>"
    doc = fetch(api_payload(text="<p>Intro.</p>" + filler + "<h2>Accolades</h2><p>Won an award.</p>"))

    assert "Won an award." in doc.text
    assert doc.truncated is False


def test_disambiguation_page_is_a_source_error() -> None:
    payload = api_payload(title="Acharya (disambiguation)", properties={"disambiguation": ""})
    with pytest.raises(SourceError, match="disambiguation page"):
        fetch(payload, key="Acharya (film)")


def test_ordinary_page_properties_do_not_trigger_the_disambiguation_check() -> None:
    doc = fetch(api_payload(properties={"wikibase_item": "Q1"}))
    assert doc.title == "NBA Most Valuable Player"


def test_url_encodes_special_characters() -> None:
    doc = fetch(api_payload(title="Baahubali: The Beginning"))
    assert doc.url == "https://en.wikipedia.org/wiki/Baahubali:_The_Beginning"
    assert slugify(doc.title) == "baahubali-the-beginning"
