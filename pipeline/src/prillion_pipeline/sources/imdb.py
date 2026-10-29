"""IMDb vote counts, from IMDb's official non-commercial datasets.

https://developer.imdb.com/non-commercial-datasets/

Licence: personal and non-commercial use only. We do NOT scrape imdb.com (its
terms forbid it) and we never redistribute the dataset files; we only keep
derived vote counts in our own candidate files. Revisit if Prillion is monetised.

Used as a popularity SIGNAL (how many people rated a film), not as a source of
facts: the datasets have no plot or evidence text, so Wikipedia stays the
citation. Vote counts are a proxy for how well-known a film is.
"""

import csv
import gzip
import os
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

# Case, accents and punctuation must not stop "Hanu-Man" matching "HanuMan".
from ..text import normalize_key as normalize_title

DATASETS_URL = "https://datasets.imdbws.com/"
RATINGS_FILE = "title.ratings.tsv.gz"
BASICS_FILE = "title.basics.tsv.gz"
INDEX_FILE = "imdb-movies.tsv"
DEFAULT_MAX_AGE_SECONDS = 7 * 24 * 3600
# Below this the vote count is too noisy to say anything about familiarity.
MIN_VOTES = 100
_NULL = r"\N"


@dataclass(frozen=True)
class ImdbTitle:
    tconst: str
    title: str
    year: int | None
    votes: int
    rating: float


def _is_fresh(path: Path, max_age: float, now: float) -> bool:
    return path.exists() and now - path.stat().st_mtime < max_age


def download(
    name: str,
    cache_dir: Path,
    client: httpx.Client,
    max_age: float = DEFAULT_MAX_AGE_SECONDS,
    now: float | None = None,
) -> Path:
    """Fetch `name` into `cache_dir` unless a fresh copy is already there.

    Written to a temp file and renamed, so a crash mid-download never leaves a
    truncated file that a later run would trust.
    """
    target = cache_dir / name
    if _is_fresh(target, max_age, time.time() if now is None else now):
        return target

    cache_dir.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    with client.stream("GET", DATASETS_URL + name) as response:
        response.raise_for_status()
        with partial.open("wb") as out:
            for chunk in response.iter_bytes(1 << 20):
                out.write(chunk)
    os.replace(partial, target)
    return target


def _rows(path: Path):
    """Yield data rows of an IMDb TSV.gz (header skipped). No quote handling: IMDb does not quote."""
    with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE)
        next(reader, None)
        yield from reader


def build_index(ratings_gz: Path, basics_gz: Path, out_path: Path, min_votes: int = MIN_VOTES) -> int:
    """Join ratings and basics into one small file of feature films. Returns the row count."""
    ratings: dict[str, tuple[str, int]] = {}
    for tconst, average, votes in _rows(ratings_gz):
        count = int(votes)
        if count >= min_votes:
            ratings[tconst] = (average, count)

    partial = out_path.with_suffix(out_path.suffix + ".part")
    written = 0
    with partial.open("w", encoding="utf-8", newline="") as out:
        for row in _rows(basics_gz):
            tconst, title_type, primary, original, _adult, year = row[:6]
            if title_type != "movie" or tconst not in ratings:
                continue
            average, count = ratings[tconst]
            fields = [tconst, primary, "" if original == _NULL else original]
            fields += ["" if year == _NULL else year, str(count), average]
            out.write("\t".join(fields) + "\n")
            written += 1
    os.replace(partial, out_path)
    return written


class ImdbIndex:
    def __init__(self, titles: list[tuple[str, ImdbTitle]]) -> None:
        self._by_key: dict[str, list[ImdbTitle]] = {}
        for key, title in titles:
            bucket = self._by_key.setdefault(key, [])
            if title not in bucket:  # primary and original title are often identical
                bucket.append(title)
        for bucket in self._by_key.values():
            bucket.sort(key=lambda t: t.votes, reverse=True)

    @classmethod
    def load(cls, index_path: Path) -> ImdbIndex:
        entries: list[tuple[str, ImdbTitle]] = []
        with index_path.open(encoding="utf-8", newline="") as handle:
            for tconst, primary, original, year, votes, rating in csv.reader(
                handle, delimiter="\t", quoting=csv.QUOTE_NONE
            ):
                title = ImdbTitle(tconst, primary, int(year) if year else None, int(votes), float(rating))
                for name in {primary, original} - {""}:
                    entries.append((normalize_title(name), title))
        return cls(entries)

    def lookup(self, title: str, year: int | None = None, year_tolerance: int = 1) -> list[ImdbTitle]:
        """Every IMDb film with this title, most-voted first.

        More than one result means the name is ambiguous; the caller must
        disambiguate (pass `year`) rather than silently take the first.
        """
        matches = self._by_key.get(normalize_title(title), [])
        if year is None:
            return list(matches)
        return [m for m in matches if m.year is not None and abs(m.year - year) <= year_tolerance]


def ensure_index(
    cache_dir: Path,
    client: httpx.Client,
    max_age: float = DEFAULT_MAX_AGE_SECONDS,
    now: float | None = None,
) -> ImdbIndex:
    """Return a ready index, downloading and building only when the cache is stale."""
    index_path = cache_dir / INDEX_FILE
    current = time.time() if now is None else now
    if not _is_fresh(index_path, max_age, current):
        ratings = download(RATINGS_FILE, cache_dir, client, max_age, current)
        basics = download(BASICS_FILE, cache_dir, client, max_age, current)
        build_index(ratings, basics, index_path)
    return ImdbIndex.load(index_path)
