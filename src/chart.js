// Results → 100%-stacked bar chart, table, settings summary, and CSV/SVG/PNG downloads.
import * as Plot from "../vendor/plot.js";
import { CATEGORIES, CATEGORY_LABELS, DEFAULT_SETTINGS } from "./constants.js";

/**
 * One colour per category, used for the chart, legend and table everywhere.
 * Okabe–Ito colours (colour-blind safe): warm for promoter and UTRs, cool for the gene
 * body, grey for intergenic.
 */
export const CATEGORY_COLORS = Object.freeze({
  promoter: "#D55E00",
  utr5: "#E69F00",
  utr3: "#F0E442",
  exon: "#009E73",
  intron: "#56B4E9",
  intergenic: "#999999",
});

/**
 * @typedef {object} Result
 * @property {string} label
 * @property {Record<string, number>} [counts] keyed by category
 * @property {number} matched
 * @property {number} unmatched
 * @property {"centre" | "bp"} mode
 * @property {string} [refused] why the file is not drawn
 * @property {boolean} [background] the genome background row (label "Genome")
 * @property {{matched: number, unmatched: number}} [peaks] peak counts, used in bp mode
 *
 * counts, matched and unmatched share one unit: peaks in "centre" mode, base pairs in
 * "bp" mode. A background row is always in base pairs.
 */

const SEP = " · ";
const SVG_NS = "http://www.w3.org/2000/svg";
const LINE_HEIGHT = 15;

/** Percentage of `count` in `total`; 0 when total is 0. */
function share(count, total) {
  return total > 0 ? (100 * count) / total : 0;
}

const fmtCount = (n) => Math.round(n).toLocaleString("en-US");
const fmtPct = (p) => `${p.toFixed(1)}%`;
/** "1 peak", "3 peaks", "12 bp". */
const amount = (n, unit) => `${fmtCount(n)} ${unit === "peaks" && n === 1 ? "peak" : unit}`;

function unitOf(result) {
  return result.background || result.mode === "bp" ? "bp" : "peaks";
}

/** Why a row is shown as a message instead of a bar, or null if it is drawn. */
function notDrawn(result) {
  if (result.refused) return `not drawn: ${result.refused}`;
  if (!(result.matched > 0)) return `not drawn: no matched ${unitOf(result)}`;
  return null;
}

/** Results in display order: input order, with background rows moved to the bottom. */
function ordered(results) {
  return [...results.filter((r) => !r.background), ...results.filter((r) => r.background)];
}

/**
 * The one-line settings summary printed under the chart and in every download.
 * @param {object} settings promoterUpstream, promoterDownstream, mode, priority,
 *   proteinCodingOnly; missing values fall back to DEFAULT_SETTINGS
 * @param {{annotationName?: string, assembly?: string}} [meta]
 * @returns {string}
 */
export function settingsSummary(settings, meta = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const parts = [
    `Promoter −${s.promoterUpstream}/+${s.promoterDownstream} bp`,
    s.mode === "bp" ? "counted by base pair" : "counted by peak centre",
    `priority ${s.priority.map((c) => CATEGORY_LABELS[c]).join(" > ")}`,
    s.proteinCodingOnly ? "protein-coding transcripts only" : "all transcripts",
  ];
  if (meta.annotationName || meta.assembly) {
    const name = meta.annotationName ?? "unnamed";
    parts.push(`annotation ${name}${meta.assembly ? ` (${meta.assembly})` : ""}`);
  }
  return parts.join(SEP);
}

/**
 * One line listing each file's unmatched count, which is excluded from the percentages
 * (ADR-0006). Empty when there are no non-background results.
 * @param {Result[]} results
 * @returns {string}
 */
export function unmatchedSummary(results) {
  const files = results.filter((r) => !r.background);
  if (files.length === 0) return "";
  const items = files.map((r) => {
    const peaks = unitOf(r) === "bp" && r.peaks ? ` (${amount(r.peaks.unmatched, "peaks")})` : "";
    return `${r.label} ${amount(r.unmatched, unitOf(r))}${peaks}`;
  });
  return `Unmatched, excluded from percentages: ${items.join(SEP)}`;
}

/** The summary lines that go under the chart and into every download. */
function footerLines(results, settings, meta = {}) {
  return [
    settingsSummary(settings, meta),
    unmatchedSummary(results),
    ...(meta.warnings ?? []).map((w) => `Warning: ${w}`),
  ].filter(Boolean);
}

