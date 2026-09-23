# ADR-0002 — Promoter is ±1 kb of the TSS by default, user-settable

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q1

## Context

The promoter window is the largest single driver of the Promoter bar. The two most-used
tools disagree: ChIPseeker defaults to ±3 kb, HOMER to −1 kb/+100 bp. A ±3 kb window
around every GENCODE transcript start covers a large share of gene-dense regions, and
swallows short first exons and introns into Promoter.

## Decision

- The promoter is a window of `upstream` bp upstream and `downstream` bp downstream of
  the TSS base, **including the TSS base itself**. Both are settable. Defaults: 1000 and
  1000.
- Upstream is strand-aware: on the − strand, upstream means higher coordinates.
- In 0-based half-open terms, with the TSS at 0-based position `t`:
  `+` strand `[t − upstream, t + downstream + 1)`; `−` strand
  `[t − downstream, t + upstream + 1)`. Clipped at 0.
- The TSS of a transcript is its 5′-most base: `start` on `+`, `end` on `−`.
- The window used is printed in the settings summary under every chart.

## Consequences

±1 kb sits between the two tools. Someone comparing against ChIPseeker must set ±3 kb
explicitly, which the settings summary makes visible. A window extending past a
chromosome's end is not clipped at the end: there's no length for a GTF, and the few
bases involved don't matter.
