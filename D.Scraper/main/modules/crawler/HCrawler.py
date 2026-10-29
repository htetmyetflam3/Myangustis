"""Novel543 chapter URL -> one UTF-8 text, following the book through its end.

Uses the scraper's HTTP/domain/login/disk plumbing. Chapter names come from
headings inside the text, not the site's sometimes misleading numeric labels.
Each chapter title is preceded by an HCrawler-owned marker such as
[[HCRAWLER MARKER 1]]; its number is a section counter, not the Chinese chapter
number. A small journal under modules/result/ makes the single output resumable;
no uploads.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

from disk_floor import check_disk
from download_rate import client_options, limit_downloads
from Scrawler import HTML_CONTENT_TYPES, _normalized_page_url, _site_key
from site_login import ensure_logged_in_sync

# The shared quote state machine lives in the repository's format/ folder.
REPO_DIR = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_DIR / "format"))
from quote_text import repair_text  # noqa: E402

SCRAPER_DIR = Path(__file__).resolve().parents[2]
INPUT_DIR = REPO_DIR / "content" / "source"
SCAN_DIR = SCRAPER_DIR / "modules" / "result"
REQUEST_TIMEOUT = 30.0
REQUEST_DELAY = 0.5
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.7",
    "Upgrade-Insecure-Requests": "1",
}
PAGE_PATH = re.compile(r"^(?P<book>/[^/]+/)(?P<series>\d+)_(?P<entry>\d+)(?:_(?P<part>\d+))?\.html$")
CHAPTER = re.compile(r"^(第\s*[零〇一二三四五六七八九十百千萬万兩两\d\s]+\s*[章回])(?:\s*[:：、.．\-—]?\s*)(.*)$")
PAGINATION = re.compile(r"[（(]\s*(\d+)\s*[/／]\s*(\d+)\s*[）)]")
RUNNING_PAGE = re.compile(r"\s+\d+\s*[/／]\s*\d+\s*$")
NEXT_LABELS = {"下一章", "下章", "下一頁", "下一页", "下頁", "下页", "next", "nextchapter", "nextpage"}
# HCrawler-owned marker, deliberately unrelated to the Chinese chapter number.
MARKER = "[[HCRAWLER MARKER {number}]]"


def _address(url: str):
    return PAGE_PATH.fullmatch(urllib.parse.urlsplit(url).path)


def _safe_url(url: str, start: str) -> str | None:
    candidate = _normalized_page_url(url, _site_key(start))
    if candidate is None:
        return None
    scope = _address(start)
    path = urllib.parse.urlsplit(candidate).path
    match = _address(candidate)
    if path == scope["book"] + "dir":
        return candidate
    if match and (match["book"], match["series"]) == (scope["book"], scope["series"]):
        return candidate
    return None


def _get(client: httpx.Client, url: str, start: str, output_dir: Path) -> BeautifulSoup:
    current = url
    for _ in range(6):
        if _safe_url(current, start) is None:
            raise ValueError(f"Refusing a URL outside this book: {current}")
        check_disk(output_dir)
        print(f"[html] {current}", flush=True)
        response = None
        for attempt in range(3):
            time.sleep(REQUEST_DELAY if attempt == 0 else attempt * 2)
            try:
                response = client.get(current)
                if response.status_code == 403:
                    raise ValueError(
                        f"Could not fetch {current}: HTTP 403 Forbidden. "
                        "Browser request headers are already set; the site refused "
                        "this request. Progress is preserved, not marked complete."
                    )
                if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
                    continue
                if not response.is_redirect:
                    response.raise_for_status()
                break
            except httpx.HTTPError as error:
                if attempt == 2:
                    raise ValueError(f"Could not fetch {current}: {error}") from error
        if response.is_redirect:
            location = response.headers.get("location")
            if not location:
                raise ValueError(f"Redirect has no Location: {current}")
            current = urllib.parse.urljoin(current, location)
            continue
        mime = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if mime not in HTML_CONTENT_TYPES:
            raise ValueError(f"Expected HTML at {current}, got {mime or 'no content type'}")
        return BeautifulSoup(response.content, "html.parser")
    raise ValueError(f"Too many redirects: {url}")


def _next_url(soup: BeautifulSoup, current: str, start: str) -> str | None:
    """Follow the chapter's navigation, without a prerequisite /dir request.

    A missing link is not proof that the book is finished. Require the final
    chapter marker when there is no forward link, and never follow another book.
    """
    address = _address(current)
    entry, part = int(address["entry"]), int(address["part"] or 1)
    pages, chapters = set(), set()
    invalid_pagination = False
    for anchor in soup.find_all(["a", "link"], href=True):
        labels = (
            anchor.get_text(), anchor.get("title", ""), anchor.get("aria-label", "")
        )
        labels = {re.sub(r"\s+", "", label).lower().strip(">›»→ ") for label in labels}
        if "next" not in anchor.get("rel", []) and not labels.intersection(NEXT_LABELS):
            continue
        url = _safe_url(urllib.parse.urljoin(current, anchor["href"]), start)
        match = _address(url) if url else None
        if match is None:
            continue
        next_entry, next_part = int(match["entry"]), int(match["part"] or 1)
        if next_entry == entry:
            if next_part == part + 1:
                pages.add(url)
            else:
                invalid_pagination = True
        elif next_entry > entry and next_part == 1:
            chapters.add(url)
        else:
            invalid_pagination = True
    if len(pages) > 1 or len(chapters) > 1:
        raise ValueError(f"Conflicting next-page/chapter links at {current}; progress preserved")
    if pages:
        return pages.pop()
    heading = soup.find("h1") or soup.find("title")
    title = heading.get_text(" ", strip=True) if heading else ""
    count = PAGINATION.search(title)
    if count and int(count[1]) < int(count[2]):
        raise ValueError(f"Page {current} says {count[0]}, but its next-page link is missing or skips a page")
    if chapters:
        return chapters.pop()
    if re.search(r"大[結结]局|全[文書书本]完", title):
        return None
    if invalid_pagination:
        raise ValueError(f"Pagination loops or skips a page at {current}; progress preserved")
    raise ValueError(
        f"No usable next-page/chapter link at {current}; "
        "not treating a missing or out-of-book link as the end of the book"
    )


def _heading(line: str) -> tuple[str, str] | None:
    match = CHAPTER.fullmatch(line)
    if not match or len(line) > 180:
        return None
    name = RUNNING_PAGE.sub("", PAGINATION.sub("", line)).strip()
    return re.sub(r"\s+", "", match[1]), name


def _text(soup: BeautifulSoup, current: str, previous: str,
          marker_base: int = 0) -> tuple[str, str, int]:
    title_tag = soup.find("h1") or soup.find("title")
    raw_title = title_tag.get_text(" ", strip=True) if title_tag else ""
    title = PAGINATION.sub("", raw_title).strip()
    # Prefer the reading pane; use the whole page only if no such pane exists.
    root = None
    for selector in ("#chapter-content", "#chaptercontent", "#BookText", "#content", ".chapter-content", ".chaptercontent", "article", ".content"):
        candidates = soup.select(selector)
        if candidates:
            root = max(candidates, key=lambda tag: len(tag.get_text()))
            break
    root = root if root is not None else (soup.body or soup)
    for tag in root.select("script, style, noscript, iframe, form, nav, header, footer, select"):
        tag.decompose()
    for tag in root.find_all("a"):
        # Chapter navigation and ad links are not novel paragraphs.
        tag.decompose()
    lines = []
    for raw in root.get_text("\n", strip=True).splitlines():
        line = raw.replace("</p>", "").strip()
        if line.startswith(("溫馨提示", "温馨提示", "502 Server Error")):
            break
        if line:
            lines.append(line)
    if not lines or not any(re.search(r"[\u3400-\u9fff]", line) for line in lines):
        raise ValueError(f"No Chinese chapter text found at {current}")
    actual = [(i, _heading(line)) for i, line in enumerate(lines) if _heading(line)]
    output = []
    sections = 0
    last_key = _heading(previous)[0] if _heading(previous) else previous

    def section(name: str, key: str) -> None:
        nonlocal previous, last_key, sections
        if key != last_key:
            number = marker_base + sections + 1
            output.append(
                f"\n\n{MARKER.format(number=number)}\n===== {name} =====\n\n"
            )
            previous, last_key = name, key
            sections += 1

    if actual and (not previous or int(_address(current)["part"] or 1) == 1):
        # Primary pages start a chapter; pagination may instead begin with
        # the preceding chapter's continuation, which must be preserved.
        lines = lines[actual[0][0]:]
    elif not actual and (not previous or int(_address(current)["part"] or 1) == 1):
        if not title:
            raise ValueError(f"No chapter name found at {current}")
        section(title, _heading(title)[0] if _heading(title) else title)
    for line in lines:
        heading = _heading(line)
        if heading:
            section(heading[1], heading[0])
        elif line not in {title, raw_title}:
            output.append(line + "\n")
    text = "".join(output)
    # The site mixes &quot;, &amp;quot; and bare " encodings. Normalize them
    # while writing the page so a later repair pass is not required.
    text, quote_changes, quote_counts = repair_text(text, include_ascii=True)
    if quote_changes:
        print(
            f"[quotes] {quote_counts['entities']} token(s): "
            f"{quote_counts['open']} open, {quote_counts['close']} close, "
            f"{quote_counts['removed']} removed, "
            f"{quote_counts['ambiguous']} flagged",
            flush=True,
        )
    if not text.strip():
        raise ValueError(f"Empty chapter body at {current}")
    return text, previous, sections


def _checkpoint(path: Path, state: dict) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def crawl_html(start_url: str, *, output_dir: Path = INPUT_DIR, scan_dir: Path = SCAN_DIR) -> tuple[Path, int]:
    """Include the supplied chapter page, then every later page in this book.

    Each completed page is committed to one text and an ignored scan/ journal.
    On rerun the text is truncated to its last committed byte before appending,
    so interruption between writing text and updating the journal cannot duplicate
    a page. A failed request stops the run rather than skipping novel text.
    """
    start = _normalized_page_url(start_url.strip())
    if start is None or _address(start) is None:
        raise ValueError("Pass a chapter URL such as https://www.novel543.com/0511241012/8011_93.html")
    address = _address(start)
    stem = f"chinese-{address['book'].strip('/')}-from-{Path(urllib.parse.urlsplit(start).path).stem}"
    destination = Path(output_dir) / (stem + ".txt")
    journal = Path(scan_dir) / (stem + ".json")
    check_disk(destination.parent)
    destination.parent.mkdir(parents=True, exist_ok=True)
    journal.parent.mkdir(parents=True, exist_ok=True)
    if journal.exists():
        state = json.loads(journal.read_text(encoding="utf-8"))
        if state.get("start_url") != start:
            raise ValueError(f"Journal belongs to another start URL: {journal}")
        if not destination.exists():
            raise ValueError(f"Output is missing: {destination}")
        # A finished crawl is not appended to, so its file may legitimately have
        # been edited after the fact (for example a quote pass that changes the
        # byte count). Only an unfinished crawl needs the byte floor that keeps
        # the append position honest.
        if not state["complete"] and destination.stat().st_size < state["bytes"]:
            raise ValueError(
                f"Output is shorter than its unfinished journal: {destination}; "
                "restore the original bytes before resuming"
            )
        if state["complete"]:
            print(f"[done] Already complete: {destination}", flush=True)
            return destination, state["pages"]
    else:
        # Never overwrite an existing text whose resume journal was removed.
        with destination.open("xb"):
            pass
        state = {"start_url": start, "next_url": start, "bytes": 0, "heading": "", "pages": 0, "sections": 0, "complete": False}
        _checkpoint(journal, state)
    with limit_downloads(0, log=print), httpx.Client(
        timeout=REQUEST_TIMEOUT,
        follow_redirects=False,
        headers={**HTTP_HEADERS, "Referer": state.get("last_url", start)},
        **client_options(),
    ) as client:
        ensure_logged_in_sync(client, start)
        seen = set()
        with destination.open("r+b") as output:
            output.seek(state["bytes"])
            output.truncate()
            while state["next_url"]:
                url = state["next_url"]
                if url in seen:
                    raise ValueError(f"Pagination loop at {url}")
                seen.add(url)
                soup = _get(client, url, start, destination.parent)
                following = _next_url(soup, url, start)
                text, heading, sections = _text(
                    soup, url, state["heading"], state["sections"]
                )
                output.write(text.encode("utf-8"))
                output.flush()
                os.fsync(output.fileno())
                state.update(next_url=following, last_url=url, bytes=output.tell(), heading=heading,
                             pages=state["pages"] + 1, sections=state["sections"] + sections,
                             complete=following is None)
                _checkpoint(journal, state)
                client.headers["Referer"] = url
                print(f"[saved] {state['pages']} page(s), {state['sections']} section(s): {heading}", flush=True)
    print(f"[done] {state['pages']} page(s) -> {destination}", flush=True)
    return destination, state["pages"]
