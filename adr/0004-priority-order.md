# ADR-0004 — ChIPseeker's priority order

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q3

## Context

Categories overlap: one transcript's exon is another's intron. ChIPseeker's default is
Promoter > 5′UTR > 3′UTR > Exon > Intron > Downstream > Intergenic; HOMER's is similar,
with TTS second.

## Decision

Promoter > 5′ UTR > 3′ UTR > Exon > Intron > Intergenic (no Downstream; ADR-0008). Fixed
in v0.1, and printed in the settings summary.

## Consequences

Results are comparable with the most-used R tool. Exon here means exonic sequence not
already claimed by a UTR, so coding exons, plus the exons of non-coding transcripts.
