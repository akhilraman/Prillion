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


def test_text_is_capped() -> None:
    doc = fetch(api_payload(text="<p>" + "a" * (MAX_TEXT_CHARS + 500) + "</p>"))
    assert len(doc.text) == MAX_TEXT_CHARS


def test_url_encodes_special_characters() -> None:
    doc = fetch(api_payload(title="Baahubali: The Beginning"))
    assert doc.url == "https://en.wikipedia.org/wiki/Baahubali:_The_Beginning"
    assert slugify(doc.title) == "baahubali-the-beginning"
