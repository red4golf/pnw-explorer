/**
 * Verification status for location entries.
 *
 * The grade is a TRANSPARENT function of the objective factcheck fields in
 * frontmatter — not a black box, and not a claim that every fact is true. It
 * measures how well sourced and how recently reviewed an entry is.
 *
 * The single most valuable mechanism here is staleness: an entry records the
 * content hash it was verified against, and any later edit changes that hash
 * and drops the badge automatically. Without it a "verified" badge outlives the
 * text it verified, which is worse than no badge at all.
 */

export type FactcheckStatus = 'unverified' | 'in-review' | 'verified' | 'corrected' | 'flagged';

export type SourceTier = 'primary' | 'peer-reviewed' | 'secondary' | 'tribal' | 'none';

export interface Factcheck {
  status: FactcheckStatus;
  lastChecked: string | null;
  reviewer: string | null;
  sourceTier: SourceTier;
  claimsTotal: number;
  claimsCited: number;
  openFlags: number;
  neutrality: 'pass' | 'fail' | 'n/a';
  checkedHash: string | null;
  notes: string | null;
}

export const FACTCHECK_DEFAULT: Factcheck = {
  status: 'unverified',
  lastChecked: null,
  reviewer: null,
  sourceTier: 'none',
  claimsTotal: 0,
  claimsCited: 0,
  openFlags: 0,
  neutrality: 'n/a',
  checkedHash: null,
  notes: null,
};

/**
 * Deterministic, dependency-free content hash (djb2-xor, base36).
 *
 * Must stay stable across Node versions and platforms: the hash is written into
 * content frontmatter, so a change to this function would invalidate every
 * verification record in the corpus at once.
 */
export function contentHash(...parts: Array<string | null | undefined>): string {
  const s = parts.filter(Boolean).join('');
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Hash the parts of an entry that carry factual content. */
export function entryContentHash(entry: {
  data: { title: string; description: string };
  body?: string;
}): string {
  const body = (entry.body ?? '').replace(/\r\n/g, '\n').trim();
  return contentHash(entry.data.title, entry.data.description, body);
}

export type Grade = 'A' | 'B' | 'C' | 'D' | '—';
export type DisplayStatus = FactcheckStatus | 'stale';

export interface Quality {
  status: DisplayStatus;
  label: string;
  grade: Grade;
  color: string;
  /** Whether the public "researched and sourced" badge shows on the page. */
  verifiedPublic: boolean;
  /** Sort weight for the admin worklist: higher surfaces first. */
  attentionRank: number;
  reasons: string[];
}

const COLORS: Record<DisplayStatus, string> = {
  verified: '#1a7f5a',
  corrected: '#1a7f5a',
  'in-review': '#3a6ea5',
  stale: '#7a4fb5',
  flagged: '#b0392f',
  unverified: '#6b7684',
};

const LABELS: Record<DisplayStatus, string> = {
  verified: 'Verified',
  corrected: 'Corrected',
  'in-review': 'In review',
  stale: 'Re-review (stale)',
  flagged: 'Flagged',
  unverified: 'Unverified',
};

const ATTENTION: Record<DisplayStatus, number> = {
  flagged: 5,
  stale: 4,
  unverified: 3,
  'in-review': 2,
  corrected: 1,
  verified: 0,
};

/** Tier ranking. Tribal institutions rank with primary sources for their own history. */
const tierRank = (t: SourceTier): number => {
  if (t === 'primary' || t === 'peer-reviewed' || t === 'tribal') return 3;
  if (t === 'secondary') return 2;
  return 0;
};

export function deriveQuality(
  input: Partial<Factcheck> | undefined,
  currentHash: string
): Quality {
  const f: Factcheck = { ...FACTCHECK_DEFAULT, ...(input ?? {}) };
  const reasons: string[] = [];

  const wasChecked = f.status === 'verified' || f.status === 'corrected';
  const stale = wasChecked && f.checkedHash != null && f.checkedHash !== currentHash;

  let status: DisplayStatus = f.status;
  if (stale) {
    status = 'stale';
    reasons.push('Content edited since it was last verified.');
  }

  let grade: Grade = '—';
  if (status === 'verified' || status === 'corrected') {
    const coverage = f.claimsTotal > 0 ? f.claimsCited / f.claimsTotal : 0;
    const rank = tierRank(f.sourceTier);

    if (f.neutrality === 'fail') {
      grade = 'D';
      reasons.push('Neutrality check failed.');
    } else if (rank === 3 && coverage >= 0.95 && f.openFlags === 0) {
      grade = 'A';
    } else if (rank >= 2 && coverage >= 0.8 && f.openFlags === 0) {
      grade = 'B';
    } else if (coverage >= 0.6 && f.openFlags <= 1) {
      grade = 'C';
    } else {
      grade = 'D';
    }

    if (f.openFlags > 0) reasons.push(`${f.openFlags} open flag(s).`);
    if (coverage < 1) {
      reasons.push(
        `${f.claimsCited}/${f.claimsTotal} claims cited (${Math.round(coverage * 100)}%).`
      );
    }
  }

  const verifiedPublic =
    (status === 'verified' || status === 'corrected') &&
    f.neutrality === 'pass' &&
    f.openFlags === 0 &&
    (grade === 'A' || grade === 'B');

  return {
    status,
    label: LABELS[status],
    grade,
    color: COLORS[status],
    verifiedPublic,
    attentionRank: ATTENTION[status],
    reasons,
  };
}

/**
 * Reader-facing sentence about the state of the research.
 *
 * Kept here rather than in the template so the public page and the admin views
 * cannot describe the same entry differently.
 */
export function statusSentence(q: Quality, lastChecked: string | null): string {
  switch (q.status) {
    case 'verified':
    case 'corrected':
      return `Researched and compared against the sources listed below${
        lastChecked ? `; last reviewed ${lastChecked}` : ''
      }.`;
    case 'stale':
      return 'This guide has been edited since its last source review. The supporting material is being checked again.';
    case 'flagged':
      return 'Some details here are disputed or need stronger documentation. Treat them with caution until the sourcing is settled.';
    case 'in-review':
      return 'A source review is underway. Details may change as better material is found.';
    default:
      return 'Research is still in progress. This is a useful introduction, but some details may change as better sources are added.';
  }
}
