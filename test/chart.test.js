// Chart, table, settings summary and downloads, rendered into jsdom from mock results.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  CATEGORY_COLORS,
  chartSVG,
  render,
  settingsSummary,
  toCSV,
  toSVG,
  unmatchedSummary,
} from "../src/chart.js";
import { CATEGORIES, CATEGORY_LABELS, DEFAULT_SETTINGS } from "../src/constants.js";

const META = { annotationName: "gencode.vM25.basic.annotation.gff3.gz", assembly: "GRCm38" };

// Genome is listed first on purpose: it must still be drawn last.
const RESULTS = [
  {
    label: "Genome",
    background: true,
    mode: "bp",
    counts: { promoter: 6003, utr5: 499, utr3: 900, exon: 1600, intron: 7998, intergenic: 13000 },
    matched: 30000,
    unmatched: 0,
  },
  {
    label: "H3K4me3",
    mode: "centre",
    counts: { promoter: 689, utr5: 20, utr3: 5, exon: 16, intron: 157, intergenic: 112 },
    matched: 999,
    unmatched: 3,
  },
  {
    label: "differential_peaks_up",
    mode: "centre",
    matched: 88,
    unmatched: 12,
    refused: "12% of peaks on chromosomes not in the annotation (chrUn_JH584304)",
  },
  {
    label: "H3K36me3",
    mode: "centre",
    // utr5 is zero: no segment for it.
    counts: { promoter: 34, utr5: 0, utr3: 65, exon: 160, intron: 715, intergenic: 26 },
    matched: 1000,
    unmatched: 0,
  },
];

function dom() {
  const { window } = new JSDOM("<!doctype html><div id=out></div>");
  return window.document;
}

function rendered(results = RESULTS, settings = DEFAULT_SETTINGS, meta = META) {
  const document = dom();
  const el = document.getElementById("out");
  render(el, results, settings, meta);
  return el;
}

const segments = (el) => [...el.querySelectorAll("g.pw-segments rect")];
const texts = (nodes) => [...nodes].map((n) => n.textContent);

test("one bar per drawn result; refused rows are messages, the Genome row sits at the bottom", () => {
  const el = rendered();
  const yLabels = texts(el.querySelectorAll('g[aria-label="y-axis tick label"] text'));
  assert.deepEqual(yLabels, ["H3K4me3", "differential_peaks_up", "H3K36me3", "Genome"]);

  const bars = new Set(segments(el).map((r) => r.getAttribute("y")));
  assert.equal(bars.size, 3, "H3K4me3, H3K36me3 and Genome are bars; the refused file is not");

  const messages = texts(el.querySelectorAll("g.pw-not-drawn text"));
  assert.deepEqual(messages, [
    "not drawn: 12% of peaks on chromosomes not in the annotation (chrUn_JH584304)",
  ]);
  assert.equal(el.querySelectorAll("g.pw-background rect").length, 1, "Genome gets a dashed outline");
});

test("one segment per non-zero category, in CATEGORIES order, labelled and coloured per category", () => {
  const el = rendered();
  const segs = segments(el);
  assert.equal(segs.length, 6 + 6 + 5, "H3K36me3 has no 5′ UTR peaks");

  const byBar = Map.groupBy(segs, (r) => r.getAttribute("y"));
  const [h3k4, h3k36, genome] = [...byBar.values()].sort(
    (a, b) => Number(a[0].getAttribute("y")) - Number(b[0].getAttribute("y")),
  );
  const categoryOf = (rect) =>
    CATEGORIES.find((c) => rect.getAttribute("aria-label").includes(`, ${CATEGORY_LABELS[c]}:`));
  assert.deepEqual(h3k4.map(categoryOf), CATEGORIES);
  assert.deepEqual(h3k36.map(categoryOf), CATEGORIES.filter((c) => c !== "utr5"));
  assert.deepEqual(genome.map(categoryOf), CATEGORIES);

  for (const rect of segs) {
    assert.equal(rect.getAttribute("fill").toUpperCase(), CATEGORY_COLORS[categoryOf(rect)]);
  }
  assert.ok(genome.every((r) => r.getAttribute("fill-opacity") === "0.55"), "Genome is lighter");
  assert.ok(h3k4.every((r) => r.getAttribute("fill-opacity") === "1"));

  // Segments start at the left edge and each bar fills the full width.
  for (const bar of [h3k4, h3k36, genome]) {
    const left = Number(bar[0].getAttribute("x"));
    const widths = bar.reduce((sum, r) => sum + Number(r.getAttribute("width")), 0);
    const last = bar.at(-1);
    assert.ok(Math.abs(left + widths - Number(last.getAttribute("x")) - Number(last.getAttribute("width"))) < 1e-6);
  }
});

