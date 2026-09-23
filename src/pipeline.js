// Main-thread API over the analysis worker (SPEC §9). One module worker is started on
// first use and kept, so it can cache the parsed annotation between runs.
import { SupersededError } from "./analysis.js";

export { SupersededError };

/** @type {Worker | null} */
let worker = null;
let nextId = 1;
/** @type {Map<number, {resolve: Function, reject: Function, onProgress: Function}>} */
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", ({ data }) => {
    const run = pending.get(data.id);
    if (!run) return;
    if (data.type === "progress") {
      run.onProgress(data.progress);
      return;
    }
    pending.delete(data.id);
    if (data.type === "result") run.resolve(data.result);
    else if (data.type === "superseded") run.reject(new SupersededError());
    else run.reject(new Error(data.message));
  });
  // A worker that fails to load or crashes: fail every pending run, and start afresh
  // next time.
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    const error = new Error(`The analysis worker failed: ${event.message || "it could not be loaded"}`);
    for (const run of pending.values()) run.reject(error);
    pending.clear();
    worker.terminate();
    worker = null;
  });
  return worker;
}

/**
 * Run the analysis in the worker. The parsed annotation is cached there, so a second
 * run with the same annotation file and protein-coding setting doesn't re-read it.
 *
 * Starting a run replaces any run still in progress: the older one rejects with
 * SupersededError, and its result is never delivered.
 *
 * @param {object} request
 * @param {File} request.annotation GFF3 or GTF, plain or gzipped
 * @param {File[]} request.peaks peak files, in the order they were added
 * @param {File} [request.chromSizes] optional chrom.sizes (ADR-0010)
 * @param {Map<File, boolean>} request.csvOneBased true for a CSV/TSV the user marked 1-based (ADR-0007)
 * @param {Map<File, string>} request.labels bar label for each peak file (ADR-0011)
 * @param {object} request.settings promoterUpstream, promoterDownstream, mode, proteinCodingOnly, priority
 * @param {object} [hooks]
 * @param {(p: {message: string, fraction: number | null}) => void} [hooks.onProgress]
 *   fraction is 0–1, or null when the amount of work left is unknown
 * @returns {Promise<{results: object[], background: object | null, meta: object,
 *   warnings: string[], assignments: Blob}>} see Analysis.run in src/analysis.js
 */
export function runAnalysis(
  { annotation, peaks, chromSizes, csvOneBased, labels, settings },
  { onProgress = () => {} } = {},
) {
  const request = {
    annotation,
    chromSizes: chromSizes ?? null,
    peaks: peaks.map((file) => ({
      file,
      label: labels.get(file) ?? file.name,
      oneBased: csvOneBased?.get(file) ?? false,
    })),
    settings,
  };
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ type: "run", id, request });
  });
}
