# ADR-0014 — The fixture's expected answers are written by hand, before code

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** §7, tests 1–3

## Context

Tests written after the code test what the code does, not what it should do. The whole
value of the fixture is that it's independent of the implementation.

## Decision

`test/fixtures/` holds three transcripts (+ strand, − strand, and one with a long 5′
UTR) as both GFF3 and GTF, 17 peaks placed on deliberate edge cases, and
`expected.json` with every answer: per-peak categories, counts, base pairs, and the
genome background. The answers were worked out by hand, then checked independently
with bedtools before any application code existed; all matched.

**Nobody edits `expected.json` to make a test pass.** A mismatch is either a bug or a
decision to revisit with a new ADR.

## Consequences

The fixture is the project's ground truth. Changing a default (for example, the
promoter window) means updating the fixture deliberately, with a new ADR.
