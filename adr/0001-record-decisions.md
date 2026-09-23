# ADR-0001 — Record decisions as ADRs

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)

## Context

SPEC.md leaves twelve questions open and forbids code until each is answered. The
answers change what the chart says, so a reader of any chart needs to be able to find
them, and a contributor needs to know which are settled.

## Decision

Each decision gets a short, numbered record in `adr/`: context, decision,
consequences. Records are never edited to reverse a decision; a new record supersedes
the old one.

## Consequences

Settled questions stay settled, with reasons attached. The cost is a small amount of
writing per decision, and the discipline of superseding rather than editing.
