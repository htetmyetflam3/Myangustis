#!/usr/bin/env python3
"""Inspect the recorded KeyMagic/font evidence without compiling a layout.

Examples:
  python3 Junk/Parser/upload/keyboards/inspect-layout.py list --query PaOh
  python3 Junk/Parser/upload/keyboards/inspect-layout.py layout PaOStandard --key .
  python3 Junk/Parser/upload/keyboards/inspect-layout.py layout ZawCode --sequence uU
  python3 Junk/Parser/upload/keyboards/inspect-layout.py codepoint U+1095
  python3 Junk/Parser/upload/keyboards/inspect-layout.py font MS-HEAVY --slot 0x75

These are bounded observations, not a keyboard, converter, or PDF decoder.
"""

import argparse
import hashlib
import json
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
DRAFT = HERE / "draft-layouts.json"
EVIDENCE = HERE / "font-layout-evidence.json"
EXTRAS = ("U+1022", "U+1025", "U+103F", "U+1009", "U+1029", "U+104C",
          "U+104D", "U+104F", "U+102A", "U+1024", "U+1027", "U+104E")


def load_evidence():
    draft_bytes = DRAFT.read_bytes()
    draft = json.loads(draft_bytes)
    evidence = json.loads(EVIDENCE.read_text(encoding="utf-8"))
    if hashlib.sha256(draft_bytes).hexdigest() != evidence.get("draft_sha256"):
        raise ValueError("Font evidence does not match the current draft-layouts.json")
    joined = {item["id"]: item for item in evidence["layouts"]}
    if len(joined) != len(draft["layouts"]):
        raise ValueError("Layout artifact counts differ between draft and font evidence")
    for layout in draft["layouts"]:
        record = joined.get(layout["id"])
        if not record or record["source_sha256"] != layout["source"]["sha256"]:
            raise ValueError(f"Missing or mismatched font evidence for {layout['id']}")
    return draft, evidence, joined


def codepoint(value):
    raw = value.strip().upper()
    if raw.startswith("U+"):
        raw = raw[2:]
    elif raw.startswith("0X"):
        raw = raw[2:]
    try:
        number = int(raw, 16)
        if not 0 <= number <= 0x10FFFF or 0xD800 <= number <= 0xDFFF:
            raise ValueError
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use a Unicode scalar, e.g. U+1095") from exc
    return f"U+{number:04X}"


def describe(text):
    return [{"codepoint": f"U+{ord(ch):04X}", "name": unicodedata.name(ch, "UNASSIGNED")}
            for ch in text]


def select(items, query, get_names):
    needle = query.casefold()
    # Search IDs as well as metadata names: a compiled artifact and its
    # source can have different display names and must both remain visible.
    return [x for x in items if any(needle in s.casefold() for s in get_names(x))]


def listing(draft, query):
    items = draft["layouts"]
    if query:
        items = select(items, query, lambda x: (x["name"], x["id"]))
    return [{"name": x["name"], "id": x["id"], "artifact": x["source"]["artifact"],
             "core_observed": x["coverage"]["core_observed"],
             "core_total": x["coverage"]["core_total"],
             "declared_font": None} for x in items]


def layout_record(layout, evidence, record, key=None, sequence=None):
    coverage = layout["coverage"]
    result = {
        "id": layout["id"], "name": layout["name"], "source": layout["source"],
        "font_metadata": record["font_metadata"], "coverage": coverage,
        "optional_and_requested_extras": {
            cp: "observed" if cp in layout["codepoints"] else "not observed in bounded probes"
            for cp in EXTRAS
        },
        "limitations": ["Positions are bounded input witnesses, not PDF bytes or converter mappings.",
                        "A missing witness is not proof that the layout cannot produce a character.",
                        "Cmap glyphs are observations, not proof of shaping or historical font use."],
    }
    if key is None and sequence is None:
        result["direct_keys"] = {k: {"output": v, "codepoints": describe(v)}
                                 for k, v in layout["keymap"].items()}
    if key is not None:
        handled = key in layout["keymap"]
        output = layout["keymap"].get(key)
        face_glyphs = {}
        if handled:
            for face, keys in record["declared_face_direct_key_cmap_glyphs"].items():
                if key in keys:
                    face_glyphs[face] = keys[key]
        result["key"] = {"input": key, "handled_in_draft": handled,
                         "output": output, "codepoints": describe(output) if handled else None,
                         "declared_face_cmap_glyphs": face_glyphs}
        result["regional_comparisons"] = [x for x in evidence["regional_key_font_examples"]
                                           if x["layout"] == layout["id"] and x["keys"] == key]
    if sequence is not None:
        contexts = []
        for item in evidence["context_witnesses"]:
            if item["source_layout"] != layout["id"]:
                continue
            for example in item["examples"]:
                if example["keys"] == sequence:
                    contexts.append({"declared_font": item["declared_font_for_this_probe"],
                                     "compiled_fixture_sha256": item["compiled_fixture_sha256"],
                                     **example})
        witnesses = []
        seen = set()
        for entry in layout["codepoints"].values():
            for witness in entry["witnesses"]:
                if witness["keys"] != sequence:
                    continue
                identity = (witness["keys"], witness["output"], witness["standalone"])
                if identity not in seen:
                    seen.add(identity)
                    witnesses.append(witness)
        result["sequence"] = {"input": sequence, "replayed_examples": contexts,
                              "bounded_draft_witnesses": witnesses,
                              "note": "No match means not recorded, not necessarily impossible."}
    return result


