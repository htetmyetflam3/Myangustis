
----

## Global Rules
 - no *.mjs just *js for esm
 - no *.md for whatever case unless requested.
 - 1st test,read,see to know
    , understand the problem then  reasoning as 2nd action unless there is accessibility issuse.
   - missing depency isnt blocked just install it.




## Exclude 
- Reading code under Lexic_No_inspect/*
- generic software advice
- long tutorials or exhaustive file trees
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
- Keep reusable scripts in `./.bin
-  squeeze commits ,  CHANGELOG.md update  must done before PR
- Append** a new dated entry in changelog.md update

 ```format
  ## [1.4.0] - 2026-09-08
  ## Added - PDF text now extracted server-side.
  ## Changed / Fixed / Removed
```

## Important Notic
- changeslogs and projectstructure in each brach are not sync and  describe old behaviour . so if ur working on main brach make sure both of your content cover all other braches .for sub braches clean the  old changeslog and project structure .reflect the current  brach behaviour in each brach documentations.

---