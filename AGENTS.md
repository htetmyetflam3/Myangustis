

 ## Global Rules
 - assgin ur output files location under Junk/SourceParentDir/   and place there properly.
 - Do not ever place Run time depency under junk dir.
 -  do not ever point the file  output location to dir where the current script is executed.

 - no *.mjs always just *js for esm
 - do not create *.md for whatever case unless explicity request
 - test,read,see to know , understand the problem then  reasoning as second phase and action as third unless there is accessibility issuse.
- missing depency isnt blocked just install it.
-  uncertainties are things to suggest pratically not  to report back plainly.
- ask clarification for ambigious case.
- avoid long tutorials or exhaustive file trees
-  avoid dumping all new files in one place (except tools and test)
-  maintaining scripts from old design and keeping old logic for  backward compability ,Python scripts in js parser , making long file names with hypens, using similar file names and functions names , placing script in random locations and Reading files  under Lexic_No_inspect/*   are policy violations.



## Exclude 
- generic software advice
- obvious language conventions 
- speculative claims or anything you could not verify



## Avoid
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

## !Reminder 
proofreading is separte service  do nothing with parser output except some pdfs from there are use to test parser that why placing  parser  output  files there will be assumed as * messing up on my dir layout *