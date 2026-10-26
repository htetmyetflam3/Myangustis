import confetti from "canvas-confetti";
import { onOverlayOpen } from "./overlay.js";
import { detect } from "./detect.js";
import { probeScript } from "./script.js";
import {
  SAMPLE_GRAMMAR_DOC,
  applicableIssues,
} from "./grammar-data.js";
const CHECK_CIRCLE =
  '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-circle-check"></use></svg>';
const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function initGrammarTool() {
  const editor = document.getElementById("grEditor");
  const drop = document.getElementById("grDrop");
  const list = document.getElementById("grIssues");
  const count = document.getElementById("grCount");
  const issueCount = document.getElementById("grIssueCount");
  const fixAll = document.getElementById("grFixAll");
  const status = document.getElementById("grammarStatus");
  const exportLink = document.getElementById("grExport");
  const toast = document.getElementById("grToast");
  const toastText = document.getElementById("grToastText");
  let issues = SAMPLE_GRAMMAR_DOC.issues.slice();
  let toastTimer = 0;
  function showToast(message) {
    toastText.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 2500);
  }
  function renderEditorState() {
    count.textContent = `${editor.value.length} Characters`;
    exportLink.href = `data:text/plain;charset=utf-8,${encodeURIComponent(editor.value)}`;
  }
  function renderIssues() {
    issueCount.textContent = String(issues.length);
    fixAll.style.display = issues.length > 0 ? "" : "none";
    status.lastChild.textContent = issues.length
      ? `${issues.length} sample suggestion${issues.length > 1 ? "s" : ""}`
      : "Sample reviewed";
    if (issues.length === 0) {
      list.innerHTML = `
        <div class="gr-empty">
          <div class="gr-empty-ico">${CHECK_CIRCLE}</div>
          <h4>No sample suggestions remaining</h4>
          <p>No remaining matches were found in this illustrative frontend rule set.</p>
          <button type="button" data-reload>Reload Sample To Test</button>
        </div>`;
      list.querySelector("[data-reload]").addEventListener("click", loadSample);
      return;
    }
    list.innerHTML = issues
      .map(
        (issue) => `
        <div class="gr-issue">
          <div class="gr-issue-top">
            <span class="gr-issue-cat">${issue.ruleCategory}</span>
            <button type="button" class="gr-issue-fix" data-fix="${issue.id}">Apply Fix</button>
          </div>
          <div class="gr-issue-diff">
            <span class="gr-issue-old">${escapeHtml(issue.original)}</span>
            <span class="gr-issue-arrow">→</span>
            <span class="gr-issue-new">${escapeHtml(issue.suggestion)}</span>
          </div>
          <p class="gr-issue-why">${escapeHtml(issue.reason)}</p>
        </div>`
      )
      .join("");
    list.querySelectorAll("[data-fix]").forEach((button) =>
      button.addEventListener("click", () => {
        const issue = issues.find((item) => item.id === button.dataset.fix);
        if (!issue) return;
        editor.value = editor.value.replace(issue.original, issue.suggestion);
        issues = issues.filter((item) => item.id !== issue.id);
        renderEditorState();
        renderIssues();
        showToast(`Fixed: "${issue.original}" → "${issue.suggestion}"`);
      })
    );
  }
  function loadSample() {
    editor.value = SAMPLE_GRAMMAR_DOC.rawText;
    issues = SAMPLE_GRAMMAR_DOC.issues.slice();
    renderEditorState();
    renderIssues();
    showToast("Restored original test document.");
  }
  function loadExtractedText(value, note) {
    editor.value = value;
    issues = applicableIssues(editor.value);
    renderEditorState();
    renderIssues();
    showToast(
      issues.length
        ? `${note} Found ${issues.length} suggestion${issues.length > 1 ? "s" : ""}.`
        : `${note} No sample rule matched this text.`,
    );
  }
  async function processFile(file) {
    showToast(`Parsing "${file.name}"...`);
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf") || lower.endsWith(".docx")) {
      try {
        const detection = await detect(file);
        if (!detection) {
          showToast("Only TXT, PDF, or DOCX files can be loaded here.");
          return;
        }
        const text = detection.text.trim();
        const script = probeScript(text);
        const hasImages = detection.imageBytes > 0 || detection.imagePages > 0;
        const hasText = text.replace(/\s/g, "").length > 0 || detection.textBytes > 0;
        if (script.readable) {
          loadExtractedText(
            text,
            hasImages
              ? "Loaded the readable Burmese text. Image/scan parts are skipped here; use Converter if you need text plus scanned images in one output."
              : "Loaded readable Burmese text from the document.",
          );
          return;
        }
        if (hasImages && !hasText) {
          showToast("This looks like an OCR/scan file. Use Converter for OCR; the grammar analysis panel does not ask manual options.");
          return;
        }
        if (hasImages) {
          showToast("No readable Burmese text was found. This panel skips images; use Converter for mixed text plus scan images.");
          return;
        }
        showToast("No readable Burmese text was found in this document.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "The document could not be parsed in the browser.");
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      window.setTimeout(() => {
        loadExtractedText(
          (typeof event.target?.result === "string" && event.target.result) ||
            "မြန်မာစာ သတ်ပုံ စစ်ဆေးရန် စာသားများ ဖြစ်ပါသည်။",
          "Document uploaded.",
        );
      }, 700);
    };
    reader.readAsText(file);
  }
  editor.value = SAMPLE_GRAMMAR_DOC.rawText;
  renderEditorState();
  renderIssues();
  editor.addEventListener("input", renderEditorState);
  document.getElementById("grLoadSample").addEventListener("click", loadSample);
  fixAll.addEventListener("click", () => {
    let text = editor.value;
    issues.forEach((issue) => {
      text = text.replace(issue.original, issue.suggestion);
    });
    editor.value = text;
    issues = [];
    renderEditorState();
    renderIssues();
    showToast("All Burmese spelling and grammar issues resolved!");
    confetti({ particleCount: 60, spread: 80 });
  });
  drop.addEventListener("dragover", (event) => {
    event.preventDefault();
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragleave", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
  });
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    const [file] = event.dataTransfer.files;
    if (file) void processFile(file);
  });
  document.getElementById("grFile").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) void processFile(file);
    event.target.value = "";
  });
  document.getElementById("grDocFile").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) void processFile(file);
    event.target.value = "";
  });
  document.getElementById("grCopy").addEventListener("click", () => {
    navigator.clipboard.writeText(editor.value);
    showToast("Copied to clipboard!");
  });
  onOverlayOpen("grammar", () => {});
}