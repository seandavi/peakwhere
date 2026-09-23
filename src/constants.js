// Shared vocabulary. Every module uses these keys; nothing hard-codes its own.

/** Category keys in default priority order (ADR-0004), highest first. */
export const CATEGORIES = ["promoter", "utr5", "utr3", "exon", "intron", "intergenic"];

/** Display labels for the chart, table and downloads. */
export const CATEGORY_LABELS = {
  promoter: "Promoter",
  utr5: "5′ UTR",
  utr3: "3′ UTR",
  exon: "Exon",
  intron: "Intron",
  intergenic: "Intergenic",
};

/** Default settings (ADR-0002, 0003, 0005). */
export const DEFAULT_SETTINGS = Object.freeze({
  promoterUpstream: 1000,
  promoterDownstream: 1000,
  mode: "centre", // "centre" | "bp"   (ADR-0003)
  proteinCodingOnly: false, // ADR-0005
  priority: CATEGORIES,
});

/** A file with more than this fraction of unmatched peaks is not drawn (ADR-0006). */
export const MAX_UNMATCHED_FRACTION = 0.05;
