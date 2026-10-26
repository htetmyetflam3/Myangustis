import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideForCaller,
  isLegacyFontPath,
  isVectorLayoutPath,
  normalizeCaller,
} from "../../../Parser/extend/caller-policy.mjs";

test("site caller parses every measured path, including old fonts", () => {
  for (const encodingPath of ["unicode", "zawcode", "wininnwa", "ayar", "SomeVectorFont"]) {
    assert.equal(decideForCaller("site", { encodingPath, lane: "extract" }).action, "parse");
  }
});

test("scraper parses only Unicode and ZawCode in the extract lane", () => {
  assert.equal(decideForCaller("scraper", { encodingPath: "unicode", lane: "extract" }).action, "parse");
  assert.equal(decideForCaller("scraper", { encodingPath: "zawcode", lane: "extract" }).action, "parse");
});

test("scraper skips every old-font layout with the contract reason", () => {
  for (const encodingPath of ["wininnwa", "ayar", "WinInnwaFont", "AyarEmbed"]) {
    const d = decideForCaller("scraper", { encodingPath, lane: "extract" });
    assert.equal(d.action, "skip");
    assert.equal(d.reason, "legacy-font-not-convertible");
    assert.equal(d.encodingPath, encodingPath);
    assert.equal(d.caller, "scraper");
  }
});

test("scraper always allows the OCR lane, even for a legacy verdict", () => {
  const d = decideForCaller("scraper", { encodingPath: "wininnwa", lane: "ocr" });
  assert.equal(d.action, "parse");
  assert.equal(d.reason, "ocr-lane");
});

test("missing verdict fails open to parsing rather than dropping a document", () => {
  const d = decideForCaller("scraper", { encodingPath: null, lane: "extract" });
  assert.equal(d.action, "parse");
  assert.match(d.reason, /fail-open/);
});

test("unknown caller defaults to the site (full-access) policy", () => {
  assert.equal(normalizeCaller(undefined), "site");
  assert.equal(normalizeCaller("nope"), "site");
  assert.equal(decideForCaller("mystery", { encodingPath: "ayar" }).action, "parse");
});

test("path guards: named tables vs font-named vector layouts", () => {
  assert.equal(isVectorLayoutPath("AyarEmbeddedFont"), true);
  assert.equal(isVectorLayoutPath("unicode"), false);
  assert.equal(isLegacyFontPath("wininnwa"), true);
  assert.equal(isLegacyFontPath("ayar"), true);
  assert.equal(isLegacyFontPath("SomeFont"), true);
  assert.equal(isLegacyFontPath("unicode"), false);
  assert.equal(isLegacyFontPath("zawcode"), false);
  assert.equal(isLegacyFontPath(null), false);
});
