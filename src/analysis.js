// A run request → chart rows, warnings and per-peak assignments (SPEC §3, §5, §9;
// ADR-0005, 0006, 0007, 0010, 0013). Pure over Blobs, so it runs in the worker and in
// Node tests alike; src/worker.js is only the message wrapper around it.
//
// The parsed annotation is cached, so changing the promoter window, counting mode or
// labels re-runs only the partition and classification. The protein-coding filter is
// applied while the annotation is built, so each filter value is cached separately.
import { buildAnnotation } from "./annotate.js";
import { parseAnnotationLines } from "./annotation.js";
import { buildPartition, classifyPeaks, genomeBackground, normaliseChrom } from "./classify.js";
import { DEFAULT_SETTINGS, MAX_UNMATCHED_FRACTION } from "./constants.js";
import { linesFromStream } from "./io.js";
import { parsePeaks } from "./peaks.js";

/** Thrown at a safe point when `shouldStop` says a newer run has replaced this one. */
export class SupersededError extends Error {
  name = "SupersededError";
  constructor() {
    super("Replaced by a newer run");
  }
}

/** Progress is reported at most this often while reading files, in ms. */
const PROGRESS_INTERVAL = 100;

/** How many chromosome names a warning or refusal lists before "and N more". */
const NAMES_SHOWN = 5;

/**
 * @typedef {{file: Blob & {name: string}, label: string, oneBased?: boolean}} PeakInput
 * @typedef {{annotation: Blob & {name: string}, chromSizes?: (Blob & {name: string}) | null,
 *   peaks: PeakInput[], settings: {promoterUpstream: number, promoterDownstream: number,
 *   mode: "centre" | "bp", proteinCodingOnly: boolean, priority?: string[]}}} RunRequest
 */

/** Identity of a file for caching: a File posted to a worker arrives as a new object. */
function fileKey(file) {
  return `${file.name}\0${file.size}\0${file.lastModified ?? ""}`;
}

