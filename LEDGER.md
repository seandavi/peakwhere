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
