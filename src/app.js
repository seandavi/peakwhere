// Page shell: UI state, file inputs, settings form, and the call into the pipeline.
// Layout: state → building the run request → render functions → event wiring.
import { CATEGORIES, CATEGORY_LABELS, DEFAULT_SETTINGS } from "./constants.js";
import { runAnalysis } from "./pipeline.js";
import {
  duplicateLabels,
  formatBytes,
  isTabularName,
  labelFromFilename,
  parseBasePairs,
  sniffPeakFormat,
  uniqueLabel,
} from "./labels.js";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Everything the page knows. Render functions read it; event handlers change it.
 * Promoter bp settings are null while the field holds something that isn't a whole
 * number ≥ 0, which blocks the Run button.
 */
export const state = {
  /** @type {File | null} */
  annotation: null,
  /** @type {File | null} */
  chromSizes: null,
  /** @type {{id: number, file: File, label: string, defaultLabel: string, format: "bed" | "csv" | null, oneBased: boolean}[]} */
  peaks: [],
  settings: {
    promoterUpstream: DEFAULT_SETTINGS.promoterUpstream,
    promoterDownstream: DEFAULT_SETTINGS.promoterDownstream,
    mode: DEFAULT_SETTINGS.mode,
    proteinCodingOnly: DEFAULT_SETTINGS.proteinCodingOnly,
  },
  running: false,
};

let nextPeakId = 1;

/** Reasons the analysis can't run yet; empty when it can. */
export function runBlockers() {
  const reasons = [];
  if (!state.annotation) reasons.push("Add an annotation file.");
  if (!state.peaks.length) reasons.push("Add at least one peak file.");
  if (state.settings.promoterUpstream === null || state.settings.promoterDownstream === null) {
    reasons.push("Promoter window sizes must be whole numbers of base pairs, 0 or more.");
  }
  if (state.peaks.some((p) => !p.label.trim())) reasons.push("Every peak file needs a label.");
  const dupes = duplicateLabels(state.peaks.map((p) => p.label));
  if (dupes.length) reasons.push(`Labels must be unique: “${dupes.join("”, “")}” is used twice.`);
  return reasons;
}

/** The argument for runAnalysis, built from the current state (SPEC.md §9, issue #8). */
export function buildRunRequest() {
  const peaks = state.peaks.map((p) => p.file);
  const labels = new Map(state.peaks.map((p) => [p.file, p.label.trim()]));
  const csvOneBased = new Map(
    state.peaks.filter((p) => p.format === "csv").map((p) => [p.file, p.oneBased]),
  );
  const request = {
    annotation: state.annotation,
    peaks,
    csvOneBased,
    labels,
    settings: { ...state.settings, priority: DEFAULT_SETTINGS.priority },
  };
  if (state.chromSizes) request.chromSizes = state.chromSizes;
  return request;
}

function addPeakFiles(files) {
  for (const file of files) {
    const defaultLabel = uniqueLabel(
      labelFromFilename(file.name),
      state.peaks.map((p) => p.label),
    );
    const entry = {
      id: nextPeakId++,
      file,
      label: defaultLabel,
      defaultLabel,
      format: isTabularName(file.name) ? "csv" : null,
      oneBased: false,
    };
    state.peaks.push(entry);
    if (entry.format === null) {
      detectPeakFormat(file).then((format) => {
        entry.format = format;
        renderPeakFormat(entry);
      });
    }
  }
  renderPeakList();
  renderRunState();
}

