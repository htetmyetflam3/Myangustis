#!/usr/bin/env python3
r"""Rebuild the KeyMagic drafts with external compiler and probe executables.

Fetch all pinned files into a separate directory first, for example:
    python fetch.py --destination /tmp/keyboards --include-discarded
    python extract.py --collection /tmp/keyboards --compiler /path/to/km-parser \
        --probe /path/to/keymagic-probe --output /tmp/keyboard-drafts

The official KeyMagic compiler/engine is GPL-2.0 and is not bundled here. The
probe is a separate, externally supplied adapter to that engine. It must accept
a .km2 path as argv[1] and one printable-US-key sequence per stdin line, reset
the engine for each line, set the Shift and left-Shift states for shifted keys,
apply ordinary key passthrough/eat behavior, and emit one line for each handled
sequence: hexadecimal ASCII input, a tab, then comma-separated hexadecimal
output code points. An empty result is represented by an empty field after the
tab. The user must ensure both executables correspond to the pinned engine
revision stated in the generated records.

No source keyboard is edited: compiler input is a temporary copy with @ICON
metadata lines omitted, because icon files are not part of the collection.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

from fetch import LOCAL_PREFIX, destination, sha256


HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "sources.json"
ENGINE_REVISION = "6a662fb071e1f0e0c9271f84e28712b9e78962ab"
KEYS = tuple(chr(i) for i in range(32, 127))
CORE = set(range(0x1000, 0x1022))
EXTRA = {0x1009, 0x103F} | set(range(0x1023, 0x102B)) | set(range(0x104C, 0x105A))
TARGETS = sorted(set(range(0x1000, 0x1028)) | EXTRA)
CATEGORIES = (
    "direct_standalone",
    "direct_composite",
    "two_key_standalone",
    "two_key_composite",
    "longer_context_standalone",
    "longer_context_composite",
)
INCLUDE_PATTERN = re.compile(r"""(?im)^\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)""")


def relative(local: str) -> str:
    return PurePosixPath(local).relative_to(LOCAL_PREFIX).as_posix()


def codepoints(text: str) -> list[str]:
    return [f"U+{ord(char):04X}" for char in text]


def compiled_symbols(path: Path) -> set[int]:
    """Read 16-bit symbols from variables and rules, not from metadata."""
    data = path.read_bytes()
    if data[:4] != b"KMKL" or data[4] != 1 or data[5] not in (3, 4, 5):
        raise ValueError(f"Unsupported KeyMagic file: {path}")
    minor = data[5]
    string_count = struct.unpack_from("<H", data, 6)[0]
    if minor == 3:
        info_count = 0
        rule_count = struct.unpack_from("<H", data, 8)[0]
        offset = 14
    else:
        info_count, rule_count = struct.unpack_from("<HH", data, 8)
        offset = 16 if minor == 4 else 18
    values: set[int] = set()

    def read_words() -> None:
        nonlocal offset
        count = struct.unpack_from("<H", data, offset)[0]
        offset += 2
        values.update(struct.unpack_from(f"<{count}H", data, offset))
        offset += 2 * count

    for _ in range(string_count):
        read_words()
    for _ in range(info_count):
        _, length = struct.unpack_from("<IH", data, offset)
        offset += 6 + length
    for _ in range(rule_count):
        read_words()
        read_words()
    if offset != len(data):
        raise ValueError(f"Unexpected trailing or truncated KeyMagic data: {path}")
    return values


def probe_sequences(
    probe: Path, compiled: Path, sequences: list[str]
) -> tuple[dict[str, str], str]:
    if not sequences:
        return {}, sha256(b"")
    result = subprocess.run(
        [str(probe), str(compiled)],
        input="\n".join(sequences) + "\n",
        text=True,
        capture_output=True,
        check=True,
        timeout=90,
    )
    outputs = {}
    for line in result.stdout.splitlines():
        if "\t" not in line:
            raise ValueError(f"Invalid probe output: {line!r}")
        input_hex, output_hex = line.split("\t", 1)
        keys = bytes.fromhex(input_hex).decode("ascii")
        outputs[keys] = "".join(chr(int(value, 16)) for value in output_hex.split(",") if value)
    return outputs, hashlib.sha256(result.stdout.encode()).hexdigest()


def metadata(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8-sig")
    result = {}
    for attr in ("NAME", "FONTFAMILY"):
        match = re.search(r"(?im)^\s*(?://\s*)?@" + attr + r"""\s*=\s*(['"])([^\r\n]*?)\1""", text)
        if match:
            result[attr.lower()] = match.group(2)
    return result


def context_sequences(source: Path | None, shortest: dict[str, str]) -> list[str]:
    if source is None or not source.exists():
        return []
    text = source.read_text(encoding="utf-8-sig")
    text = re.sub(r"(?m)^[ \t]*//.*$", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"\\[ \t]*\r?\n[ \t]*", " ", text)
    pattern = re.compile(r"(?im)^\s*((?:u[0-9a-f]{4}\s*\+\s*){1,7}u[0-9a-f]{4})\s*=>\s*([^\r\n]+)")
    sequences = set()
    for match in pattern.finditer(text):
        lhs = [int(value, 16) for value in re.findall(r"(?i)u([0-9a-f]{4})", match.group(1))]
        if not any(
            chr(cp) in match.group(2) or re.search(rf"(?i)\bu{cp:04x}\b", match.group(2))
            for cp in TARGETS
        ):
            continue
        if not all(chr(cp) in shortest for cp in lhs):
            continue
        sequence = "".join(shortest[chr(cp)] for cp in lhs)
        if 2 < len(sequence) <= 12:
            sequences.add(sequence)
    return sorted(sequences, key=lambda value: (len(value), value))


def update_shortest(shortest: dict[str, str], results: dict[str, str]) -> None:
    for keys, output in results.items():
        if len(output) == 1 and (
            output not in shortest or (len(keys), keys) < (len(shortest[output]), shortest[output])
        ):
            shortest[output] = keys


def make_entries(sequences: dict[str, str], direct: dict[str, str]) -> dict:
    entries = {}
    for cp in TARGETS:
        character = chr(cp)
        buckets = {}
        for keys, output in sequences.items():
            if character not in output:
                continue
            # Don't credit a second key when the first already produced the target.
            if len(keys) == 2 and character in direct.get(keys[0], ""):
                continue
            category = (
                "direct" if len(keys) == 1 else "two_key" if len(keys) == 2 else "longer_context"
            )
            category += "_standalone" if output == character else "_composite"
            witness = {"keys": keys, "output": output, "standalone": output == character}
            current = buckets.get(category)
            if current is None or (len(keys), keys, len(output)) < (
                len(current["keys"]),
                current["keys"],
                len(current["output"]),
            ):
                buckets[category] = witness
        entries[f"U+{cp:04X}"] = {
            "character": character,
            "witnesses": [buckets[category] for category in CATEGORIES if category in buckets],
        }
    return entries


def probe_keyboard(entry: dict, compiled: Path, source: Path | None, probe: Path) -> dict:
    direct, _ = probe_sequences(probe, compiled, list(KEYS))
    pairs, pair_hash = probe_sequences(probe, compiled, [a + b for a in KEYS for b in KEYS])
    sequences = {**direct, **pairs}
    shortest: dict[str, str] = {}
    update_shortest(shortest, sequences)
    for _ in range(2):
        results, _ = probe_sequences(probe, compiled, context_sequences(source, shortest))
        sequences.update(results)
        update_shortest(shortest, results)
    entries = make_entries(sequences, direct)
    seen = {cp for cp in TARGETS if entries[f"U+{cp:04X}"]["witnesses"]}
    missing = [f"U+{cp:04X}" for cp in sorted(CORE - seen)]
    extensions = [f"U+{cp:04X}" for cp in sorted(EXTRA & seen)]
    return {
        "source": entry["local"],
        "kind": entry["kind"],
        "compiled_path": compiled,
        "direct": direct,
        "pair_sha256": pair_hash,
        "entry_data": entries,
        "direct_keymap": [{"key": key, "output": output} for key, output in sorted(direct.items())],
        "core_seen": [f"U+{cp:04X}" for cp in sorted(CORE & seen)],
        "core_missing": missing,
        "extra_seen": extensions,
        "selection": (
            "complete_core"
            if not missing
            else "partial_with_extra" if extensions else "not_observed_in_bounded_probes"
        ),
        "meta": metadata(source) if entry["kind"] == "source" and source is not None else {},
    }


def prepare_sources(
    manifest: dict, collection: Path, temporary: Path
) -> tuple[dict[str, Path], dict[str, list[str]]]:
    originals = {}
    included_by: dict[str, list[str]] = {}
    known = {entry["local"] for entry in manifest["files"]}
    for entry in manifest["files"]:
        original = destination(collection, entry["local"])
        if not original.is_file() or sha256(original.read_bytes()) != entry["sha256"]:
            raise ValueError(f"Missing or modified pinned input: {original}")
        originals[entry["local"]] = original
        if entry["kind"] != "source":
            continue
        text = original.read_text(encoding="utf-8-sig")
        for include in INCLUDE_PATTERN.findall(text):
            dependency = (PurePosixPath(entry["local"]).parent / include).as_posix()
            if dependency not in known:
                raise ValueError(f"Unknown included file {dependency}")
            included_by.setdefault(dependency, []).append(relative(entry["local"]))
        copied = destination(temporary, entry["local"])
        copied.parent.mkdir(parents=True, exist_ok=True)
        copied.write_text(
            "\n".join(line for line in text.splitlines() if "@ICON" not in line.upper()) + "\n",
            encoding="utf-8",
        )
    return originals, included_by


def scan(
    manifest: dict, collection: Path, compiler: Path, probe: Path, temporary: Path
) -> tuple[list[dict], dict[str, list[str]]]:
    copied = temporary / "sources"
    compiled_dir = temporary / "compiled"
    compiled_dir.mkdir(parents=True)
    originals, included_by = prepare_sources(manifest, collection, copied)
    rows = []
    for entry in manifest["files"]:
        if entry["kind"] not in ("source", "compiled"):
            continue
        original = originals[entry["local"]]
        if entry["kind"] == "source":
            compiled = compiled_dir / (hashlib.sha256(entry["local"].encode()).hexdigest() + ".km2")
            result = subprocess.run(
                [str(compiler), str(destination(copied, entry["local"])), str(compiled)],
                text=True,
                capture_output=True,
                timeout=90,
            )
            if result.returncode or not compiled.exists():
                error = (result.stderr + " " + result.stdout).strip().splitlines()[:2]
                if entry["local"] not in included_by:
                    raise RuntimeError(f"Keyboard did not compile: {original}: {error}")
                rows.append({"source": entry["local"], "kind": entry["kind"], "error": error})
                continue
            source = original
        else:
            compiled = original
            sibling = original.with_suffix(".kms")
            source = sibling if sibling.exists() else None
        row = probe_keyboard(entry, compiled, source, probe)
        row["table_symbols"] = compiled_symbols(compiled)
        rows.append(row)
        print(
            f"{row['selection']:30} {len(row['core_seen']):2}/34 {relative(entry['local'])}",
            flush=True,
        )
    return rows, included_by


def classify(manifest: dict, rows: list[dict], included_by: dict[str, list[str]]) -> None:
    by_local = {row["source"]: row for row in rows}
    for entry in manifest["files"]:
        if entry["kind"] == "license":
            entry["selection"] = "license"
            continue
        if entry["local"] in included_by:
            entry["selection"] = "dependency"
            continue
        row = by_local[entry["local"]]
        if row.get("error"):
            entry["selection"] = "unverified"
        elif row["selection"] in ("complete_core", "partial_with_extra"):
            entry["selection"] = "retained"
        else:
            possible = row["table_symbols"]
            entry["selection"] = (
                "unverified" if possible & EXTRA or CORE <= possible else "discarded"
            )


def make_layouts(manifest: dict, rows: list[dict]) -> list[dict]:
    files = {entry["local"]: entry for entry in manifest["files"]}
    source_info = {f"{source['owner']}/{source['repo']}": source for source in manifest["sources"]}
    by_local = {row["source"]: row for row in rows}
    core = [f"U+{cp:04X}" for cp in sorted(CORE)]
    layouts = []
    for row in rows:
        entry = files[row["source"]]
        if entry["selection"] != "retained":
            continue
        source = source_info[entry["source"]]
        sibling = str(
            Path(entry["local"]).with_suffix(".km2" if entry["kind"] == "source" else ".kms")
        )
        other = by_local.get(sibling)
        comparison = None
        if other and not other.get("error"):
            comparison = {
                "other_file": relative(sibling),
                "same_single_and_two_key_outputs": row["pair_sha256"] == other["pair_sha256"]
                and row["direct"] == other["direct"],
                "note": "Only tested sequences were compared; other rules may differ.",
            }
        entries = row["entry_data"]
        for item in entries.values():
            for witness in item["witnesses"]:
                witness["output_codepoints"] = codepoints(witness["output"])
        nonstandalone = [
            cp
            for cp in core
            if not any(witness["standalone"] for witness in entries[cp]["witnesses"])
        ]
        license_note = (
            "LGPL-2.1-or-later" if entry["path"] == "myWin/myWin.kms" else source["license"]
        )
        record = {
            "id": relative(entry["local"]),
            "name": row["meta"].get("name") or PurePosixPath(entry["path"]).stem,
            "source": {
                "repository": entry["source"],
                "revision": entry["revision"],
                "path": entry["path"],
                "sha256": entry["sha256"],
                "url": entry["url"],
                "artifact": entry["kind"],
                "license": license_note,
                "license_url": source["license_url"],
            },
            "coverage": {
                "classification": row["selection"],
                "core_observed": len(row["core_seen"]),
                "core_total": len(core),
                "core_not_observed": row["core_missing"],
                "core_without_standalone_witness": nonstandalone,
                "extended_observed": row["extra_seen"],
            },
            "keymap": {item["key"]: item["output"] for item in row["direct_keymap"]},
            "codepoints": entries,
        }
        if row["meta"].get("fontfamily"):
            record["source"]["declared_font_family"] = row["meta"]["fontfamily"]
        if entry["path"] == "myWin/myWin.kms":
            record["source"][
                "license_url"
            ] = "http://www.gnu.org/licenses/old-licenses/lgpl-2.1.html"
            record["source"]["license_files"] = [
                "keymagic-official/myWin/COPYING",
                "keymagic-official/myWin/COPYING.LESSER",
            ]
        if comparison:
            record["comparison_to_sibling"] = comparison
        layouts.append(record)
    return sorted(layouts, key=lambda value: value["id"])


def replay(layouts: list[dict], rows: list[dict], probe: Path) -> tuple[int, int]:
    by_local = {row["source"]: row for row in rows}
    key_count = witness_count = 0
    for layout in layouts:
        expected = dict(layout["keymap"])
        key_count += len(expected)
        for item in layout["codepoints"].values():
            for witness in item["witnesses"]:
                if item["character"] not in witness["output"] or witness[
                    "output_codepoints"
                ] != codepoints(witness["output"]):
                    raise ValueError(f"Invalid witness in {layout['id']}")
                previous = expected.setdefault(witness["keys"], witness["output"])
                if previous != witness["output"]:
                    raise ValueError(f"Conflicting witness in {layout['id']}")
                witness_count += 1
        row = by_local[str(LOCAL_PREFIX / layout["id"])]
        actual, _ = probe_sequences(
            probe, row["compiled_path"], sorted(expected, key=lambda value: (len(value), value))
        )
        if actual != expected:
            raise ValueError(f"Recorded outputs did not replay: {layout['id']}")
    return key_count, witness_count


def draft_document(manifest: dict, layouts: list[dict]) -> dict:
    counts = {
        kind: sum(entry.get("selection") == kind for entry in manifest["files"])
        for kind in ("retained", "dependency", "discarded", "unverified", "license")
    }
    return {
        "format": "myangustis-keymagic-drafts-v1",
        "description": "Observed KeyMagic keyboard input rules. These are typing sequences, not PDF font-byte maps.",
        "selection": manifest["selection_policy"],
        "generation": {
            "engine_repository": "https://github.com/thantthet/keymagic",
            "engine_revision": ENGINE_REVISION,
            "method": "Original KeyMagic engine run from empty context with all printable US-layout single keys and key pairs; additional literal-context rules were probed when their components had observed standalone key sequences. Source files were compiled with icon metadata removed only.",
            "inputs": "ASCII characters represent US-layout key presses; uppercase and shifted punctuation represent Shift. keymap contains all handled single-key outputs. An empty output can be a switch or an eaten key, not necessarily an output character.",
            "limitations": [
                "A witness records complete final text, not a claim that every character was emitted separately; witness sequences are representative rather than exhaustive.",
                "Only bounded sequences and selected literal contexts were probed; an unobserved character may be reachable in another context or with other modifiers. U+1009 is a core character as well as a listed example.",
                "Each original source and compiled file is treated separately; legacy Zawgyi-font outputs remain as emitted and must not be assumed Unicode text.",
                "No source keyboard was altered, and no keyboard input mapping is a PDF character-code map.",
                "Licensing differs by upstream source; confirm redistribution rights for derived data as well as originals.",
            ],
        },
        "counts": {
            "layouts": len(layouts),
            "complete_core": sum(
                item["coverage"]["classification"] == "complete_core" for item in layouts
            ),
            "partial_with_extra": sum(
                item["coverage"]["classification"] == "partial_with_extra" for item in layouts
            ),
            "source_file_selection": counts,
        },
        "layouts": layouts,
    }


def audit_document(
    manifest: dict,
    rows: list[dict],
    included_by: dict[str, list[str]],
    replay_counts: tuple[int, int],
) -> dict:
    by_local = {row["source"]: row for row in rows}
    candidates = []
    for entry in manifest["files"]:
        if entry["kind"] == "license":
            continue
        row = by_local[entry["local"]]
        item = {
            "id": relative(entry["local"]),
            "artifact": entry["kind"],
            "sha256": entry["sha256"],
            "selection": entry["selection"],
        }
        if row.get("error"):
            if entry["path"] in ("Ayar/Ayar-autocorrect.kms", "Ayar/Ayar-autocorrect2.kms"):
                item["standalone_probe"] = (
                    "not compiled; required parent layout variables are absent"
                )
            else:
                item["standalone_probe"] = "not compiled; inspect the compiler error"
        else:
            values = row["table_symbols"]
            item.update(
                {
                    "observed_core_count": len(row["core_seen"]),
                    "observed_core_gaps": row["core_missing"],
                    "observed_extensions": row["extra_seen"],
                    "single_key_handled_count": len(row["direct_keymap"]),
                    "compiled_table_core_count": len(values & CORE),
                    "compiled_table_extensions": [f"U+{cp:04X}" for cp in sorted(values & EXTRA)],
                    "probe_status": row["selection"],
                }
            )
        if entry["selection"] == "dependency":
            item["included_by"] = sorted(included_by.get(entry["local"], []))
        if any(
            name in entry["path"] for name in ("MyanSanMobile", "PaOhMobile", "Mon-Anonta-Mobile")
        ):
            item["note"] = (
                "Mobile-oriented reordering source; ordinary standalone ASCII key mappings are not established by the probes."
            )
        candidates.append(item)
    return {
        "format": "myangustis-keymagic-audit-v1",
        "manifest": "sources.json",
        "drafts": "draft-layouts.json",
        "selection_policy": manifest["selection_policy"],
        "probe": {
            "engine_revision": ENGINE_REVISION,
            "scope": "All 95 printable US-keyboard single presses and 9,025 pairs, plus selected longer literal-context sequences. Source compilation used temporary icon-free copies and preserved includes.",
            "evidence": "draft-layouts.json preserves each single-key output and representative full-output witnesses; original source/binary SHA-256 values are in sources.json.",
            "limits": [
                "Unobserved is not impossible: long or non-US/modifier contexts are not exhaustively explored.",
                "Observed counts include code points inside larger outputs and do not imply standalone keys.",
                "A compiled-table value is a candidate only; it may be an input, an unused variable, or unreachable.",
                "The original GPL-2.0 engine is external to this proprietary repository.",
                "Original keyboard license status is recorded per source; unknown-license originals are not committed.",
            ],
        },
        "verification": {
            "witnesses_replayed_against_engine": replay_counts[1],
            "single_key_outputs_replayed_against_engine": replay_counts[0],
            "source_hashes_checked": True,
            "note": "Replay verifies recorded outputs under the same bounded engine simulation, not native keyboard applications or completeness.",
        },
        "candidates": candidates,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--collection",
        type=Path,
        required=True,
        help="full collection fetched with --include-discarded",
    )
    parser.add_argument(
        "--compiler", type=Path, required=True, help="external KeyMagic compiler executable"
    )
    parser.add_argument(
        "--probe", type=Path, required=True, help="external KeyMagic engine probe executable"
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="new directory for the generated files"
    )
    args = parser.parse_args()
    collection, compiler, probe, output = (
        path.resolve() for path in (args.collection, args.compiler, args.probe, args.output)
    )
    output.mkdir(parents=True, exist_ok=True)
    names = ("sources.json", "draft-layouts.json", "audit.json")
    if any((output / name).exists() for name in names):
        raise ValueError("Output files already exist; choose a new directory")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="keymagic-extract-") as temp:
        rows, included_by = scan(manifest, collection, compiler, probe, Path(temp))
        classify(manifest, rows, included_by)
        layouts = make_layouts(manifest, rows)
        counts = replay(layouts, rows, probe)
        documents = (
            manifest,
            draft_document(manifest, layouts),
            audit_document(manifest, rows, included_by, counts),
        )
        for name, document in zip(names, documents):
            with (output / name).open("x", encoding="utf-8") as stream:
                json.dump(document, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
    print(
        f"Generated {len(layouts)} drafts; replayed {counts[0]} single keys and {counts[1]} witnesses."
    )


if __name__ == "__main__":
    main()
