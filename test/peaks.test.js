// Peak parser: BED/narrowPeak/CSV → validated 0-based half-open peaks (SPEC §2, §5, §9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parsePeaks } from "../src/peaks.js";

const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** Every peak's coordinates are integers: no NaN ever gets through (SPEC §8). */
function assertAllIntegers(peaks) {
  for (const p of peaks) {
    assert.ok(Number.isInteger(p.start) && Number.isInteger(p.end), JSON.stringify(p));
  }
}

/** The single rejection reason for a one-row input. */
function reasonFor(text, options) {
  const { peaks, rejected } = parsePeaks(text, options);
  assert.equal(peaks.length, 0, text);
  assert.equal(rejected.length, 1, text);
  return rejected[0].reason;
}

test("fixture peaks.bed gives 17 peaks and no rejections", async () => {
  const text = await fixture("peaks.bed");
  for (const format of ["bed", "auto"]) {
    const { peaks, rejected, format: used } = parsePeaks(text, { format });
    assert.equal(used, "bed");
    assert.equal(peaks.length, 17);
    assert.deepEqual(rejected, []);
    assertAllIntegers(peaks);
    // BED coordinates pass through unchanged: they are already 0-based half-open.
    assert.deepEqual(peaks[0], {
      chrom: "chrF",
      start: 4500,
      end: 4600,
      name: "p01_promoter_upstream_of_tA",
    });
  }
});

test("peaks-nochr.bed passes chromosome names through as written", async () => {
  const { peaks, rejected } = parsePeaks(await fixture("peaks-nochr.bed"), { format: "bed" });
  assert.deepEqual(rejected, []);
  assert.equal(peaks.length, 17);
  assert.ok(peaks.every((p) => !p.chrom.startsWith("chr")));
});

test("a CSV fed to the BED path rejects every row, and yields no NaN peak", async () => {
  const { peaks, rejected, format } = parsePeaks(await fixture("peaks-as-csv.txt"), {
    format: "bed",
  });
  assert.equal(format, "bed");
  assert.deepEqual(peaks, []);
  assert.deepEqual(
    rejected.map((r) => r.lineNumber),
    [1, 2],
  );
  assert.equal(rejected[1].line, "chrF,4500,4600");
  for (const r of rejected) assert.match(r.reason, /tab-separated.*CSV/);
});

test("the same CSV in auto mode is recognised as CSV and gives 1 peak", async () => {
  const { peaks, rejected, format } = parsePeaks(await fixture("peaks-as-csv.txt"), {
    format: "auto",
  });
  assert.equal(format, "csv");
  assert.deepEqual(rejected, []);
  assert.deepEqual(peaks, [{ chrom: "chrF", start: 4500, end: 4600, name: null }]);
});

test("format defaults to auto", async () => {
  assert.equal(parsePeaks(await fixture("peaks-as-csv.txt")).format, "csv");
});

const VAHEDI = [
  "peak_id,chr,start,end,baseMean,log2FoldChange,lfcSE,stat,pvalue,padj",
  "10402,12,33032293,33051654,3463.89360057198,-2.60522816751544,0.0574973517754797,-45.3104027762626,0.0,0.0",
  "26364,2,27130799,27157085,6044.10213905509,1.67081194322156,0.0414180816926366,40.3401576060582,0.0,0.0",
  "1,X,100,200,1.0,0.5,0.1,5.0,0.01,0.02",
].join("\n");

test("a CSV shaped like the Vahedi file parses, names and chromosomes as written", () => {
  const { peaks, rejected, format } = parsePeaks(VAHEDI, { format: "auto" });
  assert.equal(format, "csv");
  assert.deepEqual(rejected, []);
  assert.deepEqual(peaks, [
    { chrom: "12", start: 33032293, end: 33051654, name: "10402" },
    { chrom: "2", start: 27130799, end: 27157085, name: "26364" },
    { chrom: "X", start: 100, end: 200, name: "1" },
  ]);
});

test("oneBased converts CSV start to 0-based and leaves end alone", () => {
  const { peaks } = parsePeaks(VAHEDI, { format: "csv", oneBased: true });
  assert.deepEqual(
    peaks.map((p) => [p.start, p.end]),
    [
      [33032292, 33051654],
      [27130798, 27157085],
      [99, 200],
    ],
  );
});

