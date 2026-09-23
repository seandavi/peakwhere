// Peak files → validated peaks, 0-based half-open (SPEC §2, §5, §9; ADR-0006, ADR-0007).
//
// Every row either becomes a peak or lands in `rejected` with its line number and a
// reason. Nothing is silently dropped and no coordinate is ever NaN (SPEC §8).
// Chromosome names are passed through as written: normalisation belongs to the engine.

/** Header names that identify each CSV/TSV column, lower-case (ADR-0007). */
const CHROM_COLUMNS = ["chr", "chrom", "chromosome", "seqnames"];
const START_COLUMNS = ["start", "chromstart"];
const END_COLUMNS = ["end", "chromend"];
const NAME_COLUMNS = ["name", "peak_id", "id"];

const DELIMITERS = ["\t", ",", ";"];
const INTEGER = /^-?\d+$/;

/**
 * @typedef {{chrom: string, start: number, end: number, name: string | null}} Peak
 * @typedef {{lineNumber: number, line: string, reason: string}} Rejection
 */

/**
 * Parse a peak file.
 *
 * BED, narrowPeak and broadPeak are tab-separated; the first three columns are used and
 * column 4, if present, is the name. CSV/TSV needs a header; columns are found by name
 * and the delimiter is sniffed from the header line. `oneBased` applies to CSV/TSV only
 * (BED is 0-based by definition) and converts 1-based closed coordinates to 0-based
 * half-open by subtracting 1 from start.
 *
 * @param {string} text
 * @param {{format?: "bed" | "csv" | "auto", oneBased?: boolean}} [options]
 * @returns {{peaks: Peak[], rejected: Rejection[], format: "bed" | "csv"}}
 *   `format` is the one actually used, so "auto" resolves to "bed" or "csv".
 *   `lineNumber` is 1-based, counting every physical line in the file.
 */
export function parsePeaks(text, { format = "auto", oneBased = false } = {}) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (format === "auto") format = findHeader(lines) === -1 ? "bed" : "csv";
  if (format === "bed") return parseBed(lines);
  if (format === "csv") return parseCsv(lines, oneBased);
  throw new Error(`Unknown peak format "${format}": expected "bed", "csv" or "auto"`);
}

/** Blank, "#" comment, and UCSC track/browser lines carry no peaks. */
function isSkippable(line) {
  return line.trim() === "" || line.startsWith("#") || /^(track|browser)(\s|$)/.test(line);
}

/** The most frequent delimiter in a header line, or null if it has none. */
function sniffDelimiter(line) {
  let best = null;
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const count = line.split(d).length - 1;
    if (count > bestCount) [best, bestCount] = [d, count];
  }
  return best;
}

/**
 * Split one delimited line into trimmed fields. Double-quoted fields (as written by R's
 * write.csv) may contain the delimiter, and "" inside quotes is a literal quote.
 */
function splitFields(line, delimiter) {
  if (!line.includes('"')) return line.split(delimiter).map((f) => f.trim());
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      fields.push(field.trim());
      field = "";
    } else field += c;
  }
  fields.push(field.trim());
  return fields;
}

/** Index of the first field whose lower-cased name is in `names`, or -1. */
function findColumn(fields, names) {
  const lower = fields.map((f) => f.toLowerCase());
  for (const name of names) {
    const i = lower.indexOf(name);
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Index of the CSV/TSV header line, or -1 if the first content line isn't one. Lines
 * with no peaks before it are skipped. A header is a line with a recognised start
 * column, which no BED data row has.
 */
function findHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (isSkippable(lines[i])) continue;
    const delimiter = sniffDelimiter(lines[i]);
    const fields = delimiter ? splitFields(lines[i], delimiter) : [lines[i].trim()];
    return findColumn(fields, START_COLUMNS) === -1 ? -1 : i;
  }
  return -1;
}

/**
 * Validate one row's chromosome and coordinates as written. `shift` is subtracted from
 * start (1 for 1-based input). Returns a peak, or a rejection reason.
 *
 * @returns {Peak | string}
 */
