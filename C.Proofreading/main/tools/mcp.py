#!/usr/bin/env python3
"""Single entry point for every proofreading tool: one command per run.

Same shape as the scraper's `main.py` — pick one command, no command prints this
help, and every flag works the same whether an agent called it over MCP or you
typed it on a phone.

The tools themselves live in `tools/mcp_server.py` (the MCP server) and
`mt/` (the libraries underneath). This file is only the door: one flag per tool,
so the CLI and the MCP server cannot drift apart — both call
`Server.call_tool(name, arguments)`.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MT = ROOT / "mt"
for _path in (HERE, MT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

# A flag given with no value (`--read` alone) still means "use the default".
USE_DEFAULT: object = object()

EXAMPLES = """\
examples:
  uv run mcp.py                                   # this help
  uv run mcp.py --serve                      # the MCP server (what a client runs)
  uv run mcp.py --selftest                   # protocol round-trip, no network, no key
  uv run mcp.py --check                      # key present? config path? nothing runs
  uv run mcp.py --print-config --client kilo  # the snippet to paste
  uv run mcp.py --install-config --client kilo --env-file ~/.env

  uv run mcp.py --inspect                    # what the Chinese crawl really has
  uv run mcp.py --inspect --check 194-408    # exit 1 if that range has holes
  uv run mcp.py --get-title 194              # chapter title, both languages
  uv run mcp.py --get-title --from 190 --to 193

  uv run mcp.py --review-brief --chars-per-arc 60
  uv run mcp.py --review-lookup --chapter 194
  uv run mcp.py --read 194 --start 1 --count 10
  uv run mcp.py --compare_english_chapter 194 --start 1 --count 10
  uv run mcp.py --previous_burmese_context "နတ်" --chapter 194
  uv run mcp.py --segment --file paragraph.txt
  uv run mcp.py --check-names --text "လျိုကျင်းက"
  uv run mcp.py --lookup-word ၀န်ကြီး
  uv run mcp.py --lookup-name --term ယဲ့နင်

  uv run mcp.py --detect "大周，帝都盛京。"
  uv run mcp.py --translate "大周，帝都盛京。" --target my
  uv run mcp.py --translate-batch --file paragraphs.txt --target en
  uv run mcp.py --translate-chapters 194+195 --target my

Text arguments accept `--file PATH` and `@PATH`, so a paragraph never has to be
pasted onto a phone command line.

exit codes: 0 ok, 1 the tool refused or failed, 2 usage error, 4 a file the
command needs is missing.

what goes where:
  mcp.py               this door: every flag
  tools/mcp.py         the implementation behind mcp.py
  tools/mcp_server.py  the MCP tools (18), the JSON-RPC server, client config
  tools/agent_english.py the read-only English comparison/context implementation
  tools/audit_source.py / tools/chapter_titles.py
                       the two scripts behind --inspect and --get-title
  mt/                  the libraries: api_translate, agent_work, names, verse …