function csvField(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/**
 * The table as CSV: one row per result (background last), a count and a percentage per
 * category, then matched and unmatched. Category percentages are of matched; matched and
 * unmatched percentages are of matched + unmatched. Rows that are not drawn leave the
 * category cells empty and say why in `not_drawn`.
 * @param {Result[]} results
 * @param {string} [summary] written first, each line prefixed with "# "
 * @returns {string}
 */
export function toCSV(results, summary) {
  const header = ["label", "unit"];
  for (const c of CATEGORIES) header.push(c, `${c}_pct`);
  header.push("matched", "matched_pct", "unmatched", "unmatched_pct", "not_drawn");

  const lines = summary ? summary.split("\n").map((l) => `# ${l}`) : [];
  lines.push(header.join(","));
  for (const r of ordered(results)) {
    const message = notDrawn(r);
    const row = [r.label, unitOf(r)];
    for (const c of CATEGORIES) {
      const n = r.counts?.[c] ?? 0;
      row.push(...(message ? ["", ""] : [n, share(n, r.matched).toFixed(2)]));
    }
    const total = r.matched + r.unmatched;
    row.push(r.matched, share(r.matched, total).toFixed(2));
    row.push(r.unmatched, share(r.unmatched, total).toFixed(2));
    row.push(message ?? "");
    lines.push(row.map(csvField).join(","));
  }
  return lines.join("\n") + "\n";
}

function svgEl(doc, name, attrs = {}, text) {
  const el = doc.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Greedy word-wrap of `text` at " · " (then spaces) to at most `max` characters. */
function wrap(text, max) {
  const out = [];
  let line = "";
  for (const word of text.split(/(?<= · )|(?<= )/)) {
    if (line && (line + word).trimEnd().length > max) {
      out.push(line.trimEnd());
      line = "";
    }
    line += word;
  }
  if (line) out.push(line.trimEnd());
  return out;
}

/** The Plot chart alone: segments, the dashed Genome outline, and not-drawn messages. */
function plotChart(results, doc, width) {
  const rows = ordered(results);
  const segments = [];
  for (const [row, r] of rows.entries()) {
    if (notDrawn(r)) continue;
    const unit = unitOf(r);
    const of = r.background ? amount(r.matched, unit) : `${fmtCount(r.matched)} matched ${unit}`;
    for (const c of CATEGORIES) {
      const count = r.counts?.[c] ?? 0;
      if (count <= 0) continue;
      const pct = fmtPct(share(count, r.matched));
      segments.push({
        row,
        category: c,
        count,
        background: Boolean(r.background),
        tip: `${r.label}\n${CATEGORY_LABELS[c]}: ${amount(count, unit)} (${pct} of ${of})`,
      });
    }
  }
  const messages = rows.flatMap((r, row) => (notDrawn(r) ? [{ row, text: notDrawn(r) }] : []));
  const backgrounds = rows.flatMap((r, row) => (r.background && !notDrawn(r) ? [{ row }] : []));

  const units = new Set(rows.filter((r) => !r.background).map(unitOf));
  const fileLabel = units.size === 1 && units.has("bp")
    ? "Percent of matched peak base pairs"
    : units.size === 1 ? "Percent of matched peaks" : "Percent of matched peaks or base pairs";
  // The Genome bar is always base pairs; say so when the file bars are not.
  const xLabel = backgrounds.length > 0 && !(units.size === 1 && units.has("bp"))
    ? `${fileLabel} (Genome bar: percent of base pairs)`
    : fileLabel;
  const longest = Math.max(0, ...rows.map((r) => r.label.length));

  return Plot.plot({
    document: doc,
    width,
    height: 36 + 30 * rows.length,
    marginTop: 6,
    marginLeft: Math.min(240, 16 + 6.5 * longest),
    marginRight: 20,
    // Stacks are normalised to [0, 1]; percent shows them as 0–100. A fixed domain keeps
    // the axis when every row is a message.
    x: { percent: true, domain: [0, 100], label: xLabel },
    y: {
      domain: rows.map((_, i) => i),
      tickFormat: (i) => rows[i].label,
      label: null,
      padding: 0.25,
    },
    color: {
      domain: CATEGORIES,
      range: CATEGORIES.map((c) => CATEGORY_COLORS[c]),
    },
    marks: [
      Plot.barX(segments, Plot.stackX({
        x: "count",
        y: "row",
        fill: "category",
        order: CATEGORIES,
        offset: "normalize",
        fillOpacity: (d) => (d.background ? 0.55 : 1),
        title: "tip",
        ariaLabel: (d) => d.tip.replace("\n", ", "),
        tip: true,
        className: "pw-segments",
      })),
      Plot.barX(backgrounds, {
        x1: 0,
        x2: 1,
        y: "row",
        fill: "none",
        stroke: "currentColor",
        strokeDasharray: "4,3",
        className: "pw-background",
      }),
      Plot.text(messages, {
        x: 0,
        y: "row",
        text: "text",
        textAnchor: "start",
        dx: 4,
        fontStyle: "italic",
        className: "pw-not-drawn",
      }),
    ],
  });
}

/**
 * The chart as one SVG element: a colour legend, the bars, and optionally the summary
 * lines underneath (for downloads).
 * @param {Result[]} results
 * @param {object} settings
 * @param {object} [meta] {annotationName, assembly, warnings}
 * @param {{document?: Document, width?: number, footer?: boolean}} [options]
 * @returns {SVGSVGElement}
 */
export function chartSVG(results, settings, meta = {}, options = {}) {
  const doc = options.document ?? globalThis.document;
  const width = options.width ?? 720;
  const root = svgEl(doc, "svg", {
    class: "pw-chart-svg",
    fill: "currentColor",
    "font-family": "system-ui, sans-serif",
    "font-size": 10,
  });

  // Legend, wrapped to the chart width.
  const legend = svgEl(doc, "g", { class: "pw-legend", "aria-label": "legend" });
  let x = 0;
  let y = 4;
  for (const c of CATEGORIES) {
    const itemWidth = 18 + 6.5 * CATEGORY_LABELS[c].length + 16;
    if (x > 0 && x + itemWidth > width) {
      x = 0;
      y += LINE_HEIGHT;
    }
    legend.append(
      svgEl(doc, "rect", { x, y, width: 12, height: 12, fill: CATEGORY_COLORS[c] }),
      svgEl(doc, "text", { x: x + 17, y: y + 10 }, CATEGORY_LABELS[c]),
    );
    x += itemWidth;
  }
  root.append(legend);

  const chart = plotChart(results, doc, width);
  const chartTop = y + 20;
  const chartHeight = Number(chart.getAttribute("height"));
  chart.setAttribute("y", chartTop);
  // Plot's own stylesheet sets height: auto, which a nested <svg> reads as 100%.
  chart.setAttribute("style", `width: ${width}px; height: ${chartHeight}px; max-width: none;`);
  root.append(chart);
  let height = chartTop + chartHeight;

  if (options.footer) {
    const footer = svgEl(doc, "g", { class: "pw-footer", "font-size": 11 });
    for (const line of footerLines(results, settings, meta).flatMap((l) => wrap(l, width / 6))) {
      height += LINE_HEIGHT;
      footer.append(svgEl(doc, "text", { x: 0, y: height }, line));
    }
    height += 6;
    root.append(footer);
  }

  root.setAttribute("width", width);
  root.setAttribute("height", height);
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return root;
}

/**
 * The chart with its summary as a standalone SVG document: white background, dark text.
 * @returns {string}
 */
export function toSVG(results, settings, meta = {}, options = {}) {
  const doc = options.document ?? globalThis.document;
  const svg = chartSVG(results, settings, meta, { ...options, document: doc, footer: true });
  svg.setAttribute("color", "#222");
  svg.prepend(svgEl(doc, "rect", { width: "100%", height: "100%", fill: "white" }));
  return new doc.defaultView.XMLSerializer().serializeToString(svg);
}

/**
 * The downloadable SVG drawn onto a canvas, as a PNG. Browser only.
 * @returns {Promise<Blob>}
 */
export async function toPNG(results, settings, meta = {}, options = {}) {
  const doc = options.document ?? globalThis.document;
  const scale = options.scale ?? 2;
  const svg = toSVG(results, settings, meta, { ...options, document: doc });
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new doc.defaultView.Image();
    img.src = url;
    await img.decode();
    const canvas = doc.createElement("canvas");
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(doc, blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement("a");
  a.href = url;
  a.download = filename;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function cell(doc, tag, text, className) {
  const el = doc.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

/** A table cell holding a count and a percentage. */
function countCell(doc, count, pct) {
  const td = cell(doc, "td", `${fmtCount(count)} `, "pw-num");
  td.append(cell(doc, "span", `(${fmtPct(pct)})`, "pw-pct"));
  return td;
}

function table(doc, results) {
  const t = cell(doc, "table", undefined, "pw-table");
  t.append(cell(doc, "caption",
    "Category percentages are of matched peaks (base pairs for bp rows). " +
    "Matched and unmatched percentages are of the whole file."));
  const head = doc.createElement("tr");
  head.append(cell(doc, "th", "File"), cell(doc, "th", "Unit"));
  for (const c of CATEGORIES) {
    const th = cell(doc, "th");
    const swatch = cell(doc, "span", undefined, "pw-swatch");
    swatch.style.background = CATEGORY_COLORS[c];
    th.append(swatch, CATEGORY_LABELS[c]);
    head.append(th);
  }
  head.append(cell(doc, "th", "Matched"), cell(doc, "th", "Unmatched"));
  for (const th of head.children) th.setAttribute("scope", "col");
  const thead = doc.createElement("thead");
  thead.append(head);

  const tbody = doc.createElement("tbody");
  for (const r of ordered(results)) {
    const tr = cell(doc, "tr", undefined, r.background ? "pw-background" : undefined);
    const th = cell(doc, "th");
    th.setAttribute("scope", "row");
    // Long file names may wrap after _ . - (thymus_H3K4me3_ENCFF674JZY), not mid-word.
    for (const part of r.label.split(/(?<=[_.-])/)) th.append(part, doc.createElement("wbr"));
    tr.append(th, cell(doc, "td", unitOf(r)));
    const message = notDrawn(r);
    if (message) {
      const td = cell(doc, "td", message, "pw-not-drawn");
      td.colSpan = CATEGORIES.length;
      tr.append(td);
    } else {
      for (const c of CATEGORIES) {
        const n = r.counts?.[c] ?? 0;
        tr.append(countCell(doc, n, share(n, r.matched)));
      }
    }
    const total = r.matched + r.unmatched;
    tr.append(countCell(doc, r.matched, share(r.matched, total)));
    tr.append(countCell(doc, r.unmatched, share(r.unmatched, total)));
    tbody.append(tr);
  }
  t.append(thead, tbody);
  return t;
}

/**
 * Render results into `el`, replacing its contents with: the chart (legend and bars,
 * background row at the bottom, not-drawn rows as messages), the settings summary and
 * the per-file unmatched line, any meta.warnings, the table, and CSV/SVG/PNG download
 * buttons. Every download includes the summary lines.
 * @param {HTMLElement} el
 * @param {Result[]} results
 * @param {object} settings
 * @param {{annotationName?: string, assembly?: string, warnings?: string[]}} [meta]
 * @param {{document?: Document, width?: number}} [options] document defaults to
 *   el.ownerDocument (so jsdom works in tests)
 */
export function render(el, results, settings, meta = {}, options = {}) {
  const doc = options.document ?? el.ownerDocument;
  const opts = { ...options, document: doc };
  const root = cell(doc, "div", undefined, "pw-chart");

  const figure = doc.createElement("figure");
  figure.append(chartSVG(results, settings, meta, opts));
  const caption = doc.createElement("figcaption");
  caption.append(cell(doc, "p", settingsSummary(settings, meta), "pw-summary"));
  const unmatched = unmatchedSummary(results);
  if (unmatched) caption.append(cell(doc, "p", unmatched, "pw-unmatched"));
  figure.append(caption);
  root.append(figure);

  if (meta.warnings?.length) {
    const ul = cell(doc, "ul", undefined, "pw-warnings");
    for (const w of meta.warnings) ul.append(cell(doc, "li", w));
    root.append(ul);
  }

  const tableWrap = cell(doc, "div", undefined, "pw-table-wrap");
  tableWrap.append(table(doc, results));
  root.append(tableWrap);

  const buttons = cell(doc, "div", undefined, "pw-downloads");
  const summary = footerLines(results, settings, meta).join("\n");
  const actions = {
    CSV: () => download(doc, new Blob([toCSV(results, summary)], { type: "text/csv" }), "peakwhere.csv"),
    SVG: () => download(doc, new Blob([toSVG(results, settings, meta, opts)], { type: "image/svg+xml" }),
      "peakwhere.svg"),
    PNG: async () => download(doc, await toPNG(results, settings, meta, opts), "peakwhere.png"),
  };
  for (const [name, action] of Object.entries(actions)) {
    const b = cell(doc, "button", `Download ${name}`);
    b.type = "button";
    b.dataset.format = name.toLowerCase();
    b.addEventListener("click", action);
    buttons.append(b);
  }
  root.append(buttons);

  el.replaceChildren(root);
}
