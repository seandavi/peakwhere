# Peak Overlap — specification

**Status:** draft. Section 6 lists open questions; **no code gets written until each one
has an answer recorded in `adr/`**.

## 1. What this is

A single web page that takes a gene annotation (GFF3 or GTF) and one or more peak files, works out
what kind of genomic region each peak falls in, and draws a bar chart of the proportions,
with one bar per peak file.

The question it answers is the one asked of every new ChIP-seq, CUT&RUN or ATAC-seq
experiment: *where are my peaks — promoters, gene bodies, or out in intergenic space — and
does that differ between conditions?*

It runs **entirely in the browser**. Files are read locally and never uploaded. There is
no server and no account, and the page can be hosted as a static site (GitHub Pages).

### Non-goals

- Not a genome browser. No tracks, no zooming, no per-peak inspection beyond a table.
- No BAM, bigWig, or signal. It only works with intervals.
- No nearest-gene assignment or functional enrichment. ChIPseeker and HOMER already do
  that well.
- No statistics beyond counting. A comparison against the genome background (§6, Q9)
  is descriptive, not a test.

## 2. Inputs

| Input | Formats | Notes |
|---|---|---|
| Annotation | GFF3 or GTF, plain or `.gz` | One file. Tested against GENCODE. GFF3 is the better choice (§4). |
| Peaks | BED3+, narrowPeak, broadPeak, plain or `.gz`; CSV/TSV with named `chr`/`start`/`end` columns | One or more files. Each file becomes one bar. |

### Reference data

All of it is real, public and **mm10**. Every link was downloaded and checked on
2026-09-23. Nothing here needs an account.

**Annotation.** GENCODE mouse M25 is the last GENCODE release on GRCm38/mm10. Later
releases are on mm39 and will silently misplace every mm10 peak (Q12).

| File | Size | URL |
|---|---|---|
| GFF3, basic | 23 MB gzipped | `https://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_mouse/release_M25/gencode.vM25.basic.annotation.gff3.gz` |
| GTF, basic | 19 MB gzipped; 630 MB and 1,302,168 lines unpacked | `https://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_mouse/release_M25/gencode.vM25.basic.annotation.gtf.gz` |

**Peaks: five experiment types, one tissue.** All are ENCODE adult male mouse thymus,
which is mostly developing T cells. They are chosen because they should look
*different*: each assay has a known genomic preference, so the chart has something to
show and the participant has something to predict (§7, test 8). Each is ENCODE's
default peak file for its experiment and downloads as a gzipped narrowPeak.

