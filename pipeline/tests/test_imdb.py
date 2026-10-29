import gzip
import os
from pathlib import Path

import httpx
import pytest

from prillion_pipeline.sources.imdb import (
    BASICS_FILE,
    INDEX_FILE,
    RATINGS_FILE,
    ImdbIndex,
    build_index,
    download,
    ensure_index,
    normalize_title,
)

RATINGS = "tconst\taverageRating\tnumVotes\n" + "\n".join(
    [
        "tt1\t8.0\t500000",  # Baahubali
        "tt2\t7.0\t90000",  # Kingdom (2025 Telugu)
        "tt3\t6.5\t300",  # Kingdom (1990s obscure)
        "tt4\t5.0\t99",  # too few votes
        "tt5\t8.8\t900000",  # a TV episode, not a movie
        "tt6\t7.7\t1200",  # Hanu-Man
    ]
)
BASICS = (
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres\n"
    + "\n".join(
        [
            "tt1\tmovie\tBaahubali: The Beginning\tBaahubali: The Beginning\t0\t2015\t\\N\t159\tAction",
            "tt2\tmovie\tKingdom\tKingdom\t0\t2025\t\\N\t150\tAction",
            "tt3\tmovie\tKingdom\tRoyaume\t0\t1995\t\\N\t90\tDrama",
            "tt4\tmovie\tNobody Saw This\tNobody Saw This\t0\t2001\t\\N\t80\tDrama",
            "tt5\ttvEpisode\tPilot\tPilot\t0\t2008\t\\N\t45\tDrama",
            "tt6\tmovie\tHanu-Man\tHanuMan\t0\t\\N\t\\N\t120\tAction",
        ]
    )
)


def write_gz(path: Path, text: str) -> Path:
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write(text + "\n")
    return path


@pytest.fixture
def index_path(tmp_path: Path) -> Path:
    ratings = write_gz(tmp_path / "r.tsv.gz", RATINGS)
    basics = write_gz(tmp_path / "b.tsv.gz", BASICS)
    out = tmp_path / INDEX_FILE
    build_index(ratings, basics, out)
    return out


def test_normalize_title_ignores_case_accents_and_punctuation() -> None:
    assert normalize_title("Hanu-Man") == normalize_title("HanuMan") == "hanuman"
    assert normalize_title("Jokić") == "jokic"


def test_build_index_keeps_only_feature_films_with_enough_votes(tmp_path: Path, index_path: Path) -> None:
    ids = [line.split("\t")[0] for line in index_path.read_text().splitlines()]
    assert ids == ["tt1", "tt2", "tt3", "tt6"]  # tt4: <100 votes, tt5: not a movie


def test_lookup_finds_by_primary_or_original_title(index_path: Path) -> None:
    index = ImdbIndex.load(index_path)

    assert index.lookup("baahubali the beginning")[0].votes == 500000
    assert index.lookup("Royaume")[0].tconst == "tt3"  # original title
    assert index.lookup("Hanu Man")[0].year is None  # \N year handled


def test_ambiguous_titles_return_every_match_most_voted_first(index_path: Path) -> None:
    matches = ImdbIndex.load(index_path).lookup("Kingdom")

    assert [m.tconst for m in matches] == ["tt2", "tt3"]


def test_year_disambiguates_with_tolerance(index_path: Path) -> None:
    index = ImdbIndex.load(index_path)

    assert [m.tconst for m in index.lookup("Kingdom", year=1995)] == ["tt3"]
    assert [m.tconst for m in index.lookup("Kingdom", year=2024)] == ["tt2"]  # +-1 year
    assert index.lookup("Kingdom", year=2010) == []
    assert index.lookup("Hanu-Man", year=2024) == []  # unknown year never matches a year filter


def test_unknown_title_is_empty_not_an_error(index_path: Path) -> None:
    assert ImdbIndex.load(index_path).lookup("No Such Film") == []


class Counter:
    """Mock IMDb server that counts requests per file."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = files
        self.hits: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        name = request.url.path.rsplit("/", 1)[-1]
        self.hits.append(name)
        if name not in self.files:
            return httpx.Response(404)
        return httpx.Response(200, content=self.files[name])

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


def test_download_skips_when_cache_is_fresh(tmp_path: Path) -> None:
    server = Counter({RATINGS_FILE: b"payload"})
    now = 1_000_000.0
    target = tmp_path / RATINGS_FILE
    target.write_bytes(b"cached")
    os.utime(target, (now - 60, now - 60))

    download(RATINGS_FILE, tmp_path, server.client(), now=now)

    assert server.hits == [] and target.read_bytes() == b"cached"


def test_download_refreshes_stale_cache_and_leaves_no_partial_file(tmp_path: Path) -> None:
    server = Counter({RATINGS_FILE: b"fresh"})
    now = 1_000_000.0
    target = tmp_path / RATINGS_FILE
    target.write_bytes(b"old")
    os.utime(target, (now - 30 * 24 * 3600, now - 30 * 24 * 3600))

    download(RATINGS_FILE, tmp_path, server.client(), now=now)

    assert target.read_bytes() == b"fresh"
    assert not list(tmp_path.glob("*.part"))


def test_failed_download_keeps_the_old_file_and_raises(tmp_path: Path) -> None:
    server = Counter({})  # every request 404s
    target = tmp_path / RATINGS_FILE
    target.write_bytes(b"old")
    os.utime(target, (1.0, 1.0))

    with pytest.raises(httpx.HTTPStatusError):
        download(RATINGS_FILE, tmp_path, server.client(), now=1_000_000.0)

    assert target.read_bytes() == b"old"
    assert not list(tmp_path.glob("*.part"))


def test_ensure_index_builds_once_then_reuses_the_cache(tmp_path: Path) -> None:
    def gz_bytes(text: str) -> bytes:
        return gzip.compress((text + "\n").encode())

    server = Counter({RATINGS_FILE: gz_bytes(RATINGS), BASICS_FILE: gz_bytes(BASICS)})

    first = ensure_index(tmp_path, server.client())
    assert first.lookup("Baahubali The Beginning")
    assert sorted(server.hits) == [BASICS_FILE, RATINGS_FILE]

    second = ensure_index(tmp_path, server.client())
    assert second.lookup("Baahubali The Beginning")
    assert len(server.hits) == 2  # nothing re-downloaded
