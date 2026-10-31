#!/usr/bin/env python3
"""Compare retained KeyMagic outputs with specific font files, without decoding.

Requires fontTools and uharfbuzz. The fetched keyboard collection is checked
against the hashes in draft-layouts.json. Optional third-party font files are
read locally and are not copied. For sequence witnesses, build the separate
font-layout-probe.cpp against the pinned external KeyMagic engine, and provide
four compiled source fixtures in --context-dir: zawcode.km2, zawgyi.km2,
myanmar3.km2 and mywin.km2. The probe accepts a compiled keyboard as an argument
and newline-separated ASCII key sequences on stdin; its output is input-hex,
a tab, and comma-separated hexadecimal code points. It preserves context within
each sequence and models ordinary host passthrough for unhandled printable keys.
This models one host, not every input method; it is not a drop-in regeneration
of extract.py's handled-key inventory.

Example (paths to the external resources must be supplied by the researcher):
  python compare-font-layouts.py --wwin Wwin_Burmese.ttf --wininnwa WinInnwa.ttf \
    --ms-heavy MSHEAV__.PFB --ms-moom MSMOOM__.PFB --probe PROBE \
    --context-dir COMPILED_SOURCES --output font-layout-evidence.json

The saved report is research evidence, not a detector, converter, or PDF map.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
import unicodedata
from collections import Counter
from itertools import product
from pathlib import Path

try:
    import fontTools
    import uharfbuzz as hb
    from fontTools.t1Lib import T1Font
    from fontTools.ttLib import TTFont
except ImportError as exc:
    raise SystemExit("Install fontTools and uharfbuzz to run this research script") from exc

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
DRAFT = HERE / "draft-layouts.json"

# These are specific local faces, not claims that every font version is identical.
LOCAL_FONTS = {
    "TharLon": "Junk/fonts/Unicode/TharLon.ttf",
    "Myanmar3": "Junk/fonts/Unicode/mm3_05-Jan-2011.ttf",
    "Myanmar3 multi-os": "Junk/fonts/Unicode/mm3-multi-os.ttf",
    "Myanmar3 PaOh": "Junk/fonts/Unicode/MM3_Paoh.ttf",
    "Zawgyi-One": "Junk/fonts/zawgyi one/ZAWGYI-ONE_V3.1.TTF",
    "Padauk": "Junk/fonts/Unicode/PADAUK-REGULAR.TTF",
    "Pyidaungsu": "Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF",
    "Yunghkio": "Junk/fonts/Unicode/Yunghkio.ttf",
    "Myanmar Text": "Junk/fonts/Unicode/MMRTEXT.TTF",
}
REFERENCES = {
    "ZawCode": "keymagic-official/ZawCode/ZawCode.kms",
    "Zawgyi L": "keymagic-official/Zawgyi/Zawgyi L.kms",
    "Myanmar3": "keymagic-official/Myanmar3/Myanmar3.kms",
    "myWin": "keymagic-official/myWin/myWin.kms",
}
CONTEXTS = {
    "zawcode": (REFERENCES["ZawCode"], "TharLon"),
    "zawgyi": (REFERENCES["Zawgyi L"], "Zawgyi-One"),
    "myanmar3": (REFERENCES["Myanmar3"], "Myanmar3"),
    "mywin": (REFERENCES["myWin"], "Myanmar3"),
}
SEQUENCES = ("uf", "uU", "uk", "uK", "us", "uG", "uF", "ju", "au")
SPOT_KEYS = ("u", "U", "s", "G", "K", "F", "f", "j")
COLLISION_TEXTS = (
    ("U+1000 U+103A", "\u1000\u103a"),
    ("U+1000 U+103C", "\u1000\u103c"),
    ("U+1000 U+1033", "\u1000\u1033"),
    ("U+1000 U+1064", "\u1000\u1064"),
    ("U+1000 U+1095", "\u1000\u1095"),
)
REGIONAL_SPOTS = {
    "keymagic-official/PaOh/PaOStandard.kms": (",", "."),
    "keymagic-official/PaOh/PaOh.kms": (",", "<"),
    "keymagic-official/Myanmar3/mm3std.kms": ("_",),
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_fixture_sha(path: Path) -> str:
    data = bytearray(path.read_bytes())
    if len(data) >= 18 and data[:6] == b"KMKL\x01\x05":
        # The v1.5 header's padding byte varies between otherwise identical builds.
        data[17] = 0
    return hashlib.sha256(data).hexdigest()


def cps(text: str) -> list[str]:
    return [f"U+{ord(c):04X}" for c in text]


def myanmar(cp: int) -> bool:
    # These are ranges, not an assertion that legacy output follows Unicode.
    return 0x1000 <= cp <= 0x109F or 0xA9E0 <= cp <= 0xA9FF or 0xAA60 <= cp <= 0xAA7F


def source_font(layout: dict, collection: Path) -> dict:
    path = collection / layout["id"]
    if not path.exists():
        return {"status": "artifact_not_fetched", "declared": None}
    if sha(path) != layout["source"]["sha256"]:
        raise ValueError(f"Keyboard does not match pinned SHA-256: {path}")
    if layout["source"]["artifact"] == "source":
        text = path.read_text(encoding="utf-8-sig")
        match = re.search(
            r"(?im)^\s*(?://\s*)?@FONTFAMILY\s*=\s*(['\"])([^\r\n]*?)\1", text
        )
        name = match.group(2).strip() if match else ""
        return {"status": "source_declaration" if name else "no_nonempty_declaration", "declared": name or None}
    return compiled_font(path)


def compiled_font(path: Path) -> dict:
    # Read only KeyMagic's public info section; never execute the supplied file.
    data = path.read_bytes()
    if data[:4] != b"KMKL" or data[4] != 1 or data[5] not in (4, 5):
        return {"status": "unsupported_compiled_metadata_version", "declared": None}
    strings, infos, _rules = struct.unpack_from("<HHH", data, 6)
    offset = 16 if data[5] == 4 else 18
    for _ in range(strings):
        if offset + 2 > len(data):
            raise ValueError(f"Truncated keyboard metadata: {path}")
        length = struct.unpack_from("<H", data, offset)[0]
        offset += 2 + 2 * length
        if offset > len(data):
            raise ValueError(f"Truncated keyboard string: {path}")
    name = None
    for _ in range(infos):
        if offset + 6 > len(data):
            raise ValueError(f"Truncated keyboard info: {path}")
        tag = data[offset : offset + 4][::-1]
        length = struct.unpack_from("<H", data, offset + 4)[0]
        start = offset + 6
        offset = start + length
        if offset > len(data):
            raise ValueError(f"Truncated keyboard info value: {path}")
        if tag == b"font":
            name = data[start:offset].decode("utf-8").strip("\x00 ") or None
    return {"status": "compiled_info" if name else "no_nonempty_declaration", "declared": name}


def name_strings(font: TTFont, ids: tuple[int, ...]) -> list[str]:
    names = set()
    for item in font["name"].names:
        if item.nameID in ids:
            try:
                names.add(item.toUnicode())
            except (UnicodeError, LookupError):
                continue
    return sorted(names)


def load_ttf(label: str, path: Path, recorded_path: str) -> dict:
    font = TTFont(path)
    cmap = font.getBestCmap() or {}
    return {
        "label": label,
        "path": recorded_path,
        "sha256": sha(path),
        "internal_names": name_strings(font, (1, 4, 6, 16)),
        "version_strings": name_strings(font, (5,)),
        "units_per_em": font["head"].unitsPerEm,
        "has_gsub": "GSUB" in font,
        "has_gpos": "GPOS" in font,
        "has_apple_morx": "morx" in font,
        "core_u1000_u1021_cmap_present": sum(cp in cmap for cp in range(0x1000, 0x1022)),
        "core_u1000_u1021_cmap_total": 34,
        "_font": font,
        "_bytes": path.read_bytes(),
        "_cmap": cmap,
    }


def shape(font: dict, text: str) -> dict:
    face = hb.Face(font["_bytes"])
    hb_font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb_font, buf)
    glyphs = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        glyphs.append({
            "glyph_id": info.codepoint,
            "glyph_name": font["_font"].getGlyphName(info.codepoint),
            "cluster": info.cluster,
            "x_advance": pos.x_advance,
            "x_offset": pos.x_offset,
            "y_offset": pos.y_offset,
        })
    return {"script": buf.script, "direction": buf.direction, "glyphs": glyphs}


def type1_report(path: Path, label: str) -> dict:
    font = T1Font(str(path))
    font.parse()
    encoding = font["Encoding"]
    slots = (0x21, 0x55, 0x6E, 0x75, 0xBE, 0xFA)
    return {
        "label": label,
        "path": f"external reference: {path.name}",
        "sha256": sha(path),
        "internal_font_name": font["FontName"],
        "encoding_slots": len(encoding),
        "non_notdef_slots": sum(name != ".notdef" for name in encoding),
        "selected_encoding_slots": {f"0x{slot:02X}": encoding[slot] for slot in slots},
        "limitation": "Custom Type 1 encoding slots, not a Unicode cmap, physical-key map, or PDF subset-byte map; host re-encoding and glyph meanings remain unverified.",
    }


def raw_comparison(layout: dict, reference: dict) -> dict:
    left, right = layout["keymap"], reference["keymap"]
    common = set(left) & set(right)
    equal = sum(left[key] == right[key] for key in common)
    return {
        "shared_handled_keys": len(common),
        "exact_raw_output_equal": equal,
        "raw_output_different": len(common) - equal,
        "reference_only_handled_keys": len(set(right) - set(left)),
    }


def probe(probe_path: Path, compiled: Path, sequences: list[str]) -> tuple[dict, str]:
    result = subprocess.run(
        [str(probe_path), str(compiled)], input="\n".join(sequences) + "\n",
        text=True, capture_output=True, check=True, timeout=90,
    )
    outputs = {}
    for line in result.stdout.splitlines():
        key_hex, output_hex = line.split("\t", 1)
        key = bytes.fromhex(key_hex).decode("ascii")
        if key in outputs:
            raise ValueError(f"Duplicate probe result: {key!r}")
        outputs[key] = "".join(chr(int(cp, 16)) for cp in output_hex.split(",") if cp)
    if set(outputs) != set(sequences):
        raise ValueError(f"Incomplete probe results for {compiled}")
    return outputs, result.stderr.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", type=Path, default=HERE)
    parser.add_argument("--wwin", type=Path)
    parser.add_argument("--wininnwa", type=Path)
    parser.add_argument("--ms-heavy", type=Path)
    parser.add_argument("--ms-moom", type=Path)
    parser.add_argument("--probe", type=Path)
    parser.add_argument("--context-dir", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if bool(args.probe) != bool(args.context_dir):
        parser.error("--probe and --context-dir must be provided together")

    draft = json.loads(DRAFT.read_text(encoding="utf-8"))
    layouts = draft["layouts"]
    refs = {name: next(row for row in layouts if row["id"] == ident) for name, ident in REFERENCES.items()}
    fonts = {name: load_ttf(name, ROOT / path, path) for name, path in LOCAL_FONTS.items()}
    for name, path in (("Wwin_Burmese", args.wwin), ("WinInnwa", args.wininnwa)):
        if path:
            fonts[name] = load_ttf(name, path, f"external reference: {path.name}")
    type1 = [type1_report(path, name) for name, path in (("MS-HEAVY", args.ms_heavy), ("MS-MOOM", args.ms_moom)) if path]

    rows = []
    for layout in layouts:
        direct = layout["keymap"]
        values = sorted({ord(c) for out in direct.values() for c in out if myanmar(ord(c))})
        declaration = source_font(layout, args.collection)
        declared_names = [part.strip() for part in (declaration["declared"] or "").split(",") if part.strip()]
        compared_faces = []
        for name in declared_names:
            candidates = ("Myanmar3", "Myanmar3 multi-os") if name == "Myanmar3" else (name,)
            compared_faces.extend(candidate for candidate in candidates if candidate in fonts and candidate not in compared_faces)
        declaration["locally_compared_faces"] = compared_faces
        declaration["unavailable_declared_families"] = [name for name in declared_names if name not in fonts]
        rows.append({
            "id": layout["id"],
            "artifact": layout["source"]["artifact"],
            "source_sha256": layout["source"]["sha256"],
            "font_metadata": declaration,
            "coverage_from_existing_draft": layout["coverage"],
            "sample_single_key_outputs": {key: cps(direct[key]) if key in direct else None for key in SPOT_KEYS},
            "exact_single_key_output_comparisons": {name: raw_comparison(layout, ref) for name, ref in refs.items()},
            "declared_face_direct_key_cmap_glyphs": {
                name: {key: [fonts[name]["_cmap"].get(ord(c)) for c in output] for key, output in direct.items()}
                for name in declaration["locally_compared_faces"]
            },
            "direct_myanmar_range_codepoints": [f"U+{cp:04X}" for cp in values],
            "best_unicode_cmap_coverage": {
                name: {
                    "present": sum(cp in font["_cmap"] for cp in values),
                    "total": len(values),
                    "absent": [f"U+{cp:04X}" for cp in values if cp not in font["_cmap"]],
                }
                for name, font in fonts.items()
            },
        })

    collisions = []
    for label, text in COLLISION_TEXTS:
        cp = ord(text[-1])
        collisions.append({
            "input": label,
            "last_codepoint_unicode_name": unicodedata.name(chr(cp), "<unassigned>"),
            "last_codepoint_cmap_glyph": {name: font["_cmap"].get(cp) for name, font in fonts.items()},
            "shaped_with_defaults": {name: shape(fonts[name], text) for name in ("TharLon", "Myanmar3", "Zawgyi-One")},
        })

    regional_spots = []
    for layout_id, keys in REGIONAL_SPOTS.items():
        layout = next(row for row in layouts if row["id"] == layout_id)
        for key in keys:
            output = layout["keymap"][key]
            regional_spots.append({
                "layout": layout_id,
                "keys": key,
                "direct_output_codepoints": cps(output),
                "unicode_character_names": [unicodedata.name(c, "<unassigned>") for c in output],
                "best_cmap_glyphs": {
                    name: [fonts[name]["_cmap"].get(ord(c)) for c in output]
                    for name in ("Myanmar3", "Myanmar3 multi-os", "Myanmar3 PaOh", "Padauk", "Pyidaungsu")
                },
                "limitation": "The Myanmar3 PaOh face is a separately named local comparison, not a proven historical font assignment for this layout.",
            })

    contexts = []
    if args.probe:
        manifest = json.loads((HERE / "sources.json").read_text(encoding="utf-8"))
        dependency = next(entry for entry in manifest["files"] if entry["path"] == "Zawgyi/zg-smart.kms")
        dependency_path = args.collection / "keymagic-official/Zawgyi/zg-smart.kms"
        if not dependency_path.is_file() or sha(dependency_path) != dependency["sha256"]:
            raise ValueError("The pinned Zawgyi source include is missing or has changed")
        for fixture, (layout_id, face) in CONTEXTS.items():
            layout = next(row for row in layouts if row["id"] == layout_id)
            compiled = args.context_dir / (fixture + ".km2")
            keys = sorted(layout["keymap"])
            all_sequences = keys + list(SEQUENCES)
            outputs, warning = probe(args.probe.resolve(), compiled.resolve(), all_sequences)
            differences = [key for key in keys if outputs[key] != layout["keymap"][key]]
            if differences:
                raise ValueError(f"Context fixture disagrees with recorded direct outputs: {fixture}: {differences}")
            contexts.append({
                "source_layout": layout_id,
                "source_sha256": layout["source"]["sha256"],
                "source_includes": (
                    [{"path": dependency["path"], "sha256": dependency["sha256"], "url": dependency["url"]}]
                    if fixture == "zawgyi" else []
                ),
                "compiled_fixture_sha256": sha(compiled),
                "compiled_fixture_sha256_with_v15_header_padding_zeroed": normalized_fixture_sha(compiled),
                "declared_font_for_this_probe": face,
                "single_keys_replayed_exactly": len(keys),
                "probe_stderr": warning or None,
                "examples": [
                    {
                        "keys": keys,
                        "final_output_codepoints": cps(outputs[keys]),
                        "shape": shape(fonts[face], outputs[keys]),
                        "same_family_alternate_shape": (
                            shape(fonts["Myanmar3 multi-os"], outputs[keys]) if face == "Myanmar3" else None
                        ),
                    }
                    for keys in SEQUENCES
                ],
            })

    sibling_comparison = None
    if args.probe:
        source_fixture = args.context_dir / "zawcode.km2"
        binary_id = "keymagic-official/ZawCode/ZawCode.km2"
        binary_layout = next(row for row in layouts if row["id"] == binary_id)
        original_binary = args.collection / binary_id
        binary_keys = sorted(binary_layout["keymap"])
        replayed, binary_warning = probe(args.probe.resolve(), original_binary.resolve(), binary_keys)
        if any(replayed[key] != binary_layout["keymap"][key] for key in binary_keys):
            raise ValueError("Original ZawCode binary disagrees with its recorded single-key outputs")
        alphabet = [chr(n) for n in range(32, 127)]
        pairs = ["".join(pair) for pair in product(alphabet, repeat=2)]
        from_source, source_warning = probe(args.probe.resolve(), source_fixture.resolve(), pairs)
        from_binary, binary_pair_warning = probe(args.probe.resolve(), original_binary.resolve(), pairs)
        differences = [keys for keys in pairs if from_source[keys] != from_binary[keys]]
        selected = [keys for keys in ("]u", "]s", "]U", "` ") if keys in differences]
        sibling_comparison = {
            "source_layout": REFERENCES["ZawCode"],
            "original_binary_layout": binary_id,
            "original_binary_sha256": sha(original_binary),
            "original_binary_single_keys_replayed_exactly": len(binary_keys),
            "pairs_compared": len(pairs),
            "pairs_with_different_final_outputs": len(differences),
            "source_probe_stderr": source_warning or None,
            "binary_probe_stderr": binary_pair_warning or binary_warning or None,
            "examples": [
                {"keys": keys, "source_output_codepoints": cps(from_source[keys]),
                 "binary_output_codepoints": cps(from_binary[keys])}
                for keys in selected
            ],
            "limitation": "Results are for this external KeyMagic engine/probe only. The original binary emitted an unknown-op warning on this engine; the cause and behavior on other KeyMagic versions are not established.",
        }

    metadata_counts = Counter(
        row["font_metadata"]["declared"] or f"<{row['font_metadata']['status']}>" for row in rows
    )
    result = {
        "format": "myangustis.keyboard-font-evidence.v1",
        "scope": "All retained draft artifacts; raw key outputs, font cmap entries, and selected shaped sequences. This is not a conversion table.",
        "draft_sha256": sha(DRAFT),
        "artifact_count": len(rows),
        "declared_font_counts": dict(sorted(metadata_counts.items())),
        "optional_inputs": {
            "Wwin_Burmese": "supplied" if args.wwin else "not supplied",
            "WinInnwa": "supplied" if args.wininnwa else "not supplied",
            "MS-HEAVY": "supplied" if args.ms_heavy else "not supplied",
            "MS-MOOM": "supplied" if args.ms_moom else "not supplied",
            "keymagic_context_probe": "supplied" if args.probe else "not supplied",
        },
        "tools": {
            "fontTools_version": fontTools.__version__,
            "uharfbuzz_version": hb.__version__,
            "harfbuzz_version": hb.version_string(),
            "keymagic_engine_repository": draft["generation"]["engine_repository"],
            "keymagic_engine_revision": draft["generation"]["engine_revision"],
            "probe_source": "Junk/Parser/upload/keyboards/font-layout-probe.cpp",
            "probe_model": "US printable key positions, Shift for uppercase/shifted punctuation, engine context retained per sequence, unhandled printable keys passed through as a simple host would.",
            "shaping": "HarfBuzz guessed segment properties and default features; glyph positions are in each font's units per em.",
        },
        "limitations": [
            "A declaration is source or binary metadata, not proof of the historical font version or document used.",
            "Raw direct-key equality includes empty outputs and is not semantic, contextual, or whole-layout equivalence.",
            "The per-key declared-face cmap glyph lists are aligned character by character with that layout's existing draft keymap. A null is an absent cmap entry and an empty list is an empty output; unhandled keys are omitted. These are unshaped glyph names, not Unicode translations.",
            "Coverage counts only code points in direct outputs in U+1000..109F, U+A9E0..A9FF, U+AA60..AA7F. A best-cmap entry is not proof of correct semantics or shaping; missing entries do not include host font fallback.",
            "Unicode character names do not describe the intended meaning of a legacy Zawgyi glyph. Glyph names and a single modern shaping engine are evidence, not a complete visual or historical rendering test.",
            "Type 1 encoding slots, Unicode code points, physical keys, and PDF subset character codes are different domains. Neither these comparisons nor the keyboard rules are PDF byte maps.",
            "Context witnesses use compiled copies of the indicated source with icon metadata removed. Fixture hashes preserve the exact bytes tested; a second hash zeroes only the variable v1.5 header padding byte. Only selected US-layout sequences were replayed; unobserved outcomes remain possible. Source and separately supplied compiled layouts can differ.",
            "The pinned compiler emitted a non-fatal unrecognized-option warning when the recorded myWin source fixture was built; the effect, if any, is unverified.",
            "Third-party font files and converter mappings are not distributed or integrated. No production classification, scoring, decoding, or keyboard data was changed.",
        ],
        "fonts": [{key: value for key, value in font.items() if not key.startswith("_")} for font in fonts.values()],
        "type1_faces": type1,
        "same_codepoint_examples": collisions,
        "regional_key_font_examples": regional_spots,
        "context_witnesses": contexts,
        "zawcode_source_binary_pair_comparison": sibling_comparison,
        "layouts": rows,
    }
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        sys.stdout.write(encoded)


if __name__ == "__main__":
    main()
