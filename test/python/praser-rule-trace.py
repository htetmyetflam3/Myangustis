#!/usr/bin/env python3
"""Which Rabbit rule fires on a given string, in order — the trace the engine never shows.

    python3 .bin/praser-rule-trace.py "အာရဗ ၻ"
    python3 .bin/praser-rule-trace.py            # defaults to the misc.spec case

It walks `Rabbit._COMPILED` exactly as `Rabbit.zg2uni` does (`re.sub` per rule, table
order, each rule seeing the previous one's output) and prints every rule that CHANGED
the text, so "no rule touched this" and "a rule fired but the result is wrong" are two
different, visible answers. Rules that match nothing are counted, not printed.
"""
import sys

sys.path.insert(0, "R_Site/Praser/Python")
from module.rabbit import Rabbit  # noqa: E402

CASE = "\u1021\u102c\u101b\u1017\u0020\u107b"   # အာရဗ + space + Zawgyi U+107B (kinzi BA)


def cps(s):
    return " ".join(f"U+{ord(c):04X}" for c in s)


def main():
    text = sys.argv[1] if len(sys.argv) > 1 else CASE
    print(f"input   {text!r}\n        {cps(text)}\n")
    out = text
    fired, silent = [], 0
    for i, (rx, to) in enumerate(Rabbit._COMPILED):
        nxt = rx.sub(to, out)
        if nxt != out:
            fired.append((i, rx.pattern, to, out, nxt))
            out = nxt
        else:
            silent += 1
    for i, pat, to, before, after in fired:
        print(f"[rule {i}]  {pat!r} -> {to!r}")
        print(f"   before {before!r}")
        print(f"   after  {after!r}")
        print(f"   cps    {cps(after)}")
    print(f"\n{len(fired)} of {len(Rabbit._COMPILED)} rules fired ({silent} matched nothing)")
    print(f"result  {out!r}\n        {cps(out)}")
    print(f"engine  {Rabbit.zg2uni(text)!r}  "
          f"{'trace == Rabbit.zg2uni' if out == Rabbit.zg2uni(text) else 'TRACE DIFFERS FROM ENGINE'}")


if __name__ == "__main__":
    main()
