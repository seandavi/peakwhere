# ADR-0006 — Normalise names, keep all chromosomes, exclude unmatched from the denominator

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q5, and §5 Chromosome names

## Context

GENCODE writes `chr1`; the Vahedi CSV writes `1`. Unreconciled, every peak lands in
Intergenic and the chart still looks like a result.

## Decision

- Names are compared after normalisation: strip a leading `chr` (case-insensitive), and
  map `MT` and `M` to one key. Display uses the annotation's spelling.
- All chromosomes are kept, including chrM and unplaced contigs.
- Peaks on chromosomes absent from the annotation are **unmatched**. They are excluded
  from the denominator and reported per file, by count and by name.
- If more than 5% of a file's peaks are unmatched, that file is not drawn. The page
  shows the unmatched names instead.

## Consequences

The most common silent failure becomes a loud one. A file that is 4% unmatched still
draws, with its count shown.
