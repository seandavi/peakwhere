// Annotation layers → a priority-resolved partition → per-category counts (SPEC §9;
// ADR-0002, 0003, 0004, 0006, 0010, 0013, 0016). Coordinates are 0-based half-open
// throughout: nothing here converts.
//
// A partition holds, per chromosome, sorted disjoint segments that each carry the one
// category that wins there. Gaps are intergenic and are not stored. Classifying a peak
// centre is one binary search; classifying base pairs is a binary search and a walk.

import { CATEGORIES, DEFAULT_SETTINGS } from "./constants.js";

const INTERGENIC = CATEGORIES.indexOf("intergenic");

/** Categories built from annotation layers; intergenic is whatever none of them covers. */
const LAYERED = ["promoter", "utr5", "utr3", "exon", "intron"];

/**
 * @typedef {{starts: Int32Array, ends: Int32Array, categories: Uint8Array,
 *   length: number | null}} ChromPartition
 *   `categories[i]` is an index into CATEGORIES. `length` is the chromosome's length
 *   from the annotation (`chromLengths`), or null when it isn't known.
 * @typedef {Map<string, ChromPartition>} Partition keyed by the annotation's spelling
 */

/**
 * Chromosome key used for matching (ADR-0006): a leading `chr` is removed, in any case,
 * and `M` and `MT` (any case) both become `M`. The rest of the name is kept as written.
 * @param {string} name
 * @returns {string}
 */
export function normaliseChrom(name) {
  const bare = /^chr/i.test(name) ? name.slice(3) : name;
  const upper = bare.toUpperCase();
  return upper === "M" || upper === "MT" ? "M" : bare;
}

/**
 * Resolve the annotation's layers into one category per base (ADR-0016).
 *
 * Promoters are windows around each TSS base (ADR-0002): `[t − up, t + down + 1)` on
 * `+`, `[t − down, t + up + 1)` on `−`, clipped at 0. Transcript spans are the intron
 * layer: any transcript base no higher category claims is intron. `priority` lists
 * categories highest first; intergenic is always the gaps, wherever it is listed.
 *
 * Chromosomes with a length in `annotation.chromLengths` but no transcripts get an
 * empty entry, so their peaks are intergenic rather than unmatched.
 *
 * @param {{byChrom: Map<string, {tss: [number, string][], utr5: [number, number][],
 *   utr3: [number, number][], exon: [number, number][], transcript: [number, number][]}>,
 *   chromLengths?: Map<string, number>}} annotation from buildAnnotation
 * @param {{promoterUpstream?: number, promoterDownstream?: number, priority?: string[]}} [settings]
 * @returns {Partition}
 */
