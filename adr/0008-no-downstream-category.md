# ADR-0008 — No Downstream category in v0.1

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q7

## Context

A Downstream (post-TES) category takes peaks from Intergenic and adds a second window
setting to explain.

## Decision

Not in v0.1. Filed as a `good first issue` enhancement.

## Consequences

Fewer categories and settings. Peaks just past a gene end count as Intergenic, as they
do in ChIPseeker with Downstream disabled.
