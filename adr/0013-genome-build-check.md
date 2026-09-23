# ADR-0013 — Show the annotation's assembly, and warn on out-of-range peaks

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q12

## Context

mm10 peaks against an mm39 annotation produce a plausible, wrong chart. Nothing in a BED
file names its assembly.

## Decision

- Look for an assembly name in the annotation's header comments (GRCm38, GRCm39,
  GRCh37, GRCh38, and the UCSC names mm10, mm39, hg19, hg38) and show it in the settings
  summary. GENCODE M25 says GRCm38.
- When chromosome lengths are known, count peaks that extend past their chromosome's
  end, and warn if there are any: the clearest sign of a build mismatch.
- No user-stated assembly in v0.1.

## Consequences

A cheap check that catches the worst case. Subtler mismatches, where coordinates stay
in range, remain the user's responsibility, and the README says so.