test("oneBased: a 1 bp peak (start == end) is valid, start 0 is not", () => {
  const { peaks } = parsePeaks("chr,start,end\nchr1,100,100", { oneBased: true });
  assert.deepEqual(peaks, [{ chrom: "chr1", start: 99, end: 100, name: null }]);
  assert.match(reasonFor("chr,start,end\nchr1,0,10", { oneBased: true }), /below 1/);
  assert.match(reasonFor("chr,start,end\nchr1,10,9", { oneBased: true }), /before start/);
});

test("oneBased does not apply to BED, which is 0-based by definition", () => {
  const { peaks } = parsePeaks("chr1\t100\t200", { format: "bed", oneBased: true });
  assert.deepEqual(peaks, [{ chrom: "chr1", start: 100, end: 200, name: null }]);
});

test("CSV columns are found by name, case-insensitively, in any order", () => {
  const text = "Score,ChromEnd,NAME,ChromStart,Chromosome\n5,200,a,100,chr2";
  const { peaks } = parsePeaks(text);
  assert.deepEqual(peaks, [{ chrom: "chr2", start: 100, end: 200, name: "a" }]);
  const seqnames = parsePeaks("seqnames\tstart\tend\tid\nchr3\t1\t2\tx").peaks;
  assert.deepEqual(seqnames, [{ chrom: "chr3", start: 1, end: 2, name: "x" }]);
});

test("the name column prefers name over peak_id over id", () => {
  const { peaks } = parsePeaks("id,peak_id,name,chr,start,end\ni,p,n,chr1,1,2");
  assert.equal(peaks[0].name, "n");
  assert.equal(parsePeaks("id,peak_id,chr,start,end\ni,p,chr1,1,2").peaks[0].name, "p");
});

test("the delimiter is sniffed from the header: tab, comma or semicolon", () => {
  for (const d of ["\t", ",", ";"]) {
    const text = ["chr", "start", "end"].join(d) + "\n" + ["chr1", "10", "20"].join(d);
    const { peaks, format } = parsePeaks(text);
    assert.equal(format, "csv", JSON.stringify(d));
    assert.deepEqual(peaks, [{ chrom: "chr1", start: 10, end: 20, name: null }]);
  }
});

test("quoted CSV fields, as R's write.csv writes them, are unquoted", () => {
  const text = '"","peak_id","chr","start","end"\n"1","a, b","12",100,200';
  const { peaks, rejected } = parsePeaks(text);
  assert.deepEqual(rejected, []);
  assert.deepEqual(peaks, [{ chrom: "12", start: 100, end: 200, name: "a, b" }]);
});

test("a BED file with a header row: auto reads it as TSV, forced BED rejects it", () => {
  const text = "chrom\tstart\tend\tname\nchr1\t10\t20\tp1\n";
  const auto = parsePeaks(text, { format: "auto" });
  assert.equal(auto.format, "csv");
  assert.deepEqual(auto.rejected, []);
  assert.deepEqual(auto.peaks, [{ chrom: "chr1", start: 10, end: 20, name: "p1" }]);

  const bed = parsePeaks(text, { format: "bed" });
  assert.deepEqual(bed.peaks, [{ chrom: "chr1", start: 10, end: 20, name: "p1" }]);
  assert.equal(bed.rejected.length, 1);
  assert.equal(bed.rejected[0].lineNumber, 1);
  assert.match(bed.rejected[0].reason, /header row/);
});

test("BED skips blank, #, track and browser lines; line numbers count them", () => {
  const text = [
    "browser position chr1:1-1000",
    'track name="peaks"',
    "# comment",
    "",
    "chr1\t10\t20",
    "   ",
    "chr1\t-1\t20",
  ].join("\n");
  const { peaks, rejected } = parsePeaks(text, { format: "bed" });
  assert.deepEqual(peaks, [{ chrom: "chr1", start: 10, end: 20, name: null }]);
  assert.deepEqual(rejected, [
    { lineNumber: 7, line: "chr1\t-1\t20", reason: "start is negative: -1" },
  ]);
});

test("narrowPeak: first three columns, name from column 4, the rest ignored", () => {
  const line = "chr10\t100015855\t100016677\tPeak_21634\t23\t.\t4.76064\t12.91286\t10.60798\t110";
  const { peaks } = parsePeaks(line, { format: "auto" });
  assert.deepEqual(peaks, [
    { chrom: "chr10", start: 100015855, end: 100016677, name: "Peak_21634" },
  ]);
});

