import React, { useRef, useState } from 'react';
import {
  Upload,
  FileUp,
  CheckCircle2,
  Copy,
  Download,
  Wand2,
  AlertTriangle,
  BookOpen
} from 'lucide-react';
import { ToolShell } from './ToolShell';
import { SAMPLE_GRAMMAR_DOC, applicableIssues, GrammarIssue } from '../data/mockData';
import { detect } from '../lib/detect';
import { probeScript } from '../lib/script';
import confetti from 'canvas-confetti';

interface GrammarToolSectionProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GrammarToolSection: React.FC<GrammarToolSectionProps> = ({ isOpen, onClose }) => {
  const [editorText, setEditorText] = useState(SAMPLE_GRAMMAR_DOC.rawText);
  const [activeIssueIndex, setActiveIssueIndex] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [issuesList, setIssuesList] = useState<GrammarIssue[]>(SAMPLE_GRAMMAR_DOC.issues);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const analysisInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleFixSingle = (issue: GrammarIssue) => {
    const newText = editorText.replace(issue.original, issue.suggestion);
    setEditorText(newText);
    setIssuesList(issuesList.filter(item => item.id !== issue.id));
    showToast(`Fixed: "${issue.original}" → "${issue.suggestion}"`);
  };

  const handleFixAll = () => {
    let text = editorText;
    issuesList.forEach(iss => {
      text = text.replace(iss.original, iss.suggestion);
    });
    setEditorText(text);
    setIssuesList([]);
    showToast("All Burmese spelling and grammar issues resolved!");
    confetti({ particleCount: 60, spread: 80 });
  };

  const handleResetSample = () => {
    setEditorText(SAMPLE_GRAMMAR_DOC.rawText);
    setIssuesList(SAMPLE_GRAMMAR_DOC.issues);
    showToast("Restored original test document.");
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      void handleFileProcess(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleFileProcess(e.target.files[0]);
      e.target.value = "";
    }
  };

  const loadExtractedText = (content: string, note: string) => {
    setEditorText(content);
    const found = applicableIssues(content);
    setIssuesList(found);
    showToast(
      found.length
        ? `${note} Found ${found.length} suggestion${found.length > 1 ? "s" : ""}.`
        : `${note} No sample rule matched this text.`,
    );
  };

