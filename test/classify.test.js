import { test } from "node:test";
import assert from "node:assert/strict";
import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
import { buildAnnotation } from "../src/annotate.js";
import { parseAnnotationLines } from "../src/annotation.js";
import { buildPartition, classifyPeaks, genomeBackground, normaliseChrom } from "../src/classify.js";
import { CATEGORIES, MAX_UNMATCHED_FRACTION } from "../src/constants.js";
import { linesFromFile } from "../src/io.js";
import { parsePeaks } from "../src/peaks.js";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const expected = JSON.parse(await readFile(fixture("expected.json"), "utf8"));
const peaksOf = async (name) => parsePeaks(await readFile(fixture(name), "utf8")).peaks;

const annotationOf = async (name, options) =>
  buildAnnotation(parseAnnotationLines(linesFromFile(await openAsBlob(fixture(name)))), options);

/** Annotation from GFF3 lines, through the real parser. */
const fromLines = (lines) => buildAnnotation(parseAnnotationLines(lines));

const gff3 = (type, start, end, strand, attributes, chrom = "chrF") =>
  [chrom, "t", type, start, end, ".", strand, ".", attributes].join("\t");

const pick = (object, keys) => Object.fromEntries(keys.map((k) => [k, object[k]]));

/** A partition's segments as [start, end, category] triples. */
const segments = (partition, chrom) => {
  const { starts, ends, categories } = partition.get(chrom);
  return [...starts].map((s, i) => [s, ends[i], CATEGORIES[categories[i]]]);
};

for (const name of ["fixture.gff3", "fixture.gtf"]) {
  test(`${name} + peaks.bed: every peak's centre category matches expected.json`, async () => {
    const partition = buildPartition(await annotationOf(name));
    const peaks = await peaksOf("peaks.bed");
    const result = classifyPeaks(partition, peaks, { mode: "centre" });
    assert.equal(peaks.length, 17);
    const got = Object.fromEntries(peaks.map((p, i) => [p.name, result.perPeak[i]]));
    assert.deepEqual(got, expected.perPeak_centre);

    const want = expected.counts_centre;
    assert.deepEqual(result.counts, pick(want, CATEGORIES));
    assert.equal(result.matched, want.matched);
    assert.equal(result.unmatched, want.unmatched);
    assert.deepEqual(result.unmatchedChroms, want.unmatchedChroms);
    assert.deepEqual(result.peaks, { matched: 16, unmatched: 1 });
    assert.equal(result.outOfRange, 0);
  });

  test(`${name} + peaks.bed: base-pair counts match expected.json`, async () => {
    const partition = buildPartition(await annotationOf(name));
    const result = classifyPeaks(partition, await peaksOf("peaks.bed"), { mode: "bp" });
    assert.deepEqual(result.counts, pick(expected.basepairs, CATEGORIES));
    assert.equal(result.matched, expected.basepairs.matched);
    // The chrZ peak is [100, 200): 100 bp, unmatched, and still one peak.
    assert.equal(result.unmatched, 100);
    assert.deepEqual(result.peaks, { matched: 16, unmatched: 1 });
  });
}

test("the partition's promoter segments are expected.json's promoter windows (ADR-0002)", async () => {
  for (const name of ["fixture.gff3", "fixture.gtf"]) {
    const partition = buildPartition(await annotationOf(name));
    const promoters = segments(partition, "chrF").filter(([, , c]) => c === "promoter");
    const windows = promoters.map(([s, e]) => [s, e]);
    assert.deepEqual(windows, expected.derivedIntervals_0based_halfOpen.promoter, name);
  }
});

test("genome background from the GFF3 fixture matches expected.json; the GTF has no lengths", async () => {
  const gff3Annotation = await annotationOf("fixture.gff3");
  const background = genomeBackground(buildPartition(gff3Annotation), gff3Annotation.chromLengths);
  assert.deepEqual(background.counts, pick(expected.genomeBackground_bp, CATEGORIES));
  assert.equal(background.total, expected.genomeBackground_bp.total);

  const gtfAnnotation = await annotationOf("fixture.gtf");
  const none = genomeBackground(buildPartition(gtfAnnotation), gtfAnnotation.chromLengths);
  assert.equal(none.total, 0);
  // With lengths from elsewhere (a chrom.sizes file, ADR-0010), named the other way.
  const sized = genomeBackground(buildPartition(gtfAnnotation), new Map([["F", 30000], ["chrZ", 500]]));
  assert.deepEqual(sized, background);
});

