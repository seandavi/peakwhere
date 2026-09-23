// Feature stream → per-chromosome annotation layers (SPEC §4 and §9, ADR-0005,
// ADR-0012, ADR-0016). Coordinates arrive 0-based half-open from the parser and stay so.
//
// The stream is consumed incrementally and no feature object is kept. What survives is
// a table of numbers per id (columnar arrays, one row per id) plus one row per exon and
// per UTR. Which ids are transcripts, which UTR is 5′ or 3′, and which transcripts pass
// the filter are all decided at the end of the stream, because a child can arrive
// before its parent's own line.

/** Codes for the protein-coding filter (ADR-0005). */
const NO_TYPE = 0;
const CODING = 1;
const NON_CODING = 2;

/** UTR rows: explicit 5′, explicit 3′, or a generic `UTR` placed later by CDS position. */
const UTR5 = 5;
const UTR3 = 3;
const UTR_GENERIC = 0;

/**
 * @typedef {{tss: [number, string][], utr5: [number, number][], utr3: [number, number][],
 *   exon: [number, number][], transcript: [number, number][]}} ChromLayers
 * @typedef {{
 *   transcriptsInFile: number,
 *   proteinCodingFilter: "off" | "applied" | "unavailable",
 *   untypedTranscripts: number,
 *   utrsWithoutCds: number,
 *   unstrandedTranscripts: number,
 * }} AnnotationStats
 * @typedef {{transcripts: number, chromLengths: Map<string, number>,
 *   assembly: string | null, byChrom: Map<string, ChromLayers>,
 *   stats: AnnotationStats}} Annotation
 */

/**
 * Build per-chromosome layers from the records of `parseAnnotationLines`.
 *
 * A transcript is any id that is the parent of an exon. Its span is its own feature's,
 * or its exons' extent when it has no feature line. Its TSS is its 5′-most base. A
 * generic `UTR` is 5′ when its 5′ end lies upstream of the transcript's CDS in
 * transcript orientation, else 3′; one in a transcript with no CDS is left out of both
 * UTR layers (it stays in the exon layer) and counted in `stats.utrsWithoutCds`.
 *
 * Each layer is sorted, and intervals that overlap or touch are merged. TSSs are sorted
 * by position and de-duplicated. `transcripts` counts the transcripts kept.
 *
 * With `proteinCodingOnly`, a transcript is kept when its type is `protein_coding`: its
 * own feature's `transcript_type`, else that feature's `gene_type`, else the same from
 * the first child that has either. A transcript with no type is dropped. If no
 * transcript has a type, nothing is dropped and `stats.proteinCodingFilter` is
 * "unavailable", so the page can say the filter wasn't applied.
 *
 * @param {AsyncIterable<object> | Iterable<object>} features records from parseAnnotationLines
 * @param {{proteinCodingOnly?: boolean}} [options]
 * @returns {Promise<Annotation>}
 */
export async function buildAnnotation(features, { proteinCodingOnly = false } = {}) {
  const table = new TranscriptTable();
  const chromLengths = new Map();
  let assembly = null;
  for await (const record of features) {
    if (record.kind === "feature") table.add(record);
    else if (record.kind === "sequenceRegion") chromLengths.set(record.chrom, record.length);
    else if (record.kind === "assembly") assembly ??= record.name;
  }
  return { ...table.layers(proteinCodingOnly), chromLengths, assembly };
}

/** Everything kept from the stream, as parallel arrays of numbers. */
class TranscriptTable {
  // Per id (a "slot"). A slot is made for every id seen, as a feature's own id or as a
  // parent; most non-transcript ids (genes, start codons) end up unused.
  slots = new Map();
  chrom = [];
  strand = []; // 1 "+", -1 "-", 0 anything else
  ownStart = []; // -1 until the id's own feature line arrives
  ownEnd = [];
  exonStart = []; // -1 until an exon arrives: then the slot is a transcript
  exonEnd = [];
  cdsStart = []; // -1 when there is no CDS
  cdsEnd = [];
  ownType = [];
  childType = [];