/** "a, b, c" or "a, b, c, d, e and 3 more". */
function listNames(names) {
  const shown = names.slice(0, NAMES_SHOWN).join(", ");
  return names.length > NAMES_SHOWN ? `${shown} and ${names.length - NAMES_SHOWN} more` : shown;
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/**
 * Runs analyses, keeping the parsed annotation (one per protein-coding filter value) and
 * the parsed peak files of the latest run for the next one.
 */
export class Analysis {
  /** @type {Map<string, object>} fileKey + filter value → buildAnnotation result */
  #annotations = new Map();
  /** @type {Map<string, object>} fileKey + oneBased → parsePeaks result */
  #peaks = new Map();

  /**
   * @param {RunRequest} request
   * @param {{onProgress?: (p: {message: string, fraction: number | null}) => void,
   *   shouldStop?: () => boolean}} [hooks] `shouldStop` is checked after the annotation
   *   is ready (so a finished parse is always cached) and before each peak file; when it
   *   returns true the run throws SupersededError.
   * @returns {Promise<{results: object[], background: object | null, meta: object,
   *   warnings: string[], assignments: Blob}>} `results` are chart rows (SPEC §9), one
   *   per peak file in input order; `background` is the Genome row or null.
   *   `assignments` is the per-peak TSV body, without a header comment (SPEC §3.4).
   */
  async run(request, { onProgress = () => {}, shouldStop = () => false } = {}) {
    const settings = { ...DEFAULT_SETTINGS, ...request.settings };
    const { priority, mode } = settings;
    const warnings = [];
    const stopIfSuperseded = () => {
      if (shouldStop()) throw new SupersededError();
    };

    // Progress is the share of bytes read, over the files not already cached.
    const annotationKey = `${fileKey(request.annotation)}\0${Boolean(settings.proteinCodingOnly)}`;
    const peakKeys = request.peaks.map((p) => `${fileKey(p.file)}\0${Boolean(p.oneBased)}`);
    let annotation = this.#annotations.get(annotationKey);
    const annotationCached = annotation !== undefined;
    const totalBytes =
      (annotationCached ? 0 : request.annotation.size) +
      request.peaks.reduce((n, p, i) => n + (this.#peaks.has(peakKeys[i]) ? 0 : p.file.size), 0);
    const progress = new ByteProgress(totalBytes, onProgress);

    if (!annotationCached) {
      const name = request.annotation.name;
      const lines = progress.lines(request.annotation, `Reading ${name}`, "Building the annotation model");
      annotation = await buildAnnotation(parseAnnotationLines(lines), {
        proteinCodingOnly: settings.proteinCodingOnly,
      });
      // Keep only this annotation file's entries: the other filter value may come next.
      for (const key of this.#annotations.keys()) {
        if (!key.startsWith(fileKey(request.annotation))) this.#annotations.delete(key);
      }
      this.#annotations.set(annotationKey, annotation);
    }
    stopIfSuperseded();
    if (annotation.stats?.proteinCodingFilter === "unavailable") {
      warnings.push(
        "The protein-coding filter wasn't applied: no transcript in the annotation has a " +
          "transcript_type or gene_type, so every transcript was used.",
      );
    }

    const chromLengths = new Map(annotation.chromLengths);
    if (request.chromSizes) {
      progress.report(`Reading ${request.chromSizes.name}`);
      const sizes = await readChromSizes(request.chromSizes);
      warnings.push(...mergeChromSizes(chromLengths, sizes, annotation, request.chromSizes.name));
    }

    progress.report("Building the partition");
    const partition = buildPartition(
      { ...annotation, chromLengths },
      {
        promoterUpstream: settings.promoterUpstream,
        promoterDownstream: settings.promoterDownstream,
        priority,
      },
    );

    const results = [];
    const assignmentParts = [];
    const peaksUsed = new Map();
    for (const [i, input] of request.peaks.entries()) {
      stopIfSuperseded();
      const { label } = input;
      let parsed = this.#peaks.get(peakKeys[i]);
      if (parsed === undefined) {
        const text = await linesToText(progress.lines(input.file, `Reading ${input.file.name}`));
        parsed = parsePeaks(text, { format: "auto", oneBased: Boolean(input.oneBased) });
      }
      peaksUsed.set(peakKeys[i], parsed);

      progress.report(`Classifying ${label}`);
      const classified = classifyPeaks(partition, parsed.peaks, { mode, priority });
      const row = {
        label,
        counts: classified.counts,
        matched: classified.matched,
        unmatched: classified.unmatched,
        mode,
        peaks: classified.peaks,
      };
      const refused = refusal(parsed, classified);
      if (refused) row.refused = refused;
      results.push(row);
      warnings.push(
        ...peakWarnings(label, parsed, classified, {
          oneBased: Boolean(input.oneBased),
          refused: Boolean(refused),
          assembly: annotation.assembly,
        }),
      );
      assignmentParts.push(assignmentLines(label, parsed.peaks, classified.perPeak));
    }
    this.#peaks = peaksUsed;

    let background = null;
    if (chromLengths.size > 0) {
      progress.report("Computing the genome background");
      const { counts, total } = genomeBackground(partition, chromLengths);
      background = { label: "Genome", background: true, counts, matched: total, unmatched: 0, mode: "bp" };
      const missing = [...annotation.byChrom.keys()].filter((c) => !chromLengths.has(c));
      if (missing.length > 0) {
        warnings.push(
          `The Genome bar covers only the chromosomes with a known length; ` +
            `${plural(missing.length, "annotated chromosome")} ${missing.length === 1 ? "has" : "have"} none: ` +
            `${listNames(missing)}.`,
        );
      }
    } else {
      warnings.push(
        "The Genome bar is hidden: the annotation gives no chromosome lengths (a GTF never " +
          "does). Use a GFF3 with ##sequence-region lines, or add a chrom.sizes file.",
      );
    }

    progress.report("Done", 1);
    const meta = {
      annotationName: request.annotation.name,
      assembly: annotation.assembly,
      chromSizesName: request.chromSizes?.name ?? null,
      transcripts: annotation.transcripts,
      proteinCodingFilter: annotation.stats?.proteinCodingFilter ?? null,
      annotationCached,
      warnings,
    };
    return { results, background, meta, warnings, assignments: new Blob(assignmentParts) };
  }
}

/**
 * Why a file isn't drawn, or null (ADR-0006): no valid peaks at all, or more than 5% of
 * its peaks on chromosomes the annotation doesn't have. Counted in peaks, whatever the mode.
 */
export function refusal(parsed, classified) {
  if (parsed.peaks.length === 0) {
    const first = parsed.rejected[0];
    return first
      ? `no valid peaks; all ${plural(parsed.rejected.length, "row")} rejected (line ${first.lineNumber}: ${first.reason})`
      : "the file has no peaks";
  }
  const { matched, unmatched } = classified.peaks;
  if (unmatched / (matched + unmatched) <= MAX_UNMATCHED_FRACTION) return null;
  const pct = ((100 * unmatched) / (matched + unmatched)).toFixed(1);
  return (
    `${pct}% of peaks (${unmatched.toLocaleString("en-US")} of ` +
    `${(matched + unmatched).toLocaleString("en-US")}) are on chromosomes not in the annotation: ` +
    `${listNames(classified.unmatchedChroms)}`
  );
}

/**
 * Warnings about one peak file: rejected rows, unmatched peaks (a refused file already
 * lists them), out-of-range peaks (ADR-0013) and the CSV coordinate reading (ADR-0007).
 */
function peakWarnings(label, parsed, classified, { oneBased, refused, assembly }) {
  const warnings = [];
  if (parsed.rejected.length > 0) {
    const first = parsed.rejected[0];
    warnings.push(
      `${label}: ${plural(parsed.rejected.length, "row")} rejected and not counted ` +
        `(first: line ${first.lineNumber}, ${first.reason}).`,
    );
  }
  const { unmatched } = classified.peaks;
  if (unmatched > 0 && !refused) {
    warnings.push(
      `${label}: ${plural(unmatched, "peak")} on chromosomes not in the annotation, left out ` +
        `of the percentages: ${listNames(classified.unmatchedChroms)}.`,
    );
  }
  if (classified.outOfRange > 0) {
    warnings.push(
      `${label}: ${plural(classified.outOfRange, "peak")} ${classified.outOfRange === 1 ? "runs" : "run"} ` +
        `past the end of ${classified.outOfRange === 1 ? "its" : "their"} chromosome. The peaks may be on a ` +
        `different genome build from the annotation${assembly ? ` (${assembly})` : ""}.`,
    );
  }
  if (parsed.format === "csv") {
    warnings.push(
      oneBased
        ? `${label}: CSV/TSV read as 1-based closed coordinates, as you marked it.`
        : `${label}: CSV/TSV read as 0-based half-open coordinates, like BED. If start is the ` +
            "first base of each peak, mark the file 1-based.",
    );
  }
  return warnings;
}

/** Per-peak TSV lines: label, chrom, start, end (0-based half-open), name, category. */
function assignmentLines(label, peaks, perPeak) {
  const lines = new Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) {
    const { chrom, start, end, name } = peaks[i];
    lines[i] = `${label}\t${chrom}\t${start}\t${end}\t${name ?? "."}\t${perPeak[i]}\n`;
  }
  return lines.join("");
}

/** Column header of the per-peak assignment file (SPEC §3.4). */
export const ASSIGNMENT_COLUMNS = "file\tchrom\tstart\tend\tname\tcategory\n";

/**
 * chrom.sizes lines → Map<name, length>. Blank and `#` lines are skipped; any other
 * line must be a name and a whole-number length.
 * @param {Blob} file
 */
export async function readChromSizes(file) {
  const sizes = new Map();
  let lineNumber = 0;
  for await (const line of linesFromStream(file.stream())) {
    lineNumber++;
    if (line.trim() === "" || line.startsWith("#")) continue;
    const [name, length] = line.trim().split(/\s+/);
    if (!/^\d+$/.test(length ?? "") || Number(length) < 1) {
      throw new Error(`${file.name ?? "chrom.sizes"}, line ${lineNumber}: expected a name and a length, got "${line}"`);
    }
    sizes.set(name, Number(length));
  }
  return sizes;
}

/**
 * Add chrom.sizes lengths to `chromLengths` for chromosomes the annotation has, matched by
 * normalised name and stored under the annotation's spelling (ADR-0006, ADR-0010). Other
 * chrom.sizes entries are ignored: their peaks stay unmatched. A length that disagrees
 * with the annotation's own keeps the annotation's and is returned as a warning.
 * @returns {string[]} warnings
 */
export function mergeChromSizes(chromLengths, sizes, annotation, sizesName) {
  const spelling = new Map();
  for (const chrom of [...annotation.byChrom.keys(), ...annotation.chromLengths.keys()]) {
    if (!spelling.has(normaliseChrom(chrom))) spelling.set(normaliseChrom(chrom), chrom);
  }
  const disagree = [];
  for (const [name, length] of sizes) {
    const chrom = spelling.get(normaliseChrom(name));
    if (chrom === undefined) continue;
    const known = annotation.chromLengths.get(chrom);
    if (known === undefined) chromLengths.set(chrom, length);
    else if (known !== length) disagree.push(chrom);
  }
  if (disagree.length === 0) return [];
  return [
    `${sizesName} gives different lengths from the annotation for ${listNames(disagree)}; the ` +
      "annotation's were used. The two may be for different genome builds.",
  ];
}

async function linesToText(lines) {
  const out = [];
  for await (const line of lines) out.push(line);
  return out.join("\n");
}

/** Reports {message, fraction} from bytes read, throttled. */
class ByteProgress {
  #read = 0;
  #last = 0;

  constructor(total, onProgress) {
    this.total = total;
    this.onProgress = onProgress;
  }

  get fraction() {
    return this.total > 0 ? Math.min(1, this.#read / this.total) : null;
  }

  report(message, fraction = this.fraction) {
    this.#last = Date.now();
    this.onProgress({ message, fraction });
  }

  /**
   * Lines of `file`, counting its (possibly compressed) bytes as they are read.
   * `doneMessage`, if given, is reported once the last line has been taken.
   */
  async *lines(file, message, doneMessage) {
    this.report(message);
    const counter = new TransformStream({
      transform: (chunk, controller) => {
        this.#read += chunk.byteLength;
        if (Date.now() - this.#last >= PROGRESS_INTERVAL) this.report(message);
        controller.enqueue(chunk);
      },
    });
    yield* linesFromStream(file.stream().pipeThrough(counter));
    if (doneMessage) this.report(doneMessage);
  }
}
