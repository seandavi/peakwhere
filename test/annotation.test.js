import { test } from "node:test";
import assert from "node:assert/strict";
import { openAsBlob } from "node:fs";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { parseAnnotationLines } from "../src/annotation.js";
import { linesFromFile, linesFromStream } from "../src/io.js";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);

const collect = async (iterable) => {
  const out = [];
  for await (const item of iterable) out.push(item);
  return out;
};

const parseFixture = async (name, format = "auto") =>
  collect(parseAnnotationLines(linesFromFile(await openAsBlob(fixture(name))), { format }));

const features = (records) => records.filter((r) => r.kind === "feature");

/** The one feature matching `where`, by type plus id or parents. */
const only = (records, where) => {
  const found = features(records).filter(
    (r) =>
      r.type === where.type &&
      (where.id === undefined || r.id === where.id) &&
      (where.start === undefined || r.start === where.start),
  );
  assert.equal(found.length, 1, JSON.stringify(where));
  return found[0];
};

test("GFF3 fixture: 0-based half-open coordinates and ID/Parent links", async () => {
  const records = await parseFixture("fixture.gff3");
  assert.deepEqual(only(records, { type: "gene", id: "gA" }), {
    kind: "feature",
    chrom: "chrF",
    start: 5000,
    end: 9000,
    strand: "+",
    type: "gene",
    id: "gA",
    parents: [],
    attrs: { gene_type: "protein_coding" },
  });
  assert.deepEqual(only(records, { type: "transcript", id: "tB" }), {
    kind: "feature",
    chrom: "chrF",
    start: 15000,
    end: 19000,
    strand: "-",
    type: "transcript",
    id: "tB",
    parents: ["gB"],
    attrs: { transcript_type: "protein_coding" },
  });
  // tC is an mRNA, not a transcript: it is yielded because it has an id.
  const tC = only(records, { type: "mRNA", id: "tC" });
  assert.deepEqual([tC.start, tC.end, tC.parents], [23000, 29000, ["gC"]]);
  const exon = only(records, { type: "exon", id: "tA.e2" });
  assert.deepEqual([exon.start, exon.end, exon.parents], [8500, 9000, ["tA"]]);
  const utr5 = only(records, { type: "five_prime_UTR", start: 18800 });
  assert.deepEqual([utr5.end, utr5.strand, utr5.id, utr5.parents], [19000, "-", null, ["tB"]]);
  const utr3 = only(records, { type: "three_prime_UTR", start: 28500 });
  assert.deepEqual([utr3.end, utr3.id, utr3.parents], [29000, null, ["tC"]]);
  // Every feature line in the fixture is either a needed type or has an id.
  assert.equal(features(records).length, 24);
});

test("GFF3 fixture: ##sequence-region gives the chromosome length", async () => {
  const records = await parseFixture("fixture.gff3");
  assert.deepEqual(
    records.filter((r) => r.kind === "sequenceRegion"),
    [{ kind: "sequenceRegion", chrom: "chrF", length: 30000 }],
  );
  assert.equal(records.filter((r) => r.kind === "assembly").length, 0);
});

test("GTF fixture: normalised onto the GFF3 id/parents model", async () => {
  const records = await parseFixture("fixture.gtf");
  const gene = only(records, { type: "gene", id: "gB" });
  assert.deepEqual([gene.start, gene.end, gene.strand, gene.parents], [15000, 19000, "-", []]);
  assert.deepEqual(gene.attrs, { gene_type: "protein_coding" });
  assert.deepEqual(only(records, { type: "transcript", id: "tA" }), {
    kind: "feature",
    chrom: "chrF",
    start: 5000,
    end: 9000,
    strand: "+",
    type: "transcript",
    id: "tA",
    parents: ["gA"],
    attrs: { transcript_type: "protein_coding" },
  });
  const exon = only(records, { type: "exon", start: 15000 });
  assert.deepEqual([exon.end, exon.id, exon.parents], [15500, null, ["tB"]]);
  const utr = only(records, { type: "UTR", start: 28500 });
  assert.deepEqual([utr.end, utr.id, utr.parents], [29000, null, ["tC"]]);
  // tC has no transcript line; its exons still name it as their parent.
  assert.equal(features(records).filter((r) => r.id === "tC").length, 0);
  const tCexons = features(records).filter((r) => r.type === "exon" && r.parents[0] === "tC");
  assert.deepEqual(
    tCexons.map((r) => [r.start, r.end, r.attrs.transcript_type]),
    [
      [23000, 25000, "protein_coding"],
      [28000, 29000, "protein_coding"],
    ],
  );
  assert.equal(records.filter((r) => r.kind !== "feature").length, 0);
});