  const handleFileProcess = async (file: File) => {
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
        const content = event.target?.result as string || "မြန်မာစာ သတ်ပုံ စစ်ဆေးရန် စာသားများ ဖြစ်ပါသည်။";
        loadExtractedText(content, "Document uploaded.");
      }, 700);
    };
    reader.readAsText(file);
  };

  const issueCount = issuesList.length;

  return (
    <ToolShell
      open={isOpen}
      onClose={onClose}
      file="burmese_rule_review.demo"
      status={issueCount ? `${issueCount} sample suggestion${issueCount > 1 ? 's' : ''}` : 'Sample reviewed'}
      eyebrow="spell & grammar preview"
      title="Burmese Spell & Grammar Review"
      subtitle="Review an illustrative rule-based sample and decide which suggestions to apply"
      badges={["Frontend rule preview"]}
      icon={<BookOpen className="w-5 h-5" />}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Text Editor Area with Drag & Drop Overlay Requirement */}
        <div className="lg:col-span-8 flex flex-col space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-1.5">
              <FileUp className="w-4 h-4 text-indigo-600" />
              Text editor & sample suggestion preview
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleResetSample}
                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
              >
                Load Sample Document
              </button>
              <span className="text-slate-300">|</span>
              <span>{editorText.length} Characters</span>
            </div>
          </div>

          {/* Interactive Dropzone Wrapper */}
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-2xl border-2 transition-all duration-200 min-h-[380px] flex flex-col bg-white overflow-hidden shadow-sm ${
              isDragOver ? 'border-indigo-500 ring-4 ring-indigo-500/20' : 'border-slate-300/80 hover:border-slate-400'
            }`}
          >
            {/* Drag and Drop Visual Overlay (Active on Drag Over) */}
            {isDragOver && (
              <div className="absolute inset-0 z-30 bg-indigo-600/90 backdrop-blur-sm flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-150">
                <Upload className="w-16 h-16 animate-bounce text-amber-300 mb-3" />
                <h4 className="text-xl font-bold mb-1">Drop Your Document Here</h4>
                <p className="text-sm text-indigo-100 max-w-md text-center">
                  Release TXT, PDF, or DOCX to load readable Burmese text into this analysis panel
                </p>
              </div>
            )}

            {/* Textarea */}
            <textarea
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              placeholder="Type or paste Burmese text here, or drag and drop TXT, PDF, or DOCX…"
              className="w-full flex-1 p-5 text-slate-800 text-base leading-relaxed resize-none focus:outline-none font-sans"
              rows={12}
            />

            {/* Bottom Quick Drag-and-drop bar */}
            <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <label className="cursor-pointer font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Load plain text</span>
                  <input 
                    type="file" 
                    accept=".txt,text/plain"
                    onChange={handleFileInput} 
                    className="hidden" 
                  />
                </label>
                <button
                  type="button"
                  onClick={() => analysisInputRef.current?.click()}
                  className="cursor-pointer font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  <span>Load PDF / DOCX text</span>
                </button>
                <input
                  ref={analysisInputRef}
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileInput}
                  className="hidden"
                />
                <span className="text-slate-400">• Drag files directly into the box</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(editorText);
                    showToast("Copied to clipboard!");
                  }}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-100 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Copy className="w-3 h-3" /> Copy
                </button>
                <a
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(editorText)}`}
                  download="checked_burmese_document.txt"
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 font-medium hover:bg-slate-100 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Download className="w-3 h-3 text-indigo-600" /> Export TXT
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: AI Analysis & Suggestions Cards */}
        <div className="lg:col-span-4 flex flex-col space-y-4">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
            <span className="flex items-center gap-1.5">
              <Wand2 className="w-4 h-4 text-indigo-600" />
              Sample suggestions ({issuesList.length})
            </span>
            {issuesList.length > 0 && (
              <button
                onClick={handleFixAll}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
              >
                Fix All Issues
              </button>
            )}
          </div>

          {/* Issues List Container */}
          <div className="flex-1 space-y-3 max-h-[460px] overflow-y-auto pr-1">
            {issuesList.length === 0 ? (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center p-6 text-center bg-white rounded-2xl border border-slate-200">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-slate-900 text-sm">No sample suggestions remaining</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  No remaining matches were found in this illustrative frontend rule set.
                </p>
                <button
                  onClick={handleResetSample}
                  className="mt-4 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Reload Sample To Test
                </button>
              </div>
            ) : (
              issuesList.map((issue, idx) => (
                <div
                  key={issue.id}
                  onMouseEnter={() => setActiveIssueIndex(idx)}
                  className={`p-4 rounded-xl border bg-white transition-all shadow-sm ${
                    activeIssueIndex === idx ? 'border-indigo-400 ring-2 ring-indigo-500/10' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                      {issue.ruleCategory}
                    </span>
                    <button
                      onClick={() => handleFixSingle(issue)}
                      className="text-xs font-bold text-indigo-600 hover:text-white hover:bg-indigo-600 px-2.5 py-1 rounded-lg border border-indigo-200 transition-all cursor-pointer"
                    >
                      Apply Fix
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-sm font-semibold mb-1.5">
                    <span className="line-through text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded">
                      {issue.original}
                    </span>
                    <span className="text-slate-400">→</span>
                    <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                      {issue.suggestion}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    {issue.reason}
                  </p>
                </div>
              ))
            )}
          </div>

          {/* Quick helper tip */}
          <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-100 text-xs text-indigo-900 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-indigo-600 flex-shrink-0 mt-0.5" />
            <span>
              <strong>သတိပြုရန်:</strong> စကားပြောစာဟန် (ဥပမာ — ပါတယ်) ကနေ ရုံးသုံးစာဟန် (ဥပမာ — ပါသည်) အဖြစ် အလိုအလျောက် ပြောင်းပေးတဲ့ သဒ္ဒါပြင်ဆင်မှုကိုလည်း လုပ်ဆောင်နိုင်ပါတယ်။
            </span>
          </div>
        </div>
      </div>

      {/* Toast notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-xl shadow-2xl border border-slate-700 text-xs font-semibold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}
    </ToolShell>
  );
};
