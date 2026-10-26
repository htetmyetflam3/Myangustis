#!/usr/bin/env python3
"""LSE / LSN register auditor for Burmese drafts.

This is the script behind the register work on chapters 194-195. It existed
only as inline Python during that job; this is the same logic, shipped as a
tool so the pass is repeatable instead of being retyped each time.

WHAT IT ANSWERS
    For every case-marker (wibat) in a Burmese text: which register is this
    form native to, which register is the sentence actually in, and what does
    resolution.single say the form should be if they disagree.

The two halves of the answer come from two different places, and that is the
whole point of the tool:

  * the register a form belongs to  ->  Engine/knowledge/isTreasure/master.json
                                        resolution.single  (42 rows)
  * the register a sentence is in   ->  the text itself, classified per block

master.json is READ ONLY. Nothing here writes to Engine/, master.json, the
POS tree or any cache. The only writes are inside --work and the optional
--json report.

REGISTER RULE (mt/quality/MT.md:206-207)
    LSE  literary     default prose / narration
    LSN  spoken       inside quote marks
    LSN  spoken       ALSO unquoted first-person inner monologue. This last
                      clause is a project ruling, not a guess: across the 195
                      human chapters there are 309 lines beginning with ငါ
                      and 0 of them carry an opening quote mark. The author
                      never quotes a thought, and his thoughts are colloquial.

READ THE CONTEXT BEFORE EDITING
    A mismatch is a candidate, not a verdict. The segmentor tags the bare က
    inside ကမ္ဘာ and တကယ့်, and the တိုင်း inside နေရာတိုင်း, as though they
    were particles. And the same surface can play several roles - က is listed
    under ကတ္တား, ထွက်ခွာရာပြ, နေရာပြ and အချိန်ပြ - and each role takes a
    different target form, so the role decides the replacement, not the word.
    Every finding therefore carries its context line and its candidate roles.

usage
    python3 mt/quality/register.py SOURCE.txt [--work DIR] [--json OUT.json]
    python3 mt/quality/register.py SOURCE.txt --raw-pos FILE   # skip tagging
    python3 mt/quality/register.py A.txt B.txt --summary       # counts only
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
MASTER = os.path.join(REPO, "Engine", "knowledge", "isTreasure", "master.json")
TAGGER = os.path.join(HERE, "tag-both.mjs")
RUNTIME_GUARD = os.path.join(REPO, "scraper", "wasm", "box", "runtime-guard.mjs")

# Colloquial surface forms that mark a block as spoken even with no quote mark
# and no ငါ. Kept deliberately small: substring matching on Burmese is a trap
# (တယ် matches inside အင်မော်တယ်, ဟုတ် inside မဟုတ်, လုပ် inside ပြုလုပ်),
# so these are matched as whole tokens only, never as substrings.
COLLOQUIAL_TOKENS = {
    "ပါပဲ", "ပဲ", "တဲ့", "လိုက်တာ", "တာ", "တယ်", "ဘူး", "လား",
    "မယ်", "ရင်", "လို့", "နဲ့", "ရဲ့", "တော့", "လဲ", "ကတော့", "မို့လို့",
}
FIRST_PERSON = ("ငါ", "ငါ့")

TOKEN_RE = re.compile(r"^(.+?)\{([a-z,?]+)\}$")
MYANMAR_RE = re.compile(r"[\u1000-\u1049\u1050-\u109F]")


# --------------------------------------------------------------------- master
def load_master(path=MASTER):
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    single = data["resolution"]["single"]
    wibat = data["top"]["wibat"]

    # marker -> set of grammatical roles it can play
    roles = defaultdict(set)
    for family in ("n", "v"):
        for role, markers in wibat.get(family, {}).items():
            for m in markers:
                roles[m].add(role)

    rows = {}
    for surface, spec in single.items():
        default = spec.get("default", "")
        native, native_role = None, None
        m = re.match(r"^!(LSE|LSN):(.+)$", default)
        if m:
            native, native_role = m.group(1), m.group(2)
        rows[surface] = {
            "native": native,
            "native_role": native_role,
            "style": spec.get("style", {}),
            "roles": sorted(roles.get(surface, [])),
        }
    return rows, dict(roles)


def target_forms(row, want_reg):
    """What resolution.single offers for `want_reg`, role-specific first."""
    style = row["style"].get(want_reg)
    if not style:
        return {}
    out = {}
    for role, form in style.items():
        out[role] = form
    return out


# --------------------------------------------------------------------- tagger
def run_tagger(source, work):
    os.makedirs(work, exist_ok=True)
    result = os.path.join(work, "result.json")
    cmd = [
        "node", "--import", RUNTIME_GUARD, TAGGER,
        os.path.abspath(source), os.path.abspath(work), result,
    ]
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout[-2000:] + "\n" + proc.stderr[-2000:] + "\n")
        raise SystemExit(f"tagger failed for {source}")
    with open(result, encoding="utf-8") as fh:
        meta = json.load(fh)
    return meta["raw_pos_path"], meta


# ------------------------------------------------------------------- parsing
COMBINING = set(range(0x102B, 0x103F)) | {0x1036, 0x1037, 0x1038, 0x1039, 0x103A}


def canon(text):
    """Sort adjacent Myanmar combining marks within each cluster.

    The segmentor emits a cluster's marks in its own canonical order, which
    for U+103A/U+1037 differs from the order in a hand-written file. Same
    characters, same length, different adjacency - so raw comparison reports
    a divergence at every such cluster. Ordering both sides identically makes
    the token stream and the source align exactly (verified: ch0194 11549
    chars, ch0195 9588 chars, identical after canon)."""
    out, i = [], 0
    while i < len(text):
        j = i
        while j < len(text) and ord(text[j]) in COMBINING:
            j += 1
        if j > i:
            out.append("".join(sorted(text[i:j], key=ord)))
        else:
            out.append(text[i])
            j = i + 1
        i = j
    return "".join(out)


def canon_with_spans(surfaces):
    """Canonicalise a token stream and return each token's start offset.

    canon() must be applied to the WHOLE stream, not per token: a combining
    mark at the start of one token can belong to the cluster that ends the
    previous token, so per-token canonicalisation drifts. Here every character
    remembers which token it came from, clusters are sorted with the character
    and its token id moving together, and each token's canon offset is then
    known exactly - no searching, no drift."""
    chars = []
    for ti, surface in enumerate(surfaces):
        chars.extend((ch, ti) for ch in surface)
    out, i = [], 0
    while i < len(chars):
        j = i
        while j < len(chars) and ord(chars[j][0]) in COMBINING:
            j += 1
        out.extend(sorted(chars[i:j], key=lambda p: ord(p[0])) if j > i
                   else [chars[i]])
        i = j if j > i else i + 1
    starts = {}
    for pos, (_, ti) in enumerate(out):
        starts.setdefault(ti, pos)
    return "".join(c for c, _ in out), starts


def parse_raw_pos(path):
    """-> flat ordered list of (surface, tags:set, is_eos) for the whole file.

    raw_pos is one line per OUTPUT UNIT, not per source line, so line numbers
    in that file cannot be used to place a token. Everything is flattened and
    aligned by character offset instead."""
    toks = []
    with open(path, encoding="utf-8") as fh:
        for raw in fh.read().split("\n"):
            for chunk in raw.split():
                if not chunk:
                    continue
                eos = chunk.endswith("<eos>")
                body = chunk[:-5] if eos else chunk
                m = TOKEN_RE.match(body)
                toks.append(((m.group(1) if m else body),
                             set(m.group(2).split(",")) if m else set(), eos))
    return toks


def index_blocks(text):
    """line number (0-based) -> block index; blocks are blank-line separated."""
    blocks, cur = [], -1
    line_of_block = []
    for line in text.split("\n"):
        if line.strip():
            if cur < 0 or not blocks or blocks[-1] is None:
                pass
        blocks.append(None)
    # simple two-pass: assign a new block id whenever a blank line is crossed
    bid, mapping, open_block = -1, [], False
    for line in text.split("\n"):
        if line.strip():
            if not open_block:
                bid += 1
                open_block = True
        else:
            open_block = False
        mapping.append(bid)
    return mapping, bid + 1


def flat_source(text):
    """whitespace-stripped source + map back to original char offsets."""
    flat, index = [], []
    for i, ch in enumerate(text):
        if ch.isspace():
            continue
        flat.append(ch)
        index.append(i)
    return "".join(flat), index


# ------------------------------------------------------------------ classify
def classify_block(block_text, tokens_in_block):
    """Register for the UNQUOTED text of a block, plus the reason."""
    if any(block_text.startswith(p) or f" {p}" in block_text for p in FIRST_PERSON):
        return "LSN", "unquoted first-person inner monologue"
    surfaces = {s for _, _, s, _, _ in tokens_in_block}
    hit = sorted(surfaces & COLLOQUIAL_TOKENS)
    if hit:
        return "LSN", "colloquial token(s): " + ", ".join(hit)
    return "LSE", "default prose"


# -------------------------------------------------------------------- report
def audit(source, raw_pos_path=None, work=None):
    text = open(source, encoding="utf-8").read()
    meta = {}
    if raw_pos_path is None:
        if work is None:
            work = tempfile.mkdtemp(prefix="register-")
        raw_pos_path, meta = run_tagger(source, work)

    rows, _ = load_master()
    toks = parse_raw_pos(raw_pos_path)
    flat, flat_to_src = flat_source(text)
    cflat = canon(flat)
    ctoks, tok_start = canon_with_spans([t[0] for t in toks])
    aligned = cflat == ctoks

    src_lines = text.split("\n")
    # char offset -> line number
    line_starts = [0]
    for i, ch in enumerate(text):
        if ch == "\n":
            line_starts.append(i + 1)

    def line_of(pos):
        lo, hi = 0, len(line_starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if line_starts[mid] <= pos:
                lo = mid
            else:
                hi = mid - 1
        return lo

    line_block, nblocks = index_blocks(text)

    # Walk tokens in document order, placing each at its source offset.
    placed = []          # (srcpos, line, block, surface, tags)
    for ti, (surface, tags, _) in enumerate(toks):
        idx = tok_start.get(ti, 0)
        srcpos = flat_to_src[idx] if idx < len(flat_to_src) else len(text) - 1
        ln = line_of(srcpos)
        bid = line_block[ln] if ln < len(line_block) else 0
        placed.append((srcpos, ln, bid, surface, tags))

    by_block = defaultdict(list)
    for item in placed:
        by_block[item[2]].append(item)

    findings, per_block = [], []
    block_reg = {}
    for bid in sorted(by_block):
        items = by_block[bid]
        btext = "\n".join(src_lines[items[0][1]:items[-1][1] + 1])
        block_reg[bid] = classify_block(btext, items)

    # Quote state is tracked cumulatively across the whole document. Toggling
    # per paragraph misclassifies multi-line dialogue and mixed blocks such as
    #   “...” ယဲ့နင်က ပြောသည်။
    # whose quoted half is LSN while the narration tail stays LSE.
    in_quote = False
    for bid in sorted(by_block):
        items = by_block[bid]
        unq_reg, unq_why = block_reg[bid]
        wibat = quoted_here = 0
        for srcpos, ln, _, surface, tags in items:
            if surface in ("\u201c", "\u201d"):
                in_quote = surface == "\u201c"
                quoted_here += 1
                continue
            if "w" not in tags:
                continue
            wibat += 1
            reg = "LSN" if in_quote else unq_reg
            why = "inside quote marks" if in_quote else unq_why
            col = srcpos - line_starts[ln]
            base = {"line": ln + 1, "col": col + 1, "surface": surface,
                    "block": bid, "block_register": reg, "reason": why}
            row = rows.get(surface)
            if row is None:
                findings.append({**base, "native": None,
                                 "verdict": "not in resolution.single",
                                 "action": None})
                continue
            native = row["native"]
            if native is None:
                verdict, action = "no declared register", None
            elif native == reg:
                verdict, action = "matches", None
            else:
                verdict = f"form is native {native}, context is {reg}"
                action = target_forms(row, reg) or None
            findings.append({
                **base, "native": native, "native_role": row["native_role"],
                "roles": row["roles"], "verdict": verdict, "action": action,
                "context": src_lines[ln][max(0, col - 22):col + len(surface) + 22],
            })
        per_block.append({
            "block": bid, "lines": [items[0][1] + 1, items[-1][1] + 1],
            "register": unq_reg, "reason": unq_why,
            "quote_marks": quoted_here, "wibat_count": wibat,
            "text": " ".join("\n".join(src_lines[items[0][1]:items[-1][1] + 1]).split())[:160],
        })

    return {
        "source": source,
        "raw_pos": raw_pos_path,
        "master": MASTER,
        "tagger_meta": meta,
        "token_stream_aligned": aligned,
        "tokens": len(toks),
        "blocks": nblocks,
        "block_report": per_block,
        "findings": findings,
    }


def summarise(rep):
    f = rep["findings"]
    print(f"\n{rep['source']}")
    print(f"  blocks {rep['blocks']}   wibat tokens {len(f)}")
    regs = Counter(b["register"] for b in rep["block_report"])
    print("  block register: " + "  ".join(f"{k}={v}" for k, v in sorted(regs.items())))
    print(f"  {'marker':<10}{'native':<7}{'LSE blk':>8}{'LSN blk':>8}{'mismatch':>10}")
    tally = defaultdict(lambda: Counter())
    for x in f:
        t = tally[x["surface"]]
        t[x["block_register"]] += 1
        if x["native"] and x["native"] != x["block_register"]:
            t["mismatch"] += 1
    for surface in sorted(tally, key=lambda s: -sum(tally[s].values())):
        t = tally[surface]
        row = next((r for r in f if r["surface"] == surface), {})
        print(f"  {surface:<10}{str(row.get('native')):<7}"
              f"{t['LSE']:>8}{t['LSN']:>8}{t['mismatch']:>10}")


def print_mismatches(rep, limit=None):
    bad = [x for x in rep["findings"]
           if x["native"] and x["native"] != x["block_register"]]
    print(f"\n-- {len(bad)} register mismatches in {rep['source']}")
    print("   These are CANDIDATES, not verdicts. The segmentor tags a bare")
    print("   က inside ကမ္ဘာ and တကယ့်, and တိုင်း inside နေရာတိုင်း, as if")
    print("   they were particles. Read the context line before changing")
    print("   anything, and check the surface against the original string.")
    print("   Also note the roles column: က can be ကတ္တား, ထွက်ခွာရာပြ,")
    print("   နေရာပြ or အချိန်ပြ, and each role takes a different LSE form,")
    print("   so only the role you actually mean decides the replacement.")
    for x in bad[:limit] if limit else bad:
        alt = x["action"] or {}
        opts = "; ".join(f"{k}->{v}" for k, v in list(alt.items())[:3]) or "-"
        print(f"  L{x['line']}:{x['col']}  {x['surface']:<8} "
              f"native={x['native']:<4} block={x['block_register']:<4} "
              f"roles={','.join(x['roles']) or '-'}")
        print(f"        {x['context']}")
        print(f"        resolution.single[{x['block_register']}]: {opts}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sources", nargs="+", help="Burmese .txt file(s)")
    ap.add_argument("--work", help="tagger work dir (default: a temp dir)")
    ap.add_argument("--raw-pos", help="reuse an existing raw_pos file "
                                      "(skips the tagger; one source only)")
    ap.add_argument("--json", help="write the full report as JSON")
    ap.add_argument("--summary", action="store_true",
                    help="marker tally only, no per-token listing")
    ap.add_argument("--mismatches", action="store_true",
                    help="list only the register mismatches")
    ap.add_argument("--limit", type=int, help="cap the mismatch listing")
    args = ap.parse_args()

    if args.raw_pos and len(args.sources) != 1:
        raise SystemExit("--raw-pos works with exactly one source")

    allreps = []
    for src in args.sources:
        work = args.work
        if work and len(args.sources) > 1:
            work = os.path.join(args.work, os.path.basename(src) + ".work")
        rep = audit(src, raw_pos_path=args.raw_pos, work=work)
        allreps.append(rep)
        if args.summary:
            summarise(rep)
        elif args.mismatches:
            print_mismatches(rep, args.limit)
        else:
            summarise(rep)
            print_mismatches(rep, args.limit)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(allreps if len(allreps) > 1 else allreps[0], fh,
                      ensure_ascii=False, indent=2)
        print(f"\nwrote {args.json}")


if __name__ == "__main__":
    main()