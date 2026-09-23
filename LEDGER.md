# Ledger

What was asked, what was done, and how it was checked, one entry per unit of work.
The field that must never be blank is **Checked how**.

**Who's who.** *SD* is Sean Davis, the maintainer. *Orchestrator* is the agent that
stood in for SD while peakwhere was built: it set direction, wrote the decisions and the
fixture, reviewed and merged PRs, and ran acceptance checks. *Worker* and *Reviewer* are
sub-agents it dispatched. Everything the orchestrator decided was decided *for* SD, not
*by* SD; SD's own review is recorded separately when it happens.

---

## Entry 1 — Repository scaffold, decisions and fixture

**Asked** — *SD*: open a new repository for the app specified in the Penn workshop's
peak-overlap exercise. Set it up with good social-coding practice, a ledger, ADRs and a
light AGENTS.md; file issues and a project; build to completion with worker agents,
with the orchestrator standing in for SD; deploy to GitHub Pages with CI; MIT if the
libraries allow.

**Orchestrator did** — Created the repository. Copied `SPEC.md` from the workshop repo.
Wrote community files (MIT licence, Contributor Covenant, contributing and security
guides, issue and PR templates), CI and Pages workflows, and `AGENTS.md`. Answered the
spec's twelve open questions as ADR-0002 to ADR-0013, and recorded the fixture-first and
vendoring decisions as ADR-0014 and ADR-0015. Built the hand-written test fixture: three
transcripts, as both GFF3 and GTF, 17 peaks on edge cases, and `expected.json`. Bundled
the libraries into `vendor/`, with generated third-party notices. Cut a chromosome 19
demo dataset from GENCODE M25 and five ENCODE thymus experiments.

**Checked how** — *Orchestrator*: checked the licences of every bundled package: ISC,
MIT, BSD-3-Clause, Unlicense and 0BSD, all compatible with MIT, with the BSD-3 notices
reproduced in `THIRD_PARTY_LICENSES.md`. Checked the fixture's hand-worked answers
**independently with bedtools**: all 17 per-peak categories, the base-pair totals
(1,306 bp) and the genome background (30,000 bp) matched exactly. Confirmed the vendored
bundles load and run as ES modules.

**Confidently wrong** — Nothing caught yet. One near-miss: the first fixture draft put a
1 kb transcript under a ±1 kb promoter, so the whole transcript was "promoter" and the
fixture couldn't test anything else. Caught while working the answers by hand.

**Keep** — Work the fixture by hand, then check the hand-work with an independent tool.
Neither step alone is enough.

---

## Entry 2 — Module contracts fixed before parallel work (PR #2)

**Asked** — *Orchestrator*, before filing issues: make SPEC.md §9 precise enough for
four agents to build against at the same time.

**Orchestrator did** — Rewrote the §9 contracts module by module, and added
`src/constants.js` as the shared vocabulary. Writing them out exposed a design problem:
the annotation model was to receive every GENCODE feature as an object, over a million
of them. ADR-0016 makes the model consume the stream incrementally, and replaces the
interval tree with a priority-resolved partition searched by binary search, which removed
a dependency.

**Checked how** — *Orchestrator*: `npm test`; CI's vendor drift check passed on GitHub's
runners, so the bundle rebuilds identically there.

**Confidently wrong** — The spec, reviewed twice already, still recommended a library
the design didn't need, and a contract that would have used hundreds of MB. Neither
showed until the contracts were written out as exact function signatures.

**Keep** — Write interfaces as signatures, not prose, before parallel work starts.

---

## Entry 3 — `npm run snap` for real-browser checks (PR #18)

**Asked** — *Orchestrator*: give workers a way to look at their work in a real browser.

**Orchestrator did** — Added `scripts/snap.mjs`: it drives the local Chrome through
`playwright-core`, saves a screenshot, and fails on console errors, HTTP errors, or any
request leaving the origin (the privacy promise, checked mechanically).

**Checked how** — *Orchestrator*: ran it against the placeholder page. It reported a
real 404 for `/favicon.ico`.

**Confidently wrong** — *Orchestrator*: a "cleaner" second version filtered console load
errors in favour of response events, which report the URL. That silently hid the favicon
404, because Chrome requests the favicon outside the page. Reverted to reporting both.

**Keep** — When you tidy up a checker's output, rerun it on the case it originally
caught.

---

## Entry 4 — Wave 1: four issues in parallel (#5, #6, #7, #8; PRs #20–#23)

**Asked** — *Orchestrator*: build the four independent issues at once, each by a
*Worker* in its own git worktree, with exclusive file ownership and only the orchestrator
merging.