"""


class UsageError(Exception):
    """The flags do not describe one runnable command."""


# ---------------------------------------------------------------- helpers


def _read_text(value: object, path: Path | None = None) -> str:
    """The text for a flag: the literal value, `@file`, or `--file PATH`."""
    if value is not None and value is not USE_DEFAULT:
        text = str(value)
        if text.startswith("@"):
            return Path(text[1:]).expanduser().read_text(encoding="utf-8")
        if text.strip():
            return text
    if path is not None:
        return Path(path).expanduser().read_text(encoding="utf-8")
    return ""


def _number(value: object, flag: str) -> int:
    try:
        return int(str(value))
    except (TypeError, ValueError):
        raise UsageError(f"{flag} needs a chapter number, not {value!r}") from None


def _chapter(value: object, args, flag: str) -> int:
    chosen = value if value is not None and value is not USE_DEFAULT else args.chapter
    if chosen is None:
        raise UsageError(f"{flag} needs a chapter number, e.g. {flag} 194")
    return _number(chosen, flag)


# ---------------------------------------------------------------- parser

# flag -> (tool name, one-line purpose). The dispatch table and the help are the
# same object, so a tool cannot be advertised without being callable.
TOOL_FLAGS = {
    "read": ("read_chapter", "ten paragraphs of a chapter, with the Chinese"),
    "segment": ("segment_text", "split Burmese text into words, with coverage"),
    "review-brief": ("review_brief", "the 111-section review in one digest"),
    "review-lookup": ("review_lookup", "one section of the review, never the file"),
    "lookup-word": ("lookup_word", "dictionary entry for one word"),
    "lookup-name": ("lookup_name", "one name from EtoBnames.txt"),
    "check-names": ("check_names", "names in a text, plus suspected variants"),
    "save-draft": ("save_draft", "store one rewritten paragraph"),
    "export-drafts": ("export_drafts", "write a chapter's drafts out"),
    "register-name": ("register_name", "append a new term to EtoBnames.txt"),
    "save-verse": ("save_verse", "record a poem, song or maxim"),
    "export-verse": ("export_verse", "write the verse section for review"),
    "detect": ("detect_language", "language of a string (one API request)"),
    "translate": ("translate_text", "one string, any pair (one API request)"),
    "translate-batch": ("translate_batch", "many strings in one request"),
    "translate-chapters": ("translate_chapters", "the Chinese novel, two chapters"),
    "compare-english": ("compare_english_chapter", "Chinese + local MT English + API English, aligned by paragraph"),
    "previous-burmese": ("previous_burmese_context", "Burmese-only keyword context from the two previous chapters"),
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mcp.py",
        description=(
            "Single entry point for the proofreading tools.\n"
            "Pick one command; with no command this help is shown and nothing runs."
        ),
        epilog=EXAMPLES,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    server = parser.add_argument_group("the server")
    server_command = server.add_mutually_exclusive_group()
    server_command.add_argument(
        "--serve", action="store_true",
        help="speak MCP on stdin/stdout. This is what a client launches; "
             "nothing is printed except protocol messages.")
    server_command.add_argument(
        "--selftest", action="store_true",
        help="initialize + tools/list + ping in-process. No key, no network.")
    server_command.add_argument(
        "--check", action="store_true",
        help="print whether the key is set and where the config lives. No request.")
    server_command.add_argument(
        "--print-config", action="store_true",
        help="print the client configuration snippet and exit.")
    server_command.add_argument(
        "--install-config", action="store_true",
        help="write or merge the entry into the client's JSON config "
             "(--client kilo or gemini).")
    server_command.add_argument(
        "--list-tools", "--list-groups", dest="list_tools", action="store_true",
        help="every tool this server can advertise, with its schema size, "
             "the groups and the presets.")

    reading = parser.add_argument_group("reading (no API key, no request)")
    read_command = reading.add_mutually_exclusive_group()
    read_command.add_argument(
        "--inspect", "--insecpt", action="store_true",
        help="audit the crawled Chinese source: which chapters exist, which "
             "headings are glued into body text, which numbers parsed twice. "
             "With --check-range LOW-HIGH, exit 1 when a chapter number is not recognized as a start.")
    read_command.add_argument(
        "--get-title", "--getTitle", dest="get_title", nargs="?",
        const=USE_DEFAULT, default=None, metavar="CHAPTER",
        help="chapter number, Burmese counterpart and title, read from the "
             "merged DOCX. Past Chinese 193 there is no title and none is invented.")
    read_command.add_argument(
        "--review-brief", "--review_brief", dest="review_brief", action="store_true",
        help=TOOL_FLAGS["review-brief"][1] + " (8-13k tokens; pass "
             "--chars-per-arc 60 to keep it near 4-6k).")
    read_command.add_argument(
        "--review-lookup", "--review_lookup", dest="review_lookup", nargs="?", const=USE_DEFAULT,
        default=None, metavar="QUERY",
        help=TOOL_FLAGS["review-lookup"][1] + " (needs --chapter).")
    read_command.add_argument(
        "--lookup-word", "--lookup_word", dest="lookup_word", nargs="?", const=USE_DEFAULT,
        default=None, metavar="WORD", help=TOOL_FLAGS["lookup-word"][1] + ".")
    read_command.add_argument(
        "--lookup-name", "--lookup_name", dest="lookup_name", nargs="?", const=USE_DEFAULT,
        default=None, metavar="TERM", help=TOOL_FLAGS["lookup-name"][1] + ".")
    read_command.add_argument(
        "--check-names", "--check_names", dest="check_names", nargs="?", const=USE_DEFAULT,
        default=None, metavar="TEXT", help=TOOL_FLAGS["check-names"][1] + ".")
    read_command.add_argument(
        "--read", "--read_chapter", nargs="?", const=USE_DEFAULT, default=None, metavar="CHAPTER",
        help=TOOL_FLAGS["read"][1] + "; window with --start/--count.")
    read_command.add_argument(
        "--compare-english", "--compare_english_chapter", dest="compare_english",
        nargs="?", const=USE_DEFAULT, default=None, metavar="CHAPTER",
        help=TOOL_FLAGS["compare-english"][1] + "; defaults to ten paragraphs.")
    read_command.add_argument(
        "--previous-burmese-context", "--previous_burmese_context",
        dest="previous_burmese_context", nargs="?", const=USE_DEFAULT,
        default=None, metavar="BURMESE_KEYWORD",
        help=TOOL_FLAGS["previous-burmese"][1] + "; requires --chapter N.")
    read_command.add_argument(
        "--segment", "--segment_text", nargs="?", const=USE_DEFAULT, default=None, metavar="TEXT",
        help=TOOL_FLAGS["segment"][1] + "; or --file PATH.")

    writing = parser.add_argument_group("writing (local, no request)")
    write_command = writing.add_mutually_exclusive_group()
    write_command.add_argument(
        "--save-draft", "--save_draft", dest="save_draft", action="store_true",
        help=TOOL_FLAGS["save-draft"][1] + " (--chapter, --paragraph, --draft).")
    write_command.add_argument(
        "--export-drafts", "--export_drafts", dest="export_drafts", nargs="?", const=USE_DEFAULT,
        default=None, metavar="CHAPTER", help=TOOL_FLAGS["export-drafts"][1] + ".")
    write_command.add_argument(
        "--register-name", "--register_name", dest="register_name", action="store_true",
        help=TOOL_FLAGS["register-name"][1] + " (--key EN, --burmese MY).")
    write_command.add_argument(
        "--save-verse", "--save_verse", dest="save_verse", action="store_true",
        help=TOOL_FLAGS["save-verse"][1] + " (--chapter, --kind, --english).")
    write_command.add_argument(
        "--export-verse", "--export_verse", dest="export_verse", nargs="?", const=USE_DEFAULT,
        default=None, metavar="CHAPTER", help=TOOL_FLAGS["export-verse"][1] + ".")

    paid = parser.add_argument_group("the API (costs RapidAPI quota)")
    paid_command = paid.add_mutually_exclusive_group()
    paid_command.add_argument(
        "--detect", "--detect_language", nargs="?", const=USE_DEFAULT, default=None, metavar="TEXT",
        help=TOOL_FLAGS["detect"][1] + ".")
    paid_command.add_argument(
        "--translate", "--translate_text", nargs="?", const=USE_DEFAULT, default=None, metavar="TEXT",
        help=TOOL_FLAGS["translate"][1] + ".")

    admin = parser.add_argument_group("the API (costs RapidAPI quota), continued")
    admin_command = admin.add_mutually_exclusive_group()
    admin_command.add_argument(
        "--translate-batch", "--translate_batch", dest="translate_batch", action="store_true",
        help=TOOL_FLAGS["translate-batch"][1] + " (--file, one string per line).")
    admin_command.add_argument(
        "--translate-chapters", "--translate_chapters", dest="translate_chapters", nargs="?",
        const=USE_DEFAULT, default=None, metavar="SPEC",
        help=TOOL_FLAGS["translate-chapters"][1] + ": 194+195, '194&195', "
             "194, or nothing for the next pair. Two chapters at most.")

    options = parser.add_argument_group("what the command acts on")
    options.add_argument("--chapter", type=int, default=None, metavar="N",
                         help="chapter number, when the command does not take one")
    options.add_argument("--paragraph", default=None, metavar="INDEX_OR_ID",
                         help="which paragraph, e.g. 3 or 0194-003-ab6f")
    options.add_argument("--draft", default=None, metavar="TEXT",
                         help="the rewritten paragraph for --save-draft")
    options.add_argument("--ai-text", dest="ai_text", default=None, metavar="TEXT",
                         help="byte-exact AI translation of that paragraph")
    options.add_argument("--note", default=None, metavar="TEXT")
    options.add_argument("--model", default=None, metavar="NAME")
    options.add_argument("--start", type=int, default=None, metavar="N",
                         help="first paragraph of a window (default 1)")
    options.add_argument("--count", type=int, default=None, metavar="N",
                         help="paragraphs in the window (default 10)")
    options.add_argument("--limit", type=int, default=None, metavar="N",
                         help="records a --review-lookup may return (default 2)")
    options.add_argument("--query", default=None, metavar="TEXT",
                         help="free-text search inside the review")
    options.add_argument("--section", default=None, metavar="N_OR_TITLE",
                         help="one review section by number or title")
    options.add_argument("--term", default=None, metavar="TERM",
                         help="a name to look up, for --lookup-name")
    options.add_argument("--keyword", default=None, metavar="BURMESE",
                         help="Burmese-only keyword for --previous-burmese-context")
    options.add_argument("--before-lines", dest="before_lines", type=int, default=None,
                         metavar="N", help="context lines before each Burmese keyword hit")
    options.add_argument("--after-lines", dest="after_lines", type=int, default=None,
                         metavar="N", help="context lines after each Burmese keyword hit")
    options.add_argument("--max-hits", dest="max_hits", type=int, default=None,
                         metavar="N", help="maximum Burmese context hits (default 10)")
    options.add_argument("--api-file", dest="api_file", type=Path, default=None,
                         metavar="PATH", help="API English one-file or chapter file/JSONL")
    options.add_argument("--api-dir", dest="api_dir", type=Path, default=None,
                         metavar="PATH", help="directory holding per-chapter API English")
    options.add_argument("--machine-file", dest="machine_file", type=Path, default=None,
                         metavar="PATH", help="local zh-en one-file output; default zh-en.txt")
    options.add_argument("--machine-dir", dest="machine_dir", type=Path, default=None,
                         metavar="PATH", help="legacy directory of per-chapter zh-en files")
    options.add_argument("--text", default=None, metavar="TEXT",
                         help="the string a command reads, instead of a value")
    options.add_argument("--file", type=Path, default=None, metavar="PATH",
                         help="read --text/--segment/--check-names/--translate "
                              "input from PATH instead of the command line")
    options.add_argument("--target", default=None,
                         help="target language code (default my, or en with --one-file)")
    options.add_argument("--source", default=None,
                         help="source language code, or auto (default auto)")
    options.add_argument("--chars-per-arc", dest="chars_per_arc", type=int,
                         default=None, metavar="N",
                         help="--review-brief: characters per arc opening (60 is cheap)")
    options.add_argument("--kind", default=None,
                         help="--save-verse: poem, philosophy, song, inscription, "
                              "maxim, other or none")
    options.add_argument("--english", default=None, metavar="TEXT",
                         help="--save-verse: the English of the verse")
    options.add_argument("--english-source", dest="english_source", default=None,
                         metavar="SOURCE", help="--save-verse: mt, own or mixed")
    options.add_argument("--mt-english", dest="mt_english", default=None,
                         metavar="TEXT", help="--save-verse: the zh-en column as it was")
    options.add_argument("--key", default=None, metavar="ENGLISH",
                         help="--register-name: the English side of the term")
    options.add_argument("--burmese", default=None, metavar="MYANMAR",
                         help="--register-name: the Burmese side of the term")
    options.add_argument("--out-dir", dest="out_dir", type=Path, default=None,
                         metavar="PATH")
    options.add_argument("--require-all", dest="require_all", action="store_true",
                         help="--export-drafts: refuse unless every paragraph has one")

    config = parser.add_argument_group("the server's own settings")
    config.add_argument("--client", choices=("json", "claude", "kilo", "codex", "gemini"),
                        default="json", help="config flavour (default json)")
    config.add_argument("--config", type=Path, default=None, metavar="PATH",
                        help="config file for --install-config")
    config.add_argument("--env-file", type=Path, default=None, metavar="PATH",
                        help="read KEY=VALUE lines from PATH at startup; the shell wins")
    config.add_argument("--tools", default=None, metavar="SPEC",
                        help="--serve: advertise only a subset (a preset: lean, "
                             "survey, edit, translate, full; or groups/names)")
    config.add_argument("--existing", type=Path, default=None,
                        help="existing human Burmese, for the comparison reference")
    config.add_argument("--cache", type=Path, default=None, help="SQLite cache path")
    config.add_argument("--no-cache", dest="no_cache", action="store_true")
    config.add_argument("--docx", type=Path, default=None,
                        help="bilingual DOCX for chapter numbers")
    config.add_argument("--source-file", dest="source_file", type=Path, default=None,
                        help="Chinese source with ===== 第N章 ===== headings")
    config.add_argument("--draft-store", dest="draft_store", type=Path, default=None,
                        help="SQLite file for agent drafts")
    config.add_argument("--max-chars", dest="max_chars", type=int,
                        default=None, metavar="N",
                        help="characters per API request (the API's limit is 500)")
    config.add_argument("--max-items", dest="max_items", type=int,
                        default=None, metavar="N",
                        help="strings per API request")
    config.add_argument("--timeout", type=float, default=None, metavar="SECONDS",
                        help="per-request timeout (default 60)")
    config.add_argument("--attempts", type=int, default=None, metavar="N",
                        help="tries per request (default 3)")
    config.add_argument("--json", action="store_true",
                        help="one JSON object, no indentation (for piping)")

    # --inspect and --get-title are the two tools with their own printers.
    inspect = parser.add_argument_group("--inspect and --get-title")
    inspect.add_argument("--check-range", dest="check_range", default=None,
                         metavar="LOW-HIGH",
                         help="--inspect: report the holes in a range; exit 1 if any")
    inspect.add_argument("--from", dest="start_chapter", type=int, default=None,
                         metavar="N", help="--get-title: first chapter")
    inspect.add_argument("--to", dest="stop_chapter", type=int, default=None,
                         metavar="N", help="--get-title: last chapter")
    inspect.add_argument("--titles", action="store_true",
                         help="--inspect: print the title table instead of the summary")
    inspect.add_argument("--summary", action="store_true",
                         help="--get-title: counts and gaps instead of the rows")
    inspect.add_argument("--write", type=Path, default=None, metavar="PATH",
                         help="--get-title: save the whole table as JSON")
    return parser


# ---------------------------------------------------------------- dispatch


def _server(args, tools: set[str] | None = None):
    """One Server, configured from the flags, for every tool call."""
    import mcp_server

    tuning = {}
    for key, fallback in (("max_chars", None), ("max_items", None),
                          ("timeout", None), ("attempts", None)):
        value = getattr(args, key, None)
        if value is not None:
            tuning[key] = value
    return mcp_server.Server(
        cache_path=args.cache,
        enabled_cache=not args.no_cache,
        source_file=args.source_file,
        existing=args.existing,
        out_dir=args.out_dir,
        draft_store=args.draft_store,
        docx=args.docx,
        tools=tools,
        **tuning,
    )


def _arguments(args) -> tuple[str, dict]:
    """Which tool, and the argument dict its schema expects."""
    text = args.text
    path = args.file

    def given(value):
        return value is not None and value is not USE_DEFAULT

    if args.compare_english is not None:
        arguments = {"chapter": _chapter(args.compare_english, args, "--compare-english")}
        for key, value in (("start", args.start), ("count", args.count),
                           ("api_file", args.api_file), ("api_dir", args.api_dir),
                           ("machine_file", args.machine_file), ("machine_dir", args.machine_dir)):
            if value is not None:
                arguments[key] = str(value) if isinstance(value, Path) else value
        return "compare_english_chapter", arguments

    if args.previous_burmese_context is not None:
        value = (str(args.previous_burmese_context)
                 if given(args.previous_burmese_context) else args.keyword)
        if not value:
            raise UsageError("--previous-burmese-context needs a Burmese keyword")
        arguments = {"chapter": _check_chapter(args), "keyword": value}
        for key, value in (("before", args.before_lines), ("after", args.after_lines),
                           ("max_hits", args.max_hits)):
            if value is not None:
                arguments[key] = value
        return "previous_burmese_context", arguments

    if args.read is not None:
        arguments = {"chapter": _chapter(args.read, args, "--read")}
        for key, value in (("start", args.start), ("count", args.count)):
            if value is not None:
                arguments[key] = value
        return "read_chapter", arguments

    if args.segment is not None:
        return "segment_text", {"text": _read_text(args.segment, path) or _read_text(text)}

    if args.check_names is not None:
        return "check_names", {"text": _read_text(args.check_names, path) or _read_text(text)}

    if args.detect is not None:
        return "detect_language", {"text": _read_text(args.detect, path) or _read_text(text)}

    if args.translate is not None:
        arguments = {"text": _read_text(args.translate, path) or _read_text(text)}
        if args.target:
            arguments["target"] = args.target
        if args.source:
            arguments["source"] = args.source
        return "translate_text", arguments

    if args.review_brief:
        return "review_brief", ({"chars_per_arc": args.chars_per_arc}
                                if args.chars_per_arc is not None else {})

    if args.review_lookup is not None:
        arguments = {}
        if given(args.review_lookup):
            arguments["query"] = str(args.review_lookup)
        elif args.query:
            arguments["query"] = args.query
        for key, value in (("section", args.section), ("chapter", args.chapter),
                           ("limit", args.limit)):
            if value is not None:
                arguments[key] = value
        return "review_lookup", arguments

    if args.lookup_word is not None:
        word = str(args.lookup_word) if given(args.lookup_word) else (args.text or "")
        return "lookup_word", {"word": _read_text(word, path)}

    if args.lookup_name is not None:
        term = (str(args.lookup_name) if given(args.lookup_name)
                else (args.term or args.text or ""))
        return "lookup_name", ({"term": term} if term else {})

    if args.save_draft:
        if args.draft is None:
            raise UsageError("--save-draft needs --draft TEXT")
        arguments = {
            "chapter": _check_chapter(args),
            "paragraph": args.paragraph if args.paragraph is not None else "1",
            "draft": _read_text(args.draft, None),
        }
        for key in ("ai_text", "model", "note"):
            value = getattr(args, key)
            if value is not None:
                arguments[key] = value
        return "save_draft", arguments

    if args.export_drafts is not None:
        arguments = {"chapter": _chapter(args.export_drafts, args, "--export-drafts")}
        if args.out_dir is not None:
            arguments["out_dir"] = str(args.out_dir)
        if args.require_all:
            arguments["require_all"] = True
        return "export_drafts", arguments

    if args.register_name:
        if not args.key or not args.burmese:
            raise UsageError("--register-name needs --key ENGLISH --burmese MYANMAR")
        arguments = {"key": args.key, "burmese": args.burmese}
        if args.note:
            arguments["note"] = args.note
        return "register_name", arguments

    if args.save_verse:
        if not args.kind:
            raise UsageError("--save-verse needs --kind (poem, philosophy, song, "
                             "inscription, maxim, other, none)")
        arguments = {"chapter": _check_chapter(args), "kind": args.kind}
        for key in ("paragraph", "english", "english_source", "mt_english",
                    "note", "model"):
            value = getattr(args, key)
            if value is not None:
                arguments[key] = value
        return "save_verse", arguments

    if args.export_verse is not None:
        return "export_verse", {"chapter": _chapter(args.export_verse, args, "--export-verse")}

    if args.translate_batch:
        if path is not None:
            texts = [line.strip() for line in
                     Path(path).expanduser().read_text(encoding="utf-8").splitlines()
                     if line.strip()]
        else:
            texts = [args.text] if args.text else []
        if not texts:
            raise UsageError("--translate-batch needs --file PATH, one string per line")
        arguments = {"texts": texts}
        if args.target:
            arguments["target"] = args.target
        if args.source:
            arguments["source"] = args.source
        return "translate_batch", arguments

    if args.translate_chapters is not None:
        arguments = {}
        if given(args.translate_chapters):
            arguments["chapters"] = str(args.translate_chapters)
        if args.target:
            arguments["target"] = args.target
        if args.source:
            arguments["source"] = args.source
        if args.out_dir is not None:
            arguments["out_dir"] = str(args.out_dir)
        return "translate_chapters", arguments

    raise UsageError("pick one command; run with no flags to see them")


def _check_chapter(args) -> int:
    if args.chapter is None:
        raise UsageError("this command needs --chapter N")
    return int(args.chapter)


def _print(result, compact: bool) -> None:
    print(json.dumps(result, ensure_ascii=False,
                     **({} if compact else {"indent": 2})))


def _run_inspect(args) -> int:
    import audit_source

    argv: list[str] = []
    if args.source_file is not None:
        argv += ["--source", str(args.source_file)]
    if args.check_range:
        argv += ["--check", args.check_range]
    else:
        if args.titles:
            argv.append("--titles")
        for flag, value in (("--from", args.start_chapter), ("--to", args.stop_chapter)):
            if value is not None:
                argv += [flag, str(value)]
    if args.json:
        argv.append("--json")
    return audit_source.main(argv)


def _run_get_title(args) -> int:
    import chapter_titles

    argv: list[str] = []
    if args.docx is not None:
        argv += ["--docx", str(args.docx)]
    if args.get_title is not None and args.get_title is not USE_DEFAULT:
        argv += ["--at", str(args.get_title)]
    if args.chapter is not None:
        argv += ["--at", str(args.chapter)]
    if args.start_chapter is not None:
        argv += ["--from", str(args.start_chapter)]
    if args.stop_chapter is not None:
        argv += ["--to", str(args.stop_chapter)]
    if args.summary:
        argv.append("--summary")
    if args.write is not None:
        argv += ["--write", str(args.write)]
    if args.json:
        argv.append("--json")
    return chapter_titles.main(argv)


# ---------------------------------------------------------------- commands


def _env_file(args) -> int:
    """0 when the path is usable; prints and returns the exit code otherwise."""
    if args.env_file is None:
        return 0
    path = Path(args.env_file).expanduser()
    if not path.is_file():
        print(f"error: no env file at {path} — create it first, e.g.\n"
              f"      printf 'RAPIDAPI_KEY=your-key\\n' > {path}",
              file=sys.stderr)
        return 2
    args.env_file = path
    return 0


def _server_command(args) -> int:
    import mcp_server

    if args.list_tools:
        rows = [{"name": tool["name"],
                 "schema_chars": len(json.dumps(tool, ensure_ascii=False)),
                 "purpose": TOOL_FLAGS.get(
                     next((flag for flag, (name, _) in TOOL_FLAGS.items()
                           if name == tool["name"]), ""), ("", ""))[1]}
                for tool in mcp_server.TOOLS]
        _print({"tools": rows,
                "total_schema_chars": len(json.dumps(mcp_server.TOOLS,
                                                     ensure_ascii=False)),
                "groups": list(mcp_server.TOOL_GROUPS),
                "presets": list(mcp_server.TOOL_PRESETS)}, args.json)
        return 0

    if args.selftest:
        result = mcp_server.selftest()
        _print(result, args.json)
        return 0 if result["ok"] else 1

    if args.check:
        from rapidapi_translator import CACHE_ENV, DEFAULT_CACHE

        import os
        _print({
            "key": "set" if os.environ.get("RAPIDAPI_KEY") else "missing",
            "env_file": str(args.env_file or os.environ.get("RAPIDAPI_ENV_FILE") or ""),
            "cache": str(args.cache or os.environ.get(CACHE_ENV) or DEFAULT_CACHE),
            "entry": str(mcp_server.ENTRY),
            "tools": len(mcp_server.TOOLS),
            "client_launches": " ".join(mcp_server.config_payload(
                "kilo", args.env_file)["mcp"][mcp_server.SERVER_NAME]["command"]),
        }, args.json)
        return 0

    if args.print_config:
        print(mcp_server.config_snippet(args.client, args.env_file))
        return 0

    if args.install_config:
        client = "kilo" if args.client == "json" else args.client
        try:
            result = mcp_server.install_config(client, args.config, args.env_file)
        except ValueError as error:
            print(f"error: {error}", file=sys.stderr)
            return 2
        _print(result, args.json)
        return 0 if result["status"] in ("created", "merged", "already") else 1

    # --serve
    try:
        enabled = mcp_server.resolve_tools(args.tools)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    from rapidapi_translator import load_env_file
    loaded = load_env_file(args.env_file)
    if loaded:
        print(f"[mcp] loaded {', '.join(loaded)} from {args.env_file}",
              file=sys.stderr)
    return _server(args, tools=enabled).serve()


def main(argv: list[str] | None = None) -> int:
    raw = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    args = parser.parse_args(raw)

    commands = [flag for flag in (
        args.serve, args.selftest, args.check, args.print_config,
        args.install_config, args.list_tools, args.inspect,
        args.get_title is not None, args.review_brief,
        args.review_lookup is not None, args.lookup_word is not None,
        args.lookup_name is not None, args.check_names is not None,
        args.read is not None, args.compare_english is not None,
        args.previous_burmese_context is not None, args.segment is not None,
        args.save_draft, args.export_drafts is not None, args.register_name,
        args.save_verse, args.export_verse is not None,
        args.detect is not None, args.translate is not None,
        args.translate_batch, args.translate_chapters is not None,
    ) if flag]

    if not commands:
        parser.print_help()
        return 0
    if len(commands) > 1:
        # Each family is mutually exclusive on its own; this catches a mix.
        print("error: one command per run — "
              + ", ".join(f"--{name}" for name in _flag_names(args)),
              file=sys.stderr)
        return 2

    try:
        if args.serve or args.selftest or args.check or args.print_config \
                or args.install_config or args.list_tools:
            problem = _env_file(args)
            if problem:
                return problem
            return _server_command(args)
        if args.inspect:
            return _run_inspect(args)
        if args.get_title is not None:
            return _run_get_title(args)
        name, arguments = _arguments(args)
        result = _server(args).call_tool(name, arguments)
        _print(result, args.json)
        return 0
    except UsageError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    except FileNotFoundError as error:
        print(f"error: {error}", file=sys.stderr)
        return 4
    except (ValueError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n[paused] nothing was written.", file=sys.stderr)
        return 130
    except Exception as error:  # CLI boundary: report tool failures without a traceback.
        print(f"error: {error}", file=sys.stderr)
        return 1


def _flag_names(args) -> list[str]:
    mapping = {
        "serve": "--serve", "selftest": "--selftest", "check": "--check",
        "print_config": "--print-config", "install_config": "--install-config",
        "list_tools": "--list-tools", "inspect": "--inspect",
        "review_brief": "--review-brief", "save_draft": "--save-draft",
        "register_name": "--register-name", "save_verse": "--save-verse",
        "translate_batch": "--translate-batch",
    }
    found = [flag for attr, flag in mapping.items() if getattr(args, attr, False)]
    for attr, flag in (("get_title", "--get-title"),
                       ("review_lookup", "--review-lookup"),
                       ("lookup_word", "--lookup-word"),
                       ("lookup_name", "--lookup-name"),
                       ("check_names", "--check-names"), ("read", "--read"),
                       ("compare_english", "--compare-english"),
                       ("previous_burmese_context", "--previous-burmese-context"),
                       ("segment", "--segment"),
                       ("export_drafts", "--export-drafts"),
                       ("export_verse", "--export-verse"), ("detect", "--detect"),
                       ("translate", "--translate"),
                       ("translate_chapters", "--translate-chapters")):
        if getattr(args, attr, None) is not None:
            found.append(flag)
    return found


if __name__ == "__main__":
    raise SystemExit(main())
