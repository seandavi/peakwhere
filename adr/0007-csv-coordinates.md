# ADR-0007 — CSV assumed 0-based, with a visible warning and a toggle

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q6

## Context

BED is 0-based by definition. A CSV is whatever its author meant, and the Vahedi CSV
doesn't say. For centre counting, a 1 bp shift moves a handful of boundary peaks.

## Decision

CSV/TSV input is read as 0-based half-open, like BED, and the page shows a warning
beside each CSV file with a toggle to reinterpret it as 1-based closed. CSV columns are
found by header name: `chr`/`chrom`/`seqnames`, `start`/`chromStart`,
`end`/`chromEnd`, case-insensitive.

## Consequences

The ambiguity is surfaced, not resolved by guessing.
