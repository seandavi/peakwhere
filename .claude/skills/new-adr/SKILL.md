---
name: new-adr
description: Creates a new architecture decision record in adr/ from the template, and
  indexes it. Use when the user wants to record, document or change a decision, when
  a PR changes settled behaviour, or when asked to write an ADR.
---

## Instructions

1. List `adr/` and take the next number (four digits, zero-padded). Never reuse or
   renumber.
2. Copy `adr/template.md` to `adr/NNNN-<kebab-case-summary>.md` and fill in every
   section. *Deciders* names who actually made the call.
3. If this reverses an earlier record, set the old record's status to
   `superseded by ADR-NNNN` and change nothing else in it.
4. Add a row to the table in `adr/README.md`.
5. If the decision changes a default that `test/fixtures/expected.json` depends on,
   say so explicitly and stop: updating the fixture is a deliberate, separate change.
