# ADR-0005 — Use every transcript in the file; optional protein-coding filter

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q4

## Context

Every extra transcript adds a promoter and turns some intron into exon. GENCODE already
ships a `basic` subset, which is what the reference data uses.

## Decision

Use every transcript in the file the user supplies. Offer one filter: **protein-coding
only**, which keeps transcripts whose `transcript_type` (or, failing that, `gene_type`)
is `protein_coding`. Choosing the annotation file is the main way to choose transcripts,
and the README says so.

## Consequences

No hidden filtering: the chart reflects the file. Annotations without
`transcript_type` get no filtering when the box is ticked, and the page says so rather
than silently dropping everything.
