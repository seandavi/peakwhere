import { test } from "node:test";
import assert from "node:assert/strict";
import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
import { buildAnnotation } from "../src/annotate.js";
import { parseAnnotationLines } from "../src/annotation.js";
import { linesFromFile } from "../src/io.js";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const expected = JSON.parse(await readFile(fixture("expected.json"), "utf8"));
const derived = expected.derivedIntervals_0based_halfOpen;
const LAYERS = ["utr5", "utr3", "exon", "transcript"];
const FIXTURE_TSS = [
  [5000, "+"],
  [18999, "-"],
  [23000, "+"],
];

const fromFixture = async (name, options) =>
  buildAnnotation(parseAnnotationLines(linesFromFile(await openAsBlob(fixture(name)))), options);

const fixtureLines = async (name) => (await readFile(fixture(name), "utf8")).split("\n").filter(Boolean);

/** Annotation from GFF3 or GTF lines, through the real parser. */
const fromLines = (lines, options, format = "auto") =>
  buildAnnotation(parseAnnotationLines(lines, { format }), options);

const gff3 = (type, start, end, strand, attributes) =>
  ["chrF", "t", type, start, end, ".", strand, ".", attributes].join("\t");

/** Transcript spans minus exons: what the partition will call intron. */
const gaps = (spans, exons) => {
  const out = [];
  for (const [s, e] of spans) {
    let at = s;
    for (const [xs, xe] of exons) {
      if (xe <= s || xs >= e) continue;
      if (xs > at) out.push([at, xs]);
      at = Math.max(at, xe);
    }
    if (at < e) out.push([at, e]);
  }
  return out;
};

for (const name of ["fixture.gff3", "fixture.gtf"]) {
  test(`${name}: layers match expected.json, TSSs are strand-aware`, async () => {
    const annotation = await fromFixture(name);
    assert.deepEqual([...annotation.byChrom.keys()], ["chrF"]);
    const chrF = annotation.byChrom.get("chrF");
    for (const layer of LAYERS) assert.deepEqual(chrF[layer], derived[layer], layer);
    assert.deepEqual(chrF.tss, FIXTURE_TSS);
    assert.deepEqual(gaps(chrF.transcript, chrF.exon), derived.intron);
    assert.equal(annotation.transcripts, 3);
    assert.equal(annotation.stats.transcriptsInFile, 3);
    assert.equal(annotation.stats.proteinCodingFilter, "off");
  });
}

test("GFF3 and GTF fixtures give identical layers; only the GFF3 has lengths", async () => {
  const fromGff3 = await fromFixture("fixture.gff3");
  const fromGtf = await fromFixture("fixture.gtf");
  assert.deepEqual(fromGff3.byChrom, fromGtf.byChrom);
  assert.deepEqual(fromGff3.chromLengths, new Map([["chrF", 30000]]));
  assert.deepEqual(fromGtf.chromLengths, new Map());
  assert.equal(fromGff3.assembly, null);
});

test("children before their parent's line give the same layers (both formats)", async () => {
  for (const name of ["fixture.gff3", "fixture.gtf"]) {
    const lines = await fixtureLines(name);
    const header = lines.filter((l) => l.startsWith("#"));
    const reversed = [...header, ...lines.filter((l) => !l.startsWith("#")).reverse()];
    const inOrder = await fromFixture(name);
    const annotation = await fromLines(reversed);
    assert.deepEqual(annotation.byChrom, inOrder.byChrom, name);
    assert.equal(annotation.transcripts, 3, name);
  }
});

test("GTF UTR sides follow transcript orientation, not coordinates", async () => {
  const gtf = (type, start, end, strand, tx) =>
    ["chrF", "t", type, start, end, ".", strand, ".", `gene_id "g${tx}"; transcript_id "${tx}";`].join("\t");
  const annotation = await fromLines([
    // + strand: the low UTR is 5′.
    gtf("exon", 101, 400, "+", "p"),
    gtf("CDS", 201, 300, "+", "p"),
    gtf("UTR", 101, 200, "+", "p"),
    gtf("UTR", 301, 400, "+", "p"),
    // − strand: the high UTR is 5′.
    gtf("exon", 1101, 1400, "-", "m"),
    gtf("CDS", 1201, 1300, "-", "m"),
    gtf("UTR", 1101, 1200, "-", "m"),
    gtf("UTR", 1301, 1400, "-", "m"),
  ]);
  const chrF = annotation.byChrom.get("chrF");
  assert.deepEqual(chrF.utr5, [
    [100, 200],
    [1300, 1400],
  ]);
  assert.deepEqual(chrF.utr3, [
    [300, 400],
    [1100, 1200],
  ]);
  assert.deepEqual(chrF.tss, [
    [100, "+"],
    [1399, "-"],
  ]);
});

