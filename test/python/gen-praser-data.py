#!/usr/bin/env python3
"""Regenerate the JSON data files the Node praser needs from the Python source.

Keeps the JS port honest: the Rabbit rule table and the cleanup imposter/priority
sets are READ FROM the Python modules, never retyped. Run from the repo root:

    python3 .bin/gen-praser-data.mjs
"""
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY_MOD = os.path.join(REPO, "R_Site", "Praser", "Python", "module")
NODE_MOD = os.path.join(REPO, "R_Site", "Praser", "Node", "module")
NODE_MODEL = os.path.join(NODE_MOD, "model")

# The extraction is done in a child python so sys.path stays clean.
PROBE = r"""
import json, sys
sys.path.insert(0, sys.argv[1])
from rabbit import Rabbit
import cleanup
out = {
    "rules": [{"from": r["from"], "to": r["to"]} for r in Rabbit._RULES],
    "reps": cleanup._IMPOSTER_REPS,
    "priority": cleanup._PRIORITY,
    "consonants": sorted(cleanup._MYA_CONSONANTS),
}
sys.stdout.write(json.dumps(out, ensure_ascii=False))
"""

os.makedirs(NODE_MODEL, exist_ok=True)
blob = subprocess.run(
    [sys.executable, "-c", PROBE, PY_MOD], capture_output=True, check=True
).stdout
data = json.loads(blob.decode("utf-8"))

with open(os.path.join(NODE_MODEL, "zg2uni-rules.json"), "w", encoding="utf-8") as f:
    json.dump(data["rules"], f, ensure_ascii=False)

with open(os.path.join(NODE_MODEL, "normalize.json"), "w", encoding="utf-8") as f:
    json.dump(
        {
            "reps": data["reps"],
            "priority": data["priority"],
            "consonants": data["consonants"],
        },
        f,
        ensure_ascii=False,
    )

for name in ("cipher-map.json", "zawgyiUnicodeModel.dat"):
    src = os.path.join(PY_MOD, "model", name)
    with open(src, "rb") as fin, open(os.path.join(NODE_MODEL, name), "wb") as fout:
        fout.write(fin.read())

print(f"[+] {len(data['rules'])} zg2uni rules")
print(f"[+] {len(data['reps'])} imposter reps, {len(data['priority'])} priorities")
print(f"[+] model + cipher map copied to {NODE_MODEL}")