test("CRLF line endings, a UTF-8 BOM and no final newline are handled", () => {
  const csv = parsePeaks("\uFEFFchr,start,end\r\nchr1,1,2\r\nchr1,3,4");
  assert.equal(csv.format, "csv");
  assert.deepEqual(csv.rejected, []);
  assert.deepEqual(
    csv.peaks.map((p) => p.end),
    [2, 4],
  );
  const bed = parsePeaks("chr1\t1\t2\r\n", { format: "bed" });
  assert.deepEqual(bed.peaks, [{ chrom: "chr1", start: 1, end: 2, name: null }]);
  assert.deepEqual(bed.rejected, []);
});

test("rejection: negative start", () => {
  assert.equal(reasonFor("chr1\t-5\t20", { format: "bed" }), "start is negative: -5");
  assert.equal(reasonFor("chr,start,end\nchr1,-5,20"), "start is negative: -5");
});

test("rejection: end <= start", () => {
  assert.match(reasonFor("chr1\t20\t20", { format: "bed" }), /end 20 is not greater than start 20/);
  assert.match(reasonFor("chr1\t20\t10", { format: "bed" }), /end 10 is not greater than start 20/);
  assert.match(reasonFor("chr,start,end\nchr1,20,20"), /not greater than start/);
});

test("rejection: non-integer coordinates", () => {
  for (const [start, end] of [
    ["10.5", "20"],
    ["abc", "20"],
    ["1e+05", "200000"],
    ["10", "20.0"],
    ["10", "NaN"],
  ]) {
    const reason = reasonFor(`chr1\t${start}\t${end}`, { format: "bed" });
    assert.match(reason, /is not an integer/, `${start} ${end}`);
    assert.match(reasonFor(`chr,start,end\nchr1,${start},${end}`), /is not an integer/);
  }
});

test("rejection: missing column or empty field", () => {
  assert.match(reasonFor("chr1\t10", { format: "bed" }), /at least 3 tab-separated columns.*found 2/);
  assert.match(
    reasonFor("chr,start,end\nchr1,10", { format: "csv" }),
    /missing end column: row has 2 fields, header has 3/,
  );
  assert.equal(reasonFor("\t10\t20", { format: "bed" }), "chromosome is empty");
  assert.equal(reasonFor("chr1\t\t20", { format: "bed" }), "start is missing");
  assert.equal(reasonFor("chr,start,end\nchr1,10,"), "end is missing");
});

test("a CSV header without coordinate columns rejects the header and every row", () => {
  const { peaks, rejected, format } = parsePeaks("chr,begin,end\nchr1,1,2\nchr1,3,4", {
    format: "csv",
  });
  assert.equal(format, "csv");
  assert.deepEqual(peaks, []);
  assert.deepEqual(
    rejected.map((r) => r.lineNumber),
    [1, 2, 3],
  );
  assert.match(rejected[0].reason, /header has no start column/);
  assert.match(rejected[1].reason, /header on line 1 has no start column/);
});

test("valid rows around bad ones still parse", () => {
  const text = "chr1\t1\t2\nchr1\tx\t2\nchr2\t3\t4";
  const { peaks, rejected } = parsePeaks(text, { format: "bed" });
  assert.equal(peaks.length, 2);
  assert.deepEqual(
    rejected.map((r) => r.lineNumber),
    [2],
  );
});

test("empty input gives no peaks and no rejections", () => {
  for (const format of ["bed", "csv", "auto"]) {
    assert.deepEqual(parsePeaks("", { format }).peaks, []);
    assert.deepEqual(parsePeaks("\n# only a comment\n", { format }).rejected, []);
  }
});

test("an unknown format throws", () => {
  assert.throws(() => parsePeaks("chr1\t1\t2", { format: "gff" }), /Unknown peak format/);
});

test("100k-line BED and CSV inputs parse in well under a second", () => {
  const n = 100_000;
  const bed = Array.from({ length: n }, (_, i) => `chr1\t${i * 10}\t${i * 10 + 5}\tp${i}`);
  const csv = ["chr,start,end,name", ...bed.map((l) => l.replaceAll("\t", ","))];
  for (const [text, format] of [
    [bed.join("\n"), "bed"],
    [csv.join("\n"), "auto"],
  ]) {
    const t0 = performance.now();
    const { peaks, rejected } = parsePeaks(text, { format });
    const ms = performance.now() - t0;
    assert.equal(peaks.length, n);
    assert.equal(rejected.length, 0);
    assert.ok(ms < 1000, `${format}: ${ms.toFixed(0)} ms`);
  }
});