test("the legend lists every category with its colour", () => {
  const el = rendered();
  const legend = el.querySelector("g.pw-legend");
  assert.deepEqual(texts(legend.querySelectorAll("text")), CATEGORIES.map((c) => CATEGORY_LABELS[c]));
  assert.deepEqual(
    [...legend.querySelectorAll("rect")].map((r) => r.getAttribute("fill")),
    CATEGORIES.map((c) => CATEGORY_COLORS[c]),
  );
});

test("tooltips give the count, its unit and the percentage of matched", () => {
  const labels = segments(rendered()).map((r) => r.getAttribute("aria-label"));
  assert.ok(labels.includes("H3K4me3, Promoter: 689 peaks (69.0% of 999 matched peaks)"));
  assert.ok(labels.includes("Genome, Intergenic: 13,000 bp (43.3% of 30,000 bp)"));

  const bp = [{ label: "A", mode: "bp", counts: { exon: 1, intron: 3 }, matched: 4, unmatched: 0 }];
  const document = dom();
  const svg = chartSVG(bp, { mode: "bp" }, {}, { document });
  const bpLabels = [...svg.querySelectorAll("g.pw-segments rect")].map((r) => r.getAttribute("aria-label"));
  assert.deepEqual(bpLabels, [
    "A, Exon: 1 bp (25.0% of 4 matched bp)",
    "A, Intron: 3 bp (75.0% of 4 matched bp)",
  ]);
  assert.equal(svg.querySelector('g[aria-label="x-axis label"] text').textContent,
    "Percent of matched peak base pairs →");
});

test("the x-axis label says the Genome bar is base pairs when the file bars count peaks", () => {
  const xLabel = (results) =>
    chartSVG(results, DEFAULT_SETTINGS, {}, { document: dom() })
      .querySelector('g[aria-label="x-axis label"] text').textContent;
  assert.equal(xLabel(RESULTS), "Percent of matched peaks (Genome bar: percent of base pairs) →");
  assert.equal(xLabel(RESULTS.filter((r) => !r.background)), "Percent of matched peaks →");

  const genome = RESULTS.find((r) => r.background);
  const bp = [{ label: "A", mode: "bp", counts: { exon: 1, intron: 3 }, matched: 4, unmatched: 0 }, genome];
  assert.equal(xLabel(bp), "Percent of matched peak base pairs →", "no note when everything is bp");
});

test("table: a row per result, categories plus matched and unmatched, count and percentage", () => {
  const el = rendered();
  const table = el.querySelector("table.pw-table");
  const head = texts(table.querySelectorAll("thead th"));
  assert.deepEqual(head, ["File", "Unit", ...CATEGORIES.map((c) => CATEGORY_LABELS[c]), "Matched", "Unmatched"]);

  const rows = [...table.querySelectorAll("tbody tr")];
  assert.deepEqual(rows.map((r) => r.querySelector("th").textContent),
    ["H3K4me3", "differential_peaks_up", "H3K36me3", "Genome"]);
  assert.equal(rows[3].className, "pw-background");

  const cells = (row) => texts(row.querySelectorAll("td"));
  assert.deepEqual(cells(rows[0]), [
    "peaks", "689 (69.0%)", "20 (2.0%)", "5 (0.5%)", "16 (1.6%)", "157 (15.7%)", "112 (11.2%)",
    "999 (99.7%)", "3 (0.3%)",
  ]);
  assert.deepEqual(cells(rows[1]), [
    "peaks", "not drawn: 12% of peaks on chromosomes not in the annotation (chrUn_JH584304)",
    "88 (88.0%)", "12 (12.0%)",
  ]);
  assert.equal(rows[1].querySelector("td.pw-not-drawn").colSpan, CATEGORIES.length);
  assert.equal(cells(rows[3])[0], "bp");
  assert.equal(cells(rows[3])[1], "6,003 (20.0%)");
});

