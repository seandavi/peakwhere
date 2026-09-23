# ADR-0010 — Genome background bar when chromosome lengths are known

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q9

## Context

"30% promoter" means nothing without knowing how much of the genome is promoter under
the same rules. The background needs chromosome lengths. GENCODE GFF3 has
`##sequence-region` lines for every chromosome; GTF has none.

## Decision

- Show a **Genome** bar: the fraction of bases in each category, with the same priority
  and promoter settings, over chromosomes whose length is known. It's the answer the
  centre rule would give for randomly placed peaks.
- Lengths come from GFF3 `##sequence-region` directives, or from an optional
  chrom.sizes file (two columns: name, length).
- Without lengths, the bar is hidden and the page says why.

## Consequences

The chart becomes interpretable. Background is computed only over annotated
chromosomes with lengths, so unplaced contigs usually drop out of it.