test("peaks-nochr.bed matches after normalisation, and none match without it (SPEC §7.4)", async () => {
  const partition = buildPartition(await annotationOf("fixture.gff3"));
  const withChr = await peaksOf("peaks.bed");
  const noChr = await peaksOf("peaks-nochr.bed");
  assert.ok(noChr.every((p) => !p.chrom.startsWith("chr")));
  for (const mode of ["centre", "bp"]) {
    const a = classifyPeaks(partition, withChr, { mode });
    const b = classifyPeaks(partition, noChr, { mode });
    assert.deepEqual(b.perPeak, a.perPeak, mode);
    assert.deepEqual(b.counts, a.counts, mode);
    assert.deepEqual([b.matched, b.unmatched, b.peaks], [a.matched, a.unmatched, a.peaks], mode);
    assert.deepEqual(b.unmatchedChroms, ["Z"], mode);
  }

  const exact = classifyPeaks(partition, noChr, { normalise: false });
  assert.deepEqual(exact.peaks, { matched: 0, unmatched: 17 });
  assert.equal(exact.matched, 0);
  assert.ok(exact.perPeak.every((c) => c === "unmatched"));
  assert.deepEqual(exact.unmatchedChroms, ["F", "Z"]);
  assert.ok(exact.peaks.unmatched / noChr.length > MAX_UNMATCHED_FRACTION);
});

test("normaliseChrom strips chr in any case and unifies M and MT (ADR-0006)", () => {
  const cases = [
    ["chr1", "1"],
    ["1", "1"],
    ["Chr1", "1"],
    ["CHRX", "X"],
    ["chrM", "M"],
    ["chrMT", "M"],
    ["MT", "M"],
    ["M", "M"],
    ["mt", "M"],
    ["chrUn_JH584304", "Un_JH584304"],
    ["chr4_GL456216_random", "4_GL456216_random"],
    ["JH584304.1", "JH584304.1"],
  ];
  for (const [name, key] of cases) assert.equal(normaliseChrom(name), key, name);
});

test("an exon at 100..200 overlaps a peak at [99, 100) and not one at [200, 201) (SPEC §7.2)", async () => {
  // − strand, so the TSS is far away at 999 and a zero-width window stays clear of 100.
  const annotation = await fromLines([
    gff3("exon", 100, 200, "-", "Parent=t"),
    gff3("exon", 901, 1000, "-", "Parent=t"),
  ]);
  const partition = buildPartition(annotation, { promoterUpstream: 0, promoterDownstream: 0 });
  const peaks = [
    { chrom: "chrF", start: 99, end: 100 },
    { chrom: "chrF", start: 200, end: 201 },
    { chrom: "chrF", start: 98, end: 99 },
  ];
  assert.deepEqual(classifyPeaks(partition, peaks).perPeak, ["exon", "intron", "intergenic"]);
  assert.deepEqual(classifyPeaks(partition, peaks, { mode: "bp" }).counts, {
    promoter: 0,
    utr5: 0,
    utr3: 0,
    exon: 1,
    intron: 1,
    intergenic: 1,
  });
});

test("promoter windows: upstream is strand-aware, TSS base included, clipped at 0 (ADR-0002)", async () => {
  const annotation = await fromLines([
    gff3("exon", 1001, 2000, "+", "Parent=plus"),
    gff3("exon", 4001, 5000, "-", "Parent=minus"),
    gff3("exon", 51, 60, "+", "Parent=nearZero"),
  ]);
  const partition = buildPartition(annotation, { promoterUpstream: 100, promoterDownstream: 10 });
  const promoters = segments(partition, "chrF").filter(([, , c]) => c === "promoter");
  // TSSs: 1000 (+), 4999 (−), 50 (+).
  assert.deepEqual(promoters, [
    [0, 61, "promoter"],
    [900, 1011, "promoter"],
    [4989, 5100, "promoter"],
  ]);
});

test("priority from settings decides which category wins; every layered category is required", async () => {
  const annotation = await annotationOf("fixture.gff3");
  const peaks = await peaksOf("peaks.bed");
  const exonFirst = ["promoter", "exon", "utr5", "utr3", "intron", "intergenic"];
  const result = classifyPeaks(buildPartition(annotation, { priority: exonFirst }), peaks);
  // UTRs are exonic, so exon above them leaves no UTR base.
  assert.equal(result.counts.utr5, 0);
  assert.equal(result.counts.utr3, 0);
  assert.equal(result.perPeak[peaks.findIndex((p) => p.name.startsWith("p04"))], "exon");
  assert.equal(result.counts.exon, 2 + 1 + 3);

  const intronFirst = ["intron", "promoter", "utr5", "utr3", "exon", "intergenic"];
  const all = segments(buildPartition(annotation, { priority: intronFirst }), "chrF");
  assert.deepEqual(
    all.filter(([, , c]) => c === "intron").map(([s, e]) => [s, e]),
    expected.derivedIntervals_0based_halfOpen.transcript,
  );

  const noUtr3 = ["promoter", "utr5", "exon", "intron"];
  assert.throws(() => buildPartition(annotation, { priority: noUtr3 }), /utr3/);
  assert.throws(() => buildPartition(annotation, { promoterUpstream: -1 }), /promoterUpstream/);
  assert.throws(() => classifyPeaks(new Map(), [], { mode: "summit" }), /mode/);
});

