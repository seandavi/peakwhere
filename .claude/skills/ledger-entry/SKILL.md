---
name: ledger-entry
description: Appends a correctly formatted entry to LEDGER.md for work just finished —
  a merged PR, a decision, a verification run. Use when the user asks to log, ledger,
  record or write up what was done, after merging a PR, or when finishing an issue.
---

## Instructions

1. Read `LEDGER.md`. Find the last entry number, and use the next one.
2. Gather the facts from what actually happened: the issue and PR numbers, the commits,
   the commands run and their output. Use `git log` and `gh pr view` rather than
   memory.
3. Append an entry in exactly this shape:

   ```markdown
   ---

   ## Entry N — <short title> (#issue, PR #pr)

   **Asked** — <who asked for what, in a sentence or two>

   **<Role> did** — <what was done: files, modules, decisions>

   **Checked how** — <who verified what, and how: tests, commands, browser checks,
   numbers compared. Name the checker.>

   **Confidently wrong** — <anything asserted that turned out false, or
   "Nothing caught.">

   **Keep** — <the one lesson or snippet worth carrying forward, or "Nothing new.">
   ```

4. Attribute every action to a role: *SD*, *Orchestrator*, *Worker* or *Reviewer*.
5. **Never invent verification.** If nothing was checked, write "Not checked" under
   *Checked how*. Don't soften it. An honest empty field is the point of the ledger.
6. Stop after appending. Don't edit earlier entries.