  // Per exon or UTR, one row per parent.
  exonSlot = [];
  exonRowStart = [];
  exonRowEnd = [];
  utrSlot = [];
  utrRowStart = [];
  utrRowEnd = [];
  utrPrime = [];

  chromNames = [];
  chromIndex = new Map();

  /** @param {{chrom: string, start: number, end: number, strand: string, type: string,
   *   id: string | null, parents: string[], attrs: object}} f */
  add(f) {
    switch (f.type) {
      case "exon":
        for (const parent of f.parents) {
          const s = this.child(parent, f);
          if (this.exonStart[s] === -1 || f.start < this.exonStart[s]) this.exonStart[s] = f.start;
          if (f.end > this.exonEnd[s]) this.exonEnd[s] = f.end;
          this.exonSlot.push(s);
          this.exonRowStart.push(f.start);
          this.exonRowEnd.push(f.end);
        }
        return;
      case "CDS":
        for (const parent of f.parents) {
          const s = this.child(parent, f);
          if (this.cdsStart[s] === -1 || f.start < this.cdsStart[s]) this.cdsStart[s] = f.start;
          if (f.end > this.cdsEnd[s]) this.cdsEnd[s] = f.end;
        }
        return;
      case "five_prime_UTR":
      case "three_prime_UTR":
      case "UTR": {
        const prime = f.type === "UTR" ? UTR_GENERIC : f.type === "five_prime_UTR" ? UTR5 : UTR3;
        for (const parent of f.parents) {
          this.utrSlot.push(this.child(parent, f));
          this.utrRowStart.push(f.start);
          this.utrRowEnd.push(f.end);
          this.utrPrime.push(prime);
        }
        return;
      }
      default: {
        // Any other feature with an id: a transcript's own line, or a gene, start codon…
        // It is recorded now and used only if the id turns out to parent an exon.
        const s = this.slot(f.id, f);
        this.chrom[s] = this.chromOf(f.chrom);
        this.strand[s] = strandCode(f.strand);
        if (this.ownStart[s] === -1 || f.start < this.ownStart[s]) this.ownStart[s] = f.start;
        if (f.end > this.ownEnd[s]) this.ownEnd[s] = f.end;
        if (this.ownType[s] === NO_TYPE) this.ownType[s] = typeCode(f.attrs);
      }
    }
  }

  /** Slot of the parent of an exon, CDS or UTR, which also supplies a fallback type. */
  child(parent, f) {
    const s = this.slot(parent, f);
    if (this.childType[s] === NO_TYPE) this.childType[s] = typeCode(f.attrs);
    return s;
  }

  /** Slot for `id`, made on first sight with chromosome and strand from `f`. */
  slot(id, f) {
    let s = this.slots.get(id);
    if (s !== undefined) return s;
    s = this.chrom.length;
    this.slots.set(id, s);
    this.chrom.push(this.chromOf(f.chrom));
    this.strand.push(strandCode(f.strand));
    this.ownStart.push(-1);
    this.ownEnd.push(-1);
    this.exonStart.push(-1);
    this.exonEnd.push(-1);
    this.cdsStart.push(-1);
    this.cdsEnd.push(-1);
    this.ownType.push(NO_TYPE);
    this.childType.push(NO_TYPE);
    return s;
  }

  chromOf(name) {
    let c = this.chromIndex.get(name);
    if (c === undefined) {
      c = this.chromNames.length;
      this.chromNames.push(name);
      this.chromIndex.set(name, c);
    }
    return c;
  }

