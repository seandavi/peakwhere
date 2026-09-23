// STUB. Returns mock results so the page shell can be built and exercised before the
// parsers, engine and worker exist. The integration issue (#11) replaces this file;
// the signature and the shape of what it returns are the contract (SPEC.md §9).
import { CATEGORIES } from "./constants.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Small deterministic hash, so the same label gives the same mock counts every run. */
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

function mockCounts(seed, total) {
  const weights = CATEGORIES.map((_, i) => 1 + ((seed >>> (i * 4)) & 15));
  const sum = weights.reduce((a, b) => a + b, 0);
  const counts = Object.fromEntries(
    CATEGORIES.map((c, i) => [c, Math.floor((total * weights[i]) / sum)]),
  );
  counts.intergenic += total - Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
}

/**
 * Run the analysis. STUB: ignores file contents and returns mock numbers after a
 * short delay, reporting progress along the way.
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
 * @returns {Promise<{results: object[], background: object | null, meta: object, warnings: string[]}>}
 */
export async function runAnalysis(
  { annotation, peaks, chromSizes, labels, settings },
  { onProgress = () => {} } = {},
) {
  const steps = [
    `Reading ${annotation.name}`,
    "Building the annotation",
    ...peaks.map((f) => `Classifying ${labels.get(f) ?? f.name}`),
  ];
  for (const [i, message] of steps.entries()) {
    onProgress({ message, fraction: i / steps.length });
    await sleep(300);
  }
  onProgress({ message: "Done", fraction: 1 });

  const bp = settings.mode === "bp";
  const results = peaks.map((file) => {
    const label = labels.get(file) ?? file.name;
    const seed = hash(label);
    const matched = 500 + (seed % 20000);
    const unmatched = seed % 7;
    return {
      label,
      counts: mockCounts(seed, bp ? matched * 350 : matched),
      matched: bp ? matched * 350 : matched,
      unmatched,
      mode: settings.mode,
    };
  });

  const warnings = ["Mock results: the analysis pipeline isn't connected yet (#11)."];
  const hasLengths = Boolean(chromSizes) || /\.gff3?(\.gz)?$/i.test(annotation.name);
  let background = null;
  if (hasLengths) {
    const total = 2_700_000_000;
    background = {
      label: "Genome",
      background: true,
      counts: mockCounts(hash("Genome"), total),
      matched: total,
      unmatched: 0,
      mode: "bp",
      total,
    };
  } else {
    warnings.push(
      "No chromosome lengths, so the Genome bar is hidden. Use a GFF3 with " +
        "##sequence-region lines, or add a chrom.sizes file.",
    );
  }

  const meta = {
    annotation: annotation.name,
    chromSizes: chromSizes?.name ?? null,
    assembly: null,
    transcripts: 81540,
    mock: true,
  };
  return { results, background, meta, warnings };
}
