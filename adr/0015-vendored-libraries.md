# ADR-0015 — Libraries bundled into a checked-in vendor/; no CDN, no build to run

**Date:** 2026-09-23
**Status:** accepted
**Deciders:** orchestrating agent, acting for Sean Davis (not yet reviewed by him)
**Spec:** §5 Privacy, §9

## Context

Browsers can't resolve `import '@observablehq/plot'`, and loading from a CDN would break
the no-network privacy promise. A build step for the app itself would make the repo
harder to read and to host.

## Decision

`npm run vendor` bundles Plot and `@flatten-js/interval-tree` with esbuild into
`vendor/` as ES modules, keeping legal comments, and regenerates
`THIRD_PARTY_LICENSES.md` from the packages actually bundled. The output is checked in.
Source imports by relative path. The app runs from any static server with no build.

## Consequences

About 400 KB of generated code in the repo, regenerated only when a version changes.
CI checks that `vendor/` matches what `npm run vendor` produces, so nobody edits a
bundle by hand.
