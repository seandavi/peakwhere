# ADR-0012 — GFF3 and GTF, one hand-written streaming parser

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q11, and §8

## Context

`@gmod/gff` needs 5.6 GB on GENCODE's GFF3, because it builds feature trees and GENCODE
has no `###` sync marks. `@gmod/gtf` is stale and built on Node streams. Both formats
are nine tab-separated columns and differ only in attribute syntax.

## Decision

One parser, line by line, for both formats, detected from the file name or the
`##gff-version` header.

- **GFF3:** attributes are `key=value` pairs separated by `;`, URL-decoded. Features link
  through `ID` and `Parent` (which may list several IDs, comma-separated). A transcript
  is any feature that is the `Parent` of an exon, so `transcript`, `mRNA`, `lnc_RNA`
  and the rest all work.
- **GTF:** attributes are `key "value";`. Features link through `transcript_id`.
  Transcript lines are optional: a transcript's span is its exons' extent when there's
  no transcript line.
- Only exon, CDS, UTR, `five_prime_UTR` and `three_prime_UTR` lines, transcript spans
  and strands, a few attributes (ADR-0005), and `##sequence-region` lengths are kept.

## Consequences

About a hundred lines we own and test, instead of a dependency that can't handle the
reference data. The fixture exercises both formats, including a GFF3 with no
`transcript_id` and a GTF with a missing transcript line.
