# Working on peakwhere

For any coding agent, and for humans who like short briefs. What the code and the docs
already say isn't repeated here.

- **`SPEC.md` is the source of truth; `adr/` records how its open questions were
  answered.** If code, spec and ADRs disagree, stop and ask. Don't pick one.
- **All coordinates crossing a module boundary are 0-based half-open.** Annotation
  `start` becomes `start − 1` in the parser and nowhere else.
- **Never edit `test/fixtures/expected.json` to make a test pass.** It was worked out by
  hand and checked with bedtools. Report the failure instead (ADR-0014).
- **Never edit `vendor/` by hand.** Change `package.json` and run `npm run vendor`
  (ADR-0015).
- **Nothing may leave the browser.** No network calls from app code except loading the
  bundled example files from the same site.
- Tests: `npm test` (Node's built-in runner). Local server: `npm run serve`. Test a
  browser feature in a browser, not only in Node: bare imports and globals behave
  differently.
- One branch and one PR per issue. Write `Closes #N` in the PR body. Say in the PR what
  you verified and how, not just what you changed.
- After a PR merges, add a `LEDGER.md` entry (there's a `ledger-entry` skill in
  `.claude/skills/`).
