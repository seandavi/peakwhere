import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  labelFromFilename,
  uniqueLabel,
  duplicateLabels,
  isTabularName,
  sniffPeakFormat,
  parseBasePairs,
  formatBytes,
} from "../src/labels.js";

test("labelFromFilename strips each ADR-0011 extension", () => {
  for (const ext of [".gz", ".bed", ".narrowPeak", ".broadPeak", ".csv", ".tsv", ".txt"]) {
    assert.equal(labelFromFilename(`sample${ext}`), "sample", ext);
  }
});

test("labelFromFilename strips stacked extensions", () => {
  assert.equal(labelFromFilename("x.narrowPeak.gz"), "x");
  assert.equal(labelFromFilename("x.bed.gz"), "x");
  assert.equal(labelFromFilename("x.csv.txt.gz"), "x");
  assert.equal(
    labelFromFilename("thymus_H3K4me3_ENCFF674JZY.chr19.narrowPeak.gz"),
    "thymus_H3K4me3_ENCFF674JZY.chr19",
  );
});

test("labelFromFilename is case-insensitive and keeps other dots", () => {
  assert.equal(labelFromFilename("Peaks.NARROWPEAK.GZ"), "Peaks");
  assert.equal(labelFromFilename("rep1.chr19.bed"), "rep1.chr19");
  assert.equal(labelFromFilename("peaks.xls"), "peaks.xls");
  assert.equal(labelFromFilename("peaks"), "peaks");
});

test("labelFromFilename never returns an empty label", () => {
  assert.equal(labelFromFilename(".bed"), ".bed");
  assert.equal(labelFromFilename(".bed.gz"), ".bed");
});

test("uniqueLabel appends a counter only when needed", () => {
  assert.equal(uniqueLabel("a", []), "a");
  assert.equal(uniqueLabel("a", ["a"]), "a (2)");
  assert.equal(uniqueLabel("a", ["a", "a (2)"]), "a (3)");
  assert.equal(uniqueLabel("a", new Set(["b"])), "a");
});

test("duplicateLabels finds repeats after trimming", () => {
  assert.deepEqual(duplicateLabels(["a", "b", "c"]), []);
  assert.deepEqual(duplicateLabels(["a", "b", "a ", "b", "a"]), ["a", "b"]);
});

test("isTabularName recognises CSV and TSV, compressed or not", () => {
  assert.equal(isTabularName("x.csv"), true);
  assert.equal(isTabularName("x.TSV.gz"), true);
  assert.equal(isTabularName("x.bed"), false);
  assert.equal(isTabularName("x.txt"), false);
  assert.equal(isTabularName("csv.bed"), false);
});

test("sniffPeakFormat: BED lines are bed, headers and commas are csv", () => {
  assert.equal(sniffPeakFormat("chr1\t100\t200\n"), "bed");
  assert.equal(sniffPeakFormat("chr1 100 200 name\n"), "bed");
  assert.equal(sniffPeakFormat("chr,start,end\nchr1,100,200\n"), "csv");
  assert.equal(sniffPeakFormat("chr1,100,200\n"), "csv");
  assert.equal(sniffPeakFormat("chrom\tstart\tend\nchr1\t100\t200\n"), "csv");
});

test("sniffPeakFormat skips comments, track and browser lines", () => {
  assert.equal(sniffPeakFormat("# comment\ntrack name=x\nbrowser position chr1\n\nchr1\t1\t2"), "bed");
  assert.equal(sniffPeakFormat("\r\n# only a comment\r\n"), null);
  assert.equal(sniffPeakFormat(""), null);
});

test("sniffPeakFormat agrees with the fixture files", async () => {
  const read = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  assert.equal(sniffPeakFormat(await read("peaks.bed")), "bed");
  assert.equal(sniffPeakFormat(await read("peaks-nochr.bed")), "bed");
  assert.equal(sniffPeakFormat(await read("peaks-as-csv.txt")), "csv");
});

test("parseBasePairs accepts whole numbers ≥ 0 only", () => {
  assert.equal(parseBasePairs("1000"), 1000);
  assert.equal(parseBasePairs(" 0 "), 0);
  assert.equal(parseBasePairs(3000), 3000);
  for (const bad of ["", "-1", "1.5", "1e3", "abc", "99999999999999999999"]) {
    assert.equal(parseBasePairs(bad), null, bad);
  }
});

test("formatBytes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(999), "999 B");
  assert.equal(formatBytes(1500), "1.5 kB");
  assert.equal(formatBytes(23_400_000), "23.4 MB");
});
