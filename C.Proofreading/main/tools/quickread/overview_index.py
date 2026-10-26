#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///

"""Index the Burmese overview so the agent can pull one section instead of re-reading it.

`content/review/burmese-overview.md` is 7,000+ lines: characters, a
translation-defect dossier, and eighteen chapter arcs. The study phase reads it
once. The editing phase must not — an agent that has forgotten what a character
is like needs that character's paragraph, not the whole document.

    python3 mt/overview_index.py --build
    python3 mt/overview_index.py --find ကျီမင်းယွဲ့
    python3 mt/overview_index.py --get character-yed-nan
    python3 mt/overview_index.py --chapter 17
    python3 mt/overview_index.py --chapter 17 --section problems

The index is a plain YAML file of line ranges into the markdown. It carries no
prose of its own, so it cannot drift from the document: rebuild it after any
edit and the ranges are recomputed. If a range no longer matches, `--verify`
says so.

The overview is written in a deliberately conversational register and says so
itself. That is not the house style — do not imitate it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "content" / "review" / "burmese-overview.md"
DEFAULT_INDEX = ROOT / "content" / "review" / "overview.yaml"

BURMESE_DIGITS = "၀၁၂၃၄၅၆၇၈၉"
HEADING = re.compile(r"^(#{1,4})\s+(.*)$")
CHAPTER_RANGE = re.compile(r"အခန်း\s*([၀-၉]+)\s*[–—−-]\s*([၀-၉]+)")
CHAPTER_ANY = re.compile(r"အခန်း\s*([၀-၉]+)")

SECTION_KINDS = {
    "ဇာတ်ကောင်တွေ": "characters",
    "မသဲကွဲမရှင်းလင်းသည့်အပိုင်းများ": "issues",
    "ဘာသာပြန် ခြုံငုံသုံးသပ်ချက်": "verdict",
}
ARC_PARTS = {
    "ဇာတ်လမ်း": "story",
    "ကျွန်တော် ဘာထင်လဲ": "opinion",
}
PROBLEM_PREFIX = "ဒီပိုင်း"


def to_int(text: str) -> int | None:
    """Burmese or Arabic digits to int."""
    digits = "".join(str(BURMESE_DIGITS.index(ch)) if ch in BURMESE_DIGITS else ch
                     for ch in text)
    return int(digits) if digits.isdigit() else None


def chapters_in(title: str) -> list[int]:
    """Chapters a heading refers to: a range, or every number it names."""
    found = CHAPTER_RANGE.search(title)
    if found:
        low, high = to_int(found.group(1)), to_int(found.group(2))
        if low is not None and high is not None:
            return [low, high] if low <= high else [high, low]
    numbers = [to_int(m) for m in CHAPTER_ANY.findall(title)]
    numbers = sorted({n for n in numbers if n is not None})
    if not numbers:
        return []
    return [numbers[0], numbers[-1]] if len(numbers) > 1 else [numbers[0], numbers[0]]


@dataclass
class Section:
    id: str
    level: int
    title: str
    line: int
    end: int
    kind: str
    chapters: list[int] = field(default_factory=list)
    parent: str | None = None
    slug: str = ""

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "lines": [self.line, self.end],
            "chapters": self.chapters,
            "parent": self.parent,
            "children": [],
        }


def slugify(title: str, level: int) -> str:
    """Readable id fragment: keeps Myanmar (marks included) and any other script."""
    cleaned = re.sub(r"^[၀-၉]+။\s*", "", title.strip())
    out: list[str] = []
    for char in cleaned:
        myanmar = ("\u1000" <= char <= "\u109F" or "\uAA60" <= char <= "\uAA7F"
                   or "\uA9E0" <= char <= "\uA9FF")
        if myanmar or char.isalnum():
            out.append(char)
        elif out and out[-1] != "-":
            out.append("-")
    slug = "".join(out).strip("-")
    return slug[:48] or f"h{level}"


KIND_ID = {"characters": "character", "character": "character",
           "issues": "issue", "issue": "issue",
           "verdict": "verdict", "verdict-part": "verdict",
           "arc": "arc", "arc-title": "arc-title", "story": "story",
           "opinion": "opinion", "problems": "problems", "text": "section"}


def parse(text: str) -> tuple[list[Section], list[dict]]:
    lines = text.splitlines()
    headings: list[tuple[int, int, str]] = []
    for number, raw in enumerate(lines, start=1):
        match = HEADING.match(raw)
        if match:
            headings.append((number, len(match.group(1)), match.group(2).strip()))
    if not headings:
        raise SystemExit("no headings found — is this the overview file?")

    sections: list[Section] = []
    for position, (line, level, title) in enumerate(headings):
        end = len(lines)
        for following_line, following_level, _ in headings[position + 1:]:
            if following_level <= level:
                end = following_line - 1
                break
        section = Section(id="", level=level, title=title, line=line, end=end, kind="text")
        if title.startswith("ဇာတ်ကောင်တွေ"):
            section.kind = "characters"
        elif title.startswith("မသဲကွဲ"):
            section.kind = "issues"
        elif title.startswith("ဘာသာပြန် ခြုံငုံ"):
            section.kind = "verdict"
        elif level == 2 and CHAPTER_ANY.search(title):
            section.kind = "arc"
            section.chapters = chapters_in(title)
        sections.append(section)

    # a child inherits the kind of the nearest section above it
    stack: list[Section] = []
    for section in sections:
        while stack and stack[-1].level >= section.level:
            stack.pop()
        parent = stack[-1] if stack else None
        section.parent = parent
        if parent is not None:
            if parent.kind == "characters":
                section.kind = "character"
            elif parent.kind == "issues":
                section.kind = "issue"
            elif parent.kind == "verdict":
                section.kind = "verdict-part"
            elif parent.kind == "arc":
                part = re.sub(r"^[၀-၉]+။\s*", "", section.title)
                if part.startswith(PROBLEM_PREFIX):
                    section.kind = "problems"
                else:
                    section.kind = ARC_PARTS.get(part, "arc-title")
                section.chapters = list(parent.chapters)
        stack.append(section)

    seen: dict[str, int] = {}
    for section in sections:
        base = f"{KIND_ID[section.kind]}-{slugify(section.title, section.level)}"
        count = seen.get(base, 0)
        seen[base] = count + 1
        section.id = base if count == 0 else f"{base}-{count + 1}"

    for section in sections:
        section.parent = section.parent.id if section.parent else None

    characters = parse_character_table(lines)
    return sections, characters


def parse_character_table(lines: list[str]) -> list[dict]:
    """Rows of the `| ဇာတ်ကောင် | ရာထူး | ဆက်စပ်မှု |` table."""
    rows: list[dict] = []
    header_at = None
    for index, raw in enumerate(lines):
        if raw.startswith("|") and "ဇာတ်ကောင်" in raw and "ရာထူး" in raw:
            header_at = index
            break
    if header_at is None:
        return rows
    for raw in lines[header_at + 2:]:
        if not raw.startswith("|"):
            break
        cells = [cell.strip() for cell in raw.strip().strip("|").split("|")]
        if len(cells) < 3 or not cells[0]:
            continue
        rows.append({"name": cells[0], "role": cells[1], "relation": cells[2],
                     "line": header_at + 1 + len(rows) + 3})
    return rows


def scalar(value) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if value is None:
        return "null"
    return json.dumps(value, ensure_ascii=False)


def dump(index: dict) -> str:
    """YAML without a dependency: JSON strings are valid YAML scalars."""
    out: list[str] = []
    for key in ("source", "sha256", "lines", "generated_by"):
        out.append(f"{key}: {scalar(index[key])}")
    out.append("characters:")
    for row in index["characters"]:
        out.append(f"  - name: {scalar(row['name'])}")
        out.append(f"    role: {scalar(row['role'])}")
        out.append(f"    relation: {scalar(row['relation'])}")
        out.append(f"    line: {row['line']}")
        out.append(f"    section: {scalar(row.get('section'))}")
    out.append("sections:")
    for section in index["sections"]:
        out.append(f"  - id: {scalar(section['id'])}")
        out.append(f"    kind: {scalar(section['kind'])}")
        out.append(f"    title: {scalar(section['title'])}")
        out.append(f"    lines: [{section['lines'][0]}, {section['lines'][1]}]")
        out.append(f"    chapters: [{', '.join(str(c) for c in section['chapters'])}]")
        out.append(f"    parent: {scalar(section['parent'])}")
    return "\n".join(out) + "\n"


def build(source: Path, index_path: Path) -> dict:
    text = source.read_text(encoding="utf-8")
    sections, characters = parse(text)
    # attach each table row to its character section, when one exists
    for row in characters:
        match = next((s for s in sections if s.kind == "character" and s.title == row["name"]), None)
        row["section"] = match.id if match else None
    index = {
        "source": str(source.relative_to(ROOT)) if source.is_relative_to(ROOT) else str(source),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "lines": len(text.splitlines()),
        "generated_by": "mt/overview_index.py --build",
        "characters": characters,
        "sections": [section.as_dict() for section in sections],
    }
    index_path.write_text(dump(index), encoding="utf-8")
    return index


# ---------------------------------------------------------------- reading


def load(index_path: Path) -> dict:
    """Read the generated YAML without a YAML parser (single-field lines only)."""
    if not index_path.is_file():
        raise SystemExit(f"{index_path} is missing — run: python3 mt/overview_index.py --build")
    sections: list[dict] = []
    characters: list[dict] = []
    current: dict | None = None
    target: list[dict] | None = None
    for raw in index_path.read_text(encoding="utf-8").splitlines():
        if raw.startswith("characters:"):
            target = characters
            continue
        if raw.startswith("sections:"):
            target = sections
            continue
        if raw.startswith("  - ") and target is not None:
            current = {}
            target.append(current)
            key, _, value = raw[4:].partition(": ")
            current[key] = json.loads(value) if value.startswith('"') else value
            continue
        if raw.startswith("    ") and current is not None:
            key, _, value = raw[4:].partition(": ")
            if value.startswith('"'):
                current[key] = json.loads(value)
            elif value.startswith("["):
                current[key] = [int(v) for v in re.findall(r"\d+", value)]
            else:
                current[key] = value
    return {"sections": sections, "characters": characters}


MAX_LINES = 80


def own_end(section: dict, sections: list[dict]) -> int:
    """Last line before the section's first child, so a container shows only its preamble."""
    children = [child["lines"][0] for child in sections if child.get("parent") == section["id"]]
    return min(children) - 1 if children else section["lines"][1]


