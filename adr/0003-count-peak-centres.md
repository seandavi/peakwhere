# ADR-0003 — Count peaks by their centre; base pairs as a toggle

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q2

## Context

Three counting rules are on the table: (a) each peak gets its highest-priority
overlapping category; (b) each peak gets the category at its centre; (c) fraction of
peak base pairs per category. (a) makes Promoter greedy for wide peaks: the Vahedi
union peaks run to 93 kb, and nearly every one would touch a promoter. HOMER uses (b).
Rule (b) also has a clean null model: the genome background is exactly what (b) gives
for centres dropped uniformly at random (ADR-0010).

## Decision

- Default is (b). The centre of a 0-based half-open peak `[s, e)` is
  `s + floor((e − s) / 2)`. The summit column of narrowPeak is not used in v0.1.
- (c) is available as a toggle, with per-base priority. The table shows base pairs.
- (a) is not offered.

## Consequences

Wide peaks are represented by one point, which undersells what they cover; (c) is there
for that. Using summits would be more precise for narrowPeak files and is a reasonable
later addition, but it would make results depend on file format.