test("the partition agrees base by base with a brute-force priority lookup", () => {
  let seed = 42;
  const random = (n) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  const interval = () => {
    const s = random(1900);
    return [s, s + 1 + random(120)];
  };
  const priority = ["promoter", "utr5", "utr3", "exon", "intron", "intergenic"];
  for (let round = 0; round < 20; round++) {
    const layers = {
      tss: Array.from({ length: 1 + random(4) }, () => [random(2000), random(2) ? "+" : "-"]),
      utr5: Array.from({ length: random(5) }, interval),
      utr3: Array.from({ length: random(5) }, interval),
      exon: Array.from({ length: random(10) }, interval),
      transcript: Array.from({ length: 1 + random(4) }, interval),
    };
    const settings = { promoterUpstream: random(50), promoterDownstream: random(50), priority };
    const partition = buildPartition({ byChrom: new Map([["chrF", layers]]) }, settings);

    const expectedAt = (x) => {
      const inside = (list) => list.some(([s, e]) => s <= x && x < e);
      const promoters = layers.tss.map(([t, strand]) =>
        strand === "+"
          ? [t - settings.promoterUpstream, t + settings.promoterDownstream + 1]
          : [t - settings.promoterDownstream, t + settings.promoterUpstream + 1],
      );
      if (inside(promoters)) return "promoter";
      if (inside(layers.utr5)) return "utr5";
      if (inside(layers.utr3)) return "utr3";
      if (inside(layers.exon)) return "exon";
      if (inside(layers.transcript)) return "intron";
      return "intergenic";
    };
    const bases = Array.from({ length: 2200 }, (_, x) => ({ chrom: "chrF", start: x, end: x + 1 }));
    const got = classifyPeaks(partition, bases).perPeak;
    for (let x = 0; x < bases.length; x++) assert.equal(got[x], expectedAt(x), `round ${round}, base ${x}`);

    // Disjoint, sorted, non-empty, and never two touching segments of one category.
    const all = segments(partition, "chrF");
    for (let i = 0; i < all.length; i++) {
      assert.ok(all[i][0] < all[i][1]);
      if (i > 0) {
        assert.ok(all[i - 1][1] <= all[i][0]);
        assert.ok(all[i - 1][1] < all[i][0] || all[i - 1][2] !== all[i][2]);
      }
    }
  }
});

test("bp mode: perPeak is the majority category, ties to the higher priority", async () => {
  const partition = buildPartition(await annotationOf("fixture.gff3"));
  const peaks = [
    { chrom: "chrF", start: 15400, end: 15800 }, // 100 bp exon, 300 bp intron
    { chrom: "chrF", start: 8450, end: 8550 }, // 50 bp intron, 50 bp exon
    { chrom: "chrF", start: 8950, end: 9050 }, // 50 bp 3′ UTR, 50 bp intergenic
  ];
  assert.deepEqual(classifyPeaks(partition, peaks, { mode: "bp" }).perPeak, ["intron", "exon", "utr3"]);
  const intergenicFirst = ["intergenic", ...CATEGORIES.filter((c) => c !== "intergenic")];
  const reordered = classifyPeaks(partition, peaks, { mode: "bp", priority: intergenicFirst });
  assert.deepEqual(reordered.perPeak, ["intron", "exon", "intergenic"]);
});

test("unmatched chromosomes are listed once each, as written, in order of first appearance", () => {
  const partition = buildPartition({ byChrom: new Map() });
  const peaks = [
    { chrom: "chrZ", start: 0, end: 10 },
    { chrom: "Z", start: 0, end: 10 },
    { chrom: "chrZ", start: 20, end: 25 },
    { chrom: "chrUn_JH584304", start: 0, end: 10 },
  ];
  const result = classifyPeaks(partition, peaks, { mode: "bp" });
  assert.deepEqual(result.unmatchedChroms, ["chrZ", "Z", "chrUn_JH584304"]);
  assert.equal(result.unmatched, 35);
  assert.equal(result.matched, 0);
  assert.deepEqual(result.peaks, { matched: 0, unmatched: 4 });
});

