# Architecture decision records

One short record per decision that shaped peakwhere: what was decided, why, and what it
costs. Most answer an open question from [`SPEC.md` §6](../SPEC.md#6-open-questions);
the spec's rule is that no code is written until each of those has a record here.

Records are numbered and never renumbered. To change a decision, write a new record that
supersedes the old one, and mark the old one `superseded by ADR-NNNN`. Use
[`template.md`](template.md), or the `new-adr` skill in `.claude/skills/`.

**Who decided.** peakwhere was built as a worked example of agent-driven development. An
orchestrating agent stood in for the maintainer, Sean Davis, and made these calls in his
place, using the reasoning in each record; Sean had not reviewed them when they were
written. Each record says so under *Deciders*. If you disagree with one, that's what a
superseding ADR is for.

| ADR | Decision | Spec |
|---|---|---|
| [0001](0001-record-decisions.md) | Record decisions as ADRs | — |
| [0002](0002-promoter-window.md) | Promoter is ±1 kb of the TSS by default, user-settable | Q1 |
| [0003](0003-count-peak-centres.md) | Count peaks by their centre; base pairs as a toggle | Q2 |
| [0004](0004-priority-order.md) | ChIPseeker's priority order | Q3 |
| [0005](0005-transcript-set.md) | Use every transcript in the file; optional protein-coding filter | Q4 |
| [0006](0006-chromosome-handling.md) | Normalise names, keep all chromosomes, exclude unmatched from the denominator | Q5 |
| [0007](0007-csv-coordinates.md) | CSV assumed 0-based, with a visible warning and a toggle | Q6 |
| [0008](0008-no-downstream-category.md) | No Downstream category in v0.1 | Q7 |
| [0009](0009-single-exon-category.md) | One Exon category; no CDS split | Q8 |
| [0010](0010-genome-background.md) | Genome background bar when chromosome lengths are known | Q9 |
| [0011](0011-multiple-files.md) | One bar per file, labelled from the filename; no column splitting in v0.1 | Q10 |
| [0012](0012-hand-written-parser.md) | GFF3 and GTF, one hand-written streaming parser | Q11 |
| [0013](0013-genome-build-check.md) | Show the annotation's assembly, and warn on out-of-range peaks | Q12 |
| [0014](0014-fixture-first.md) | The fixture's expected answers are written by hand, before code | §7 |
| [0015](0015-vendored-libraries.md) | Libraries bundled into a checked-in `vendor/`; no CDN, no build to run | §9 |