/** Peek at the start of a file (decompressing gzip) to decide if it's CSV/TSV. */
async function detectPeakFormat(file) {
  try {
    const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    let head;
    if (magic[0] === 0x1f && magic[1] === 0x8b) {
      const reader = file.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
      const { value } = await reader.read();
      reader.cancel().catch(() => {});
      head = new TextDecoder().decode(value);
    } else {
      head = await file.slice(0, 16384).text();
    }
    return sniffPeakFormat(head) ?? "bed";
  } catch {
    return "bed";
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

/** Show the chosen annotation or chrom.sizes file, or the empty picker. */
function renderSingleFile(kind) {
  const file = state[kind];
  const prefix = kind === "annotation" ? "annotation" : "chrom-sizes";
  const chosen = $(`${prefix}-chosen`);
  $(`${prefix}-drop`).dataset.empty = String(!file);
  chosen.hidden = !file;
  chosen.querySelector(".file-name").textContent = file?.name ?? "";
  chosen.querySelector(".file-size").textContent = file ? formatBytes(file.size) : "";
}

function renderPeakList() {
  const list = $("peak-list");
  list.replaceChildren(...state.peaks.map(peakRow));
  for (const entry of state.peaks) renderPeakFormat(entry);
}

function peakRow(entry) {
  const labelInput = el("input", {
    type: "text",
    class: "label-input",
    value: entry.label,
    "aria-label": `Label for ${entry.file.name}`,
    spellcheck: "false",
  });
  const oneBased = el("input", { type: "checkbox", class: "one-based" });
  oneBased.checked = entry.oneBased;
  return el(
    "li",
    { class: "peak-row", "data-id": entry.id },
    el(
      "div",
      { class: "peak-main" },
      labelInput,
      el(
        "span",
        { class: "peak-file" },
        el("span", { class: "file-name", text: entry.file.name }),
        el("span", { class: "file-size", text: formatBytes(entry.file.size) }),
        el("span", { class: "badge", hidden: "" }),
      ),
    ),
    el("button", {
      type: "button",
      class: "icon-button remove",
      "aria-label": `Remove ${entry.file.name}`,
      text: "✕",
    }),
    el(
      "div",
      { class: "csv-note", hidden: "" },
      el("p", {
        text:
          "CSV/TSV has no standard coordinate system. Read as 0-based half-open, like BED. " +
          "If start is the first base of the peak, the file is 1-based.",
      }),
      el("label", { class: "choice" }, oneBased, " Coordinates are 1-based (closed)"),
    ),
  );
}

/** Show or hide a row's CSV warning and toggle once its format is known. */
function renderPeakFormat(entry) {
  const row = $("peak-list").querySelector(`[data-id="${entry.id}"]`);
  if (!row) return;
  const badge = row.querySelector(".badge");
  badge.hidden = entry.format === null;
  badge.textContent = entry.format === "csv" ? "CSV/TSV" : "BED";
  row.querySelector(".csv-note").hidden = entry.format !== "csv";
}

function renderSettings() {
  $("promoter-upstream").value = state.settings.promoterUpstream;
  $("promoter-downstream").value = state.settings.promoterDownstream;
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === state.settings.mode;
  }
  $("protein-coding-only").checked = state.settings.proteinCodingOnly;
}

function renderRunState() {
  const blockers = runBlockers();
  $("run").disabled = state.running || blockers.length > 0;
  $("run").textContent = state.running ? "Running…" : "Run analysis";
  $("run-hint").textContent = state.running ? "" : blockers.join(" ");
  for (const id of ["promoter-upstream", "promoter-downstream"]) {
    const key = id === "promoter-upstream" ? "promoterUpstream" : "promoterDownstream";
    $(id).setAttribute("aria-invalid", String(state.settings[key] === null));
  }
  const dupes = new Set(duplicateLabels(state.peaks.map((p) => p.label)));
  for (const entry of state.peaks) {
    const input = $("peak-list").querySelector(`[data-id="${entry.id}"] .label-input`);
    input?.setAttribute("aria-invalid", String(!entry.label.trim() || dupes.has(entry.label.trim())));
  }
}

/** @param {{message: string, fraction: number | null}} progress */
function renderProgress({ message, fraction }) {
  const bar = $("progress-bar");
  $("progress").hidden = false;
  $("progress").classList.remove("error");
  if (fraction === null || fraction === undefined) bar.removeAttribute("value");
  else bar.value = fraction;
  $("progress-message").textContent = message;
}

function renderError(error) {
  $("progress").hidden = false;
  $("progress").classList.add("error");
  $("progress-bar").value = 0;
  $("progress-message").textContent = `Something went wrong: ${error?.message ?? error}`;
}

function renderWarnings(warnings) {
  const box = $("warnings");
  box.hidden = !warnings.length;
  box.replaceChildren(el("ul", {}, ...warnings.map((w) => el("li", { text: w }))));
}

/**
 * PLACEHOLDER for the chart (issue #11 swaps in src/chart.js). Renders the results as a
 * plain table: one row per peak file, then the genome background if there is one.
 * @param {object[]} results [{label, counts, matched, unmatched, mode, refused?}]
 * @param {object | null} background {label: "Genome", background: true, counts, ...}
 * @param {object} meta
 */
export function showResults(results, background, meta) {
  const container = $("results");
  const rows = background ? [...results, background] : results;

  const head = el(
    "tr",
    {},
    el("th", { scope: "col", text: "File" }),
    ...CATEGORIES.map((c) => el("th", { scope: "col", text: CATEGORY_LABELS[c] })),
    el("th", { scope: "col", text: "Matched" }),
    el("th", { scope: "col", text: "Unmatched" }),
  );
  const body = rows.map((r) => {
    const label = el("th", { scope: "row", title: r.label, text: r.label });
    if (r.refused) {
      return el(
        "tr",
        { class: "refused" },
        label,
        el("td", { colspan: CATEGORIES.length + 2, text: r.refused }),
      );
    }
    const total = CATEGORIES.reduce((n, c) => n + r.counts[c], 0);
    return el(
      "tr",
      r.background ? { class: "background" } : {},
      label,
      ...CATEGORIES.map((c) =>
        el(
          "td",
          {},
          numberFormat.format(r.counts[c]),
          el("span", { class: "pct", text: `${total ? ((100 * r.counts[c]) / total).toFixed(1) : "0.0"}%` }),
        ),
      ),
      el("td", { text: numberFormat.format(r.matched) }),
      el("td", { text: r.background ? "—" : numberFormat.format(r.unmatched) }),
    );
  });

  container.replaceChildren(
    el("h2", { text: "Results" }),
    el("p", {
      class: "hint",
      text:
        `Annotation: ${meta.annotation}. Counts are ${
          results[0]?.mode === "bp" ? "base pairs" : "peaks"
        }, and percentages are of the matched total. Unmatched peaks are on chromosomes ` +
        "the annotation doesn't have." +
        (background ? " The Genome row is in base pairs." : ""),
    }),
    el(
      "div",
      { class: "table-scroll" },
      el("table", {}, el("thead", {}, head), el("tbody", {}, ...body)),
    ),
  );
  container.hidden = false;
}

async function run() {
  if (state.running || runBlockers().length) return;
  const request = buildRunRequest();
  state.running = true;
  renderRunState();
  renderProgress({ message: "Starting…", fraction: 0 });
  try {
    const { results, background, meta, warnings } = await runAnalysis(request, {
      onProgress: renderProgress,
    });
    $("progress").hidden = true;
    renderWarnings(warnings);
    showResults(results, background, meta);
    ($("warnings").hidden ? $("results") : $("warnings")).scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    renderError(error);
  } finally {
    state.running = false;
    renderRunState();
  }
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

/** Highlight a drop zone while files are dragged over it, and hand dropped files on. */
function wireDropZone(zone, onFiles) {
  let depth = 0;
  zone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    zone.classList.add("dragging");
  });
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("dragleave", () => {
    if (--depth === 0) zone.classList.remove("dragging");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove("dragging");
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  });
}