test("outOfRange counts peaks ending past a known chromosome length (ADR-0013)", async () => {
  const peaks = [
    { chrom: "chrF", start: 29900, end: 30000 }, // ends on the last base: in range
    { chrom: "chrF", start: 29950, end: 30001 },
    { chrom: "chrF", start: 40000, end: 40100 },
    { chrom: "chrZ", start: 40000, end: 40100 }, // unmatched, so not counted here
  ];
  const withLength = classifyPeaks(buildPartition(await annotationOf("fixture.gff3")), peaks);
  assert.equal(withLength.outOfRange, 2);
  assert.deepEqual(withLength.perPeak, ["intergenic", "intergenic", "intergenic", "unmatched"]);
  const noLength = classifyPeaks(buildPartition(await annotationOf("fixture.gtf")), peaks);
  assert.equal(noLength.outOfRange, 0);
});

test("a chromosome with a length but no transcripts is intergenic, not unmatched", async () => {
  const annotation = await fromLines([
    "##gff-version 3",
    "##sequence-region chrF 1 3000",
    "##sequence-region chrE 1 500",
    gff3("exon", 2001, 2500, "+", "Parent=t"),
  ]);
  const partition = buildPartition(annotation);
  const result = classifyPeaks(partition, [{ chrom: "chrE", start: 10, end: 20 }]);
  assert.deepEqual(result.perPeak, ["intergenic"]);
  assert.equal(result.peaks.unmatched, 0);
  // The promoter window [1000, 3001) runs past chrF's end and is clipped there.
  assert.deepEqual(genomeBackground(partition, annotation.chromLengths), {
    counts: { promoter: 2000, utr5: 0, utr3: 0, exon: 0, intron: 0, intergenic: 1000 + 500 },
    total: 3500,
  });
});

test("100k peaks against 50k transcripts classify in well under a second", () => {
  let seed = 7;
  const random = (n) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed % n;
  };
  const chroms = Array.from({ length: 20 }, (_, i) => `chr${i + 1}`);
  const byChrom = new Map();
  for (const chrom of chroms) {
    const layers = { tss: [], utr5: [], utr3: [], exon: [], transcript: [] };
    let at = 0;
    for (let t = 0; t < 2500; t++) {
      at += 1000 + random(50000);
      const length = 2000 + random(40000);
      const plus = random(2) === 0;
      layers.transcript.push([at, at + length]);
      layers.tss.push(plus ? [at, "+"] : [at + length - 1, "-"]);
      for (let x = at; x < at + length; x += 500 + random(5000)) layers.exon.push([x, x + 100 + random(300)]);
      layers.utr5.push(plus ? [at, at + 150] : [at + length - 150, at + length]);
      layers.utr3.push(plus ? [at + length - 500, at + length] : [at, at + 500]);
    }
    for (const key of ["utr5", "utr3", "exon", "transcript"]) layers[key].sort((a, b) => a[0] - b[0]);
    layers.tss.sort((a, b) => a[0] - b[0]);
    byChrom.set(chrom, layers);
  }
  const peaks = Array.from({ length: 100_000 }, () => {
    const start = random(60_000_000);
    return { chrom: chroms[random(chroms.length)], start, end: start + 200 + random(2000) };
  });

  const began = performance.now();
  const partition = buildPartition({ byChrom });
  const centre = classifyPeaks(partition, peaks, { mode: "centre" });
  const bp = classifyPeaks(partition, peaks, { mode: "bp" });
  const elapsed = performance.now() - began;
  assert.equal(centre.peaks.matched, 100_000);
  assert.equal(centre.matched, 100_000);
  assert.equal(bp.matched, peaks.reduce((n, p) => n + p.end - p.start, 0));
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)} ms`);
});

test("with the filter on, peaks on a GTF chromosome with only a lncRNA are intergenic (#30)", async () => {
  const lncRNA = 'gene_id "gL"; transcript_id "tL"; gene_type "lncRNA"; transcript_type "lncRNA";';
  const gtf = [
    ...(await readFile(fixture("fixture.gtf"), "utf8")).split("\n").filter(Boolean),
    ["chrL", "t", "exon", 101, 500, ".", "+", ".", lncRNA].join("\t"),
  ];
  const annotation = await buildAnnotation(parseAnnotationLines(gtf), { proteinCodingOnly: true });
  const partition = buildPartition(annotation);
  const peaks = [
    { chrom: "chrL", start: 200, end: 300 }, // inside the dropped lncRNA's exon
    { chrom: "L", start: 5000, end: 5100 },
    { chrom: "chrZ", start: 0, end: 10 },
  ];
  const result = classifyPeaks(partition, peaks);
  assert.deepEqual(result.perPeak, ["intergenic", "intergenic", "unmatched"]);
  assert.deepEqual(result.peaks, { matched: 2, unmatched: 1 });
  assert.deepEqual(result.unmatchedChroms, ["chrZ"]);
  assert.equal(classifyPeaks(partition, peaks, { mode: "bp" }).counts.intergenic, 200);
});
