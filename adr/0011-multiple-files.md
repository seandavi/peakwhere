# ADR-0011 — One bar per file, labelled from the filename; no column splitting in v0.1

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** Q10

## Context

Splitting the Vahedi CSV by fold change is the natural demo, but it adds a filter UI.

## Decision

One bar per file, labelled with the filename minus compression and format extensions
(`.gz`, `.bed`, `.narrowPeak`, `.broadPeak`, `.csv`, `.tsv`, `.txt`), in the order
added. Labels are editable. Splitting one file by a column is filed as an enhancement.

## Consequences

Users split files themselves for now, for example with `awk`.
