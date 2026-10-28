

 ## Global Rules
 - no *.mjs always just *js for esm
 - do not create *.md for whatever case unless explicity request
 - test,read,see to know , understand the problem then  reasoning as second phase and action as third unless there is accessibility issuse.
- missing depency isnt blocked just install it.
-  uncertainties are things to suggest pratically not  to report back plainly.
- ask clarification for ambigious case.
- avoid long tutorials or exhaustive file trees
-  avoid dumping all new files in one place (except tools and test)
- backward compability is 
## Exclude 
- Reading code under Lexic_No_inspect/*
- generic software advice
- obvious language conventions 
- speculative claims or anything you could not verify



## Avoid
- finding errors in Lexic_No_inspect/*
- creating test files in root
- techanical jargon in architecture questions and  explainations 
- Do not ask about anything the repo already makes clear.
  

-----

## Warn
- undocumented conventions
- missing setup or test prerequisites that are known but not written down
  

## Rules

- Prefer executable sources of truth over prose. If docs conflict with config or scripts, trust the executable source and only keep what you can verify.
- One task at a time. Do not start the next one.
-  verified with the result .Do not reason and call it verified.
- Say what you could **not** verify, and flag anything you added unasked.
- Ask architecture questions plainly
- maintain existing dir layout  and place new file appropiately
- avoid performing task out of the scope however appropiate adjustment is necessary and keeping old logic for backward compability is prohibited and duplicated scripts are policy violation.
- on PR request : must execute all tests, maintain previous test suit record, Append** a new dated entry in changelog.md update at pr

 ```format
  ## [1.4.0] - 2026-09-08
  ## Added - PDF text now extracted server-side.
  ## Changed / Fixed / Removed
```