test("GFF3 and GTF fixtures give the same exons, CDS and UTR intervals", async () => {
  const intervals = (records, types) =>
    features(records)
      .filter((r) => types.includes(r.type))
      .map((r) => [r.chrom, r.start, r.end, r.strand, r.parents.join()].join(":"))
      .sort();
  const gff3 = await parseFixture("fixture.gff3");
  const gtf = await parseFixture("fixture.gtf");
  for (const type of ["exon", "CDS"]) {
    assert.deepEqual(intervals(gff3, [type]), intervals(gtf, [type]), type);
  }
  assert.deepEqual(intervals(gff3, ["five_prime_UTR", "three_prime_UTR"]), intervals(gtf, ["UTR"]));
});

test("an annotation 100..200 becomes [99, 200) (SPEC §7.2)", async () => {
  const [exon] = await collect(
    parseAnnotationLines(["chr1\tx\texon\t100\t200\t.\t+\t.\tParent=t1"], { format: "gff3" }),
  );
  assert.deepEqual([exon.start, exon.end], [99, 200]);
});

test("format auto: header first, else attribute syntax; explicit format wins", async () => {
  const gff3Text = await readFile(fixture("fixture.gff3"), "utf8");
  const headerless = gff3Text.split("\n").filter((l) => !l.startsWith("##gff-version"));
  const fromSyntax = features(await collect(parseAnnotationLines(headerless, { format: "auto" })));
  assert.equal(fromSyntax.find((r) => r.type === "transcript").id, "tA");

  const gtfLines = (await readFile(fixture("fixture.gtf"), "utf8")).split("\n");
  const asGtf = features(await collect(parseAnnotationLines(gtfLines, { format: "gtf" })));
  const auto = features(await collect(parseAnnotationLines(gtfLines, { format: "auto" })));
  assert.deepEqual(auto, asGtf);

  // A feature line with no attributes doesn't decide the format; the next one does.
  const lines = ["chr1\tx\tregion\t1\t10\t.\t+\t.\t.", 'chr1\tx\ttranscript\t1\t10\t.\t+\t.\tgene_id "g"; transcript_id "t";'];
  const [transcript] = await collect(parseAnnotationLines(lines, { format: "auto" }));
  assert.deepEqual([transcript.id, transcript.parents], ["t", ["g"]]);

  await assert.rejects(collect(parseAnnotationLines([], { format: "bed" })), /Unknown annotation format/);
});

test("GFF3 attributes are URL-decoded and Parent and tag may list several values", async () => {
  const [feature] = await collect(
    parseAnnotationLines(
      ["chr1\tx\texon\t1\t10\t.\t-\t.\tID=e%3B1; Parent=t%2C1,t2;gene_type=a%20b;tag=basic,CCDS;Name=x"],
      { format: "gff3" },
    ),
  );
  assert.equal(feature.id, "e;1");
  assert.deepEqual(feature.parents, ["t,1", "t2"]);
  assert.deepEqual(feature.attrs, { gene_type: "a b", tag: ["basic", "CCDS"] });
});

test("GTF: repeated tag, unquoted values, and a semicolon inside quotes", async () => {
  const [transcript] = await collect(
    parseAnnotationLines(
      ['chr1\tx\ttranscript\t1\t10\t.\t+\t.\tgene_id "g;1"; transcript_id t1; level 2; tag "basic"; tag "CCDS";'],
      { format: "gtf" },
    ),
  );
  assert.deepEqual([transcript.id, transcript.parents], ["t1", ["g;1"]]);
  assert.deepEqual(transcript.attrs, { tag: ["basic", "CCDS"] });
});

test("only needed features are yielded", async () => {
  const gtf = [
    'chr1\tx\tstart_codon\t1\t3\t.\t+\t0\tgene_id "g"; transcript_id "t";',
    'chr1\tx\tSelenocysteine\t4\t6\t.\t+\t0\tgene_id "g"; transcript_id "t";',
    'chr1\tx\tCDS\t1\t9\t.\t+\t0\tgene_id "g"; transcript_id "t";',
  ];
  assert.deepEqual(
    features(await collect(parseAnnotationLines(gtf, { format: "gtf" }))).map((r) => r.type),
    ["CDS"],
  );
  const gff3 = [
    "chr1\tx\tregion\t1\t100\t.\t+\t.\tName=chr1",
    "chr1\tx\tstart_codon\t1\t3\t.\t+\t0\tParent=t",
    "chr1\tx\tlnc_RNA\t1\t100\t.\t+\t.\tID=t;Parent=g",
    "chr1\tx\tUTR\t1\t9\t.\t+\t.\tParent=t",
  ];
  assert.deepEqual(
    features(await collect(parseAnnotationLines(gff3, { format: "gff3" }))).map((r) => r.type),
    ["lnc_RNA", "UTR"],
  );
});

