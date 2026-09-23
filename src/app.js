// Page shell: UI state, file inputs, settings form, and the call into the pipeline.
// Layout: state → building the run request → render functions → event wiring.
import { ASSIGNMENT_COLUMNS } from "./analysis.js";
import { render, settingsSummary } from "./chart.js";
import { DEFAULT_SETTINGS } from "./constants.js";
import { runAnalysis, SupersededError } from "./pipeline.js";
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
  /** True once results are showing: from then on, changing a setting re-runs. */
  hasResults: false,
};

let nextPeakId = 1;

/** The Try-the-example data in examples/ (served from the same site), labelled by assay. */
const EXAMPLE = {
  annotation: "gencode.vM25.basic.chr19.gff3.gz",
  peaks: [
    ["thymus_H3K4me3_ENCFF674JZY.chr19.narrowPeak.gz", "H3K4me3"],
    ["thymus_H3K36me3_ENCFF853BYO.chr19.narrowPeak.gz", "H3K36me3"],
    ["thymus_H3K27me3_ENCFF478UYW.chr19.narrowPeak.gz", "H3K27me3"],
    ["thymus_CTCF_ENCFF714WDP.chr19.narrowPeak.gz", "CTCF"],
    ["thymus_DNase_ENCFF979ULB.chr19.narrowPeak.gz", "DNase"],
  ],
};

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

/**
 * @param {File[]} files
 * @param {string[]} [labels] default labels, instead of ones made from the file names
 */
function addPeakFiles(files, labels = []) {
  for (const [i, file] of files.entries()) {
    const defaultLabel = uniqueLabel(
      labels[i] ?? labelFromFilename(file.name),
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

/**
 * Show the results with src/chart.js: chart, settings summary, warnings, table and
 * downloads, plus a download of the per-peak assignments (SPEC §3.4).
 * @param {object[]} results one row per peak file (SPEC §9)
 * @param {object | null} background the Genome row, or null
 * @param {object} meta annotationName, assembly, warnings
 * @param {object} settings the settings the results were computed with
 * @param {Blob} assignments per-peak TSV body from the worker
 */
export function showResults(results, background, meta, settings, assignments) {
  const container = $("results");
  const chart = el("div");
  render(chart, background ? [...results, background] : results, settings, meta);

  const perPeak = el("button", { type: "button", "data-format": "tsv", text: "Download per-peak TSV" });
  perPeak.addEventListener("click", () => {
    const header =
      `# peakwhere per-peak assignments: ${settingsSummary(settings, meta)}\n` +
      "# start and end are 0-based half-open, as in BED; category is unmatched for peaks " +
      "on chromosomes not in the annotation\n";
    const url = URL.createObjectURL(
      new Blob([header, ASSIGNMENT_COLUMNS, assignments], { type: "text/tab-separated-values" }),
    );
    const a = el("a", { href: url, download: "peakwhere-per-peak.tsv" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });
  chart.querySelector(".pw-downloads")?.append(perPeak);

  container.replaceChildren(el("h2", { text: "Results" }), chart);
  container.hidden = false;
}

/** Tags each run, so a slower, older run can never overwrite a newer one's results. */
let latestRun = 0;

/**
 * Run the analysis and show the results. `auto` is a re-run after a setting changed:
 * it doesn't scroll, and shows progress only if it takes a noticeable time.
 */
async function run({ auto = false } = {}) {
  if (runBlockers().length) return;
  const request = buildRunRequest();
  const token = ++latestRun;
  const started = performance.now();
  const showProgress = (progress) => {
    if (token === latestRun && (!auto || performance.now() - started > 250)) renderProgress(progress);
  };
  state.running = true;
  renderRunState();
  if (!auto) renderProgress({ message: "Starting…", fraction: 0 });
  try {
    const { results, background, meta, assignments } = await runAnalysis(request, {
      onProgress: showProgress,
    });
    if (token !== latestRun) return;
    $("progress").hidden = true;
    showResults(results, background, meta, request.settings, assignments);
    state.hasResults = true;
    if (!auto) $("results").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    if (token !== latestRun || error instanceof SupersededError) return;
    renderError(error);
  } finally {
    if (token === latestRun) {
      state.running = false;
      renderRunState();
    }
  }
}

let rerunTimer;

/** Once results are showing, re-run shortly after the last settings or label change. */
function scheduleRerun() {
  if (!state.hasResults) return;
  clearTimeout(rerunTimer);
  rerunTimer = setTimeout(() => run({ auto: true }), 300);
}

/** Example files, fetched once from examples/ and then reused (so the worker's cache hits). */
let exampleFiles = null;

async function fetchExample() {
  const get = async (name) => {
    const response = await fetch(new URL(`../examples/${name}`, import.meta.url));
    if (!response.ok) throw new Error(`Couldn't load the example file ${name} (HTTP ${response.status})`);
    return new File([await response.blob()], name);
  };
  const [annotation, ...peaks] = await Promise.all([
    get(EXAMPLE.annotation),
    ...EXAMPLE.peaks.map(([name]) => get(name)),
  ]);
  return { annotation, peaks };
}

/** Load the chr19 example into the form, replacing the current files, and run it. */
async function tryExample() {
  if (state.running) return;
  $("try-example").disabled = true;
  renderProgress({ message: "Fetching the example files…", fraction: null });
  try {
    exampleFiles ??= await fetchExample();
  } catch (error) {
    renderError(error);
    return;
  } finally {
    $("try-example").disabled = false;
  }
  setSingleFile("annotation", exampleFiles.annotation);
  setSingleFile("chromSizes", null);
  state.peaks = [];
  addPeakFiles(exampleFiles.peaks, EXAMPLE.peaks.map(([, label]) => label));
  await run();
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
      scheduleRerun();
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
    if (entry && e.target.classList.contains("one-based")) {
      entry.oneBased = e.target.checked;
      scheduleRerun();
    }
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
    scheduleRerun();
  });
  $("promoter-downstream").addEventListener("input", (e) => {
    state.settings.promoterDownstream = parseBasePairs(e.target.value);
    renderRunState();
    scheduleRerun();
  });
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", () => {
      if (radio.checked) {
        state.settings.mode = radio.value;
        scheduleRerun();
      }
    });
  }
  $("protein-coding-only").addEventListener("change", (e) => {
    state.settings.proteinCodingOnly = e.target.checked;
    scheduleRerun();
  });

  $("analysis-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!state.running) run();
  });
  $("try-example").addEventListener("click", tryExample);
}

wire();
renderSettings();
renderSingleFile("annotation");
renderSingleFile("chromSizes");
renderPeakList();
renderRunState();