test("a generic UTR in a transcript with no CDS is in neither UTR layer, and counted", async () => {
  const annotation = await fromLines([
    gff3("transcript", 101, 400, "+", "ID=t"),
    gff3("exon", 101, 400, "+", "Parent=t"),
    gff3("UTR", 101, 200, "+", "Parent=t"),
  ]);
  const chrF = annotation.byChrom.get("chrF");
  assert.deepEqual([chrF.utr5, chrF.utr3, chrF.exon], [[], [], [[100, 400]]]);
  assert.equal(annotation.stats.utrsWithoutCds, 1);
});

test("a transcript is an id that parents an exon: genes, start codons and CDS-only ids are not", async () => {
  const annotation = await fromLines([
    gff3("gene", 101, 900, "+", "ID=g"),
    // The span and TSS come from the transcript's own line, not its exons' extent.
    gff3("mRNA", 101, 400, "+", "ID=t;Parent=g"),
    gff3("exon", 151, 350, "+", "ID=e1;Parent=t"),
    gff3("start_codon", 101, 103, "+", "ID=sc;Parent=t"),
    // An id with CDS and UTR children but no exon is not a transcript.
    gff3("mRNA", 601, 900, "+", "ID=noexons;Parent=g"),
    gff3("CDS", 601, 900, "+", "Parent=noexons"),
    gff3("five_prime_UTR", 601, 650, "+", "Parent=noexons"),
  ]);
  assert.equal(annotation.transcripts, 1);
  const chrF = annotation.byChrom.get("chrF");
  assert.deepEqual(chrF.transcript, [[100, 400]]);
  assert.deepEqual(chrF.exon, [[150, 350]]);
  assert.deepEqual(chrF.tss, [[100, "+"]]);
  assert.deepEqual(chrF.utr5, []);
});

test("an exon with several parents belongs to each", async () => {
  const lines = [
    gff3("transcript", 101, 1000, "-", "ID=a;transcript_type=protein_coding"),
    gff3("transcript", 101, 500, "-", "ID=b;transcript_type=lncRNA"),
    gff3("exon", 101, 200, "-", "Parent=a,b"),
    gff3("exon", 901, 1000, "-", "Parent=a"),
    gff3("exon", 401, 500, "-", "Parent=b"),
  ];
  const all = (await fromLines(lines)).byChrom.get("chrF");
  assert.deepEqual(all.exon, [
    [100, 200],
    [400, 500],
    [900, 1000],
  ]);
  assert.deepEqual(all.tss, [
    [499, "-"],
    [999, "-"],
  ]);
  const coding = (await fromLines(lines, { proteinCodingOnly: true })).byChrom.get("chrF");
  assert.deepEqual(coding.exon, [
    [100, 200],
    [900, 1000],
  ]);
  assert.deepEqual(coding.tss, [[999, "-"]]);
});

test("protein-coding filter drops a non-coding transcript, GFF3 and GTF", async () => {
  const lncGff3 = [
    gff3("gene", 10001, 12000, "+", "ID=gL;gene_type=lncRNA"),
    gff3("transcript", 10001, 12000, "+", "ID=tL;Parent=gL;transcript_type=lncRNA"),
    gff3("exon", 10001, 10500, "+", "Parent=tL"),
    gff3("exon", 11501, 12000, "+", "Parent=tL"),
  ];
  // No transcript line: the type comes from the exons, as in the GTF fixture's tC.
  const lncAttrs = 'gene_id "gL"; transcript_id "tL"; gene_type "lncRNA"; transcript_type "lncRNA";';
  const lncGtf = [10001, 11501].map((start) =>
    ["chrF", "t", "exon", start, start + 499, ".", "+", ".", lncAttrs].join("\t"),
  );
  for (const [name, extra] of [
    ["fixture.gff3", lncGff3],
    ["fixture.gtf", lncGtf],
  ]) {
    const lines = [...(await fixtureLines(name)), ...extra];
    const all = await fromLines(lines);
    assert.equal(all.transcripts, 4, name);
    assert.deepEqual(all.byChrom.get("chrF").tss.map(([pos]) => pos), [5000, 10000, 18999, 23000], name);
    assert.equal(all.stats.proteinCodingFilter, "off");

    const coding = await fromLines(lines, { proteinCodingOnly: true });
    assert.equal(coding.transcripts, 3, name);
    assert.equal(coding.stats.transcriptsInFile, 4, name);
    assert.equal(coding.stats.proteinCodingFilter, "applied", name);
    const chrF = coding.byChrom.get("chrF");
    assert.deepEqual(chrF.tss, FIXTURE_TSS, name);
    for (const layer of LAYERS) assert.deepEqual(chrF[layer], derived[layer], `${name} ${layer}`);
  }
});