function toPeak(chrom, startText, endText, name, shift) {
  if (!chrom) return "chromosome is empty";
  if (!startText) return "start is missing";
  if (!endText) return "end is missing";
  if (!INTEGER.test(startText)) return `start is not an integer: "${startText}"`;
  if (!INTEGER.test(endText)) return `end is not an integer: "${endText}"`;
  const start = Number(startText) - shift;
  const end = Number(endText);
  if (start < 0) {
    return shift
      ? `start ${startText} is below 1, the first base in 1-based coordinates`
      : `start is negative: ${startText}`;
  }
  if (end <= start) {
    return shift
      ? `end ${endText} is before start ${startText}`
      : `end ${endText} is not greater than start ${startText}`;
  }
  return { chrom, start, end, name: name || null };
}

function parseBed(lines) {
  const peaks = [];
  const rejected = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isSkippable(line)) continue;
    const reject = (reason) => rejected.push({ lineNumber: i + 1, line, reason });
    const fields = line.split("\t").map((f) => f.trim());
    if (fields.length < 3) {
      let reason = `expected at least 3 tab-separated columns (chrom, start, end), found ${fields.length}`;
      if (line.includes(",")) reason += "; this looks like a CSV: use the CSV format";
      reject(reason);
      continue;
    }
    if (findColumn(fields.slice(1, 2), START_COLUMNS) !== -1) {
      reject(`this looks like a header row ("${fields[1]}"): use the CSV/TSV or auto format`);
      continue;
    }
    const peak = toPeak(fields[0], fields[1], fields[2], fields[3], 0);
    if (typeof peak === "string") reject(peak);
    else peaks.push(peak);
  }
  return { peaks, rejected, format: "bed" };
}

function parseCsv(lines, oneBased) {
  const peaks = [];
  const rejected = [];
  let i = 0;
  while (i < lines.length && isSkippable(lines[i])) i++;
  if (i === lines.length) return { peaks, rejected, format: "csv" };

  const headerLine = lines[i];
  const headerNumber = i + 1;
  const delimiter = sniffDelimiter(headerLine) ?? ",";
  const header = splitFields(headerLine, delimiter);
  const columns = {
    chrom: findColumn(header, CHROM_COLUMNS),
    start: findColumn(header, START_COLUMNS),
    end: findColumn(header, END_COLUMNS),
  };
  const nameColumn = findColumn(header, NAME_COLUMNS);
  const missing = Object.keys(columns).filter((k) => columns[k] === -1);

  // Without the three coordinate columns no row can be read. Say so on the header and
  // on every row, so the rejected count still matches the file.
  let headerProblem = null;
  if (missing.length) {
    const lookedFor = { chrom: CHROM_COLUMNS, start: START_COLUMNS, end: END_COLUMNS };
    headerProblem = `has no ${missing.join(", ")} column (looked for ${missing
      .map((k) => lookedFor[k].join("/"))
      .join("; ")})`;
    rejected.push({ lineNumber: headerNumber, line: headerLine, reason: `header ${headerProblem}` });
  }

  const shift = oneBased ? 1 : 0;
  for (i++; i < lines.length; i++) {
    const line = lines[i];
    if (isSkippable(line)) continue;
    const reject = (reason) => rejected.push({ lineNumber: i + 1, line, reason });
    if (headerProblem) {
      reject(`not read: the header on line ${headerNumber} ${headerProblem}`);
      continue;
    }
    const fields = splitFields(line, delimiter);
    const absent = Object.keys(columns).filter((k) => columns[k] >= fields.length);
    if (absent.length) {
      reject(`missing ${absent.join(", ")} column: row has ${fields.length} fields, header has ${header.length}`);
      continue;
    }
    const peak = toPeak(
      fields[columns.chrom],
      fields[columns.start],
      fields[columns.end],
      nameColumn === -1 ? null : fields[nameColumn],
      shift,
    );
    if (typeof peak === "string") reject(peak);
    else peaks.push(peak);
  }
  return { peaks, rejected, format: "csv" };
}