test("percentages are count / matched and sum to 100% per bar, within rounding", () => {
  const el = rendered();
  for (const row of el.querySelectorAll("tbody tr")) {
    const pcts = [...row.querySelectorAll("td.pw-num .pw-pct")]
      .slice(0, CATEGORIES.length)
      .map((s) => Number(s.textContent.replace(/[()%]/g, "")));
    if (pcts.length < CATEGORIES.length) continue; // not drawn
    const sum = pcts.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) <= 0.05 * CATEGORIES.length, `${sum}`);
  }
  const csv = toCSV(RESULTS).trim().split("\n").slice(1).map((l) => l.split(","));
  const h3k4 = csv.find((r) => r[0] === "H3K4me3");
  const pcts = CATEGORIES.map((_, i) => Number(h3k4[3 + 2 * i]));
  assert.deepEqual(pcts, [68.97, 2.0, 0.5, 1.6, 15.72, 11.21]);
  assert.ok(Math.abs(pcts.reduce((a, b) => a + b, 0) - 100) <= 0.005 * CATEGORIES.length);
});

test("settings summary, unmatched line and warnings appear under the chart", () => {
  const el = rendered(RESULTS, DEFAULT_SETTINGS, { ...META, warnings: ["Assembly mismatch"] });
  assert.equal(el.querySelector("figcaption .pw-summary").textContent, settingsSummary(DEFAULT_SETTINGS, META));
  assert.equal(el.querySelector("figcaption .pw-unmatched").textContent,
    "Unmatched, excluded from percentages: H3K4me3 3 peaks · differential_peaks_up 12 peaks · H3K36me3 0 peaks");
  assert.deepEqual(texts(el.querySelectorAll(".pw-warnings li")), ["Assembly mismatch"]);
  assert.deepEqual(texts(el.querySelectorAll(".pw-downloads button")),
    ["Download CSV", "Download SVG", "Download PNG"]);
});

test("render replaces what was there before", () => {
  const document = dom();
  const el = document.getElementById("out");
  el.textContent = "old";
  render(el, RESULTS, DEFAULT_SETTINGS, META);
  render(el, RESULTS.slice(0, 2), DEFAULT_SETTINGS, META);
  assert.equal(el.children.length, 1);
  assert.equal(el.querySelectorAll("tbody tr").length, 2);
});

test("a result with no matched peaks is a message, not a bar", () => {
  const el = rendered([{ label: "empty", mode: "centre", counts: {}, matched: 0, unmatched: 0 }]);
  assert.equal(segments(el).length, 0);
  assert.deepEqual(texts(el.querySelectorAll("g.pw-not-drawn text")), ["not drawn: no matched peaks"]);
});

test("settingsSummary: defaults with annotation and assembly", () => {
  assert.equal(
    settingsSummary(DEFAULT_SETTINGS, META),
    "Promoter −1000/+1000 bp · counted by peak centre · priority Promoter > 5′ UTR > 3′ UTR > " +
      "Exon > Intron > Intergenic · all transcripts · annotation gencode.vM25.basic.annotation.gff3.gz (GRCm38)",
  );
});

