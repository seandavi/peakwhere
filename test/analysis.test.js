// The analysis behind the worker (src/analysis.js), run in Node on the hand-built fixture:
// counts, ADR-0006 refusal, warnings, chrom.sizes, per-peak output and the annotation cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { Analysis, ASSIGNMENT_COLUMNS, SupersededError } from "../src/analysis.js";
import { CATEGORIES } from "../src/constants.js";

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const expected = JSON.parse(await fixture("expected.json"));
const GFF3 = await fixture("fixture.gff3");
const GTF = await fixture("fixture.gtf");
const PEAKS = await fixture("peaks.bed");
const SETTINGS = { ...expected.settings, mode: "centre", proteinCodingOnly: false };

const file = (text, name) => new File([text], name, { lastModified: 1 });
const countsOf = (row) => Object.fromEntries(CATEGORIES.map((c) => [c, row.counts[c]]));
const pick = (o) => Object.fromEntries(CATEGORIES.map((c) => [c, o[c]]));

/** Twenty more matched peaks, which bring chrZ's one peak under the 5% threshold. */
const EXTRA = Array.from({ length: 20 }, (_, i) => `chrF\t${100 + i}\t${101 + i}\textra${i}`).join("\n");

function request({ annotation = file(GFF3, "fixture.gff3"), peaks, chromSizes = null, ...settings } = {}) {
  return {
    annotation,
    chromSizes,
    peaks: peaks ?? [{ file: file(PEAKS, "peaks.bed"), label: "fixture" }],
    settings: { ...SETTINGS, ...settings },
  };
}

test("fixture GFF3, centre mode: counts, unmatched and Genome bar match expected.json", async () => {
  const { results, background, meta } = await new Analysis().run(request());
  const [row] = results;
  assert.equal(row.label, "fixture");
  assert.equal(row.mode, "centre");
  assert.deepEqual(countsOf(row), pick(expected.counts_centre));
  assert.equal(row.matched, expected.counts_centre.matched);
  assert.equal(row.unmatched, expected.counts_centre.unmatched);
  assert.deepEqual(row.peaks, { matched: 16, unmatched: 1 });

  assert.equal(background.label, "Genome");
  assert.equal(background.background, true);
  assert.equal(background.mode, "bp");
  assert.deepEqual(countsOf(background), pick(expected.genomeBackground_bp));
  assert.equal(background.matched, expected.genomeBackground_bp.total);
  assert.equal(meta.annotationName, "fixture.gff3");
  assert.equal(meta.transcripts, 3);
});

test("bp mode counts base pairs, and the fixture GTF gives the same counts as the GFF3", async () => {
  const bp = await new Analysis().run(request({ mode: "bp" }));
  assert.deepEqual(countsOf(bp.results[0]), pick(expected.basepairs));
  assert.equal(bp.results[0].matched, expected.basepairs.matched);
  assert.equal(bp.results[0].mode, "bp");

  const gtf = await new Analysis().run(request({ annotation: file(GTF, "fixture.gtf") }));
  assert.deepEqual(countsOf(gtf.results[0]), pick(expected.counts_centre));
});

test("more than 5% of peaks unmatched: the file is refused, naming the chromosomes (ADR-0006)", async () => {
  // The fixture's chrZ peak is 1 of 17, 5.9%.
  const { results, warnings } = await new Analysis().run(request());
  assert.match(results[0].refused, /^5\.9% of peaks \(1 of 17\) are on chromosomes not in the annotation: chrZ$/);
  assert.ok(!warnings.some((w) => w.includes("left out of the percentages")), "the refusal already names them");
});

test("5% or fewer unmatched: the file is drawn, and a warning names the unmatched chromosomes", async () => {
  const peaks = [{ file: file(`${PEAKS}\n${EXTRA}\n`, "more.bed"), label: "more" }];
  const { results, warnings } = await new Analysis().run(request({ peaks }));
  assert.equal(results[0].refused, undefined);
  assert.deepEqual(results[0].peaks, { matched: 36, unmatched: 1 });
  assert.ok(warnings.includes("more: 1 peak on chromosomes not in the annotation, left out of the percentages: chrZ."));
});

