// Pure helpers for the page shell: labels, peak-file format sniffing, settings input.
// No DOM here, so everything is testable in Node.

/** Compression and format extensions stripped from a file name to make a label (ADR-0011). */
const LABEL_EXTENSIONS = /\.(gz|bed|narrowPeak|broadPeak|csv|tsv|txt)$/i;

/**
 * Default label for a peak file: its name minus compression and format extensions,
 * stripped repeatedly so `x.narrowPeak.gz` becomes `x` (ADR-0011). Other dots stay:
 * `sample.chr19.bed` becomes `sample.chr19`. A name that is nothing but extensions
 * is returned unchanged rather than as an empty label.
 * @param {string} name
 * @returns {string}
 */
export function labelFromFilename(name) {
  let label = name;
  while (LABEL_EXTENSIONS.test(label)) {
    const stripped = label.replace(LABEL_EXTENSIONS, "");
    if (!stripped) break;
    label = stripped;
  }
  return label;
}

/**
 * `label` if it isn't already taken, otherwise `label (2)`, `label (3)`, … so two files
 * with the same name still get distinct bars.
 * @param {string} label
 * @param {Iterable<string>} taken
 * @returns {string}
 */
export function uniqueLabel(label, taken) {
  const used = new Set(taken);
  if (!used.has(label)) return label;
  let n = 2;
  while (used.has(`${label} (${n})`)) n++;
  return `${label} (${n})`;
}

/**
 * Labels that appear more than once (after trimming), in first-seen order.
 * @param {Iterable<string>} labels
 * @returns {string[]}
 */
export function duplicateLabels(labels) {
  const seen = new Set();
  const dupes = new Set();
  for (const raw of labels) {
    const label = raw.trim();
    if (seen.has(label)) dupes.add(label);
    seen.add(label);
  }
  return [...dupes];
}

/**
 * Whether a file name says CSV/TSV, compressed or not.
 * @param {string} name
 * @returns {boolean}
 */
export function isTabularName(name) {
  return /\.(csv|tsv)(\.gz)?$/i.test(name);
}

/**
 * Guess whether the start of a peak file is BED-like or CSV/TSV with a header, from its
 * first data line. BED-like means columns 2 and 3 are integers; anything with a comma,
 * or a header row, is CSV. Blank, `#`, `track` and `browser` lines are skipped, as the
 * peak parser skips them. Returns null when there is no data line to judge.
 *
 * This only decides whether to show the 0-/1-based toggle (ADR-0007); the peak parser
 * makes its own decision when it reads the file.
 * @param {string} text the first few kilobytes of the file, decompressed
 * @returns {"bed" | "csv" | null}
 */
export function sniffPeakFormat(text) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^(track|browser)\b/.test(line)) continue;
    if (line.includes(",")) return "csv";
    const fields = line.split(/\s+/);
    const isInt = (s) => /^\d+$/.test(s ?? "");
    return isInt(fields[1]) && isInt(fields[2]) ? "bed" : "csv";
  }
  return null;
}

/**
 * Parse a base-pair setting typed into a form field: a whole number ≥ 0, or null.
 * @param {string} value
 * @returns {number | null}
 */
export function parseBasePairs(value) {
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Human-readable file size, e.g. `23.4 MB`.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  const units = ["B", "kB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return i === 0 ? `${n} B` : `${n.toFixed(1)} ${units[i]}`;
}
