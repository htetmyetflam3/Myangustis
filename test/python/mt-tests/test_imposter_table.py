"""The imposter table: `ဥ+်` has its partner, and `က္က` is never rewritten bare.

Two regressions are guarded here.

1. The table used to carry `ဣ` <- `က္က`. `cleanImposters()` replaces the whole
   matched span, so every genuine conjunct (`သက္ကတ`, `သိက္ခာ`) became `ဣ`. The
   row had to become the two compounds it was standing in for:
   `က္က+န္ဒြေ` -> `ဣ+န္ဒြေ` and `က္က+န္ဒြာ` -> `ဣ+န္ဒြာ`.

2. `ဥ`/`ဉ` are siblings: each `ဥ` form in the table carries a `ဉ` imposter
   (`ဥုံ` <- `ဉုံ`, `ဥမ်` <- `ဉမ်`). `ဥ်` was the one missing its partner, so
   `ဥ်` never became `ဉ်`.

The table is read as data: the table is what the WASM payload inlines, and
`scraper/wasm/box/tools/verify-payload.mjs` proves the binary carries it.
"""
import json
import subprocess
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ROOT = REPO / "Proofreading" / "main"
MASTER_ENC = REPO / "master.json.enc"
SECURE_JS = REPO / "secure.js"


def _load_master():
    # Node door into repo-root secure.js: it owns the .env key and the sealed
    # cache; Python never holds the key or writes a readable copy.
    script = ("import {readMasterJson} from %s;"
              "process.stdout.write(JSON.stringify(readMasterJson()));"
              % json.dumps(str(SECURE_JS)))
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, check=True, text=True).stdout
    return json.loads(out)

# Every `ဥ` unit and the `ဉ` spelling it has to absorb.
U_SIBLINGS = {"ဥုံ": "ဉုံ", "ဥမ်": "ဉမ်", "ဉ်": "ဥ်"}


class ImposterTable(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        master = _load_master()
        cls.imposter = master["mapData"]["IMPOSTER"]

    def test_bare_katka_no_longer_rewrites_real_conjuncts(self):
        for correct, entry in self.imposter.items():
            self.assertNotIn(
                "က္က",
                entry["imposters"],
                f"{correct!r} still rewrites every bare က္က",
            )

    def test_katka_compounds_carry_their_own_rows(self):
        self.assertEqual(self.imposter["ဣန္ဒြေ"]["imposters"], ["က္ကန္ဒြေ"])
        self.assertEqual(self.imposter["ဣန္ဒြာ"]["imposters"], ["က္ကန္ဒြာ"])
        self.assertEqual(self.imposter["ဣန္ဒြေ"]["correct"], "ဣန္ဒြေ")
        self.assertEqual(self.imposter["ဣန္ဒြာ"]["correct"], "ဣန္ဒြာ")

    def test_every_u_sibling_has_its_imposter(self):
        for correct, imposter in U_SIBLINGS.items():
            self.assertIn(correct, self.imposter, f"missing {correct!r} row")
            self.assertEqual(self.imposter[correct]["correct"], correct)
            self.assertIn(
                imposter,
                self.imposter[correct]["imposters"],
                f"{correct!r} does not absorb {imposter!r}",
            )

    def test_row_shape_is_honoured(self):
        for correct, entry in self.imposter.items():
            self.assertEqual(set(entry), {"correct", "imposters"}, correct)
            self.assertEqual(entry["correct"], correct)
            self.assertTrue(entry["imposters"], correct)
            for imposter in entry["imposters"]:
                self.assertNotIn(" ", imposter, f"{correct!r} key is not contiguous")


if __name__ == "__main__":
    unittest.main()
