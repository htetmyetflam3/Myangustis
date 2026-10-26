"""Shared Chinese quote normalization for HCrawler and repair_quotes.py.

The source site can emit quote marks as `&quot;`, `&amp;quot;`, `&#34;` or a bare
ASCII `"`. This module chooses Chinese `“` / `”` from local context. It preserves
all non-quote characters and line endings. It does not rewrite source files; the
caller decides where the returned text goes.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
import re

# `&quot;`, `&amp;quot;`, `&amp;amp;quot;`, `&#34;`, `&#x22;`.
# Each additional escaping turns the leading `&` into `&amp;`, giving
# `&amp;quot;` (not `&amp;&quot;`). Matching is case-insensitive.
ENTITY_SOURCE = r"&(?:amp;)*(?:quot|#0*34|#x0*22);"
ENTITY = re.compile(ENTITY_SOURCE, re.IGNORECASE)
LINE_END = re.compile(r"(\r\n|\n|\r)$")
OPEN_QUOTE = "“"
CLOSE_QUOTE = "”"
COLONS = ":："
CLOSING_PUNCTUATION = "！？。，、；：!?.,;:"
SENTENCE_END = "。！？!?"
STRAIGHT_QUOTE = '"'


@dataclass(frozen=True)
class Change:
    line: int
    column: int
    choice: str
    reason: str
    ambiguous: bool
    context: str
    start: int
    end: int


def token_pattern(include_ascii: bool = False) -> re.Pattern[str]:
    """Return the entity matcher, optionally including bare ASCII quotes."""
    if include_ascii:
        return re.compile(f"(?:{ENTITY_SOURCE})|{STRAIGHT_QUOTE}", re.IGNORECASE)
    return ENTITY


def split_line_ending(line: str) -> tuple[str, str]:
    match = LINE_END.search(line)
    if match is None:
        return line, ""
    return line[:match.start()], match.group(1)


def scan_existing_quotes(chunk: str, inside: bool) -> bool:
    """Track already-correct curly quotes between quote tokens."""
    for character in chunk:
        if character == OPEN_QUOTE:
            inside = True
        elif character == CLOSE_QUOTE:
            inside = False
    return inside


def repair_line(body: str, line_number: int,
                pattern: re.Pattern[str] = ENTITY) -> tuple[str, list[Change]]:
    matches = list(pattern.finditer(body))
    if not matches:
        return body, []
    decisions: list[Change] = []
    inside = False
    cursor = 0
    previous_end: int | None = None
    for match in matches:
        chunk = body[cursor:match.start()]
        inside = scan_existing_quotes(chunk, inside)

        prefix = body[:match.start()]
        suffix = body[match.end():]
        left = prefix.rstrip()[-1:] if prefix.rstrip() else ""
        right = suffix.lstrip()[:1] if suffix.lstrip() else ""
        bol = not prefix.lstrip("\ufeff").strip()
        eol = not suffix.strip()
        between_previous = body[previous_end:match.start()] if previous_end is not None else ""

        if inside and prefix.rstrip().endswith(OPEN_QUOTE):
            choice = "remove"
            reason = "duplicate-opening-after-open-quote"
            ambiguous = True
        elif inside:
            choice = "close"
            reason = "closes-open-quote"
            ambiguous = False
        elif bol:
            choice = "open"
            reason = "line-start"
            ambiguous = False
        elif eol:
            choice = "close"
            reason = "line-end"
            ambiguous = False
        elif left and left in COLONS:
            choice = "open"
            reason = "after-colon"
            ambiguous = False
        elif right and right in CLOSING_PUNCTUATION:
            choice = "close"
            reason = "before-closing-punctuation"
            ambiguous = False
        elif left == "。":
            # A quote after a full stop normally opens a new quotation, but a
            # fragment ending a previous quotation can also end with a marker.
            if previous_end is not None and "。" in between_previous:
                choice = "open"
                reason = "quote-after-narrative"
            else:
                choice = "close"
                reason = "after-period"
            ambiguous = True
        elif left and left in SENTENCE_END:
            choice = "close"
            reason = "after-sentence-end"
            ambiguous = True
        else:
            choice = "open"
            reason = "default-open"
            ambiguous = True

        context = (
            body[max(0, match.start() - 28):match.start()]
            + "⟦" + match.group(0) + "⟧"
            + body[match.end():match.end() + 28]
        ).replace("\t", " ")
        decisions.append(Change(line_number, match.start() + 1, choice, reason,
                                ambiguous, context, match.start(), match.end()))
        if choice == "close":
            inside = False
        else:
            inside = True
        previous_end = match.end()
        cursor = match.end()

    # `"outer ... "term" ...` has three entities on one line in this source.
    # Without this, the term's opening quote is mistaken for the outer closing
    # quote and the pair comes out reversed. Only a short, punctuation-free gap
    # is treated as a nested term.
    if (len(decisions) in {3, 4}
            and decisions[0].choice == "open" and decisions[0].reason == "line-start"
            and decisions[1].choice == "close" and decisions[1].reason == "closes-open-quote"
            and decisions[2].choice == "open" and decisions[2].reason == "default-open"
            and (len(decisions) == 3 or decisions[3].choice == "close")):
        gap = body[decisions[1].end:decisions[2].start]
        if (0 < len(gap.strip()) <= 6
                and not re.search(r"[\s。！？!?，、；：:.,;\"“”]", gap)):
            decisions[1] = replace(decisions[1], choice="open",
                                   reason="nested-pair-open", ambiguous=True)
            decisions[2] = replace(decisions[2], choice="close",
                                   reason="nested-pair-close", ambiguous=True)

    output: list[str] = []
    cursor = 0
    for decision, match in zip(decisions, matches):
        output.append(body[cursor:decision.start])
        if decision.choice == "remove":
            output.append("")
        elif decision.choice == "open":
            output.append(OPEN_QUOTE)
        else:
            output.append(CLOSE_QUOTE)
        cursor = match.end()
    output.append(body[cursor:])
    return "".join(output), decisions


def repair_text(text: str, *, include_ascii: bool = False) -> tuple[str, list[Change], dict]:
    """Normalize quote tokens line by line, preserving every line ending.

    `include_ascii=True` also treats bare `"` as a quote token. HCrawler uses
    this because the site mixes entity and straight quote encodings; the repair
    CLI leaves bare quotes alone unless its explicit option is set.
    """
    pattern = token_pattern(include_ascii)
    lines = text.splitlines(keepends=True)
    repaired: list[str] = []
    changes: list[Change] = []
    for number, line in enumerate(lines, 1):
        body, ending = split_line_ending(line)
        fixed, line_changes = repair_line(body, number, pattern)
        repaired.append(fixed + ending)
        changes.extend(line_changes)
    counts = {"entities": len(changes), "open": 0, "close": 0, "removed": 0,
              "ambiguous": 0, "lines_changed": len({c.line for c in changes}),
              "include_ascii": include_ascii}
    for change in changes:
        if change.choice == "open":
            counts["open"] += 1
        elif change.choice == "close":
            counts["close"] += 1
        else:
            counts["removed"] += 1
        if change.ambiguous:
            counts["ambiguous"] += 1
    result = "".join(repaired)
    counts["remaining_entities"] = len(pattern.findall(result))
    counts["input_chars"] = len(text)
    counts["output_chars"] = len(result)
    return result, changes, counts
