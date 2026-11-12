"""Regression tests for the standalone SVG line slicers and page exporter."""
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SVGOUT = ROOT / "svgout"
XLINK = "{http://www.w3.org/1999/xlink}href"

# The duplicate occurrences are deliberately byte-for-byte identical. The other
# cases include an empty outline, a very small outline, an unassigned glyph,
# an unassigned space, transformed and vertical uses, and an image reference.
PAGE = '''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="120" height="120" viewBox="0 0 120 120">
<defs><path id="glyph" d="M0 0L0.5 0L0.5 0.7Z"/><path id="space" d=""/><path id="tiny" d="M0 0L0.0001 0L0.0001 0.0001Z"/><clipPath id="clip"><rect x="80" y="70" width="10" height="10"/></clipPath></defs>
<g fill="#334455"><use xlink:href="#glyph" transform="matrix(10,0,0,-10,5,20)"/><use xlink:href="#glyph" transform="matrix(10,0,0,-10,5,20)"/><use xlink:href="#tiny" transform="matrix(10,0,0,-10,15,20)"/><use xlink:href="#space" transform="matrix(10,0,0,-10,20,20)"/></g>
<g transform="matrix(1,0,0,1,30,40)" inkscape:label="parent"><use xlink:href="#glyph" transform="matrix(10,0,0,-10,5,10)" data-kind="transformed"/></g>
<use xlink:href="#glyph" transform="matrix(10,0,0,-10,5,80)" data-kind="unmatched"/>
<use xlink:href="#space" transform="matrix(10,0,0,-10,5,98)" data-kind="unmatched-space"/>
<use xlink:href="#glyph" transform="translate(25,95)" data-kind="unsupported-transform"/>
<use xlink:href="#glyph" transform="matrix(0,10,10,0,100,30)" data-kind="vertical"/>
<g clip-path="url(#clip)"><g transform="matrix(1,0,0,1,80,70)"><use xlink:href="#image" x="0" y="0" width="10" height="10" data-kind="image"/></g></g>
<g transform="matrix(1,0,0,1,40,40)"><image id="image" width="1" height="1" xlink:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII="/></g>
</svg>'''


def use_signatures(xml):
    root = ET.fromstring(xml)
    return Counter(tuple(sorted(elem.attrib.items())) for elem in root.iter()
                   if elem.tag.rsplit("}", 1)[-1] == "use")


def use_contexts(xml):
    root = ET.fromstring(xml)
    found = []

    def visit(elem, parents):
        if elem.tag.rsplit("}", 1)[-1] == "use":
            context = tuple(tuple(sorted(p.attrib.items())) for p in parents
                            if p.tag.rsplit("}", 1)[-1] == "g"
                            and p.get("data-source-uses") != "true"
                            and (p.get("transform") or p.get("clip-path")))
            found.append((tuple(sorted(elem.attrib.items())), context))
        for child in elem:
            visit(child, parents + (elem,))

    visit(root, ())
    return Counter(found)