test("settingsSummary: bp mode, custom window, protein-coding only, no meta", () => {
  assert.equal(
    settingsSummary({ promoterUpstream: 3000, promoterDownstream: 100, mode: "bp", proteinCodingOnly: true }),
    "Promoter −3000/+100 bp · counted by base pair · priority Promoter > 5′ UTR > 3′ UTR > " +
      "Exon > Intron > Intergenic · protein-coding transcripts only",
  );
  assert.match(settingsSummary({}, { annotationName: "x.gtf" }), / · annotation x\.gtf$/);
});

test("unmatchedSummary: units follow the mode; peak counts shown in bp mode when given", () => {
  assert.equal(
    unmatchedSummary([
      { label: "a", mode: "centre", matched: 9, unmatched: 1 },
      { label: "b", mode: "bp", matched: 900, unmatched: 1200, peaks: { matched: 9, unmatched: 2 } },
      { label: "c", mode: "bp", matched: 900, unmatched: 0 },
      { label: "Genome", background: true, mode: "bp", matched: 10, unmatched: 0 },
    ]),
    "Unmatched, excluded from percentages: a 1 peak · b 1,200 bp (2 peaks) · c 0 bp",
  );
  assert.equal(unmatchedSummary([]), "");
});

test("toCSV: exact output for a small input", () => {
  const results = [
    { label: "Genome", background: true, mode: "bp",
      counts: { promoter: 1, utr5: 0, utr3: 0, exon: 1, intron: 1, intergenic: 1 }, matched: 4, unmatched: 0 },
    { label: 'peaks, "rep 1"', mode: "centre",
      counts: { promoter: 1, utr5: 0, utr3: 0, exon: 0, intron: 1, intergenic: 1 }, matched: 3, unmatched: 1 },
    { label: "bad", mode: "centre", matched: 5, unmatched: 5, refused: "50% of peaks unmatched" },
  ];
  assert.equal(
    toCSV(results),
    [
      "label,unit,promoter,promoter_pct,utr5,utr5_pct,utr3,utr3_pct,exon,exon_pct,intron,intron_pct," +
        "intergenic,intergenic_pct,matched,matched_pct,unmatched,unmatched_pct,not_drawn",
      '"peaks, ""rep 1""",peaks,1,33.33,0,0.00,0,0.00,0,0.00,1,33.33,1,33.33,3,75.00,1,25.00,',
      "bad,peaks,,,,,,,,,,,,,5,50.00,5,50.00,not drawn: 50% of peaks unmatched",
      "Genome,bp,1,25.00,0,0.00,0,0.00,1,25.00,1,25.00,1,25.00,4,100.00,0,0.00,",
      "",
    ].join("\n"),
  );
});

test("toCSV: the summary is written first as # lines", () => {
  const csv = toCSV([], "line one\nline two");
  assert.deepEqual(csv.split("\n").slice(0, 3), ["# line one", "# line two", "label,unit,promoter,promoter_pct,utr5,utr5_pct,utr3,utr3_pct,exon,exon_pct,intron,intron_pct,intergenic,intergenic_pct,matched,matched_pct,unmatched,unmatched_pct,not_drawn"]);
});

test("toSVG: standalone SVG with a white background and the summary lines", () => {
  const document = dom();
  const svg = toSVG(RESULTS, DEFAULT_SETTINGS, { ...META, warnings: ["Assembly mismatch"] }, { document });
  const parsed = new document.defaultView.DOMParser().parseFromString(svg, "image/svg+xml");
  assert.equal(parsed.querySelector("parsererror"), null, "well-formed XML");
  const root = parsed.documentElement;
  assert.equal(root.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(root.firstElementChild.getAttribute("fill"), "white");
  const footer = texts(root.querySelectorAll("g.pw-footer text")).join(" ");
  for (const phrase of ["Promoter −1000/+1000 bp", "counted by peak centre", "all transcripts",
    "gencode.vM25.basic.annotation.gff3.gz (GRCm38)", "H3K4me3 3 peaks", "Warning: Assembly mismatch"]) {
    assert.ok(footer.includes(phrase), phrase);
  }
  assert.equal(Number(root.getAttribute("height")), Number(root.getAttribute("viewBox").split(" ")[3]));
});