def codepoint_record(cp, draft, evidence):
    char = chr(int(cp[2:], 16))
    witnesses = []
    for layout in draft["layouts"]:
        entry = layout["codepoints"].get(cp)
        if entry:
            witnesses.append({"layout": layout["id"], "witnesses": entry["witnesses"]})
    same = [x for x in evidence["same_codepoint_examples"] if x["input"].split()[-1] == cp]
    regional = [x for x in evidence["regional_key_font_examples"]
                if cp in x["direct_output_codepoints"]]
    return {"codepoint": cp, "character": char, "unicode_name": unicodedata.name(char, "UNASSIGNED"),
            "layout_witnesses": witnesses, "same_codepoint_font_examples": same,
            "regional_font_examples": regional,
            "note": "Cmap or bounded keyboard observations do not establish PDF bytes or full shaping."}


def font_record(query, slot, evidence):
    faces = select(evidence["fonts"] + evidence["type1_faces"], query,
                   lambda x: (x["label"], *x.get("internal_names", []), x.get("internal_font_name", "")))
    result = []
    for face in faces:
        value = dict(face)
        if slot is not None:
            slots = face.get("selected_encoding_slots")
            key = f"0x{slot:02X}"
            value["requested_slot"] = {"slot": key,
                                       "recorded_glyph": slots.get(key) if slots and key in slots else None,
                                       "recorded": bool(slots and key in slots),
                                       "note": "Type 1 encoding position only; not a physical key or PDF byte."}
        value["same_codepoint_examples"] = [
            {"input": x["input"], "glyph": x["last_codepoint_cmap_glyph"][face["label"]]}
            for x in evidence["same_codepoint_examples"]
            if face["label"] in x["last_codepoint_cmap_glyph"]
        ]
        result.append(value)
    return result


def hex_byte(value):
    try:
        number = int(value, 16)
        if not 0 <= number <= 255:
            raise ValueError
        return number
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Use a byte from 00 to FF, e.g. 0x75") from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    lists = sub.add_parser("list", help="list all 54 retained artifacts")
    lists.add_argument("--query", help="filter by layout name or ID")
    lay = sub.add_parser("layout", help="show positions, source, coverage, and contextual observations")
    lay.add_argument("query", help="exact name/ID, or a substring")
    group = lay.add_mutually_exclusive_group()
    group.add_argument("--key", help="one direct key position, e.g. --key=.")
    group.add_argument("--sequence", help="show only previously recorded contextual witnesses")
    cp = sub.add_parser("codepoint", help="find recorded outputs and font comparisons")
    cp.add_argument("value", type=codepoint)
    font = sub.add_parser("font", help="show recorded face/encoding evidence")
    font.add_argument("query", help="font label or internal name")
    font.add_argument("--slot", type=hex_byte, help="selected recorded Type 1 encoding slot")
    for child in (lists, lay, cp, font):
        child.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args()
    if args.command == "layout" and args.key is not None and len(args.key) != 1:
        parser.error("--key must be exactly one character; use --sequence for multiple keys")
    try:
        draft, evidence, joined = load_evidence()
        if args.command == "list":
            data = listing(draft, args.query)
            for row in data:
                row["declared_font"] = joined[row["id"]]["font_metadata"]["declared"]
        elif args.command == "layout":
            layouts = select(draft["layouts"], args.query, lambda x: (x["name"], x["id"]))
            data = [layout_record(x, evidence, joined[x["id"]], args.key, args.sequence) for x in layouts]
        elif args.command == "codepoint":
            data = codepoint_record(args.value, draft, evidence)
        else:
            data = font_record(args.query, args.slot, evidence)
        if isinstance(data, list) and not data:
            print("No recorded matches. Use 'list' to inspect available layouts.", file=sys.stderr)
            return 2
        if args.json or args.command != "list":
            print(json.dumps(data, ensure_ascii=False, indent=2))
        else:
            for item in data:
                print(f"{item['id']}  [{item['artifact']}; core {item['core_observed']}/{item['core_total']}; "
                      f"font {item['declared_font'] or 'not declared'}]")
        return 0
    except (OSError, KeyError, ValueError, json.JSONDecodeError) as exc:
        print(f"Cannot inspect recorded evidence: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