def show(source: Path, section: dict, sections: list[dict] | None = None) -> str:
    """One section, without the duplicate heading line the range starts with."""
    lines = source.read_text(encoding="utf-8").splitlines()
    start, end = section["lines"][0], (own_end(section, sections or []) if sections
                                       else section["lines"][1])
    body = lines[start:end]
    clipped = len(body) > MAX_LINES
    text = "\n".join(body[:MAX_LINES]).strip()
    suffix = f"\n\n… ({len(body) - MAX_LINES} more lines; --get {section['id']})" if clipped else ""
    return f"### {section['title']}  [lines {start}-{end}]\n\n{text}{suffix}"


def brief(source: Path, index: dict, *, chars_per_arc: int = 420,
          budget: int = 14000) -> str:
    """The whole document in one round: who, what went wrong, the plot.

    The review is 7,279 lines and 673 KB. Reading it inside an agent session
    would spend the context before the first paragraph is judged, so this
    returns a bounded digest: the character table, the known translation
    defects, the verdict, and each arc's title with its opening.

    What it is *not*: a style guide. The reviewer writes in a chatty first
    person on purpose and says so on line 7. The author's voice is the
    reference, never this document.
    """
    lines = source.read_text(encoding="utf-8").splitlines()

    def body(section: dict, limit: int | None = None) -> str:
        start, end = section["lines"][0], section["lines"][1]
        chunk = [line for line in lines[start:end] if line.strip()]
        text = "\n".join(chunk)
        if limit and len(text) > limit:
            text = text[:limit].rstrip() + " …"
        return text

    sections = index["sections"]
    out: list[str] = [
        "# The review, in one round",
        "",
        f"Source: {source.relative_to(ROOT)} — {len(lines)} lines, "
        f"{len(sections)} sections, {len(index['characters'])} characters.",
        "",
        "How to read this: facts and defects, not prose style. The reviewer's "
        "voice is casual by design and is **not** the author's tone — never "
        "imitate it. Burmese quoted here may carry the same PDF damage as the "
        "reference; take the meaning, never feed the quotes to the segmenter.",
        "",
        "## Characters",
        "",
    ]
    for row in index["characters"]:
        out.append(f"- **{row['name']}** — {row['role']}; {row['relation']}")
    out.append("")

    issues = [section for section in sections if section["kind"] == "issue"]
    out += ["## Known translation defects", ""]
    for issue in issues:
        out.append(f"### {issue['title']}  [{issue['id']}]")
        out.append("")
        out.append(body(issue, 700))
        out.append("")

    for section in sections:
        if section["kind"] == "verdict":
            out += ["## The reviewer's verdict", "", body(section, 900), ""]
            break

    out += ["## The story, part by part", ""]
    arcs = [section for section in sections if section["kind"] == "arc"]
    used = sum(len(chunk) for chunk in out)
    for arc in arcs:
        if used >= budget:
            out.append(f"_… {len(arcs) - arcs.index(arc)} more parts; "
                       "read them with review_lookup --chapter N_")
            break
        title = next((section["title"] for section in sections
                      if section.get("parent") == arc["id"]
                      and section["kind"] == "arc-title"), "")
        story = next((section for section in sections
                      if section.get("parent") == arc["id"]
                      and section["kind"] == "story"), None)
        chapters = arc.get("chapters") or []
        span = f"chapters {chapters[0]}–{chapters[-1]}" if chapters else ""
        out += [f"### {arc['title']} — {span}", ""]
        if title:
            out += [f"*{title}*", ""]
        if story:
            text = body(story, chars_per_arc)
            used += len(text)
            out += [text, ""]
    return "\n".join(out).strip() + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    parser.add_argument("--build", action="store_true", help="regenerate the index")
    parser.add_argument("--find", nargs="+", metavar="TEXT",
                        help="sections whose title, character or body mention TEXT")
    parser.add_argument("--get", metavar="ID", help="print one section by id")
    parser.add_argument("--chapter", type=int, help="the arc that covers this chapter")
    parser.add_argument("--section", choices=["story", "opinion", "problems", "title"],
                        help="with --chapter: which part to print")
    parser.add_argument("--titles", action="store_true", help="list section ids only")
    parser.add_argument("--limit", type=int, default=3, help="max sections printed by --find")
    parser.add_argument("--verify", action="store_true", help="check ranges against the source")
    parser.add_argument("--brief", action="store_true",
                        help="the whole document as one bounded digest: characters, "
                             "defects, verdict, every arc's opening")
    parser.add_argument("--chars-per-arc", type=int, default=420,
                        help="story characters per arc in --brief (default: 420)")
    args = parser.parse_args(argv)

    if args.build:
        index = build(args.source, args.index)
        print(f"wrote {args.index} — {len(index['sections'])} sections, "
              f"{len(index['characters'])} characters, {index['lines']} lines")
        return 0

    if args.brief:
        index = load(args.index)
        print(brief(args.source, index, chars_per_arc=args.chars_per_arc))
        return 0

    index = load(args.index)
    document = args.source.read_text(encoding="utf-8")
    lines = document.splitlines()

    if args.verify:
        drift = 0
        for section in index["sections"]:
            start, end = section["lines"]
            heading = lines[start - 1] if start <= len(lines) else ""
            if section["title"] not in heading:
                print(f"drift: {section['id']} expected {section['title']!r} at {start}")
                drift += 1
        print("ranges match" if not drift else f"{drift} section(s) drifted — rebuild")
        return 0 if not drift else 1

    if args.titles:
        for section in index["sections"]:
            print(f"{section['id']:<40} {section['kind']:<12} {section['title']}")
        return 0

    if args.get:
        match = next((s for s in index["sections"] if s["id"] == args.get), None)
        if match is None:
            print(f"no section {args.get!r}; try --find", file=sys.stderr)
            return 2
        print(show(args.source, match, index["sections"]))
        return 0

    if args.find:
        wanted = [word.lower() for word in args.find]
        hits = []
        for section in index["sections"]:
            haystack = section["title"].lower()
            start = section["lines"][0]
            end = own_end(section, index["sections"])
            body = "\n".join(lines[start - 1:end]).lower()
            if all(word in haystack or word in body for word in wanted):
                hits.append(section)
        def rank(section: dict) -> tuple:
            exact = 0 if any(word == section["title"].lower() for word in wanted) else 1
            depth = {"character": 0, "issue": 1, "arc-title": 2}.get(section["kind"], 3)
            return (exact, depth, section["lines"][0])
        hits.sort(key=rank)
        rows = [row for row in index["characters"]
                if all(word in row["name"].lower() or word in row["role"].lower()
                       or word in row["relation"].lower() for word in wanted)]
        for row in rows:
            print(f"{row['name']}  —  {row['role']}  —  {row['relation']}")
        if rows:
            print()
        for section in hits[:args.limit]:
            print(show(args.source, section, index["sections"]))
            print()
        if len(hits) > args.limit:
            print(f"({len(hits) - args.limit} more section(s) matched; raise --limit)")
        if not hits and not rows:
            print(f"nothing matched {' '.join(args.find)}", file=sys.stderr)
            return 2
        return 0

    if args.chapter is not None:
        arcs = [s for s in index["sections"]
                if s["kind"] in {"arc"} and len(s["chapters"]) == 2
                and s["chapters"][0] <= args.chapter <= s["chapters"][1]]
        if not arcs:
            print(f"chapter {args.chapter} is outside the indexed arcs", file=sys.stderr)
            return 2
        arc = arcs[0]
        children = [s for s in index["sections"] if s.get("parent") == arc["id"]]
        if args.section:
            wanted = next((s for s in children if s["kind"] == args.section), None)
            if wanted is None:
                print(f"{arc['id']} has no {args.section} part", file=sys.stderr)
                return 2
            print(show(args.source, wanted, index["sections"]))
            return 0
        # no --section: a compact map, so the agent asks for one part only
        print(f"{arc['title']}  [{arc['lines'][0]}-{arc['lines'][1]}]  "
              f"chapters {arc['chapters'][0]}-{arc['chapters'][1]}")
        for section in children:
            start, end = section["lines"]
            first = next((l.strip() for l in lines[start:end] if l.strip()
                          and not l.startswith("#")), "")
            print(f"  {section['kind']:<10} {section['id']:<44} "
                  f"[{start}-{end}]  {first[:70]}")
        others = [s for s in index["sections"] if s["kind"] in {"character", "issue"}]
        print(f"\n  {len(others)} document-wide sections (characters, issues) — use --find NAME")
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