test("assembly is read from header comments, GENCODE style, once", async () => {
  const gff3 = [
    "##gff-version 3",
    "#description: evidence-based annotation of the mouse genome (GRCm38), version M25 (Ensembl 100)",
    "#provider: GENCODE",
    "##sequence-region chr1 1 195471971",
    "chr1\tx\texon\t1\t10\t.\t+\t.\tParent=t",
    "# a later comment mentioning GRCm39 is not a header",
  ];
  const records = await collect(parseAnnotationLines(gff3, { format: "auto" }));
  assert.deepEqual(
    records.filter((r) => r.kind !== "feature"),
    [
      { kind: "assembly", name: "GRCm38" },
      { kind: "sequenceRegion", chrom: "chr1", length: 195471971 },
    ],
  );
  // GENCODE's GTF writes the same header with ##.
  const gtf = ["##description: evidence-based annotation of the human genome (GRCh38), version 44"];
  assert.deepEqual(await collect(parseAnnotationLines(gtf, { format: "auto" })), [
    { kind: "assembly", name: "GRCh38" },
  ]);
  const ucsc = ["#!genome-build mm10"];
  assert.deepEqual(await collect(parseAnnotationLines(ucsc)), [{ kind: "assembly", name: "mm10" }]);
});

test("blank lines are skipped, ##FASTA ends the features, bad lines throw with a line number", async () => {
  const withFasta = ["", "chr1\tx\texon\t1\t10\t.\t+\t.\tParent=t", "  ", "##FASTA", ">chr1", "ACGT"];
  assert.equal((await collect(parseAnnotationLines(withFasta, { format: "gff3" }))).length, 1);

  const bed = ["chr1\t0\t10"];
  await assert.rejects(collect(parseAnnotationLines(bed)), /Line 1: expected 9 tab-separated columns/);
  const badStart = ["#", "chr1\tx\texon\t0\t10\t.\t+\t.\tParent=t"];
  await assert.rejects(collect(parseAnnotationLines(badStart)), /Line 2: bad coordinates 0\.\.10/);
  const reversed = ["chr1\tx\texon\t20\t10\t.\t+\t.\tParent=t"];
  await assert.rejects(collect(parseAnnotationLines(reversed)), /bad coordinates/);
});

test("a gzipped fixture with a misleading name parses the same as the plain one", async () => {
  const plain = await parseFixture("fixture.gff3");
  const disguised = new File([gzipSync(await readFile(fixture("fixture.gff3")))], "fixture.gff3");
  assert.deepEqual(await collect(parseAnnotationLines(linesFromFile(disguised), { format: "auto" })), plain);
});

/** A GTF of `total` synthetic exon lines, generated on demand; `produced()` counts lines so far. */
const syntheticGtf = (total) => {
  let produced = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (produced === total) return controller.close();
      let text = "";
      for (let i = 0; i < 1000; i++, produced++) {
        const start = produced * 10 + 1;
        text += `chr1\tsynthetic\texon\t${start}\t${start + 4}\t.\t+\t.\tgene_id "g${produced}"; transcript_id "t${produced}";\r\n`;
      }
      controller.enqueue(new TextEncoder().encode(text));
    },
  });
  return { stream, produced: () => produced };
};

/** Parse `stream`, checking every synthetic line arrives with the right coordinates. */
const parseSynthetic = async (stream, total, onFirst = () => {}) => {
  let count = 0;
  let last;
  for await (const record of parseAnnotationLines(linesFromStream(stream), { format: "auto" })) {
    if (count === 0) onFirst();
    count++;
    last = record;
  }
  assert.equal(count, total);
  assert.deepEqual([last.start, last.end, last.parents], [(total - 1) * 10, (total - 1) * 10 + 5, [`t${total - 1}`]]);
};

test("streams a large annotation: the first record arrives before the input is read", async () => {
  const total = 300_000;
  const source = syntheticGtf(total);
  let producedAtFirstRecord;
  await parseSynthetic(source.stream, total, () => (producedAtFirstRecord = source.produced()));
  assert.ok(producedAtFirstRecord < total / 10, `first record after ${producedAtFirstRecord} of ${total} lines`);
});

test("streams a large gzipped annotation", async () => {
  // No laziness check here: Node 22's CompressionStream and DecompressionStream read
  // their whole input before emitting anything. Node 24+ and Chrome don't.
  const total = 300_000;
  await parseSynthetic(syntheticGtf(total).stream.pipeThrough(new CompressionStream("gzip")), total);
});
