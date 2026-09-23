// GFF3/GTF lines → flat feature records, streaming (SPEC §9, ADR-0012, ADR-0013).
// This is the one place where annotation coordinates change base: a 1-based closed
// `start..end` becomes 0-based half-open `[start − 1, end)`.

/**
 * Feature types yielded even without an id, keyed by lower case. Anything else needs an
 * id to be kept. Matching ignores case and yields the canonical spelling, so Ensembl's
 * `five_prime_utr` reaches downstream code as `five_prime_UTR`.
 */
const NEEDED_TYPES = new Map(
  ["exon", "CDS", "UTR", "five_prime_UTR", "three_prime_UTR"].map((t) => [t.toLowerCase(), t]),
);

/** Attribute keys copied into `attrs`. */
const KEPT_ATTRS = new Set(["gene_type", "transcript_type", "tag"]);

/** Assembly names looked for in header comments (ADR-0013). */
const ASSEMBLY = /\b(GRC[hm]\d+|mm\d+|hg\d+)\b/;

/** One GTF attribute: `key "value";` or `key value;`. */
const GTF_ATTR = /([^\s;]+)\s+(?:"([^"]*)"|([^\s;]*))/g;

/**
 * @typedef {{kind: "feature", chrom: string, start: number, end: number, strand: string,
 *   type: string, id: string | null, parents: string[],
 *   attrs: {gene_type?: string, transcript_type?: string, tag?: string[]}}} FeatureRecord
 * @typedef {{kind: "sequenceRegion", chrom: string, length: number}} SequenceRegionRecord
 * @typedef {{kind: "assembly", name: string}} AssemblyRecord
 */

/**
 * Parse GFF3 or GTF lines into feature, sequenceRegion and assembly records.
 *
 * GTF is normalised onto the GFF3 id/parents model: a gene line gets id = gene_id; a
 * transcript line gets id = transcript_id and parents = [gene_id]; exon, CDS and UTR
 * lines get id = null and parents = [transcript_id]. Only exon, CDS, UTR,
 * five_prime_UTR and three_prime_UTR features (matched in any case and yielded with
 * that spelling), and features with an id, are yielded.
 *
 * Format "auto" uses a `##gff-version 3` header if there is one, and otherwise the
 * attribute syntax of the first feature line that has attributes.
 *
 * @param {AsyncIterable<string> | Iterable<string>} lines
 * @param {{format?: "gff3" | "gtf" | "auto"}} [options]
 * @returns {AsyncIterable<FeatureRecord | SequenceRegionRecord | AssemblyRecord>}
 * @throws {Error} on a feature line that isn't nine columns with valid coordinates.
 */
export async function* parseAnnotationLines(lines, { format = "auto" } = {}) {
  if (!["gff3", "gtf", "auto"].includes(format)) throw new Error(`Unknown annotation format: ${format}`);
  let lineNumber = 0;
  let inHeader = true;
  let assemblyFound = false;

  for await (const line of lines) {
    lineNumber++;
    if (line.charCodeAt(0) === 35 /* # */) {
      if (line.startsWith("##")) {
        if (line.startsWith("##FASTA")) return;
        if (format === "auto" && /^##gff-version\s+3\b/.test(line)) format = "gff3";
        if (line.startsWith("##sequence-region")) {
          const region = sequenceRegion(line, lineNumber);
          if (region) yield region;
          continue;
        }
      }
      if (inHeader && !assemblyFound) {
        const match = ASSEMBLY.exec(line);
        if (match) {
          assemblyFound = true;
          yield { kind: "assembly", name: match[1] };
        }
      }
      continue;
    }

    const cols = line.split("\t");
    if (cols.length < 9) {
      if (line.trim() === "") continue;
      throw new Error(`Line ${lineNumber}: expected 9 tab-separated columns, found ${cols.length}`);
    }
    inHeader = false;
    const neededType = NEEDED_TYPES.get(cols[2].toLowerCase());
    const type = neededType ?? cols[2];
    const attributes = cols[8];
    if (format === "auto" && attributes !== "" && attributes !== ".") {
      format = /^\s*[^\s=;]+=/.test(attributes) ? "gff3" : "gtf";
    }
    // GTF ids come only from gene and transcript lines, so other types can be dropped
    // before their attributes are read.
    if (format === "gtf" && !neededType && type !== "gene" && type !== "transcript") continue;

    const parsed = format === "gtf" ? gtfFeature(type, attributes) : gff3Feature(attributes);
    if (parsed.id === null && !neededType) continue;

    const start = Number(cols[3]);
    const end = Number(cols[4]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new Error(`Line ${lineNumber}: bad coordinates ${cols[3]}..${cols[4]}`);
    }
    yield {
      kind: "feature",
      chrom: cols[0],
      start: start - 1,
      end,
      strand: cols[6],
      type,
      id: parsed.id,
      parents: parsed.parents,
      attrs: parsed.attrs,
    };
  }
}

/** `##sequence-region chrF 1 30000` → {kind, chrom, length}, length being the end. */
function sequenceRegion(line, lineNumber) {
  const [, chrom, , end] = line.trim().split(/\s+/);
  if (chrom === undefined) return null;
  const length = Number(end);
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`Line ${lineNumber}: bad ##sequence-region: ${line}`);
  }
  return { kind: "sequenceRegion", chrom, length };
}

/** GFF3 column 9: `key=value;…`, URL-decoded; Parent and tag may hold several values. */
function gff3Feature(attributes) {
  let id = null;
  let parents = [];
  const attrs = {};
  if (attributes === ".") return { id, parents, attrs };
  for (const pair of attributes.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    if (key === "ID") id = decode(value);
    else if (key === "Parent") parents = value.split(",").map(decode);
    else if (key === "tag") attrs.tag = value.split(",").map(decode);
    else if (KEPT_ATTRS.has(key)) attrs[key] = decode(value);
  }
  return { id, parents, attrs };
}

/** GTF column 9: `key "value"; …`, normalised onto id/parents by feature type. */
function gtfFeature(type, attributes) {
  let geneId;
  let transcriptId;
  const attrs = {};
  for (const [, key, quoted, bare] of attributes.matchAll(GTF_ATTR)) {
    const value = quoted ?? bare;
    if (key === "gene_id") geneId = value;
    else if (key === "transcript_id") transcriptId = value;
    else if (key === "tag") (attrs.tag ??= []).push(value);
    else if (KEPT_ATTRS.has(key)) attrs[key] = value;
  }
  if (type === "gene") return { id: geneId ?? null, parents: [], attrs };
  if (type === "transcript") {
    return { id: transcriptId ?? null, parents: geneId === undefined ? [] : [geneId], attrs };
  }
  return { id: null, parents: transcriptId === undefined ? [] : [transcriptId], attrs };
}

/** Percent-decode a GFF3 value; a malformed escape is kept as written. */
function decode(value) {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