test("protein-coding filter falls back to gene_type, then to the children", async () => {
  const annotation = await fromLines(
    [
      // Own feature: transcript_type wins over gene_type.
      gff3("transcript", 101, 200, "+", "ID=a;transcript_type=retained_intron;gene_type=protein_coding"),
      gff3("exon", 101, 200, "+", "Parent=a"),
      // Own feature with gene_type only.
      gff3("transcript", 301, 400, "+", "ID=b;gene_type=protein_coding"),
      gff3("exon", 301, 400, "+", "Parent=b"),
      // No type on the transcript line: taken from its child.
      gff3("transcript", 501, 600, "+", "ID=c"),
      gff3("exon", 501, 600, "+", "Parent=c;transcript_type=protein_coding"),
      // No type anywhere: dropped, because other transcripts do have one.
      gff3("transcript", 701, 800, "+", "ID=d"),
      gff3("exon", 701, 800, "+", "Parent=d"),
    ],
    { proteinCodingOnly: true },
  );
  assert.deepEqual(annotation.byChrom.get("chrF").transcript, [
    [300, 400],
    [500, 600],
  ]);
  assert.equal(annotation.stats.untypedTranscripts, 1);
  assert.equal(annotation.stats.proteinCodingFilter, "applied");
});

test("protein-coding filter with no type attributes anywhere keeps everything and says so", async () => {
  const lines = await fixtureLines("fixture.gff3");
  const bare = lines.map((l) => l.replace(/;(gene|transcript)_type=[^;]*/, ""));
  assert.ok(!bare.some((l) => l.includes("_type=")));
  const annotation = await fromLines(bare, { proteinCodingOnly: true });
  assert.equal(annotation.transcripts, 3);
  assert.equal(annotation.stats.proteinCodingFilter, "unavailable");
  assert.equal(annotation.stats.untypedTranscripts, 3);
  for (const layer of LAYERS) assert.deepEqual(annotation.byChrom.get("chrF")[layer], derived[layer], layer);
});

test("assembly and ##sequence-region lengths pass through; layers are per chromosome", async () => {
  const annotation = await fromLines([
    "##gff-version 3",
    "#description: evidence-based annotation of the mouse genome (GRCm38), version M25",
    "##sequence-region chr1 1 195471971",
    "##sequence-region chr2 1 182113224",
    ["chr2", "t", "exon", 11, 20, ".", "-", ".", "Parent=x"].join("\t"),
    ["chr1", "t", "exon", 1, 10, ".", "+", ".", "Parent=y"].join("\t"),
  ]);
  assert.equal(annotation.assembly, "GRCm38");
  assert.deepEqual([...annotation.chromLengths], [
    ["chr1", 195471971],
    ["chr2", 182113224],
  ]);
  assert.deepEqual(annotation.byChrom.get("chr1").tss, [[0, "+"]]);
  assert.deepEqual(annotation.byChrom.get("chr2").tss, [[19, "-"]]);
});

test("an unstranded transcript has a span and exons but no TSS, and is counted", async () => {
  const annotation = await fromLines([gff3("exon", 101, 200, ".", "Parent=u")]);
  const chrF = annotation.byChrom.get("chrF");
  assert.deepEqual([chrF.transcript, chrF.exon, chrF.tss], [[[100, 200]], [[100, 200]], []]);
  assert.equal(annotation.stats.unstrandedTranscripts, 1);
});

test("layers are sorted and merged; shared TSSs appear once", async () => {
  const annotation = await fromLines([
    gff3("exon", 501, 700, "+", "Parent=t1"),
    gff3("exon", 101, 300, "+", "Parent=t1"),
    gff3("exon", 101, 250, "+", "Parent=t2"),
    gff3("exon", 301, 400, "+", "Parent=t2"),
  ]);
  const chrF = annotation.byChrom.get("chrF");
  // [100,300) and [300,400) touch, so they merge.
  assert.deepEqual(chrF.exon, [
    [100, 400],
    [500, 700],
  ]);
  assert.deepEqual(chrF.transcript, [[100, 700]]);
  assert.deepEqual(chrF.tss, [[100, "+"]]);
  assert.equal(annotation.transcripts, 2);
});
