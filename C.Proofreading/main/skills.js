/**
 * Skill: natural-burmese-translator
 * Role: Human-grade literary translator (Chinese -> Burmese)
 * Paradigm: Translate blind first, then let the tools correct you.
 */

export const NaturalTranslatorSkill = {
  name: 'natural-burmese-translator',
  description: 'Translates Chinese to natural Burmese matching human author voice. Follows the inverted workflow: blind baseline translation, counting-based calibration, and tool-assisted correction.',
  
  corePrinciples: [
    'Translate blind first: Never load heavy terminology, particles, or style checkers before the raw draft.',
    'Author voice by counting: Settle style using frequency analysis against human corpus (e.g. 0 occurrences of ကျွန်ုပ်, unquoted monologue), not prompt assumptions.',
    'Targeted corrections: w=ဝိဘတ် role-based particle resolution (LSE narration vs. LSN spoken/unquoted monologue).',
    'Eye-verification first: Do not run automated test suites for obvious inspections (paths, imports, simple word mappings).',
    'Do not build tools: Use tools strictly as stepping stones to refine translation.'
  ],

  workflowPhases: [
    {
      phase: 1,
      name: 'English Bridge Generation',
      action: 'Generate intermediate English bridge directly against source Chinese with paragraph tags (**[001]**, **[002]**).',
      rules: [
        'Chinese source is the sole authority; API English is only a witness.',
        'Zero gaps in paragraph mapping.'
      ]
    },
    {
      phase: 2,
      name: 'Blind Burmese Draft',
      action: 'Translate bridge to Burmese naturally without consulting particle rules, name lists, or style guides.',
      rules: [
        'Zero Chinese characters, zero English/Latin words.',
        'Keep the raw draft intact in raw/ baseline folder for audit comparison.'
      ]
    },
    {
      phase: 3,
      name: 'Corpus Voice Calibration',
      action: 'Check frequencies against the human baseline corpus.',
      rules: [
        'Count tokens, never substrings (e.g., match exact surface tokens to avoid false positives like တယ် inside အင်မော်တယ်).',
        'Check unquoted 1st-person thoughts (LSN spoken register, no quotation marks).',
        'Verify zero occurrences of forbidden/stiff particles (e.g., ကျွန်ုပ်, ပါသည်).'
      ]
    },
    {
      phase: 4,
      name: 'Iterative Tagging & Register Correction Loop',
      action: 'Run copy-then-tag cycles and apply register audits.',
      rules: [
        'Never tag or mutate the original text directly; copy to work buffer first.',
        'Match on normalized text (" ".join(block.split())), then re-wrap <= 95 cols.',
        'Rejoin paragraphs with double newline (\\n\\n), never single newline.',
        'Determine particle role before applying resolution (e.g., က as ကတ္တား vs. အချိန်ပြ).'
      ]
    },
    {
      phase: 5,
      name: 'Terminology & Final Verification',
      action: 'Register newly coined terms into registry and verify final constraints.',
      rules: [
        'Register names via CLI/tools, not by editing master files directly.',
        'Ensure master data remains completely untouched (master_sha256 unchanged).'
      ]
    }
  ],

  cliToolsMap: {
    bridgeAlignment: 'python3 C.Proofreading/main/tools/mcp.py --compare_english_chapter <num>',
    chapterRead: 'python3 C.Proofreading/main/tools/mcp.py --read_chapter <num>',
    taggerNode: 'node C.Proofreading/main/proofreading-tagger.js',
    registerAudit: 'python3 C.Proofreading/register.py <draft_path> --work <work_dir> --mismatches',
    nameCheck: 'python3 C.Proofreading/main/tools/mcp.py --check_names --text "<text>"',
    nameRegister: 'python3 C.Proofreading/main/tools/mcp_server.py --register-name'
  }
};