export function buildPartition(
  annotation,
  {
    promoterUpstream = DEFAULT_SETTINGS.promoterUpstream,
    promoterDownstream = DEFAULT_SETTINGS.promoterDownstream,
    priority = DEFAULT_SETTINGS.priority,
  } = {},
) {
  for (const [name, value] of [
    ["promoterUpstream", promoterUpstream],
    ["promoterDownstream", promoterDownstream],
  ]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a whole number ≥ 0, not ${value}`);
    }
  }
  const missing = LAYERED.filter((c) => !priority.includes(c));
  if (missing.length > 0) throw new Error(`priority is missing ${missing.join(", ")}`);
  // Rank 0 wins. Only the layered categories are ranked.
  const ranked = priority.filter((c) => LAYERED.includes(c));
  const rankOf = (category) => ranked.indexOf(category);
  const categoryOfRank = Uint8Array.from(ranked, (c) => CATEGORIES.indexOf(c));

  const lengths = annotation.chromLengths ?? new Map();
  /** @type {Partition} */
  const partition = new Map();
  for (const [chrom, layers] of annotation.byChrom) {
    const promoters = layers.tss.map(([t, strand]) =>
      strand === "-"
        ? [Math.max(0, t - promoterDownstream), t + promoterUpstream + 1]
        : [Math.max(0, t - promoterUpstream), t + promoterDownstream + 1],
    );
    const segments = sweep(
      [
        [rankOf("promoter"), promoters],
        [rankOf("utr5"), layers.utr5],
        [rankOf("utr3"), layers.utr3],
        [rankOf("exon"), layers.exon],
        [rankOf("intron"), layers.transcript],
      ],
      categoryOfRank,
    );
    partition.set(chrom, { ...segments, length: lengths.get(chrom) ?? null });
  }
  for (const [chrom, length] of lengths) {
    if (partition.has(chrom)) continue;
    const empty = { starts: new Int32Array(0), ends: new Int32Array(0), categories: new Uint8Array(0) };
    partition.set(chrom, { ...empty, length });
  }
  return partition;
}

/**
 * Overlapping intervals of up to eight ranks → disjoint segments, each with the category
 * of the lowest rank covering it. Adjacent segments of one category are merged.
 *
 * Every interval becomes two events packed in one number, `pos * 16 + isStart * 8 +
 * rank`, so a typed-array sort orders them by position.
 */
function sweep(rankedLayers, categoryOfRank) {
  let n = 0;
  for (const [, intervals] of rankedLayers) n += 2 * intervals.length;
  const events = new Float64Array(n);
  let k = 0;
  for (const [rank, intervals] of rankedLayers) {
    for (const [s, e] of intervals) {
      if (e <= s) continue;
      events[k++] = s * 16 + 8 + rank;
      events[k++] = e * 16 + rank;
    }
  }
  const sorted = events.subarray(0, k).sort();

  const depth = new Int32Array(8);
  const starts = [];
  const ends = [];
  const categories = [];
  let prev = -1;
  for (const event of sorted) {
    const pos = Math.floor(event / 16);
    if (pos !== prev && prev !== -1) {
      let rank = 0;
      while (rank < depth.length && depth[rank] === 0) rank++;
      if (rank < depth.length) {
        const category = categoryOfRank[rank];
        const last = starts.length - 1;
        if (last >= 0 && ends[last] === prev && categories[last] === category) ends[last] = pos;
        else {
          starts.push(prev);
          ends.push(pos);
          categories.push(category);
        }
      }
    }
    const low = event - pos * 16;
    depth[low & 7] += low & 8 ? 1 : -1;
    prev = pos;
  }
  return {
    starts: Int32Array.from(starts),
    ends: Int32Array.from(ends),
    categories: Uint8Array.from(categories),
  };
}

/** Index of the last segment starting at or before `x`, or −1. */
function lastStartAtOrBefore(starts, x) {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (starts[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Index of the first segment ending after `x` (segments are disjoint, so ends are sorted). */
function firstEndAfter(ends, x) {
  let lo = 0;
  let hi = ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (ends[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Partition entries keyed by `key(chrom)`; when two names share a key, the first wins. */
function byChromKey(partition, key) {
  const index = new Map();
  for (const [chrom, entry] of partition) {
    const k = key(chrom);
    if (!index.has(k)) index.set(k, entry);
  }
  return index;
}

/**
 * Count peaks, or peak base pairs, per category (ADR-0003, ADR-0006, ADR-0013).
 *
 * "centre" gives each peak `[s, e)` the category at `s + floor((e − s) / 2)`. "bp" gives
 * each base of each peak its category. `counts`, `matched` and `unmatched` are in the
 * mode's unit (peaks, or base pairs); `peaks` always counts peaks. A peak whose
 * chromosome isn't in the partition, after normalisation, is unmatched: it is left out
 * of `counts` and `matched`, and its chromosome is listed in `unmatchedChroms` as the
 * peak file writes it, once, in order of first appearance.
 *
 * `outOfRange` counts matched peaks (always peaks) whose end is past their chromosome's
 * known length: the sign of a genome build mismatch. They are still classified.
 *
 * `perPeak` holds each peak's category, or "unmatched", in input order. In "bp" mode it
 * is the category with the most bases in the peak, ties going to the higher priority.
 *
 * @param {Partition} partition from buildPartition
 * @param {{chrom: string, start: number, end: number}[]} peaks from parsePeaks
 * @param {{mode?: "centre" | "bp", priority?: string[], normalise?: boolean}} [options]
 *   `priority` breaks per-peak ties in "bp" mode; pass the one given to buildPartition.
 *   `normalise: false` matches chromosome names exactly (SPEC §7.4).
 */
export function classifyPeaks(
  partition,
  peaks,
  { mode = DEFAULT_SETTINGS.mode, priority = DEFAULT_SETTINGS.priority, normalise = true } = {},
) {
  if (mode !== "centre" && mode !== "bp") throw new Error(`Unknown counting mode: ${mode}`);
  const key = normalise ? normaliseChrom : (name) => name;
  const index = byChromKey(partition, key);
  const tally = new Float64Array(CATEGORIES.length);
  const perPeak = new Array(peaks.length);
  const unmatchedChroms = new Set();
  let unmatched = 0;
  let matchedPeaks = 0;
  let outOfRange = 0;
  // Category indices from highest to lowest priority, for bp-mode ties.
  const tieOrder = [...priority, ...CATEGORIES]
    .map((c) => CATEGORIES.indexOf(c))
    .filter((c, i, all) => c !== -1 && all.indexOf(c) === i);
  const inPeak = new Float64Array(CATEGORIES.length);

  for (let p = 0; p < peaks.length; p++) {
    const { chrom, start, end } = peaks[p];
    const entry = index.get(key(chrom));
    if (entry === undefined) {
      unmatchedChroms.add(chrom);
      unmatched += mode === "bp" ? end - start : 1;
      perPeak[p] = "unmatched";
      continue;
    }
    matchedPeaks++;
    if (entry.length !== null && end > entry.length) outOfRange++;
    const { starts, ends, categories } = entry;

    if (mode === "centre") {
      const centre = start + Math.floor((end - start) / 2);
      const i = lastStartAtOrBefore(starts, centre);
      const category = i >= 0 && centre < ends[i] ? categories[i] : INTERGENIC;
      tally[category]++;
      perPeak[p] = CATEGORIES[category];
      continue;
    }

    inPeak.fill(0);
    let covered = 0;
    for (let i = firstEndAfter(ends, start); i < starts.length && starts[i] < end; i++) {
      const bp = Math.min(end, ends[i]) - Math.max(start, starts[i]);
      inPeak[categories[i]] += bp;
      covered += bp;
    }
    inPeak[INTERGENIC] += end - start - covered;
    let best = tieOrder[0];
    for (const c of tieOrder) {
      tally[c] += inPeak[c];
      if (inPeak[c] > inPeak[best]) best = c;
    }
    perPeak[p] = CATEGORIES[best];
  }

  const counts = Object.fromEntries(CATEGORIES.map((c, i) => [c, tally[i]]));
  return {
    counts,
    matched: tally.reduce((a, b) => a + b, 0),
    unmatched,
    unmatchedChroms: [...unmatchedChroms],
    peaks: { matched: matchedPeaks, unmatched: peaks.length - matchedPeaks },
    outOfRange,
    perPeak,
  };
}

/**
 * Base pairs per category over the chromosomes that are both in the partition and in
 * `chromLengths` (ADR-0010), matched by normalised name. Segments are clipped to the
 * chromosome's length (a promoter window may run past it; ADR-0002), and the rest of
 * each chromosome is intergenic. `total` is the sum of the lengths used.
 *
 * @param {Partition} partition
 * @param {Map<string, number>} chromLengths from the GFF3 or a chrom.sizes file
 * @returns {{counts: Record<string, number>, total: number}}
 */
export function genomeBackground(partition, chromLengths) {
  const index = byChromKey(partition, normaliseChrom);
  const tally = new Float64Array(CATEGORIES.length);
  const seen = new Set();
  let total = 0;
  for (const [chrom, length] of chromLengths) {
    const key = normaliseChrom(chrom);
    const entry = index.get(key);
    if (entry === undefined || seen.has(key)) continue;
    seen.add(key);
    total += length;
    let covered = 0;
    const { starts, ends, categories } = entry;
    for (let i = 0; i < starts.length && starts[i] < length; i++) {
      const bp = Math.min(ends[i], length) - starts[i];
      tally[categories[i]] += bp;
      covered += bp;
    }
    tally[INTERGENIC] += length - covered;
  }
  return { counts: Object.fromEntries(CATEGORIES.map((c, i) => [c, tally[i]])), total };
}