**Workers did** — Annotation parser and streaming I/O (#21), peak parser (#20), chart,
table and downloads (#23), page shell (#22). Each opened a PR with tests and a
verification section.

**Orchestrator did** — Answered a contract question from the chart worker mid-run (units
in base-pair mode) and wrote the answer into SPEC.md (#19). Reviewed every PR, running
the tests locally and looking at the UI PRs in headless Chrome. Requested changes on
three:

- **#20:** accept `1e+05`. R's `write.csv` writes round numbers that way, so the first
  version would have rejected real peaks.
- **#21:** match Ensembl's lowercase `five_prime_utr`, which would otherwise have been
  dropped, with UTR bases counted as exon. Also a clearer bgzip error (#24).
- **#23:** the results table was clipped on the right. The worker had checked the page
  in a browser and not noticed; the orchestrator's own screenshot caught it.

Deferred Dependabot's PR #1: its esbuild bump failed the vendor drift check, as designed.

**Checked how** — *Orchestrator*: local `npm test` on each branch (32, 40, 31 and 16
tests). Screenshots of the page and chart at 1280 px. Checked by hand that `1e+05` and
friends are accepted and `1.5e0` rejected. Decoded every ENCODE and example file with
`DecompressionStream`: all single-member gzip, so bgzip support could wait.

**Confidently wrong** — *Worker* (#5) reported that tests passed locally on Node 22. They
hadn't been seen to: its search missed that run's output format. The worker caught and
corrected this in its next report. Separately, GitHub won't let an account request
changes on its own PR, and every commit here is under one account, so reviews are PR
comments.

**Keep** — A worker saying it looked at the UI is not the same as the reviewer looking.
And the best review findings (R's scientific notation, Ensembl's lowercase types) came
from knowing where real bioinformatics files come from, not from reading the code.

---

## Entry 5 — Annotation model (#9, PR #25)

**Asked** — *Orchestrator*: the engine owner builds #9, then #10, in sequence, because
they're where the bugs live.

**Worker did** — `buildAnnotation`: incremental and columnar, with transcripts resolved
at end of stream (so children may precede parents), and GTF UTRs split by CDS position
and strand. Mutation-tested its own tests: six plausible bugs, each caught.

**Checked how** — *Worker*: fixture layers match `expected.json` in both formats. On full
GENCODE M25: 81,540 transcripts, 45,509 protein-coding (matching an independent `grep`),
2.9 s, 40 MB held after GC. *Orchestrator*: reviewed the report and PR, and CI.

**Confidently wrong** — Nothing caught. The worker found that GENCODE's GTF counts stop
codons as UTR and its GFF3 doesn't, about 3 bp per coding transcript. Accepted and to
be documented.

**Keep** — Asking a worker to mutation-test its own tests is cheap, and it found one
test that couldn't fail.

---

## Entry 6 — Engine, integration, and v0.1.0 (#10, #30, #11, #13, #14; PRs #29, #31, #32)

**Asked** — *SD*: finish peakwhere lean. One integration worker and one review, then a
README, and close the milestone. Skip the separate reviewer agent, and leave browser e2e
in CI (#12) for later.

**Workers did** — The engine owner built the partition and classifier (#29), then fixed
a bug it found in its own earlier module (#30, PR #31): with the protein-coding filter
on, a GTF chromosome carrying only non-coding transcripts disappeared, so its peaks
turned unmatched. The integrator (#32) moved the analysis into a Web Worker behind a
Node-testable `src/analysis.js`. It caches the parsed annotation per filter setting,
re-runs automatically on setting changes, and tags runs so a stale result can't
overwrite a newer one.

**Orchestrator did** — Answered the integrator's three design questions mid-run, passed
the engine owner's notes to it, reviewed and merged, and wrote the README.

**Checked how** — *Orchestrator*: an independent `bedtools` pipeline over full GENCODE M25
with the app's exact rules, including separate UTR categories. Every category of all
five ENCODE files and the genome background match the engine to two decimal places. So
does the Vahedi H3K27ac CSV (49,781 peaks, chromosomes written `12`): 19.25% promoter,
46.87% intron, 30.23% intergenic in both. Local `npm test` on each PR (116, then 134).
*Try the example* in headless Chrome, with no console errors or offsite requests.
*Worker* (#32): full reference data in the page in 2.9 s, main thread never blocked for
more than 42 ms.

**Confidently wrong** — *Orchestrator*: the first `bedtools` run reused an `awk` array
name as a scalar. Awk aborted partway through, and the promoter and intron layers came
out empty, yet the script still printed a tidy table of plausible-looking percentages.
Caught only because 0.0% promoter for H3K4me3 is biologically impossible. A draft of this
README claimed Ensembl support that no whole Ensembl file had tested.

**Keep** — An independent cross-check is only independent if it can fail loudly. Read its
numbers against the biology before trusting them. And the engine owner finding a bug in
its own earlier module while building the next is the argument for keeping the serial
issues with one agent.
