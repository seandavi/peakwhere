// Sanity checks on the hand-written fixture itself. These test the ground truth,
// not the app: if they fail, expected.json was edited inconsistently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const expected = JSON.parse(
  await readFile(new URL("./fixtures/expected.json", import.meta.url), "utf8"),
);
const CATEGORIES = ["promoter", "utr5", "utr3", "exon", "intron", "intergenic"];
const sum = (o) => CATEGORIES.reduce((n, c) => n + o[c], 0);

test("centre counts sum to the matched peak count", () => {
  assert.equal(sum(expected.counts_centre), expected.counts_centre.matched);
});

test("per-peak categories agree with the counts", () => {
  const tally = {};
  for (const c of Object.values(expected.perPeak_centre)) tally[c] = (tally[c] ?? 0) + 1;
  for (const c of CATEGORIES) assert.equal(tally[c] ?? 0, expected.counts_centre[c], c);
  assert.equal(tally.unmatched, expected.counts_centre.unmatched);
});

test("base-pair and genome-background totals are consistent", () => {
  assert.equal(sum(expected.basepairs), expected.basepairs.matched);
  assert.equal(sum(expected.genomeBackground_bp), expected.genomeBackground_bp.total);
});

test("every peak in peaks.bed has an expected category", async () => {
  const bed = await readFile(new URL("./fixtures/peaks.bed", import.meta.url), "utf8");
  const names = bed.split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t")[3]);
  assert.deepEqual(names.sort(), Object.keys(expected.perPeak_centre).sort());
});