| Assay | File | Experiment | Peaks | What to expect | Caveat |
|---|---|---|---|---|---|
| H3K4me3 | [`ENCFF674JZY`](https://www.encodeproject.org/files/ENCFF674JZY/@@download/ENCFF674JZY.bed.gz) | [ENCSR000CCJ](https://www.encodeproject.org/experiments/ENCSR000CCJ/) | 25,099 | Active promoters | |
| H3K36me3 | [`ENCFF853BYO`](https://www.encodeproject.org/files/ENCFF853BYO/@@download/ENCFF853BYO.bed.gz) | [ENCSR000CFV](https://www.encodeproject.org/experiments/ENCSR000CFV/) | 91,474 | Bodies of transcribed genes | A broad mark called as narrow peaks, so domains are chopped into many ~200 bp pieces. Q2 matters here. |
| H3K27me3 | [`ENCFF478UYW`](https://www.encodeproject.org/files/ENCFF478UYW/@@download/ENCFF478UYW.bed.gz) | [ENCSR000CGC](https://www.encodeproject.org/experiments/ENCSR000CGC/) | 16,586 | Polycomb-repressed, often developmental, genes | Also broad, also called narrow |
| CTCF | [`ENCFF714WDP`](https://www.encodeproject.org/files/ENCFF714WDP/@@download/ENCFF714WDP.bed.gz) | [ENCSR000CDZ](https://www.encodeproject.org/experiments/ENCSR000CDZ/) | 20,220 | Insulators, spread across introns and intergenic space | ENCODE flags it *extremely low read depth*. It shows more promoter signal than CTCF usually does. Is that biology, or depth? |
| DNase-seq | [`ENCFF979ULB`](https://www.encodeproject.org/files/ENCFF979ULB/@@download/ENCFF979ULB.bed.gz) | [ENCSR322AIL](https://www.encodeproject.org/experiments/ENCSR322AIL/) | 67,929 | All accessible chromatin: promoters plus distal elements | Different lab and strain (B6CASTF1/J, not B6NCrl); same tissue, age and sex |

The four ChIP-seq experiments come from the Ren lab (UCSD, ENCODE 2). A sixth file pairs
with the Vahedi data below: thymus **H3K27ac**,
[`ENCFF974HMO`](https://www.encodeproject.org/files/ENCFF974HMO/@@download/ENCFF974HMO.bed.gz)
(35,290 peaks, same experiment series).

Every ENCODE file uses `chr1`-style names, matching GENCODE. Four of them include a
handful of peaks (1 to 15) on unplaced contigs such as `chrUn_JH584304`, which aren't in
the `basic` annotation. That exercises the unmatched-chromosome report without tripping
the 5% refusal.

**The Vahedi lab's own peaks.** `track-a/data/differential_peaks.csv` in
[golnazvahedi/epigenetics-agentic-workshop](https://github.com/golnazvahedi/epigenetics-agentic-workshop)
holds 49,781 H3K27ac union peaks with DESeq2 results (6.7 MB). It's a CSV, not a BED, and
it uses `1`-style chromosome names: two traps in one file (§5). It can be split into two
"files" (up in knockout, down in knockout) to exercise the multi-file path. How to split
it is the user's decision, not the tool's (Q10).

## 3. Outputs

1. **A bar chart**, one bar per peak file, showing the proportion in each category,
   stacked to 100%. Counts are shown on hover.
2. **A table** with the same numbers: rows are peak files, columns are categories, and
   each cell holds both a count and a percentage.
3. **A settings summary** printed under the chart: the annotation file name, promoter
   window, counting rule, priority order and gene filter. A chart without its settings
   can't be interpreted or reproduced.
4. **Downloads**: the table as CSV, the chart as SVG and PNG, and a per-peak assignment
   file (the input peak plus its assigned category).

## 4. Categories

Annotation files contain only some of the categories people want. The rest have to be
**derived**, and how much derivation is needed depends on the format:

| Category | GENCODE GFF3 | GENCODE GTF | How to derive it |
|---|---|---|---|
| Promoter | No | No | A window around each transcript's TSS. The TSS is `start` on `+` strand and `end` on `−` strand. Window size is Q1. |
| 5′ UTR | **Yes**: `five_prime_UTR` | **No.** Only a single `UTR` type | From GTF: `UTR` segments upstream of the transcript's CDS, in transcript orientation. |
| 3′ UTR | **Yes**: `three_prime_UTR` | **No**, same as above | From GTF: `UTR` segments downstream of the CDS. |
| Exon (CDS / other) | Yes: `exon`, `CDS` | Yes: `exon`, `CDS` | Directly. Non-coding transcripts have exons and no CDS. |
| Intron | No | No | Transcript span minus its exons. |
| Downstream / TTS | No | No | A window past each transcript's end. Optional (Q7). |
| Intergenic | No | No | Everything not covered by any of the above. |

Feature counts, verified for M25 basic:

- **GTF:** 55,401 `gene`, 81,540 `transcript`, 527,731 `exon`, 428,717 `CDS`, 117,716
  `UTR`.
- **GFF3:** the same genes, transcripts and exons; 428,861 `CDS`; 68,996
  `five_prime_UTR`; 45,585 `three_prime_UTR`.

Neither format has `intron` or `promoter` lines. The GFF3 saves the one fiddly
derivation, splitting UTRs by CDS position and strand, which is why it's the preferred
input.

Categories overlap: an exon of one transcript can be an intron of another, and a promoter
can sit inside the intron of a neighbouring gene. Each peak or base therefore needs a
**priority order** to resolve which category wins (Q3).

## 5. Behaviour and constraints

### Coordinates

This is where these tools are wrong most often, and the error is always small enough to
look plausible.

- GTF and GFF3 are **1-based, closed**: `start..end` includes both ends.
- BED is **0-based, half-open**: `[start, end)`.
- Internally, everything is 0-based half-open. An annotation `start` becomes
  `start − 1`, and `end` is unchanged.
- If an interval library uses closed intervals, conversion happens at exactly one
  boundary in the code, and a test covers it (see §7).

### Chromosome names

GENCODE writes `chr1` … `chrM`. The reference peak CSV writes `1` … `19`, `X`, `Y`. Without reconciliation, **every
peak lands in "Intergenic"** and the chart looks like a real, if boring, result. The tool
must:

- normalise names (`1` ↔ `chr1`, `MT` ↔ `chrM`);
- report how many peaks are on chromosomes absent from the annotation;
- **refuse to draw** if more than 5% of peaks are unmatched, and show the unmatched names;
- below that threshold, **exclude unmatched peaks from the denominator**. They are not
  Intergenic: nothing is known about them. Each file's unmatched count appears in the
  table and the settings summary, so the bars always sum to 100% of the *matched*
  peaks, and the reader can see how many that is.

### Input validation

Every peak must have a chromosome, an integer start ≥ 0, and an integer end > start.
Rows that fail are counted and reported. They are never silently dropped and never
silently parsed. See §8: the BED library turns a CSV line into `NaN` coordinates without
raising an error.

### Performance

- Target: the reference annotation plus the five ENCODE peak files, from file drop to
  chart in **under 30 seconds** on a 2022-era laptop, without the tab becoming
  unresponsive.
- The annotation is streamed line by line. It is never held in memory as one string, and
  never as a full tree of feature objects: §8 shows a tree-building parser reaching
  5.6 GB on this file. Gzip is decoded with the browser's built-in `DecompressionStream`.
- Parsing and classification run in a **Web Worker**, with a progress indicator.
- Only the columns and feature types needed are kept. Attributes are parsed for the
  handful of keys used, and the keys differ by format:
  - **GFF3** relates features through `ID` and `Parent`. A transcript's identity is its
    `ID`; an exon, CDS or UTR belongs to the transcript named in its `Parent`, which can
    list several IDs separated by commas. This is the standard, and it is what the parser
    relies on.
  - **GTF** uses `transcript_id` on every line.
  - Both: `gene_type`, `transcript_type` and `tag`, for the transcript filter (Q4).

  GENCODE's GFF3 also copies `transcript_id` onto every line, so a parser keyed on
  `transcript_id` alone would pass every test on GENCODE and fail on any other GFF3.
  The fixture (§7.1) therefore writes its GFF3 **without** `transcript_id`.
- `##sequence-region` directives in a GFF3 give chromosome lengths, which the genome
  background needs (Q9). GENCODE M25's GFF3 has one for each of its 22 chromosomes;
  its GTF has none.

### Privacy

Nothing leaves the machine: no uploads, no analytics, no CDN calls. Libraries are served
from the same site as the page (§9). The page must state this.

## 6. Open questions

**Every one needs an answer before implementation starts.** Record each answer as a short
decision record in `adr/`, including the reason. Where a default is offered, it's there so
there is something to disagree with, not because it's right.

| # | Question | Why it matters | Reference points | Suggested default |
|---|---|---|---|---|
| Q1 | **How big is a promoter?** | It is the single biggest driver of the "Promoter" bar. | ChIPseeker `annotatePeak`: `tssRegion = c(-3000, 3000)`. HOMER: TSS −1 kb to +100 bp. | User-settable; default ±1 kb, with the choice shown on the chart |
| Q2 | **What is being counted?** (a) peaks, assigning each to its highest-priority overlapping category; (b) peaks, by the category at the peak **centre** or summit; (c) **base pairs**, as the fraction of total peak bp in each category | (a) and (b) can differ a lot for wide peaks. The Vahedi peaks run up to 93,567 bp, so a single peak can span five categories. In the other direction, the ENCODE H3K36me3 file breaks broad domains into tens of thousands of small pieces, so counting peaks weights long genes heavily. | HOMER classifies by peak centre. ChIPseeker assigns each peak one category by priority. | (b), with (c) available as a toggle |
| Q3 | **Priority order** when categories overlap | It changes the answer for every ambiguous base. | ChIPseeker default: Promoter > 5′UTR > 3′UTR > Exon > Intron > Downstream > Intergenic. HOMER: TSS > TTS > CDS exon > 5′UTR > 3′UTR > … | ChIPseeker order |
| Q4 | **Which transcripts count?** All in the file, `basic`-tagged only, protein-coding only, or one per gene | Every extra transcript adds promoters and removes introns. | GENCODE ships a separate `basic` file, which is already filtered. | Whatever is in the file, plus an optional protein-coding filter |
| Q5 | **Chromosome handling:** chrM, unplaced scaffolds, sex chromosomes | They affect both matching and the genome background (Q9). | | Keep all; report unmatched |
| Q6 | **What coordinate base is a CSV in?** | BED is 0-based by definition; a CSV is whatever its author meant. The reference CSV doesn't say. | | Assume 0-based, show a warning, and let the user flip it |
| Q7 | **Include a Downstream/TTS category?** If so, how far? | It takes peaks away from Intergenic. | ChIPseeker: "Downstream". HOMER: TTS −100 bp to +1 kb. | Off |
| Q8 | **Split Exon** into CDS vs non-coding exon? | Biologically meaningful, and costs one more colour. | HOMER separates CDS exons. | No |
| Q9 | **Show a genome background bar?** This is the genome's own composition under the same rules. It is the answer rule (b) would give for peak centres dropped uniformly at random. | Without it, "30% promoter" has nothing to compare against. It needs chromosome lengths: GFF3 `##sequence-region` lines have them, GTF doesn't, and a chromosome-sizes file can supply them (UCSC's [`mm10.chrom.sizes`](https://hgdownload.soe.ucsc.edu/goldenPath/mm10/bigZips/mm10.chrom.sizes)). | | Yes, when lengths are available: from the GFF3, or from an optional chrom.sizes input. Otherwise the bar is hidden, and the page says why. |
| Q10 | **Multiple files:** how are they labelled and ordered, and is splitting one file by a column (e.g. `log2FoldChange > 0`) in scope? | Splitting the reference CSV is the natural demo. | | Label from filename, keep input order; splitting is a stretch goal |
| Q11 | **Annotation formats and parser.** GFF3, GTF, or both? Library, or hand-written? | See §8. `@gmod/gff` needs 5.6 GB on the reference GFF3; `@gmod/gtf` is stale and built on Node streams. Both formats are nine tab-separated columns and differ only in attribute syntax. | | Both formats, one hand-written streaming parser, with tests |
| Q12 | **Wrong genome build.** mm10 peaks against an mm39 annotation will produce a chart, just a wrong one. | Nothing checks for it. GENCODE M26 onward is mm39. | | Warn if the annotation header names a different assembly from one the user states |

## 7. Acceptance tests

Each test must exist and pass before the work is called done.

1. **Hand-built fixture.** One `+` and one `−` strand transcript (two exons, UTRs, one
   intron each), written out **as both GFF3 and GTF**, and a BED file with about 12
   peaks placed deliberately: inside the promoter window, straddling the window edge by
   1 bp, on the exact first and last base of an exon, entirely in an intron, spanning
   exon and intron, beyond the gene, and on a chromosome absent from the annotation.
   **The expected category for every peak is written down by a human before any code
   runs.** Both annotation formats must give identical results. The GFF3 version uses
   only `ID` and `Parent` to link features, with no `transcript_id`, so it proves the
   parser handles standard GFF3 and not just GENCODE's.
2. **Off-by-one test.** A peak at BED `[99, 100)` and an exon at annotation `100..200`
   must overlap. A peak at `[200, 201)` must not.
3. **Strand test.** The promoter of the `−` strand transcript sits past its `end`, not
   before its `start`.
4. **Name mismatch test.** Peaks named `1` against an annotation with `chr1` match after
   normalisation. With normalisation disabled, the tool refuses to draw.
5. **Bad row test.** A CSV fed to the BED path produces a clear error, not a chart.
6. **Cross-check against an independent tool.** Run the same data through something
   that isn't this code, with settings matched as closely as possible, and compare.
   Where the numbers disagree, the difference gets explained, not tuned away. Run once,
   by hand, and record it in the ledger. Two routes:
   - **ChIPseeker** (R): set `tssRegion` and priority to match your decisions.
   - **bedtools**: build promoter, exon and transcript BED files from the annotation,
     `bedtools merge` each, then assign peak centres in priority order with repeated
     `bedtools intersect -u` / `-v`. It's about fifteen lines of shell and matches
     counting rule (b) directly.
7. **Performance.** The reference files, timed in a browser, on the numbers in §5.
8. **Biology sanity check.** Before running the ENCODE thymus files, write down which
   bar should be the most promoter-heavy, which should have almost nothing intergenic,
   and why. Then compare. A chart that contradicts well-established biology is a bug
   until proven otherwise, and a chart that matches it is not proof of anything — but a
   mismatch is the cheapest bug detector available.

## 8. Research findings

Checked on 2026-09-23 by installing the packages and running them, not from memory. The
first draft, written from recall, got three things wrong:

- It named `bed-utils` and `js-interval-tree`. **Neither package exists on npm.** An
  invented package name is worse than a mistake, because anyone can register the name
  later and fill it with whatever they like. Check that a package exists, and who
  publishes it, before installing anything an agent names.
- It said `@gmod/gff` parses GTF. It doesn't (see below).

| Package | Version | Verdict |
|---|---|---|
| [`@gmod/gff`](https://github.com/GMOD/gff-js) | 2.1.0 | **GFF3 only; it does not read GTF.** Easy to get wrong, because GTF is often loosely called "GFF". Maintained, no dependencies, and uses web `TransformStream`, so it runs in a browser. **But it can't stream GENCODE.** It builds parent–child trees and releases them only at a `###` sync mark, and GENCODE's GFF3 has none. Measured on the reference file, it emitted nothing for 12 s (the end of the file), and the Node heap peaked at **5.6 GB**, which is beyond what a browser tab gets. Fine for small files; wrong for this one. |
| [`@gmod/gtf`](https://github.com/GMOD/gtf-js) | 0.0.9 | Reads GTF. Last release **2023-10**. Built on Node streams (it depends on `stream-browserify`). Its README says "for JBrowse, we generally encourage GFF3 over GTF". Usable, but a GTF line is nine tab-separated columns and a hand-written parser is small and easy to test. |
| [`@gmod/bed`](https://github.com/GMOD/bed-js) | 2.3.0 | Good BED parser, actively maintained (August 2026). narrowPeak uses `new BED({ type: 'bigNarrowPeak' })`; `'narrowPeak'` throws "Type not found". **It does not validate:** `parseLine('chr1,100,200')` returns `chromStart: NaN` with no error. Lines must also be filtered for headers and comments first. |
| [`@flatten-js/interval-tree`](https://github.com/alexbol99/flatten-interval-tree) | 2.0.3 | Straightforward 1-D interval tree. **Intervals are closed:** `[100,199]` and `[199,200]` overlap. Half-open BED intervals must be inserted as `[start, end − 1]`, or every boundary base is double-counted. |
| [`flatbush`](https://github.com/mourner/flatbush) | 4.6.2 | Static, very fast packed spatial index. It is 2-D, so a 1-D use needs `y = 0`. Worth considering if the interval tree is too slow to build. The annotation index is built once and never modified, which suits a static index. |
| [`@observablehq/plot`](https://observablehq.com/plot/) | 0.6.17 | One call renders a 100%-stacked bar chart: `Plot.barX(data, Plot.stackX({x: "n", y: "file", fill: "category", offset: "normalize"}))`. Vega-Lite 6.4.3 is the alternative if an interactive spec is wanted. |

Prior art for the definitions, from primary sources:

- **ChIPseeker** `annotatePeak` defaults, taken from `R/annotatePeak.R` on its `devel`
  branch: `tssRegion = c(-3000, 3000)`, `level = "transcript"`, and
  `genomicAnnotationPriority = c("Promoter", "5UTR", "3UTR", "Exon", "Intron",
  "Downstream", "Intergenic")`.
- **HOMER** `annotatePeaks.pl`, from its
  [annotation documentation](http://homer.ucsd.edu/homer/ngs/annotation.html), classifies
  "the region occupied by the center of the peak". Its TSS runs from −1 kb to +100 bp and
  its TTS from −100 bp to +1 kb. Priority is TSS, TTS, CDS exons, 5′ UTR exons, and so on.

The two most-used tools disagree on promoter size **and** on whether a peak is classified
by its centre or by any overlap. Q1 and Q2 are real decisions, not formalities.

## 9. Architecture and work breakdown

Plain ES modules; **running the app needs no build step**. Pages serves a copy of
`index.html`, `src/`, `vendor/` and `examples/`.

The page can't `import '@observablehq/plot'` directly, because a browser can't resolve an
npm package name, and a CDN would break the privacy rule (§5). So Plot is bundled once
into `vendor/` and **checked in** (ADR-0015). `npm run vendor` regenerates it, together
with `THIRD_PARTY_LICENSES.md`, and CI fails if the checked-in copy drifts. Source
imports it by relative path (`import * as Plot from '../vendor/plot.js'`), which works in
the page, a worker and Node tests alike. There is no interval-tree dependency:
classification uses a priority-resolved partition (ADR-0016).

```
index.html            page shell                                   (issue: page shell)
src/constants.js      category keys, labels, defaults — shared, exists already
src/io.js             File/stream → lines, gzip detected by magic  (issue: annotation parser)
src/annotation.js     GFF3/GTF lines → flat features, streaming    (issue: annotation parser)
src/peaks.js          BED/narrowPeak/CSV text → validated peaks    (issue: peak parser)
src/annotate.js       feature stream → per-category intervals      (issue: annotation model)
src/classify.js       partition, centre/bp counts, background      (issue: overlap engine)
src/chart.js          results → Plot chart, table, CSV/SVG/PNG     (issue: chart)
src/app.js            UI state, file inputs, settings form         (issue: page shell)
src/pipeline.js       main-thread API over the worker              (issue: integration)
src/worker.js         runs parse → annotate → classify off-thread  (issue: integration)
vendor/               generated; never edited by hand
test/fixtures/        the hand-built fixture and expected.json (§7, ADR-0014)
test/*.test.js        node --test
```

**The interfaces are fixed first, so the issues can be built in parallel.** Each module
exports plain functions over plain objects. Category keys come from `src/constants.js`:
`promoter`, `utr5`, `utr3`, `exon`, `intron`, `intergenic`.

```js
// io.js         linesFromFile(file: Blob) → AsyncIterable<string>
//               linesFromStream(stream: ReadableStream<Uint8Array>) → AsyncIterable<string>
//               Gzip detected by the 1f 8b magic bytes, not the file name; decoded with
//               DecompressionStream. Handles \n and \r\n, and a final line with no newline.
//
// annotation.js parseAnnotationLines(lines: AsyncIterable<string> | Iterable<string>,
//                                    {format: "gff3" | "gtf" | "auto"}) → AsyncIterable<
//                 | {kind: "feature", chrom, start, end, strand, type, id, parents, attrs}
//                 | {kind: "sequenceRegion", chrom, length}
//                 | {kind: "assembly", name}>
//               start/end 0-based half-open. id: string | null. parents: string[].
//               GTF is normalised to the same id/parents model: a transcript line gets
//               id = transcript_id, parents = [gene_id]; exon/CDS/UTR lines get
//               id = null, parents = [transcript_id]; a gene line gets id = gene_id.
//               attrs holds only gene_type, transcript_type and tag, when present.
//               Only needed features are yielded: exon, CDS, UTR, five_prime_UTR,
//               three_prime_UTR, plus any feature with an id (genes, transcripts, mRNA…).
//
// peaks.js      parsePeaks(text: string, {format: "bed" | "csv" | "auto", oneBased?: boolean})
//                 → {peaks: [{chrom, start, end, name}], rejected: [{lineNumber, line, reason}],
//                    format}
//               BED/narrowPeak/broadPeak: skip blank, #, track and browser lines.
//               CSV/TSV: header required; columns found by name (ADR-0007).
//               oneBased converts 1-based closed CSV coordinates (start − 1).
//
// annotate.js   buildAnnotation(features: AsyncIterable, {proteinCodingOnly})
//                 → Promise<{transcripts: number, chromLengths: Map<chrom, length>,
//                            assembly: string | null, byChrom: Map<chrom, {
//                              tss: [[pos, strand]...], utr5: [[s, e]...], utr3: [[s, e]...],
//                              exon: [[s, e]...], transcript: [[s, e]...]}>}>
//               Consumes the stream incrementally (ADR-0016). A transcript is any id that
//               is the parent of an exon. GTF UTRs split into 5'/3' by CDS position and
//               strand. Also returns stats: {proteinCodingFilter: "off" | "applied" |
//               "unavailable", …}, so the page can say when the filter couldn't apply.
//               Promoters are NOT built here: they depend on a setting, so
//               the engine builds them from tss. Introns need no list of their own:
//               transcript spans enter the partition just above intergenic, so any
//               transcript base not claimed by a higher category is intron.
//
// classify.js   buildPartition(annotation, {promoterUpstream, promoterDownstream, priority})
//                 → Map<chrom, {starts: Int32Array|number[], ends, categories}>
//               classifyPeaks(partition, peaks, {mode: "centre" | "bp"})
//                 → {counts: {category: n}, matched, unmatched, unmatchedChroms: string[],
//                    peaks: {matched, unmatched}, outOfRange, perPeak: [category | "unmatched"]}
//               counts, matched and unmatched are in the mode's unit: peaks in "centre"
//               mode, base pairs in "bp" mode. `peaks` always counts peaks, because the
//               5% refusal rule (ADR-0006) is about peaks whatever the mode.
//               genomeBackground(partition, chromLengths) → {counts: {category: bp}, total}
//               normaliseChrom(name) → key used for matching (ADR-0006)
//
// chart.js      render(el, results, settings, meta) → void
//               results: [{label, counts, matched, unmatched, mode, peaks?, refused?: string}]
//               (a background row has label "Genome" and background: true)
//               toCSV(results, summary?) → string; when summary is given, the first
//               line is "# <summary>" (pandas comment="#", R comment.char="#").
//               settingsSummary(settings, meta) → string
```

All coordinates crossing these boundaries are 0-based half-open. That is the contract, and
every module's tests assert it.

### Issues

| Issue | Depends on | Parallel? |
|---|---|---|
| Record decisions for Q1–Q12 in `adr/` | nothing | **First, and done by a human** |
| Test fixture and expected answers (§7.1–7.3) | decisions | Human writes the expected answers; an agent may write the files |
| Annotation parser (GFF3 and GTF) | interfaces | ✅ |
| Peak parser and validation | interfaces | ✅ |
| Chart, table and downloads, using mock counts | interfaces | ✅ |
| Page shell, file inputs and settings form | interfaces | ✅ |
| Annotation model: derive promoter, UTR, intron and intergenic intervals | annotation parser, fixture | Single owner. This is where the bugs live. |
| Overlap engine and counting rule | annotation model, fixture | Single owner, same person as above |
| Integration: worker, streaming, progress, example data | everything above | After the engine merges |
| Independent cross-check (§7.6) and biology check (§7.8) | everything | Human-run, recorded in the ledger |

The four parallel issues touch different files, so they merge cleanly. The
annotation-model and overlap-engine issues are kept serial and single-owner on purpose:
they are the part of the problem that is actually hard, and splitting them across agents
splits the understanding too.