  /** Resolve transcripts, filter, UTR sides and TSSs; return sorted, merged layers. */
  layers(proteinCodingOnly) {
    const n = this.chrom.length;
    const type = (s) => this.ownType[s] || this.childType[s];
    let transcriptsInFile = 0;
    let untypedTranscripts = 0;
    for (let s = 0; s < n; s++) {
      if (this.exonStart[s] === -1) continue;
      transcriptsInFile++;
      if (type(s) === NO_TYPE) untypedTranscripts++;
    }
    const filtering = proteinCodingOnly && untypedTranscripts < transcriptsInFile;
    const kept = new Uint8Array(n);
    for (let s = 0; s < n; s++) {
      kept[s] = this.exonStart[s] !== -1 && (!filtering || type(s) === CODING) ? 1 : 0;
    }

    const perChrom = this.chromNames.map(() => ({ tss: [], utr5: [], utr3: [], exon: [], transcript: [] }));
    let transcripts = 0;
    let unstrandedTranscripts = 0;
    for (let s = 0; s < n; s++) {
      if (!kept[s]) continue;
      transcripts++;
      const layers = perChrom[this.chrom[s]];
      const start = this.ownStart[s] !== -1 ? this.ownStart[s] : this.exonStart[s];
      const end = this.ownStart[s] !== -1 ? this.ownEnd[s] : this.exonEnd[s];
      layers.transcript.push([start, end]);
      if (this.strand[s] === 1) layers.tss.push([start, "+"]);
      else if (this.strand[s] === -1) layers.tss.push([end - 1, "-"]);
      else unstrandedTranscripts++;
    }
    for (let i = 0; i < this.exonSlot.length; i++) {
      const s = this.exonSlot[i];
      if (kept[s]) perChrom[this.chrom[s]].exon.push([this.exonRowStart[i], this.exonRowEnd[i]]);
    }
    let utrsWithoutCds = 0;
    for (let i = 0; i < this.utrSlot.length; i++) {
      const s = this.utrSlot[i];
      if (!kept[s]) continue;
      let prime = this.utrPrime[i];
      if (prime === UTR_GENERIC) {
        if (this.cdsStart[s] === -1) {
          utrsWithoutCds++;
          continue;
        }
        const upstream =
          this.strand[s] === -1 ? this.utrRowEnd[i] > this.cdsEnd[s] : this.utrRowStart[i] < this.cdsStart[s];
        prime = upstream ? UTR5 : UTR3;
      }
      const layer = prime === UTR5 ? perChrom[this.chrom[s]].utr5 : perChrom[this.chrom[s]].utr3;
      layer.push([this.utrRowStart[i], this.utrRowEnd[i]]);
    }

    const byChrom = new Map();
    this.chromNames.forEach((name, c) => {
      const l = perChrom[c];
      if (l.transcript.length === 0) return;
      byChrom.set(name, {
        tss: sortedUniqueTss(l.tss),
        utr5: sortedMerged(l.utr5),
        utr3: sortedMerged(l.utr3),
        exon: sortedMerged(l.exon),
        transcript: sortedMerged(l.transcript),
      });
    });
    const proteinCodingFilter = !proteinCodingOnly ? "off" : filtering ? "applied" : "unavailable";
    return {
      transcripts,
      byChrom,
      stats: {
        transcriptsInFile,
        proteinCodingFilter,
        untypedTranscripts,
        utrsWithoutCds,
        unstrandedTranscripts,
      },
    };
  }
}

/** `transcript_type`, falling back to `gene_type`, as a filter code (ADR-0005). */
function typeCode(attrs) {
  const value = attrs.transcript_type ?? attrs.gene_type;
  if (value === undefined) return NO_TYPE;
  return value === "protein_coding" ? CODING : NON_CODING;
}

function strandCode(strand) {
  return strand === "+" ? 1 : strand === "-" ? -1 : 0;
}

/** Sort by start and merge intervals that overlap or touch. Reuses the input pairs. */
function sortedMerged(intervals) {
  intervals.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const pair of intervals) {
    const last = out[out.length - 1];
    if (last !== undefined && pair[0] <= last[1]) {
      if (pair[1] > last[1]) last[1] = pair[1];
    } else {
      out.push(pair);
    }
  }
  return out;
}

/** Sort TSSs by position, then strand, and drop repeats. */
function sortedUniqueTss(tss) {
  tss.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return tss.filter((t, i) => i === 0 || t[0] !== tss[i - 1][0] || t[1] !== tss[i - 1][1]);
}