test("a file with no valid peaks is refused with the first rejection, and rejected rows are warned about", async () => {
  const peaks = [
    { file: file("chrF 100 200\nnot a peak\n", "bad.bed"), label: "bad" },
    { file: file(`${EXTRA}\nchrF\t500\t400\tbackwards\n`, "some.bed"), label: "some" },
  ];
  const { results, warnings } = await new Analysis().run(request({ peaks }));
  assert.match(results[0].refused, /^no valid peaks; all 2 rows rejected \(line 1: expected at least 3 tab-separated columns/);
  assert.equal(results[1].refused, undefined);
  assert.ok(warnings.includes("some: 1 row rejected and not counted (first: line 21, end 400 is not greater than start 500)."));
});

test("peaks past their chromosome's end are warned about, naming the annotation's assembly (ADR-0013)", async () => {
  const gff3 = GFF3.replace("##gff-version 3\n", "##gff-version 3\n#description: GRCm38\n");
  const peaks = [{ file: file(`${EXTRA}\nchrF\t29950\t30050\tpast_end\n`, "p.bed"), label: "p" }];
  const { warnings, meta } = await new Analysis().run(request({ annotation: file(gff3, "a.gff3"), peaks }));
  assert.equal(meta.assembly, "GRCm38");
  assert.ok(warnings.includes(
    "p: 1 peak runs past the end of its chromosome. The peaks may be on a different genome build " +
      "from the annotation (GRCm38).",
  ));
});

test("CSV input warns about its coordinate reading, and the 1-based toggle shifts start (ADR-0007)", async () => {
  const csv = await fixture("peaks-as-csv.txt");
  const run = (oneBased) =>
    new Analysis().run(request({ peaks: [{ file: file(csv, "p.csv"), label: "csv", oneBased }] }));
  const zero = await run(false);
  assert.ok(zero.warnings.some((w) => w.startsWith("csv: CSV/TSV read as 0-based half-open coordinates")));
  const one = await run(true);
  assert.ok(one.warnings.includes("csv: CSV/TSV read as 1-based closed coordinates, as you marked it."));
  const [zeroLine] = (await zero.assignments.text()).split("\n");
  const [oneLine] = (await one.assignments.text()).split("\n");
  assert.equal(zeroLine.split("\t").slice(2, 4).join("-"), "4500-4600");
  assert.equal(oneLine.split("\t").slice(2, 4).join("-"), "4499-4600");
});

test("no chromosome lengths (GTF): no Genome bar, and a warning says why", async () => {
  const { background, warnings } = await new Analysis().run(request({ annotation: file(GTF, "fixture.gtf") }));
  assert.equal(background, null);
  assert.ok(warnings.some((w) => w.startsWith("The Genome bar is hidden: the annotation gives no chromosome lengths")));
});

test("chrom.sizes fills in lengths by normalised name, gzipped or not; other contigs are ignored", async () => {
  const sizes = "# mm-ish\nF\t30000\nchrUn_JH584304\t114452\n";
  for (const chromSizes of [file(sizes, "x.chrom.sizes"), file(gzipSync(sizes), "x.chrom.sizes.gz")]) {
    const { background, warnings, results } = await new Analysis().run(
      request({ annotation: file(GTF, "fixture.gtf"), chromSizes }),
    );
    assert.deepEqual(countsOf(background), pick(expected.genomeBackground_bp));
    assert.equal(background.matched, 30000, "chrUn_JH584304 isn't in the annotation, so it isn't in the background");
    assert.deepEqual(results[0].peaks, { matched: 16, unmatched: 1 });
    assert.ok(!warnings.some((w) => w.includes("Genome bar")));
  }
});

test("a chrom.sizes length that disagrees with ##sequence-region is warned about; the annotation's wins", async () => {
  const chromSizes = file("chrF\t40000\n", "other.sizes");
  const { background, warnings } = await new Analysis().run(request({ chromSizes }));
  assert.equal(background.matched, 30000);
  assert.ok(warnings.includes(
    "other.sizes gives different lengths from the annotation for chrF; the annotation's were used. " +
      "The two may be for different genome builds.",
  ));
});

test("a malformed chrom.sizes line is an error, not a guess", async () => {
  await assert.rejects(
    new Analysis().run(request({ chromSizes: file("chrF\tlots\n", "bad.sizes") })),
    /bad\.sizes, line 1: expected a name and a length/,
  );
});

test("an annotation part-covered by lengths: the Genome bar says which chromosomes it leaves out", async () => {
  const gff3 = `${GFF3}chrG\tfixture\ttranscript\t101\t200\t.\t+\t.\tID=tG\nchrG\tfixture\texon\t101\t200\t.\t+\t.\tParent=tG\n`;
  const { warnings } = await new Analysis().run(request({ annotation: file(gff3, "two.gff3") }));
  assert.ok(warnings.includes(
    "The Genome bar covers only the chromosomes with a known length; 1 annotated chromosome has none: chrG.",
  ));
});

test("the protein-coding filter's 'unavailable' state is a warning (ADR-0005)", async () => {
  const untyped = GFF3.replace(/;(gene|transcript)_type=[^;\n]*/g, "");
  const { warnings, meta } = await new Analysis().run(
    request({ annotation: file(untyped, "untyped.gff3"), proteinCodingOnly: true }),
  );
  assert.equal(meta.proteinCodingFilter, "unavailable");
  assert.ok(warnings.some((w) => w.startsWith("The protein-coding filter wasn't applied")));

  const typed = await new Analysis().run(request({ proteinCodingOnly: true }));
  assert.equal(typed.meta.proteinCodingFilter, "applied");
  assert.ok(!typed.warnings.some((w) => w.includes("protein-coding")));
});

test("per-peak assignments: one line per input peak, with the expected category (SPEC §3.4)", async () => {
  const { assignments } = await new Analysis().run(request());
  const lines = (await assignments.text()).trimEnd().split("\n").map((l) => l.split("\t"));
  assert.equal(ASSIGNMENT_COLUMNS, "file\tchrom\tstart\tend\tname\tcategory\n");
  assert.equal(lines.length, Object.keys(expected.perPeak_centre).length);
  for (const [label, , , , name, category] of lines) {
    assert.equal(label, "fixture");
    assert.equal(category, expected.perPeak_centre[name], name);
  }
  assert.deepEqual(lines[0], ["fixture", "chrF", "4500", "4600", "p01_promoter_upstream_of_tA", "promoter"]);
});

test("changing settings or labels reuses the parsed annotation; a new filter value or file re-parses", async () => {
  const analysis = new Analysis();
  const annotation = file(GFF3, "fixture.gff3");
  const first = await analysis.run(request({ annotation }));
  assert.equal(first.meta.annotationCached, false);

  // A File posted to a worker arrives as a new object: equal name, size and date still hit.
  const again = await analysis.run(request({
    annotation: file(GFF3, "fixture.gff3"),
    promoterUpstream: 0,
    promoterDownstream: 0,
    mode: "bp",
    peaks: [{ file: file(PEAKS, "peaks.bed"), label: "renamed" }],
  }));
  assert.equal(again.meta.annotationCached, true);
  assert.equal(again.results[0].label, "renamed");
  assert.notDeepEqual(countsOf(again.results[0]), countsOf(first.results[0]));

  const filtered = await analysis.run(request({ annotation, proteinCodingOnly: true }));
  assert.equal(filtered.meta.annotationCached, false);
  const filteredAgain = await analysis.run(request({ annotation, proteinCodingOnly: true }));
  assert.equal(filteredAgain.meta.annotationCached, true);
  const unfilteredAgain = await analysis.run(request({ annotation }));
  assert.equal(unfilteredAgain.meta.annotationCached, true, "both filter values stay cached");

  const other = await analysis.run(request({ annotation: file(GTF, "fixture.gtf") }));
  assert.equal(other.meta.annotationCached, false);
});

test("progress runs from 0 to 1 and ends with Done", async () => {
  const seen = [];
  await new Analysis().run(request(), { onProgress: (p) => seen.push(p) });
  assert.equal(seen[0].message, "Reading fixture.gff3");
  assert.deepEqual(seen.at(-1), { message: "Done", fraction: 1 });
  const fractions = seen.map((p) => p.fraction);
  assert.ok(fractions.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= fractions[i - 1])), String(fractions));
  assert.ok(seen.some((p) => p.message === "Classifying fixture"));
});

test("a superseded run stops with SupersededError, and its finished annotation parse is kept", async () => {
  const analysis = new Analysis();
  await assert.rejects(analysis.run(request(), { shouldStop: () => true }), SupersededError);
  const next = await analysis.run(request());
  assert.equal(next.meta.annotationCached, true);
});