@unittest.skipUnless(shutil.which("node") and (SVGOUT / "make-line.js").is_file(), "JS SVG reference is not available")
class SvgFramePreservationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cwd = Path(self.tmp.name)
        (self.cwd / "svgout" / "known").mkdir(parents=True)
        self.page = self.cwd / "page.svg"
        self.page.write_text(PAGE, encoding="utf-8")
        self.lines = self.page.with_suffix(".lines.json")
        self.lines.write_text(json.dumps({"width": 120, "height": 120,
                                          "coordinates": "svg-page",
                                          "lines": [[5, 20, 10, "first"],
                                                    [35, 50, 10, "second"]]}),
                              encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def run_pair(self, selection=""):
        results = []
        outputs = []
        for runner, executable, suffix in (("make-line.js", "node", ".js"),
                                            ("make_line.py", sys.executable, ".py")):
            cmd = [executable, str(SVGOUT / runner), str(self.page), "1", suffix, selection]
            result = subprocess.run(cmd, cwd=self.cwd, capture_output=True, text=True)
            results.append(result)
            if result.returncode == 0:
                outputs.append(tuple((self.cwd / "svgout" / "known" /
                                      f"{name}{suffix}.svg").read_bytes()
                                     for name in ("line-sample", "frame-sheet")))
        return results, outputs

    def test_full_sheet_preserves_every_use_and_its_context(self):
        results, outputs = self.run_pair()
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("retained", result.stderr.lower())
        self.assertEqual(outputs[0], outputs[1])
        sheet = outputs[0][1]
        self.assertEqual(use_signatures(PAGE), use_signatures(sheet))
        self.assertEqual(use_contexts(PAGE), use_contexts(sheet))
        root = ET.fromstring(sheet)
        self.assertEqual(root.get("data-lines"), "3")
        self.assertEqual(len([e for e in root.iter() if e.tag.endswith("}image")
                              and e.get("id") == "image"]), 1)
        viewbox = [float(n) for n in root.get("viewBox").split()]
        self.assertLessEqual(viewbox[1], 0)
        self.assertGreaterEqual(viewbox[1] + viewbox[3], 120)

    def test_selected_lines_are_intentional_subsets(self):
        results, outputs = self.run_pair("1")
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(outputs[0], outputs[1])
        uses = [e for e in ET.fromstring(outputs[0][1]).iter() if e.tag.endswith("}use")]
        self.assertEqual(len(uses), 4)  # both repeats, the tiny glyph, and the space
        self.assertEqual(sum(e.get(XLINK) == "#glyph" for e in uses), 2)

        results, outputs = self.run_pair("2")
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(outputs[0], outputs[1])
        uses = [e for e in ET.fromstring(outputs[0][1]).iter() if e.tag.endswith("}use")]
        self.assertEqual([e.get("data-kind") for e in uses], ["transformed"])

    def test_selecting_every_line_also_retains_unframed_uses(self):
        results, outputs = self.run_pair("1-3")
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(use_signatures(PAGE), use_signatures(outputs[0][1]))

    def test_missing_or_empty_line_metadata_does_not_drop_uses(self):
        for empty in (False, True):
            if empty:
                self.lines.write_text('{"coordinates": "svg-page", "lines": []}', encoding="utf-8")
            else:
                self.lines.unlink()
            results, outputs = self.run_pair()
            for result in results:
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("falling back", result.stderr.lower())
            self.assertEqual(outputs[0], outputs[1])
            self.assertEqual(use_signatures(PAGE), use_signatures(outputs[0][1]))

    def test_old_unrotated_metadata_is_not_treated_as_svg_coordinates(self):
        self.lines.write_text('{"lines": [[5, 20, 10, "old"]]}', encoding="utf-8")
        results, outputs = self.run_pair()
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("unverified coordinates", result.stderr.lower())
            self.assertIn("re-export", result.stderr.lower())
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(use_signatures(PAGE), use_signatures(outputs[0][1]))

    def test_unknown_local_reference_fails_instead_of_emitting_a_lossy_sheet(self):
        self.page.write_text(PAGE.replace('xlink:href="#image" x="0"',
                                          'xlink:href="#missing" x="0"'),
                             encoding="utf-8")
        results, outputs = self.run_pair()
        self.assertFalse(outputs)
        for result in results:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("missing", result.stderr.lower())

    def test_stroked_uses_keep_the_page_viewport_in_selected_outputs(self):
        page = '''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" viewBox="0 0 100 100">
<defs><path id="g" d="M0 0L1 0L1 1Z"/></defs>
<g stroke="#ff0000" stroke-width="5"><use xlink:href="#g" transform="matrix(10,0,0,-10,20,20)"/></g>
</svg>'''
        self.page.write_text(page, encoding="utf-8")
        self.lines.write_text(json.dumps({"coordinates": "svg-page",
                                          "lines": [[20, 20, 10, "x"]]}), encoding="utf-8")
        results, outputs = self.run_pair("1")
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("avoid clipping", result.stderr.lower())
            self.assertIn("not assessed for strokes", result.stdout.lower())
        self.assertEqual(outputs[0], outputs[1])
        for svg in outputs[0]:
            self.assertEqual(use_signatures(page), use_signatures(svg))
            box = [float(v) for v in ET.fromstring(svg).get("viewBox").split()]
            self.assertLessEqual(box[1], 0)
            self.assertGreaterEqual(box[1] + box[3], 100)

    def test_css_transformed_use_is_retained_unframed_not_misassigned(self):
        text = PAGE.replace('data-kind="transformed"',
                            'style="transform:translate(0px,20px)" data-kind="transformed"', 1)
        self.page.write_text(text, encoding="utf-8")
        results, outputs = self.run_pair()
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("retained", result.stderr.lower())
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(use_signatures(text), use_signatures(outputs[0][1]))
        results, outputs = self.run_pair("2")
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(outputs[0], outputs[1])
        selected = [e for e in ET.fromstring(outputs[0][1]).iter() if e.tag.endswith("}use")]
        self.assertFalse(any(e.get("data-kind") == "transformed" for e in selected))

    def test_uses_inside_definitions_and_their_body_reference_are_preserved(self):
        definition = ('<g id="combo" opacity="0.5">'
                      '<use xlink:href="#glyph" transform="matrix(1,0,0,1,0,0)"/>'
                      '</g></defs>')
        text = PAGE.replace('</defs>', definition, 1).replace(
            '</svg>', '<use xlink:href="#combo" transform="matrix(10,0,0,10,10,90)"/></svg>', 1)
        self.page.write_text(text, encoding="utf-8")
        results, outputs = self.run_pair()
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(use_signatures(text), use_signatures(outputs[0][1]))

    def test_external_use_references_fail_instead_of_changing_their_base_url(self):
        text = PAGE.replace('xlink:href="#image" x="0"',
                            'xlink:href="other.svg#image" x="0"', 1)
        self.page.write_text(text, encoding="utf-8")
        results, outputs = self.run_pair()
        self.assertFalse(outputs)
        for result in results:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("external svg use reference", result.stderr.lower())

    def test_unhandled_or_malformed_use_syntax_fails_explicitly(self):
        prefixed = PAGE.replace('xmlns:inkscape=',
                                'xmlns:svg="http://www.w3.org/2000/svg" xmlns:inkscape=', 1)
        prefixed = prefixed.replace('<use xlink:href="#glyph"',
                                    '<svg:use xlink:href="#glyph"', 1)
        first = '<use xlink:href="#glyph" transform="matrix(10,0,0,-10,5,20)"/>'
        malformed = PAGE.replace(first, first[:-2], 1)
        for text, message in ((prefixed, "namespaced"), (malformed, "malformed")):
            self.page.write_text(text, encoding="utf-8")
            results, outputs = self.run_pair()
            self.assertFalse(outputs)
            for result in results:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr.lower())

    def test_ambiguous_duplicate_definition_ids_fail_without_a_sheet(self):
        text = PAGE.replace('<defs>', '<defs><path id="glyph" d="M0 0"/>', 1)
        self.page.write_text(text, encoding="utf-8")
        results, outputs = self.run_pair()
        self.assertFalse(outputs)
        for result in results:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("duplicate svg id", result.stderr.lower())

    def test_unmeasurable_or_malformed_glyph_path_fails_without_a_sheet(self):
        old = 'd="M0 0L0.5 0L0.5 0.7Z"'
        for replacement, message in (('d="M0 0A2 2 0 1 1 1 0"', "unsupported glyph path"),
                                     ('d="M0 0L0.5"', "truncated command")):
            self.page.write_text(PAGE.replace(old, replacement, 1), encoding="utf-8")
            results, outputs = self.run_pair()
            self.assertFalse(outputs)
            for result in results:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(message, result.stderr.lower())

    def test_implicit_lines_after_absolute_and_relative_moves_are_measured(self):
        old = 'd="M0 0L0.5 0L0.5 0.7Z"'
        for path, expected_band in (("M0.5 0.75 0.7 0.5", "0.500"),
                                    ("m0.5 0.75 0.7 0.5", "0.625")):
            self.page.write_text(PAGE.replace(old, f'd="{path}"', 1), encoding="utf-8")
            results, outputs = self.run_pair("1")
            for result in results:
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(outputs[0], outputs[1])
            self.assertEqual(ET.fromstring(outputs[0][1]).get("data-band"), expected_band)

    def test_scientific_notation_in_a_glyph_path_is_measured_in_both_runners(self):
        text = PAGE.replace('d="M0 0L0.5 0L0.5 0.7Z"',
                            'd="M0 0L5e-1 0L5e-1 7e-1Z"', 1)
        self.page.write_text(text, encoding="utf-8")
        results, outputs = self.run_pair()
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(outputs[0], outputs[1])
        self.assertEqual(use_signatures(text), use_signatures(outputs[0][1]))

    def test_page_clip_id_does_not_collide_with_source_definitions(self):
        self.page.write_text(PAGE.replace('<defs>',
                                          '<defs><path id="__svgout_page_clip" d="M0 0"/>', 1),
                             encoding="utf-8")
        results, outputs = self.run_pair()
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(outputs[0], outputs[1])
        root = ET.fromstring(outputs[0][1])
        ids = [e.get("id") for e in root.iter() if e.get("id")]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("__svgout_page_clip_", ids)
        self.assertEqual(use_signatures(self.page.read_text()), use_signatures(outputs[0][1]))

    def test_unhandled_root_geometry_fails_instead_of_repositioning_uses(self):
        self.page.write_text(PAGE.replace('viewBox="0 0 120 120"',
                                          'viewBox="10 0 120 120"'), encoding="utf-8")
        results, outputs = self.run_pair()
        self.assertFalse(outputs)
        for result in results:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("viewbox", result.stderr.lower())

    def test_nonmatching_selection_fails_in_both_runners(self):
        results, outputs = self.run_pair("999")
        self.assertFalse(outputs)
        for result in results:
            self.assertNotEqual(result.returncode, 0)

    def test_parity_check_never_renames_or_overwrites_existing_files(self):
        fixture = self.cwd / "prototype"
        out = fixture / "svgout"
        (out / "known").mkdir(parents=True)
        (fixture / "package.json").write_text('{"type":"module"}', encoding="utf-8")
        for name in ("make-line.js", "make_line.py", "scan-frame.js", "scan_frame.py",
                     "test_frame_parity.py"):
            shutil.copyfile(SVGOUT / name, out / name)
        shutil.copyfile(self.page, out / "page.svg")
        shutil.copyfile(self.lines, out / "page.lines.json")
        parked = out / "page.lines.json.parked"
        parked.write_text("keep parked metadata", encoding="utf-8")
        sentinel = out / "known" / "frame-sheet.1.js.svg"
        sentinel.write_text("keep existing output", encoding="utf-8")
        original_metadata = (out / "page.lines.json").read_bytes()
        cmd = [sys.executable, str(out / "test_frame_parity.py")]
        result = subprocess.run(cmd, cwd=fixture, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("8/8 outputs byte-identical", result.stdout)
        self.assertEqual((out / "page.lines.json").read_bytes(), original_metadata)
        self.assertEqual(parked.read_text(), "keep parked metadata")
        self.assertEqual(sentinel.read_text(), "keep existing output")

        (out / "page.lines.json").write_text('{"lines": []}', encoding="utf-8")
        result = subprocess.run(cmd, cwd=fixture, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unverified coordinates", result.stderr.lower())

        (out / "page.svg").unlink()
        result = subprocess.run(cmd, cwd=fixture, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no page exports", result.stdout)


try:
    import pymupdf
    from PIL import Image  # noqa: F401 -- required by pdf2svg
except ImportError:
    pymupdf = None


@unittest.skipIf(pymupdf is None, "PyMuPDF and Pillow are required for PDF export")
class SvgRotationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("svg_pdf2svg", SVGOUT / "pdf2svg.py")
        cls.exporter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.exporter)

    def test_metadata_baselines_and_x_coordinates_match_rotated_svg(self):
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation), pymupdf.open() as doc:
                page = doc.new_page(width=200, height=300)
                text_rotation = (-rotation) % 360
                origin = {0: (30, 40), 90: (170, 40),
                          180: (170, 250), 270: (30, 250)}[text_rotation]
                page.insert_text(origin, "Test rotation", rotate=text_rotation, fontsize=12)
                page.set_rotation(rotation)
                source_lines = [line for block in page.get_text("dict")["blocks"]
                                for line in block.get("lines", [])]
                self.assertEqual(len(source_lines), 1)
                rows = self.exporter.page_lines(page)
                self.assertEqual(len(rows), 1)
                transformed_rect = pymupdf.Rect(source_lines[0]["bbox"]) * page.rotation_matrix
                self.assertAlmostEqual(rows[0][0], transformed_rect.x0, delta=0.01)
                svg = page.get_svg_image(matrix=pymupdf.Matrix(1, 1), text_as_path=True)
                matrices = re.findall(r'transform="matrix\(([^)]+)\)"', svg)
                self.assertTrue(matrices)
                for matrix in matrices:
                    self.assertAlmostEqual(rows[0][1], float(matrix.split(",")[-1]), delta=0.02)

    @unittest.skipUnless(shutil.which("node") and (SVGOUT / "make-line.js").is_file(), "JS SVG reference is not available")
    def test_rotated_pdf_through_both_slicers_keeps_all_uses_on_the_line(self):
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation), tempfile.TemporaryDirectory() as tmp, pymupdf.open() as doc:
                page = doc.new_page(width=200, height=300)
                text_rotation = (-rotation) % 360
                origin = {0: (30, 40), 90: (170, 40),
                          180: (170, 250), 270: (30, 250)}[text_rotation]
                page.insert_text(origin, "Test rotation", rotate=text_rotation, fontsize=12)
                page.set_rotation(rotation)
                svg = page.get_svg_image(matrix=pymupdf.Matrix(1, 1), text_as_path=True)
                work = Path(tmp)
                (work / "svgout" / "known").mkdir(parents=True)
                src = work / "page.svg"
                src.write_text(svg, encoding="utf-8")
                src.with_suffix(".lines.json").write_text(json.dumps({
                    "coordinates": "svg-page", "rotation": rotation,
                    "lines": self.exporter.page_lines(page),
                }), encoding="utf-8")
                outputs = []
                for runner, executable, suffix in (("make-line.js", "node", ".js"),
                                                    ("make_line.py", sys.executable, ".py")):
                    result = subprocess.run([executable, str(SVGOUT / runner), str(src), "1", suffix],
                                            cwd=work, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    line = (work / "svgout" / "known" / f"line-sample{suffix}.svg").read_bytes()
                    sheet = (work / "svgout" / "known" / f"frame-sheet{suffix}.svg").read_bytes()
                    self.assertEqual(use_signatures(svg), use_signatures(sheet))
                    self.assertEqual(use_signatures(svg), use_signatures(line))
                    self.assertEqual(ET.fromstring(sheet).get("data-lines"), "1")
                    outputs.append((line, sheet))
                self.assertEqual(outputs[0], outputs[1])

    def test_cropped_page_origins_match_svg_after_rotation(self):
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation), pymupdf.open() as doc:
                page = doc.new_page(width=300, height=400)
                page.insert_text((100, 150), "Cropped text", fontsize=12)
                page.set_cropbox(pymupdf.Rect(50, 60, 260, 370))
                page.set_rotation(rotation)
                rows = self.exporter.page_lines(page)
                svg = page.get_svg_image(matrix=pymupdf.Matrix(1, 1), text_as_path=True)
                tag = re.search(r'<use\b[^>]*/>', svg).group(0)
                matrix = re.search(r'transform="matrix\(([^)]+)\)"', tag).group(1)
                origin_y = float(matrix.split(",")[-1])
                self.assertAlmostEqual(rows[0][1], origin_y, delta=0.02)

    def test_one_open_document_can_export_multiple_pages(self):
        with tempfile.TemporaryDirectory() as tmp, pymupdf.open() as doc:
            for text in ("one", "two"):
                doc.new_page(width=200, height=300).insert_text((30, 40), text)
            export = self.exporter
            original = export.OUT, export.PROOF, export.WORK, export.make_proofs
            export.OUT = tmp
            export.PROOF = str(Path(tmp) / "proof")
            export.WORK = str(Path(tmp) / ".work")
            export.make_proofs = lambda *args: None
            try:
                first = export.process(doc, "original.pdf", 1, 36)
                second = export.process(doc, "original.pdf", 2, 36)
                self.assertEqual((first["lines"], second["lines"]), (1, 1))
                metadata = json.loads((Path(tmp) / first["lines_json"]).read_text())
                self.assertEqual(metadata["coordinates"], "svg-page")
                self.assertEqual(metadata["rotation"], 0)
                self.assertEqual(doc.page_count, 2)
            finally:
                export.OUT, export.PROOF, export.WORK, export.make_proofs = original


if __name__ == "__main__":
    unittest.main()
