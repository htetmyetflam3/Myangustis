#!/usr/bin/env python3
"""The MCP tool server for the RapidAPI translator: a library, no CLI.

Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout, so any MCP client that
can launch a command works: Kilo, Claude Desktop, Claude Code, Cursor, Zed.

Nothing here parses arguments. Every entry point lives in `tools/mcp.py`:

    uv run mcp.py --serve                 # this server, on stdio
    uv run mcp.py --selftest              # no-network round trip
    uv run mcp.py --read_chapter 194      # a tool without a client
    uv run mcp.py --list-tools            # what is on offer

`mt/` stays a library too, which is why this file imports it by path.

Tools:

    detect_language      language code/name for a string
    translate_text       one string, any supported pair
    translate_batch      many strings in one request (cache-aware)
    translate_chapters   translate the local Chinese novel, writing files

The key comes from `RAPIDAPI_KEY` in the server environment. Nothing is printed
to stdout except protocol messages; diagnostics go to stderr.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MT = ROOT / "mt"
if str(MT) not in sys.path:
    sys.path.insert(0, str(MT))

from rapidapi_translator import (  # noqa: E402
    CACHE_ENV,
    DEFAULT_CACHE,
    HOST,
    KEY_ENV,
    MAX_REQUEST_CHARS,
    MAX_REQUEST_ITEMS,
    CachedTranslator,
    TranslatorError,
    load_env_file,
)

SERVER_NAME = "rapidapi-translator"
SERVER_VERSION = "1.0.0"
SUPPORTED_PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07")
DEFAULT_PROTOCOL = "2024-11-05"

INSTRUCTIONS = (
    "Translation and read-only proofreading tools backed by the RapidAPI "
    "'Multi format AI translator' API. `compare_english_chapter` compares "
    "Chinese, local machine English, and API English by source paragraph; it "
    "does not call the API. `previous_burmese_context` requires the current "
    "Chinese chapter and a Burmese-only keyword, then searches its two mapped "
    "predecessor chapters. "
    f"The API key is read from {KEY_ENV}. `translate_chapters` translates ONE "
    "PAIR of chapters of the local Chinese novel, two chapters at most, and "
    "writes files under content/mtranslate/rapidapi; it costs about five "
    "requests per chapter. Omit `chapters` for the next pair after the human "
    "translation (194+195, then 196+197). Check the free plan first with "
    "`mt/apicaller.py` or `mt/api_translate.py --plan`."
)

TOOLS = [
    {
        "name": "detect_language",
        "description": "Detect the language of a text with the RapidAPI translator.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to analyse."},
            },
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "translate_text",
        "description": "Translate one string. One API request per call unless cached.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to translate."},
                "target": {"type": "string", "description": "Target language code.",
                           "default": "my"},
                "source": {"type": "string", "description": "Source code or 'auto'.",
                           "default": "auto"},
            },
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "translate_batch",
        "description": "Translate many strings in as few requests as possible. "
                       "Only strings missing from the local cache are sent.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "texts": {"type": "array", "items": {"type": "string"},
                          "description": "Strings, translated in input order."},
                "target": {"type": "string", "description": "Target language code.",
                           "default": "my"},
                "source": {"type": "string", "description": "Source code or 'auto'.",
                           "default": "auto"},
            },
            "required": ["texts"],
            "additionalProperties": False,
        },
    },
    {
        "name": "read_chapter",
        "description": "Legacy Burmese-review reader: returns bounded Chinese "
                       "paragraphs and attaches `my` only when API Burmese rows exist. "
                       "API-generated Burmese text is not retained in the current "
                       "workflow, so this may return no `my` field. Do not regenerate "
                       "that output as part of English review. Use `start` and `count` "
                       "for small windows; `window.next_start` marks the continuation.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chapter": {"type": "integer", "description": "Chinese chapter number."},
                "start": {"type": "integer", "default": 1,
                          "description": "First paragraph, 1-based."},
                "count": {"type": "integer",
                          "description": "How many paragraphs; default is the rest of "
                                         "the chapter. 10 keeps a turn small."},
                "translations": {"type": "string",
                                 "description": "Directory holding chNNNN.my.jsonl from "
                                                "api_translate.py; default "
                                                "content/mtranslate/rapidapi."},
                "reference_lines": {"type": "integer",
                                    "description": "How many existing Burmese lines to "
                                                   "include as a style reference.",
                                    "default": 0},
            },
            "required": ["chapter"],
            "additionalProperties": False,
        },
    },
    {
        "name": "compare_english_chapter",
        "description": "Return one bounded chapter window as aligned rows: original Chinese, "
                       "local machine English, and English translated by the API. Defaults "
                       "to ten paragraphs. Source and line counts are verified; the tool "
                       "refuses to silently shift mismatched translations. Reads the API "
                       "one-file content/mtranslate/english.txt. Local machine English "
                       "defaults to content/mtranslate/zh-en.txt. The human Burmese "
                       "context tool reports its known encoding caution.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chapter": {"type": "integer", "description": "Chinese chapter number."},
                "start": {"type": "integer", "default": 1, "description": "First paragraph, 1-based."},
                "count": {"type": "integer", "default": 10, "description": "Paragraphs in this window; ten is the default."},
                "api_file": {"type": "string", "description": "Optional API english.txt, per-chapter .txt, or source-verified .jsonl."},
                "api_dir": {"type": "string", "description": "Optional directory of per-chapter API output."},
                "machine_file": {"type": "string", "description": "Optional local zh-en one-file output; default content/mtranslate/zh-en.txt."},
                "machine_dir": {"type": "string", "description": "Optional legacy per-chapter directory override."},
            },
            "required": ["chapter"],
            "additionalProperties": False,
        },
    },
    {
        "name": "previous_burmese_context",
        "description": "Search a Burmese-only keyword in the Burmese human translation "
                       "for the two Chinese chapters before the current chapter. The "
                       "current Chinese chapter is required; the DOCX chapter map handles "
                       "splits such as Chinese 193 → Burmese 195. The human source has "
                       "known encoding damage: treat returned lines as contextual clues, "
                       "not reliable spelling or grammar. Return only a few full lines "
                       "around each match, not whole chapters.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chapter": {"type": "integer", "description": "Current Chinese chapter; search its two predecessors."},
                "keyword": {"type": "string", "description": "A Burmese-script word or phrase only."},
                "before": {"type": "integer", "default": 2, "description": "Context lines before each match."},
                "after": {"type": "integer", "default": 2, "description": "Context lines after each match."},
                "max_hits": {"type": "integer", "default": 10, "description": "Maximum matching lines returned."},
            },
            "required": ["chapter", "keyword"],
            "additionalProperties": False,
        },
    },
    {
        "name": "save_draft",
        "description": "Store the agent's adjusted Burmese for one paragraph. It is "
                       "kept as a draft with the AI translation it started from; it "
                       "never overwrites the translation and is never approved text.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chapter": {"type": "integer"},
                "paragraph": {"type": "string",
                              "description": "1-based index or a paragraph id from "
                                             "read_chapter."},
                "draft": {"type": "string", "description": "Adjusted Burmese text."},
                "ai_text": {"type": "string",
                            "description": "AI translation (RapidAPI output) this draft "
                                           "started from. Not the legacy MT column."},
                "mt": {"type": "string",
                       "description": "Deprecated alias of ai_text, kept for old callers."},
                "model": {"type": "string", "description": "Which model wrote it."},
                "note": {"type": "string", "description": "Optional note."},
            },
            "required": ["chapter", "paragraph", "draft"],
            "additionalProperties": False,
        },
    },
    {
        "name": "export_drafts",
        "description": "Write the drafted chapter as text plus a Chinese / AI / "
                       "draft comparison, and report which paragraphs are still missing.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chapter": {"type": "integer"},
                "out_dir": {"type": "string",
                            "description": "Default content/mtranslate/drafts."},
                "require_all": {"type": "boolean", "default": False},
            },
            "required": ["chapter"],
            "additionalProperties": False,
        },
    },
    {
        "name": "lookup_word",
        "description": "Read-only dictionary probe. Says whether a spelling is an entry, "
                       "its POS families, whether the POS tree can reach it, and returns "
                       "dictionary-proved repairs for storage-order damage "
                       "(e.g. အေခြအေန -> အခြေအနေ, ဘ၀ -> ဘဝ). A suggestion is only "
                       "returned when the written form is not an entry and the repaired "
                       "form is.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "word": {"type": "string", "description": "The spelling to check."},
            },
            "required": ["word"],
            "additionalProperties": False,
        },
    },
    {
        "name": "review_lookup",
        "description": "Read-only lookup into content/review/burmese-overview.md, the "
                       "background document: characters, arcs, and the dossier of known "
                       "translation errors in the human Burmese. Use it during editing "
                       "when you have forgotten a character's nature, a rank, or how a "
                       "term was ruled on. Returns one matching section, not the whole "
                       "document. Never imitate its conversational register — it is "
                       "notes about the novel, not the novel.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string",
                          "description": "Character name, Chinese term, or words to find."},
                "section": {"type": "string",
                            "description": "Exact section id, skips the search."},
                "chapter": {"type": "integer",
                            "description": "Return the arc that covers this chapter."},
                "limit": {"type": "integer", "default": 2},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "review_brief",
        "description": "The whole review in one round: the character table, the known "
                       "translation defects, the reviewer's verdict, and every story "
                       "arc's title with its opening. Call this ONCE at the start of a "
                       "session instead of reading the 7,279-line document. Its voice "
                       "is casual on purpose and is NOT the author's tone; its Burmese "
                       "quotes may carry PDF damage.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chars_per_arc": {"type": "integer", "default": 420,
                                  "description": "Story characters per arc; lower it "
                                                 "if the session is already long."},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "lookup_name",
        "description": "The name list (content/reference/EtoBnames.txt) is the "
                       "authority for how a name or term is written in Burmese. Look "
                       "one up by its key (Ye Nin) or by a Burmese form (ယဲ့နင်). Omit "
                       "`term` to list every entry. A term the list knows is written "
                       "exactly as the list writes it.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "term": {"type": "string", "description": "Key or Burmese form."},
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "check_names",
        "description": "Report which listed names occur in a Burmese text, and which "
                       "spellings look like a variant of a listed name. A report, not a "
                       "rewriter: rewrite to the canonical form yourself. A name the "
                       "list spells correctly wins even when the text's spelling is also "
                       "correct Burmese.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string",
                         "description": "One paragraph or sentence of Burmese."},
            },
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "register_name",
        "description": "Append a new recurring term to EtoBnames.txt: two sides, no "
                       "category — `key` is the English of the zh-en column, `burmese` "
                       "the AI translation's form, corrected if wrong. Not only people: "
                       "a weapon, martial art, bloodline ability, pill, rank or place "
                       "qualifies when it will recur. Only when no entry exists; never "
                       "a second spelling, never an edit — flag instead.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "key": {"type": "string",
                        "description": "The English term as the zh-en column writes it, "
                                       "e.g. 'Shen Ji' or 'Golden Eagle Saber'."},
                "burmese": {"type": "string",
                            "description": "The Burmese form, taken from the AI "
                                           "translation and corrected if needed."},
                "note": {"type": "string",
                         "description": "Optional note: where it first appears."},
            },
            "required": ["key", "burmese"],
            "additionalProperties": False,
        },
    },
    {
        "name": "save_verse",
        "description": "Record ONE line YOU judged to be verse — poem, song, maxim, "
                       "inscription, philosophy line — with an English version for the "
                       "human. No tool extracts verse: it is a reading judgement, made "
                       "while you re-match tone. `kind: none` means the chapter was "
                       "checked and has none, which is not the same as never looking.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chapter": {"type": "integer"},
                "paragraph": {"type": "string",
                              "description": "1-based index or a paragraph id from "
                                             "read_chapter. Omit only for kind `none`."},
                "kind": {"type": "string",
                         "enum": ["poem", "philosophy", "song", "inscription",
                                  "maxim", "other", "none"],
                         "description": "What the line is. `none` records that the "
                                        "chapter has no verse at all."},
                "english": {"type": "string",
                            "description": "The English version of this line."},
                "english_source": {"type": "string", "enum": ["mt", "own", "mixed"],
                                   "default": "own",
                                   "description": "`mt` = the zh-en column verbatim, "
                                                  "`own` = your own rendering, `mixed` "
                                                  "= quoted then rewritten."},
                "mt_english": {"type": "string",
                               "description": "The zh-en line you started from, if any."},
                "note": {"type": "string",
                         "description": "Why this line is verse, and what to watch in "
                                        "the Burmese."},
                "model": {"type": "string"},
            },
            "required": ["chapter", "kind"],
            "additionalProperties": False,
        },
    },
    {
        "name": "export_verse",
        "description": "Write the chapter's verse section (Chinese, English, why) to "
                       "content/mtranslate/verse/chNNNN.verse.md — the separate section "
                       "the human reviews at the end of the chapter.",
        "inputSchema": {
            "type": "object",
            "properties": {"chapter": {"type": "integer"}},
            "required": ["chapter"],
            "additionalProperties": False,
        },
    },
    {
        "name": "segment_text",
        "description": "Read-only segmentation probe. Runs the repository engine on the "
                       "text and returns every token with its smallest units and POS "
                       "candidates, plus which tokens are split clusters and why "
                       "(word / unit / loan / unknown), plus character coverage. "
                       "Use it before rewriting a sentence; {?} tags are NOT error "
                       "signals on their own.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "One or more sentences."},
            },
            "required": ["text"],
            "additionalProperties": False,
        },
    },
    {
        "name": "translate_chapters",
        "description": "Translate ONE PAIR of chapters of the local Chinese "
                       "novel (two at most; a third is refused) and write "
                       "JSONL, TXT, a comparison markdown and a report. Omit "
                       "`chapters` for the next pair after the human "
                       "translation that is not on disk yet, e.g. 194+195 then "
                       "196+197. Costs ~5 requests per chapter.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chapters": {"type": "string",
                             "description": "One or two chapters: '194&195', "
                                            "'194+195', '194,195' or '194'. "
                                            "Omit for the next pair."},
                "target": {"type": "string", "description": "Target language code.",
                           "default": "my"},
                "source": {"type": "string", "description": "Source code or 'auto'.",
                           "default": "auto"},
                "out_dir": {"type": "string",
                            "description": "Output directory; default "
                                           "content/mtranslate/rapidapi."},
            },
            "required": [],
            "additionalProperties": False,
        },
    },
]


# ─── Tool groups ─────────────────────────────────────────────────────────
#
# The tool list is not paid for once — it is re-sent with every request, and on
# a free Groq plan (8,000 tokens a minute) all eighteen schemas are
# most of the budget before the model has read a word. `--tools` narrows what
# this process advertises, so the fixed cost drops to whatever the phase needs.
# Nothing is removed from the code: a phase that needs a name lookup just
# declares it.
TOOL_GROUPS = {
    "read": ("read_chapter", "segment_text", "lookup_word", "detect_language"),
    "english": ("compare_english_chapter", "previous_burmese_context"),
    "review": ("review_brief", "review_lookup"),
    "names": ("lookup_name", "check_names", "register_name"),
    "verse": ("save_verse", "export_verse"),
    "draft": ("save_draft", "export_drafts"),
    "api": ("translate_text", "translate_batch", "translate_chapters"),
}
# Phase presets. `survey` is the first pass (no drafting, no spending), `edit`
# is paragraph-by-paragraph rewriting, `translate` is the one paid step.
TOOL_PRESETS = {
    # `survey` — the read-only first pass: see the chapter, check names, record
    # verse. 7.5k of schema characters, ~2.3k tokens.
    "survey": ("read", "review", "names", "verse"),
    # `edit` — rewriting paragraph by paragraph; no review digest, no API.
    "edit": ("read", "names", "verse", "draft"),
    # `lean` — the smallest loop that can still do the work: read ten
    # paragraphs, segment them, check a name, draft one save. ~2.5k characters,
    # under 1k tokens, which is what an 8,000-token minute can afford.
    "lean": ("read_chapter", "segment_text", "lookup_word",
             "check_names", "lookup_name", "save_draft", "save_verse"),
    "translate": ("api", "read"),
    "english-review": ("english", "review", "names"),
    "full": tuple(TOOL_GROUPS),
}


def resolve_tools(spec: str | None) -> set[str] | None:
    """`"survey"`, `"read,names"`, or `""` (None) for every tool."""
    if spec is None or not str(spec).strip():
        return None
    wanted: set[str] = set()
    for raw in str(spec).split(","):
        item = raw.strip().lower()
        if not item:
            continue
        if item in TOOL_GROUPS:
            wanted.update(TOOL_GROUPS[item])
        elif item in TOOL_PRESETS:
            # A preset may name groups or bare tool names, as `lean` does.
            for member in TOOL_PRESETS[item]:
                wanted.update(TOOL_GROUPS.get(member, (member,)))
        elif item in {tool["name"] for tool in TOOLS}:
            wanted.add(item)
        else:
            raise ValueError(
                f"unknown tool or group {item!r}; groups are "
                f"{', '.join(TOOL_GROUPS)}; presets are "
                f"{', '.join(TOOL_PRESETS)}")
    return wanted or None


class Server:
    def __init__(self, *, cache_path: Path | str | None = None, enabled_cache: bool = True,
                 max_chars: int = MAX_REQUEST_CHARS,
                 max_items: int = MAX_REQUEST_ITEMS,
                 timeout: float = 60.0, max_attempts: int = 3,
                 source_file: Path | str | None = None,
                 existing: Path | str | None = None,
                 out_dir: Path | str | None = None,
                 draft_store: Path | str | None = None,
                 docx: Path | str | None = None,
                 tools: set[str] | None = None) -> None:
        self.tools = tools
        self.cache_path = cache_path
        self.enabled_cache = enabled_cache
        self.max_chars = max_chars
        self.max_items = max_items
        self.timeout = timeout
        self.max_attempts = max_attempts
        self.source_file = source_file
        self.existing = existing
        self.draft_store = draft_store
        self.docx = docx
        self.out_dir = out_dir
        self._translator: CachedTranslator | None = None
        self._drafts = None

    @property
    def translator(self) -> CachedTranslator:
        if self._translator is None:
            self._translator = CachedTranslator(
                cache_path=self.cache_path, enabled=self.enabled_cache,
                timeout=self.timeout, max_attempts=self.max_attempts,
                max_chars=self.max_chars, max_items=self.max_items)
        return self._translator

    @property
    def drafts(self):
        """Opened lazily so read-only tools never create a database."""
        if self._drafts is None:
            from agent_work import DraftStore  # noqa: PLC0415
            store = self.draft_store or None
            self._drafts = DraftStore(store) if store else DraftStore()
        return self._drafts

    # -- tools -------------------------------------------------------

    @staticmethod
    def _text_arg(arguments: dict, name: str) -> str:
        value = arguments.get(name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"`{name}` must be a non-empty string")
        return value

    @staticmethod
    def _language(value: str, name: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError(f"`{name}` must be a language code")
        return value

    def call_tool(self, name: str, arguments: dict) -> dict:
        if self.tools is not None and name not in self.tools:
            raise ValueError(
                f"tool {name!r} is not enabled in this server "
                f"(--tools); restart with it if you need it")
        if name == "read_chapter":
            chapter = self._chapter_arg(arguments)
            return self._read_chapter(chapter, arguments)
        if name == "compare_english_chapter":
            from agent_english import compare_english_chapter  # noqa: PLC0415
            chapter = self._chapter_arg(arguments)
            paths = {}
            for key in ("api_file", "api_dir", "machine_file", "machine_dir"):
                if arguments.get(key):
                    paths[key] = Path(arguments[key]).expanduser()
            return compare_english_chapter(
                chapter,
                start=int(arguments.get("start", 1)),
                count=int(arguments.get("count", 10)),
                source_file=Path(self.source_file) if self.source_file else None,
                **paths,
            )
        if name == "previous_burmese_context":
            from agent_english import previous_burmese_context  # noqa: PLC0415
            chapter = self._chapter_arg(arguments)
            return previous_burmese_context(
                chapter,
                arguments.get("keyword", ""),
                before=int(arguments.get("before", 2)),
                after=int(arguments.get("after", 2)),
                max_hits=int(arguments.get("max_hits", 10)),
                docx=Path(self.docx) if self.docx else None,
                burmese_file=Path(self.existing) if self.existing else None,
            )
        if name == "save_draft":
            return self._save_draft(arguments)
        if name == "export_drafts":
            chapter = self._chapter_arg(arguments)
            out_dir = arguments.get("out_dir")
            from api_translate import CHINESE  # noqa: PLC0415
            return self.drafts.export(
                chapter, Path(out_dir) if out_dir else Path(
                    self.out_dir or "content/mtranslate/drafts"),
                require_all=bool(arguments.get("require_all", False)),
                source=Path(self.source_file or CHINESE))
        if name == "detect_language":
            text = self._text_arg(arguments, "text")
            return self.translator.detect(text)
        if name == "translate_text":
            text = self._text_arg(arguments, "text")
            target = self._language(arguments.get("target", "my"), "target")
            source = self._language(arguments.get("source", "auto"), "source")
            translated = self.translator.translate(text, target, source)
            return {"translated_text": translated, "target": target, "source": source}
        if name == "translate_batch":
            texts = arguments.get("texts")
            if not isinstance(texts, list) or not texts or not all(
                    isinstance(item, str) and item.strip() for item in texts):
                raise ValueError("`texts` must be a non-empty array of non-empty strings")
            target = self._language(arguments.get("target", "my"), "target")
            source = self._language(arguments.get("source", "auto"), "source")
            result = self.translator.translate_batch(texts, target, source)
            return {
                "translations": result.texts,
                "source_language": result.source_language,
                "source_language_name": result.source_language_name,
                "requests": result.requests,
                "cached": result.cached,
            }
        if name == "lookup_word":
            word = self._text_arg(arguments, "word")
            from lexicon import lookup, suggest  # noqa: PLC0415
            result = lookup(word)
            result["repairs"] = suggest(word)
            return result
        if name == "segment_text":
            text = self._text_arg(arguments, "text")
            from lexicon import segment  # noqa: PLC0415
            return segment(text)
        if name == "review_lookup":
            return self._review_lookup(arguments)
        if name == "review_brief":
            return self._review_brief(arguments)
        if name == "lookup_name":
            return self._lookup_name(arguments)
        if name == "check_names":
            return self._check_names(arguments)
        if name == "register_name":
            return self._register_name(arguments)
        if name == "save_verse":
            return self._save_verse(arguments)
        if name == "export_verse":
            return self._export_verse(arguments)
        if name == "translate_chapters":
            return self._translate_chapters(arguments)
        raise KeyError(name)

    @staticmethod
    def _chapter_arg(arguments: dict) -> int:
        value = arguments.get("chapter")
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise ValueError("`chapter` must be a chapter number")
        try:
            return int(value)
        except (TypeError, ValueError):
            raise ValueError("`chapter` must be a chapter number") from None

    def _review_lookup(self, arguments: dict) -> dict:
        """One section of the background document, never the whole file."""
        import overview_index  # noqa: PLC0415
        index_path = ROOT / "content" / "review" / "overview.yaml"
        source = ROOT / "content" / "review" / "burmese-overview.md"
        if not index_path.is_file():
            raise ValueError("content/review/overview.yaml is missing — run "
                             "`python3 mt/overview_index.py --build`")
        index = overview_index.load(index_path)
        lines = source.read_text(encoding="utf-8").splitlines()
        limit = int(arguments.get("limit", 2))

        def render(section: dict) -> dict:
            start = section["lines"][0]
            end = overview_index.own_end(section, index["sections"])
            body = lines[start - 1:end]
            return {
                "id": section["id"],
                "kind": section["kind"],
                "title": section["title"],
                "lines": [start, end],
                "text": "\n".join(body[:overview_index.MAX_LINES]).strip(),
                "truncated": len(body) > overview_index.MAX_LINES,
            }

        if arguments.get("section"):
            wanted = str(arguments["section"]).strip()
            match = next((s for s in index["sections"] if s["id"] == wanted), None)
            if match is None:
                raise ValueError(f"no section {wanted!r}; use `query` to search")
            return {"matches": [render(match)], "count": 1}

        if arguments.get("chapter") is not None:
            chapter = int(arguments["chapter"])
            arcs = [s for s in index["sections"] if s["kind"] == "arc"
                    and len(s["chapters"]) == 2
                    and s["chapters"][0] <= chapter <= s["chapters"][1]]
            if not arcs:
                raise ValueError(f"chapter {chapter} is outside the indexed arcs")
            arc = arcs[0]
            children = [s for s in index["sections"] if s.get("parent") == arc["id"]]
            return {"chapter": chapter, "arc": render(arc),
                    "parts": [{k: s[k] for k in ("id", "kind", "title", "lines")}
                              for s in children],
                    "count": 1 + len(children)}

        query = str(arguments.get("query", "")).strip()
        if not query:
            raise ValueError("pass `query`, `section`, or `chapter`")
        words = query.lower().split()
        hits = []
        for section in index["sections"]:
            start = section["lines"][0]
            end = overview_index.own_end(section, index["sections"])
            body = "\n".join(lines[start - 1:end]).lower()
            if all(word in section["title"].lower() or word in body for word in words):
                hits.append(section)
        rank = {"character": 0, "issue": 1, "arc-title": 2}
        hits.sort(key=lambda s: (0 if s["title"].lower() == query.lower() else 1,
                                 rank.get(s["kind"], 3), s["lines"][0]))
        rows = [row for row in index.get("characters", [])
                if all(word in (row["name"] + row["role"] + row["relation"]).lower()
                       for word in words)]
        return {"matches": [render(s) for s in hits[:limit]],
                "characters": rows, "count": len(hits)}

    @staticmethod
    def _names_path(path: Path) -> str:
        try:
            return str(path.relative_to(ROOT))
        except ValueError:
            return str(path)

    def _review_brief(self, arguments: dict) -> dict:
        """The whole document in one bounded digest, for the start of a session."""
        import overview_index  # noqa: PLC0415
        index_path = ROOT / "content" / "review" / "overview.yaml"
        source = ROOT / "content" / "review" / "burmese-overview.md"
        if not index_path.is_file():
            raise ValueError("content/review/overview.yaml is missing — run "
                             "`python3 mt/overview_index.py --build`")
        try:
            per_arc = int(arguments.get("chars_per_arc", 420))
        except (TypeError, ValueError):
            raise ValueError("`chars_per_arc` must be a number") from None
        index = overview_index.load(index_path)
        text = overview_index.brief(source, index, chars_per_arc=per_arc)
        return {
            "markdown": text,
            "characters": len(index["characters"]),
            "sections": len(index["sections"]),
            "note": "facts and defects only; the review's voice is not the "
                    "author's tone, and its Burmese quotes may carry PDF damage",
            "next": "read_chapter for the chapter, then judge one paragraph at a time",
        }

    def _lookup_name(self, arguments: dict) -> dict:
        import names  # noqa: PLC0415
        result = names.load()
        term = arguments.get("term")
        if term is None or not str(term).strip():
            return {
                "file": self._names_path(names.NAMES_FILE),
                "count": len(result.entries),
                "entries": [entry.as_dict() for entry in result.entries],
                "note": "the list is the authority for spelling; reuse it, do not "
                        "coin a new form for a term it already lists",
            }
        found = names.lookup(result.entries, str(term))
        if not found:
            return {
                "file": self._names_path(names.NAMES_FILE),
                "count": 0,
                "entries": [],
                "suggestion": "no entry; check a variant spelling, or register it with "
                              "register_name if the entity is genuinely new",
            }
        return {"file": self._names_path(names.NAMES_FILE),
                "count": len(found),
                "entries": [entry.as_dict() for entry in found]}

    def _check_names(self, arguments: dict) -> dict:
        import names  # noqa: PLC0415
        text = arguments.get("text")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("`text` must be a non-empty string")
        result = names.load()
        found = names.hits(text, result.entries)
        suspects = names.variants(text, result.entries)
        return {
            "file": self._names_path(names.NAMES_FILE),
            "hits": found,
            "variants": suspects,
            "verdict": ("clean" if not suspects else
                        "rewrite each variant to its canonical form; the list wins "
                        "even when the text's spelling is also correct Burmese"),
        }

    def _register_name(self, arguments: dict) -> dict:
        import names  # noqa: PLC0415
        key = arguments.get("key")
        burmese = arguments.get("burmese")
        if not isinstance(key, str) or not key.strip():
            raise ValueError("`key` must be a non-empty string")
        if not isinstance(burmese, str) or not burmese.strip():
            raise ValueError("`burmese` must be a non-empty string")
        note = arguments.get("note") or ""
        try:
            entry = names.add(names.NAMES_FILE, key, burmese, str(note))
        except ValueError as error:
            return {"added": None, "refused": str(error),
                    "note": "do not work around this: reuse the existing entry, "
                            "and flag the conflict in your report"}
        return {"added": entry.as_dict(),
                "file": self._names_path(names.NAMES_FILE),
                "note": "registered; every later occurrence must use this spelling"}

    def _save_verse(self, arguments: dict) -> dict:
        import verse  # noqa: PLC0415
        chapter = self._chapter_arg(arguments)
        kind = arguments.get("kind")
        if not isinstance(kind, str) or not kind.strip():
            raise ValueError("`kind` must be one of: " + ", ".join(verse.KINDS))
        english = arguments.get("english") or ""
        if not isinstance(english, str):
            raise ValueError("`english` must be a string")
        try:
            record = verse.save(
                chapter, kind=kind,
                paragraph=arguments.get("paragraph"),
                english=english,
                english_source=str(arguments.get("english_source", "own")),
                mt_english=arguments.get("mt_english"),
                note=str(arguments.get("note") or ""),
                model=arguments.get("model"))
        except verse.VerseError as error:
            raise ValueError(str(error)) from None
        return {"saved": record,
                "note": "the human reviews this section; it is not part of the draft",
                "next": "export_verse at the end of the chapter"}

    def _export_verse(self, arguments: dict) -> dict:
        import verse  # noqa: PLC0415
        chapter = self._chapter_arg(arguments)
        report = verse.export(chapter)
        if report["empty"]:
            report["warning"] = ("nothing recorded for this chapter — save_verse each "
                                 "line, or save_verse with kind `none` after checking")
        return report

    def _read_chapter(self, chapter: int, arguments: dict) -> dict:
        from agent_work import DEFAULT_OUT, read_chapter  # noqa: PLC0415
        from api_translate import BURMESE, CHINESE, DOCX  # noqa: PLC0415
        try:
            limit = int(arguments.get("reference_lines", 0))
        except (TypeError, ValueError):
            raise ValueError("`reference_lines` must be a number") from None
        try:
            start = int(arguments["start"]) if arguments.get("start") else None
            count = int(arguments["count"]) if arguments.get("count") else None
        except (TypeError, ValueError):
            raise ValueError("`start` and `count` must be numbers") from None
        translations = arguments.get("translations")
        from agent_work import DraftError  # noqa: PLC0415
        try:
            return read_chapter(
                chapter,
                source=Path(self.source_file or CHINESE),
                existing=Path(self.existing or BURMESE),
                docx=Path(self.docx or DOCX),
                store=self.drafts,
                reference_lines_limit=max(0, limit),
                translations=Path(translations) if translations else None,
                start=start, count=count,
            )
        except DraftError as error:
            raise ValueError(str(error)) from None

    def _save_draft(self, arguments: dict) -> dict:
        from agent_work import DraftError, chapter_paragraphs_by_number, _select  # noqa: PLC0415
        from api_translate import CHINESE  # noqa: PLC0415
        chapter = self._chapter_arg(arguments)
        try:
            paragraph = _select(
                chapter_paragraphs_by_number(chapter,
                                             source=Path(self.source_file or CHINESE)),
                str(arguments.get("paragraph", "")))
        except DraftError as error:
            raise ValueError(str(error)) from None
        draft = arguments.get("draft")
        if not isinstance(draft, str) or not draft.strip():
            raise ValueError("`draft` must be a non-empty string")
        ai_text = arguments.get("ai_text") or arguments.get("mt")
        return self.drafts.save(paragraph, draft, ai_text=ai_text,
                                model=arguments.get("model"),
                                note=arguments.get("note"))

    def _translate_chapters(self, arguments: dict) -> dict:
        from apicaller import (  # noqa: PLC0415
            PairError, next_numbers, resolve, translate_pair,
        )
        from api_translate import BURMESE, CHINESE, DOCX, OUTPUT, chinese_chapters
        from chapter_map import ChapterMapError, load_or_derive

        spec = arguments.get("chapters")
        if spec is not None and not isinstance(spec, str):
            raise ValueError("`chapters` must be a string such as '194&195'")
        target = self._language(arguments.get("target", "my"), "target")
        source = self._language(arguments.get("source", "auto"), "source")
        out_dir = Path(arguments.get("out_dir") or self.out_dir or OUTPUT)
        chapters = chinese_chapters(Path(self.source_file or CHINESE))
        chapter_map = None
        try:
            chapter_map = load_or_derive(None, Path(self.docx or DOCX))
        except (ChapterMapError, OSError, KeyError):
            chapter_map = None
        try:
            numbers, selected, note = resolve(
                spec, chapters, chapter_map, out_dir=out_dir, target=target)
        except PairError as error:
            raise ValueError(str(error)) from error
        report = translate_pair(
            selected, chapter_map=chapter_map, target=target, source=source,
            out_dir=out_dir, cache_path=self.cache_path,
            enabled_cache=self.enabled_cache, max_chars=self.max_chars,
            max_items=self.max_items, timeout=self.timeout,
            attempts=self.max_attempts,
            existing=Path(self.existing or BURMESE))
        return {
            "target": report["target"],
            "detected": report["detected"],
            "requested": numbers,
            "selection": note,
            "totals": report["totals"],
            "chapters": report["chapters"],
            "files": report["files"],
            "elapsed_seconds": report["elapsed_seconds"],
            "next": next_numbers(chapter_map, chapters, out_dir=out_dir,
                                 target=target),
        }

    # -- protocol ----------------------------------------------------

    def handle(self, request: dict) -> dict | None:
        request_id = request.get("id")
        method = request.get("method")
        if not isinstance(method, str):
            return self._error(request_id, -32600, "invalid request: missing method")
        if request_id is None and method.startswith("notifications/"):
            return None
        if method == "initialize":
            offered = (request.get("params") or {}).get("protocolVersion")
            version = offered if offered in SUPPORTED_PROTOCOLS else DEFAULT_PROTOCOL
            return self._result(request_id, {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "instructions": INSTRUCTIONS,
            })
        if method == "ping":
            return self._result(request_id, {})
        if method == "tools/list":
            listed = ([tool for tool in TOOLS if tool["name"] in self.tools]
                      if self.tools else TOOLS)
            return self._result(request_id, {"tools": listed})
        if method == "tools/call":
            params = request.get("params") or {}
            name = params.get("name")
            arguments = params.get("arguments") or {}
            if not isinstance(name, str):
                return self._error(request_id, -32602, "missing tool name")
            if not isinstance(arguments, dict):
                return self._error(request_id, -32602, "arguments must be an object")
            try:
                payload = self.call_tool(name, arguments)
            except KeyError:
                return self._error(request_id, -32602, f"unknown tool: {name}")
            except (ValueError, TranslatorError) as error:
                return self._result(request_id, {
                    "content": [{"type": "text", "text": str(error)}],
                    "isError": True,
                })
            except Exception as error:  # pragma: no cover - defensive
                return self._result(request_id, {
                    "content": [{"type": "text",
                                 "text": f"{type(error).__name__}: {error}"}],
                    "isError": True,
                })
            return self._result(request_id, {
                "content": [{"type": "text",
                             "text": json.dumps(payload, ensure_ascii=False, indent=2)}],
                "isError": False,
            })
        if request_id is None:
            return None
        return self._error(request_id, -32601, f"method not found: {method}")

    @staticmethod
    def _result(request_id, result) -> dict:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _error(request_id, code: int, message: str) -> dict:
        return {"jsonrpc": "2.0", "id": request_id,
                "error": {"code": code, "message": message}}

    def serve(self, stdin=None, stdout=None) -> int:
        stdin = stdin or sys.stdin
        stdout = stdout or sys.stdout
        for line in stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
            except json.JSONDecodeError as error:
                response = self._error(None, -32700, f"parse error: {error.msg}")
            else:
                if isinstance(request, dict):
                    try:
                        response = self.handle(request)
                    except Exception as error:  # pragma: no cover - defensive
                        response = self._error(request.get("id"), -32603,
                                               f"internal error: {error}")
                else:
                    response = self._error(None, -32600, "invalid request")
            if response is not None:
                stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
                stdout.flush()
        return 0


# The one entry point a client launches. This file holds the tools; tools/mcp.py
# holds every flag, so a client and a human go through the same door.
ENTRY = ROOT / "mcp.py"

CLIENTS = ("json", "claude", "kilo", "codex", "gemini")


CONFIG_PATHS = {
    "kilo": ("~/.config/kilo/kilo.json", "mcp"),
    "gemini": ("~/.gemini/settings.json", "mcpServers"),
}


def _extra_args(env_file: Path | str | None) -> list[str]:
    return ["--env-file", str(Path(env_file).expanduser())] if env_file else []


def config_payload(client: str = "json", env_file: Path | str | None = None) -> dict:
    """The server entry in the shape that client expects.

    With `env_file`, the server reads the key from that file at startup and the
    entry carries no `environment` placeholder, so nothing has to be exported
    into the client's shell.
    """
    if client not in CLIENTS:
        raise ValueError(f"client must be one of {', '.join(CLIENTS)}")
    command = sys.executable
    server = str(ENTRY)
    extra = ["--serve", *_extra_args(env_file)]
    environment = {} if env_file else {KEY_ENV: "{env:" + KEY_ENV + "}"}
    if client == "kilo":
        return {"mcp": {SERVER_NAME: {
            "type": "local",
            "command": [command, server, *extra],
            "enabled": True,
            **({"environment": environment} if environment else {}),
        }}}
    if client == "gemini":
        env = {} if env_file else {KEY_ENV: "${" + KEY_ENV + "}"}
        payload = {"command": command, "args": [server, *extra]}
        return {"mcpServers": {SERVER_NAME: dict(payload, **({"env": env} if env else {}))}}
    return {"mcpServers": {SERVER_NAME: {
        "command": command,
        "args": [server, *extra],
        "env": {KEY_ENV: "<your-rapidapi-key>"},
    }}}


def config_snippet(client: str = "json", env_file: Path | str | None = None) -> str:
    """Client config that keeps the key out of the file where the client can.

    `codex` forwards the variable with `env_vars`, `kilo` and `gemini` expand
    `{env:VAR}` / `${VAR}` at launch, and the `claude` snippet relies on the
    script inheriting the exported variable. Only the generic JSON (Claude
    Desktop and other GUI clients that do not expand variables) shows a
    placeholder value.
    """
    if client not in CLIENTS:
        raise ValueError(f"client must be one of {', '.join(CLIENTS)}")
    extra = ["--serve", *_extra_args(env_file)]
    if client == "claude":
        return ("# export RAPIDAPI_KEY=... in this shell first, then:\n"
                f"claude mcp add --scope user {SERVER_NAME} -- "
                f"{sys.executable} {ENTRY} --serve"
                + (f" {' '.join(extra[1:])}" if len(extra) > 1 else ""))
    if client == "codex":
        args = ", ".join(f'"{item}"' for item in [str(ENTRY), *extra])
        return ("# ~/.codex/config.toml\n"
                f"[mcp_servers.{SERVER_NAME}]\n"
                f'command = "{sys.executable}"\n'
                f"args = [{args}]\n"
                + ("" if env_file else f'env_vars = ["{KEY_ENV}"]'))
    return json.dumps(config_payload(client, env_file), indent=2)


def install_config(client: str = "kilo", path: Path | str | None = None,
                   env_file: Path | str | None = None) -> dict:
    """Write or merge the entry into a client's JSON config.

    Refuses to touch a file that is not plain JSON (kilo accepts JSONC, and
    rewriting it would drop comments), and never overwrites an existing entry
    with the same name. The key is a placeholder that the client expands, so no
    secret is written here.
    """
    if client not in CONFIG_PATHS:
        return {"status": "manual", "path": None,
                "reason": f"{client} is configured by hand",
                "snippet": config_snippet(client, env_file)}
    default_path, root_key = CONFIG_PATHS[client]
    target = Path(path).expanduser() if path else Path(default_path).expanduser()
    payload = config_payload(client, env_file)[root_key][SERVER_NAME]

    if target.exists():
        text = target.read_text(encoding="utf-8")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as error:
            return {"status": "manual", "path": str(target),
                    "reason": f"not plain JSON ({error.msg} at line {error.lineno}); "
                              "merge the snippet yourself so comments are not lost",
                    "snippet": config_snippet(client, env_file)}
        if not isinstance(data, dict):
            return {"status": "manual", "path": str(target),
                    "reason": "config root is not an object",
                    "snippet": config_snippet(client, env_file)}
        servers = data.get(root_key)
        if servers is not None and not isinstance(servers, dict):
            return {"status": "manual", "path": str(target),
                    "reason": f'top-level "{root_key}" is not an object',
                    "snippet": config_snippet(client, env_file)}
        servers = servers or {}
        if SERVER_NAME in servers:
            return {"status": "already", "path": str(target),
                    "entry": servers[SERVER_NAME]}
        servers[SERVER_NAME] = payload
        data[root_key] = servers
        target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                          encoding="utf-8")
        try:
            target.chmod(0o600)
        except OSError:
            pass
        return {"status": "merged", "path": str(target), "entry": payload}

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({root_key: {SERVER_NAME: payload}}, indent=2,
                                 ensure_ascii=False) + "\n", encoding="utf-8")
    try:
        target.chmod(0o600)
    except OSError:
        pass
    return {"status": "created", "path": str(target), "entry": payload}


def selftest() -> dict:
    """Protocol round-trip with no network and no key; proves the server runs."""
    server = Server(enabled_cache=False)
    responses = []
    for request in (
        {"jsonrpc": "2.0", "id": 1, "method": "initialize",
         "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                    "clientInfo": {"name": "selftest", "version": "0"}}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "id": 3, "method": "ping"},
    ):
        responses.append(server.handle(request))
    tools = responses[1]["result"]["tools"] if responses[1] else []
    return {
        "ok": responses[0] is not None and responses[1] is not None
              and responses[2] is not None,
        "protocol": (responses[0] or {}).get("result", {}).get("protocolVersion"),
        "tools": [tool["name"] for tool in tools],
        "key": "set" if os.environ.get(KEY_ENV) else "missing",
        "python": sys.executable,
        "server": str(ENTRY),
    }
