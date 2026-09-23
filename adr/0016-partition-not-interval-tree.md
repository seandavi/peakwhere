# ADR-0016 — Classify against a priority-resolved partition; drop the interval tree

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** §8, §9; partly supersedes ADR-0015's library list

## Context

SPEC.md §8 recommended `@flatten-js/interval-tree` for overlap queries. But the priority
order (ADR-0004) means every base belongs to exactly one category. That can be computed
once, as a sorted, non-overlapping list of segments per chromosome, each carrying one
category. Separately, the spec's §9 contract had the annotation model receive every
feature as an object: over a million for GENCODE, a few hundred MB in a browser.

## Decision

- The annotation model **consumes the feature stream incrementally**. It keeps only
  what it needs per transcript (exon coordinates, CDS extent, UTRs, span, strand,
  filter attributes), never the full list of features.
- The overlap engine builds a **partition** per chromosome: sorted disjoint segments
  `[start, end, category]`, with higher-priority categories winning. Gaps are
  intergenic.
- Centre counting is one binary search per peak. Base-pair counting is a binary search
  followed by a walk across segments. The genome background is a sum of segment lengths.
- `@flatten-js/interval-tree` is removed from `vendor/` and `package.json`.

## Consequences

Faster, less memory, one fewer dependency, and simpler to reason about: the partition is
the priority order, made concrete. Changing the priority or the promoter window rebuilds
the partition, which is a cheap sort-and-sweep. SPEC.md §9 is updated to match.