function setSingleFile(kind, file) {
  state[kind] = file;
  renderSingleFile(kind);
  renderRunState();
}

function wire() {
  // A file dropped outside a drop zone would make the browser navigate to it and lose
  // everything on the page.
  for (const type of ["dragover", "drop"]) window.addEventListener(type, (e) => e.preventDefault());

  $("annotation-input").addEventListener("change", (e) => {
    if (e.target.files[0]) setSingleFile("annotation", e.target.files[0]);
    e.target.value = "";
  });
  $("chrom-sizes-input").addEventListener("change", (e) => {
    if (e.target.files[0]) setSingleFile("chromSizes", e.target.files[0]);
    e.target.value = "";
  });
  $("peaks-input").addEventListener("change", (e) => {
    addPeakFiles([...e.target.files]);
    e.target.value = "";
  });
  wireDropZone($("annotation-drop"), (files) => setSingleFile("annotation", files[0]));
  wireDropZone($("chrom-sizes-drop"), (files) => setSingleFile("chromSizes", files[0]));
  wireDropZone($("peaks-drop"), addPeakFiles);
  for (const button of document.querySelectorAll("[data-clear]")) {
    button.addEventListener("click", () => setSingleFile(button.dataset.clear, null));
  }

  const peakFor = (target) => {
    const id = Number(target.closest(".peak-row")?.dataset.id);
    return state.peaks.find((p) => p.id === id);
  };
  const list = $("peak-list");
  list.addEventListener("input", (e) => {
    const entry = peakFor(e.target);
    if (entry && e.target.classList.contains("label-input")) {
      entry.label = e.target.value;
      renderRunState();
    }
  });
  list.addEventListener("focusout", (e) => {
    const entry = peakFor(e.target);
    if (entry && e.target.classList.contains("label-input") && !entry.label.trim()) {
      entry.label = entry.defaultLabel;
      e.target.value = entry.label;
      renderRunState();
    }
  });
  list.addEventListener("change", (e) => {
    const entry = peakFor(e.target);
    if (entry && e.target.classList.contains("one-based")) entry.oneBased = e.target.checked;
  });
  list.addEventListener("click", (e) => {
    const entry = peakFor(e.target);
    if (entry && e.target.closest(".remove")) {
      state.peaks = state.peaks.filter((p) => p !== entry);
      renderPeakList();
      renderRunState();
    }
  });

  $("promoter-upstream").addEventListener("input", (e) => {
    state.settings.promoterUpstream = parseBasePairs(e.target.value);
    renderRunState();
  });
  $("promoter-downstream").addEventListener("input", (e) => {
    state.settings.promoterDownstream = parseBasePairs(e.target.value);
    renderRunState();
  });
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", () => {
      if (radio.checked) state.settings.mode = radio.value;
    });
  }
  $("protein-coding-only").addEventListener("change", (e) => {
    state.settings.proteinCodingOnly = e.target.checked;
  });

  $("analysis-form").addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });
}

wire();
renderSettings();
renderSingleFile("annotation");
renderSingleFile("chromSizes");
renderPeakList();
renderRunState();
