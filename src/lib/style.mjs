/**
 * STYLE-STANDARD, executable.
 *
 * The writing standard for this corpus was derived by measuring two hand-written
 * exemplars against the two weakest machine-assembled entries. Every rule in it
 * is numeric, which means every rule in it can be enforced before merge instead
 * of being rediscovered in a quarterly review. This module is that enforcement.
 *
 * Plain .mjs on purpose: the CI gate (node), the build, and the /admin dashboard
 * all import THIS file. One implementation, three consumers, no drift between
 * "what the doc says", "what CI checks", and "what the dashboard reports".
 *
 * Nothing here judges whether a claim is TRUE — that is the factcheck record's
 * job (src/lib/quality.ts). This measures how the prose is built.
 */

/** Thresholds, quoted from STYLE-STANDARD "Numbers to hit". */
export const T = {
  words: { min: 650, max: 900 },
  flesch: { floor: 50, target: [55, 70] },
  shortSentenceRatio: 0.3, // >=30% of sentences <=12 words
  shortSentenceWords: 12,
  maxSentenceWords: 45, // hard ceiling, any single sentence
  longSentenceWords: 35, // at most 1 per 1000 words
  longSentencesPer1000: 1,
  sentenceStdDevMin: 9, // the rhythm test; "non-negotiable"
  meanSentence: [15, 20],
  medianSentenceMax: 17,
  paragraphSentences: [1, 6],
  sections: [4, 6],
  abstractNounsPer100: 4,
  numeralsPer1000: 15,
  sharedShingle: 12, // no 12-word run shared with another entry
};

/** Rule 4: unsourced editorial verdicts wearing a description's clothes. */
export const BANNED_ADJECTIVES = [
  'beloved',
  'charming',
  'remarkable',
  'crucial',
  'iconic',
  'profound',
  'essential',
  'comprehensive',
  'spectacular',
  'extraordinary',
  'enduring',
  'distinctive',
  'sophisticated',
];

/** Verbs that assert significance instead of showing evidence. */
export const BANNED_VERB_PATTERNS = [
  /\bstands?\s+as\b/gi,
  /\bstood\s+as\b/gi,
  /\bserves?\s+as\b/gi,
  /\bserved\s+as\b/gi,
  /\brepresents?\b/gi,
  /\brepresented\b/gi,
  /\breflects?\b/gi,
  /\breflected\b/gi,
  /\bprovides?\b/gi,
  /\bprovided\b/gi,
];

/** Warm, unfalsifiable, factually empty. */
export const BANNED_COLLECTIVE_PATTERNS = [
  /\b(?:local\s+)?residents\s+took\s+pride\b/gi,
  /\bcommunity\s+volunteers\b/gi,
  /\bcommunity\s+involvement\b/gi,
  /\bcountless\b/gi,
  /\bthousands\s+of\s+hours\b/gi,
  /\bover\s+a\s+century\b/gi,
];

/** Headings that prove the shape came before the research. */
export const GENERIC_HEADINGS = [
  'cultural legacy',
  'educational programs',
  'community integration',
  'historic preservation',
  'historical significance',
  'legacy',
  'overview',
  'introduction',
  'conclusion',
  'modern era',
  'today',
  'visiting',
  'cultural impact',
  'economic impact',
  'community impact',
  'preservation efforts',
];

const ABBREVIATIONS =
  /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|Co|Inc|Ltd|Ft|Mt|Gen|Col|Capt|Lt|Sgt|Rev|Hon|Prof|approx|vs|etc|Ave|Blvd|Rd|No)\.$/i;

const MONTHS =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const FULL_DATE = new RegExp(MONTHS + '\\s+\\d{1,2},?\\s+\\d{4}', 'g');

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/** Split a markdown file into frontmatter text and body. */
export function splitFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { frontmatter: '', body: raw };
  return { frontmatter: m[1], body: m[2] };
}

/**
 * Body prose only: no headings, no Sources block, no code, no link syntax.
 * The Sources block is excluded deliberately — citations are not prose, and
 * counting them would let a long bibliography paper over a thin narrative.
 */
export function proseOf(body) {
  let t = body;
  t = t.replace(/^##\s*Sources[\s\S]*$/im, ''); // drop the sources block
  t = t.replace(/```[\s\S]*?```/g, ''); // fenced code
  t = t.replace(/^\s{0,3}#{1,6}\s.*$/gm, ''); // headings
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ''); // images
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // links -> text
  t = t.replace(/^\s{0,3}>\s?/gm, ''); // blockquote markers
  t = t.replace(/\*\*|__|\*|_|`/g, ''); // emphasis marks
  t = t.replace(/^\s*[-*+]\s+/gm, ''); // list bullets
  t = t.replace(/\r\n/g, '\n');
  return t.trim();
}

export function headingsOf(body) {
  const out = [];
  const re = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/gm;
  let m;
  while ((m = re.exec(body))) out.push({ level: m[1].length, text: m[2].trim() });
  return out;
}

export function paragraphsOf(prose) {
  return prose
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Sentence split that survives abbreviations and initials.
 *
 * Note on decimals: the split only fires on a period FOLLOWED BY WHITESPACE, so
 * "15,000" and "3.5" are never broken and need no special case. An earlier
 * version re-joined any fragment ending in digit-period, which silently welded
 * every sentence ending in a year ("...in 1857.") to the one after it — that
 * inflated mean sentence length and suppressed the short-sentence count on
 * exactly the numerate entries the standard is trying to reward.
 */
export function sentencesOf(text) {
  const rough = text.split(/(?<=[.!?])["')\]]?\s+/);
  const out = [];
  for (const piece of rough) {
    const prev = out[out.length - 1];
    // Re-join only for a known abbreviation, or a bare initial ("J. J. Felt"),
    // which appears as a fragment that is nothing but a single capital letter.
    const isBareInitial = prev !== undefined && /(?:^|\s)[A-Z]\.$/.test(prev);
    if (prev !== undefined && (ABBREVIATIONS.test(prev) || isBareInitial)) {
      out[out.length - 1] = prev + ' ' + piece;
    } else if (piece.trim()) {
      out.push(piece.trim());
    }
  }
  return out.filter((s) => /[a-z]/i.test(s));
}

export function wordsOf(text) {
  return text.match(/[\w'’-]+/g) ?? [];
}

export function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const stdDev = (a) => {
  if (a.length < 2) return 0;
  const mu = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - mu) ** 2)));
};

const countMatches = (text, re) => (text.match(re) ?? []).length;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** Every measurable property of one entry's prose. Pure and deterministic. */
export function measure(body) {
  const prose = proseOf(body);
  const headings = headingsOf(body);
  const paragraphs = paragraphsOf(prose);
  const sentences = sentencesOf(prose);
  const words = wordsOf(prose);
  const wordCount = words.length;

  const sentenceLengths = sentences.map((s) => wordsOf(s).length).filter((n) => n > 0);
  const syllableCount = words.reduce((sum, w) => sum + syllables(w), 0);

  const flesch =
    sentenceLengths.length && wordCount
      ? 206.835 -
        1.015 * (wordCount / sentenceLengths.length) -
        84.6 * (syllableCount / wordCount)
      : 0;

  const per1000 = (n) => (wordCount ? (n * 1000) / wordCount : 0);
  const per100 = (n) => (wordCount ? (n * 100) / wordCount : 0);

  // "while" as a connective. Excludes the noun ("a while", "the while") and the
  // compounds (meanwhile, worthwhile), which are not the weld the standard bans.
  const whileCount = countMatches(prose, /(?<!\ba\s)(?<!\bthe\s)(?<!mean)(?<!worth)while\b/gi);

  const bannedAdjectives = BANNED_ADJECTIVES.map((adj) => ({
    term: adj,
    count: countMatches(prose, new RegExp('\\b' + adj + '\\b', 'gi')),
  })).filter((x) => x.count > 0);

  const bannedVerbs = BANNED_VERB_PATTERNS.map((re) => {
    const found = prose.match(re) ?? [];
    return found.length ? { term: found[0].toLowerCase(), count: found.length } : null;
  }).filter(Boolean);

  const bannedCollectives = BANNED_COLLECTIVE_PATTERNS.map((re) => {
    const found = prose.match(re) ?? [];
    return found.length ? { term: found[0].toLowerCase(), count: found.length } : null;
  }).filter(Boolean);

  const abstractNouns = words.filter(
    (w) => /(?:tion|ment|ance|ity|ness|ship|ism)s?$/i.test(w) && w.length > 6
  );

  const numerals = countMatches(prose, /\d[\d,.]*/g);
  const fullDates = countMatches(prose, FULL_DATE);

  const paragraphSentenceCounts = paragraphs.map((p) => sentencesOf(p).length);
  let metronomeRuns = 0;
  for (let i = 2; i < paragraphSentenceCounts.length; i++) {
    if (
      paragraphSentenceCounts[i] === paragraphSentenceCounts[i - 1] &&
      paragraphSentenceCounts[i] === paragraphSentenceCounts[i - 2]
    ) {
      metronomeRuns++;
    }
  }

  const firstSentence = sentences[0] ?? '';
  // Participial scene-setting opener ("Perched on a bluff...", "Standing atop...")
  // or a brochure preposition frame. Delays the subject, signals brochure.
  const participialOpener =
    /^[A-Z][a-z]+(?:ed|ing)\b[^.!?]*,/.test(firstSentence) ||
    /^(?:In the heart of|Nestled|Perched|Situated|Located|Standing|Rising|Tucked)\b/i.test(
      firstSentence
    );

  const nestedParens = countMatches(prose, /\([^()]*\([^()]*\)/g);
  const boldRuns = countMatches(
    body.replace(/^##\s*Sources[\s\S]*$/im, ''),
    /\*\*[^*\n]+\*\*/g
  );
  const secondPerson = countMatches(prose, /\byou(?:r|rs|rself)?\b/gi);

  const sectionHeadings = headings.filter((h) => h.level === 2).map((h) => h.text);
  const genericHeadings = sectionHeadings.filter((h) =>
    GENERIC_HEADINGS.includes(
      h
        .toLowerCase()
        .replace(/[^a-z ]/g, '')
        .trim()
    )
  );

  const hasSources = /^##\s*Sources\s*$/im.test(body);

  return {
    wordCount,
    flesch: Number(flesch.toFixed(1)),
    sentenceCount: sentenceLengths.length,
    meanSentence: Number(mean(sentenceLengths).toFixed(1)),
    medianSentence: median(sentenceLengths),
    stdDev: Number(stdDev(sentenceLengths).toFixed(1)),
    shortSentenceRatio: sentenceLengths.length
      ? Number(
          (
            sentenceLengths.filter((n) => n <= T.shortSentenceWords).length /
            sentenceLengths.length
          ).toFixed(3)
        )
      : 0,
    maxSentence: sentenceLengths.length ? Math.max(...sentenceLengths) : 0,
    longSentencesPer1000: Number(
      per1000(sentenceLengths.filter((n) => n > T.longSentenceWords).length).toFixed(1)
    ),
    whileCount,
    bannedAdjectives,
    bannedVerbs,
    bannedCollectives,
    abstractNounsPer100: Number(per100(abstractNouns.length).toFixed(1)),
    abstractNounSamples: [...new Set(abstractNouns.map((w) => w.toLowerCase()))].slice(0, 8),
    numeralsPer1000: Number(per1000(numerals).toFixed(1)),
    fullDates,
    paragraphCount: paragraphs.length,
    paragraphSentenceCounts,
    metronomeRuns,
    maxParagraphSentences: paragraphSentenceCounts.length
      ? Math.max(...paragraphSentenceCounts)
      : 0,
    sectionCount: sectionHeadings.length,
    sectionHeadings,
    genericHeadings,
    participialOpener,
    nestedParens,
    boldRuns,
    secondPerson,
    hasSources,
    firstSentence: firstSentence.slice(0, 140),
  };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * Turn metrics into violations.
 *
 * Severity is about confidence, not importance:
 *   error — the standard states a hard number and the entry misses it.
 *   warn  — a strong signal that is occasionally legitimately overridden.
 *   info  — worth a human's eye, never blocks.
 */
export function evaluate(metrics, { hasFactcheck = false } = {}) {
  const v = [];
  const err = (code, msg) => v.push({ level: 'error', code, msg });
  const warn = (code, msg) => v.push({ level: 'warn', code, msg });
  const info = (code, msg) => v.push({ level: 'info', code, msg });

  // --- Length --------------------------------------------------------------
  if (metrics.wordCount < T.words.min) {
    warn(
      'words-short',
      `${metrics.wordCount} words; the standard asks for ${T.words.min}-${T.words.max}.`
    );
  } else if (metrics.wordCount > T.words.max) {
    err(
      'words-long',
      `${metrics.wordCount} words against a ${T.words.max} ceiling — the excess is usually connective tissue.`
    );
  }

  // --- Readability ---------------------------------------------------------
  if (metrics.flesch < T.flesch.floor) {
    err(
      'flesch',
      `Flesch ${metrics.flesch} is below the hard floor of ${T.flesch.floor} (target ${T.flesch.target[0]}-${T.flesch.target[1]}).`
    );
  } else if (metrics.flesch < T.flesch.target[0]) {
    info(
      'flesch-low',
      `Flesch ${metrics.flesch} clears the floor but sits under the ${T.flesch.target[0]}-${T.flesch.target[1]} target.`
    );
  }

  // --- Rhythm --------------------------------------------------------------
  if (metrics.stdDev < T.sentenceStdDevMin) {
    err(
      'rhythm',
      `Sentence-length standard deviation ${metrics.stdDev} is under ${T.sentenceStdDevMin}. The prose is metronomic; there is nowhere to breathe when read aloud.`
    );
  }
  if (metrics.shortSentenceRatio < T.shortSentenceRatio) {
    err(
      'short-sentences',
      `${Math.round(metrics.shortSentenceRatio * 100)}% of sentences are ${T.shortSentenceWords} words or fewer; the standard asks for ${T.shortSentenceRatio * 100}%.`
    );
  }
  if (metrics.maxSentence > T.maxSentenceWords) {
    err(
      'sentence-too-long',
      `Longest sentence runs ${metrics.maxSentence} words; nothing may exceed ${T.maxSentenceWords}.`
    );
  }
  if (metrics.longSentencesPer1000 > T.longSentencesPer1000) {
    warn(
      'long-sentence-density',
      `${metrics.longSentencesPer1000} sentences over ${T.longSentenceWords} words per 1,000; the budget is ${T.longSentencesPer1000}.`
    );
  }
  if (metrics.meanSentence > T.meanSentence[1]) {
    warn(
      'mean-sentence',
      `Mean sentence ${metrics.meanSentence} words, above the ${T.meanSentence[1]}-word ceiling.`
    );
  }
  if (metrics.medianSentence > T.medianSentenceMax) {
    warn(
      'median-sentence',
      `Median sentence ${metrics.medianSentence} words, above ${T.medianSentenceMax}.`
    );
  }

  // --- The machine signatures ----------------------------------------------
  if (metrics.whileCount > 0) {
    err(
      'while-weld',
      `"while" used ${metrics.whileCount}x as a connective. Two facts get two sentences.`
    );
  }
  for (const { term, count } of metrics.bannedAdjectives) {
    err(
      'banned-adjective',
      `Stock evaluative adjective "${term}" (${count}x) — an unsourced verdict wearing a description's clothes.`
    );
  }
  for (const { term, count } of metrics.bannedVerbs) {
    err(
      'banned-verb',
      `"${term}" (${count}x) asserts significance instead of showing evidence.`
    );
  }
  for (const { term, count } of metrics.bannedCollectives) {
    warn(
      'unfalsifiable',
      `"${term}" (${count}x) — warm, unsourceable, and factually empty. Use the real number or cut it.`
    );
  }
  if (metrics.abstractNounsPer100 > T.abstractNounsPer100) {
    err(
      'abstract-nouns',
      `${metrics.abstractNounsPer100} abstract nouns per 100 words (ceiling ${T.abstractNounsPer100}). Examples: ${metrics.abstractNounSamples.join(', ')}. A nominalised subject hides the actor.`
    );
  }
  if (metrics.participialOpener) {
    err(
      'participial-opener',
      `Opens with a participial or brochure frame: "${metrics.firstSentence}" — rule 1 wants a name, bearing, distance, or date in present tense.`
    );
  }

  // --- Evidence density ----------------------------------------------------
  if (metrics.numeralsPer1000 < T.numeralsPer1000) {
    err(
      'numerals',
      `${metrics.numeralsPer1000} numerals per 1,000 words; the standard asks for ${T.numeralsPer1000}. Intensity words are standing in for counts.`
    );
  }
  if (metrics.fullDates < 1) {
    warn(
      'no-full-date',
      'No Month-Day-Year date anywhere in the entry. At least one is expected where the record supports it.'
    );
  }

  // --- Structure -----------------------------------------------------------
  if (metrics.sectionCount < T.sections[0] || metrics.sectionCount > T.sections[1]) {
    warn(
      'section-count',
      `${metrics.sectionCount} sections; the standard asks for ${T.sections[0]}-${T.sections[1]}.`
    );
  }
  for (const h of metrics.genericHeadings) {
    err(
      'generic-heading',
      `Heading "${h}" is reusable boilerplate — it proves the shape came before the research.`
    );
  }
  if (metrics.maxParagraphSentences > T.paragraphSentences[1]) {
    warn(
      'paragraph-long',
      `A paragraph runs ${metrics.maxParagraphSentences} sentences; the ceiling is ${T.paragraphSentences[1]}.`
    );
  }
  if (metrics.metronomeRuns > 0) {
    warn(
      'metronome',
      `${metrics.metronomeRuns} run(s) of three consecutive paragraphs with identical sentence counts. Uniformity is the most audible tell in narration.`
    );
  }

  // --- Read-aloud ----------------------------------------------------------
  if (metrics.nestedParens > 0) {
    warn('nested-parens', `${metrics.nestedParens} nested parenthetical(s) — unspeakable aloud.`);
  }
  if (metrics.boldRuns > 0) {
    info(
      'bold-emphasis',
      `${metrics.boldRuns} bold run(s). Bold is silent in audio; any meaning it carries is lost in a third of the delivery surfaces.`
    );
  }

  // --- Sourcing ------------------------------------------------------------
  if (!metrics.hasSources) {
    err(
      'no-sources',
      'No "## Sources" block. Every entry ends with one, listing each source and its tier.'
    );
  }
  if (!hasFactcheck) {
    warn(
      'no-factcheck',
      'No factcheck record in frontmatter — the entry has never been through a sourcing pass.'
    );
  }

  return v;
}

/**
 * 0-100. Errors cost 6, warnings 2, info 0.5, floored at zero.
 * Deliberately blunt: the number exists to rank a worklist, not to be precise.
 */
export function score(violations) {
  const cost = violations.reduce(
    (sum, x) => sum + (x.level === 'error' ? 6 : x.level === 'warn' ? 2 : 0.5),
    0
  );
  return Math.max(0, Math.round(100 - cost));
}

export function grade(s) {
  if (s >= 90) return 'A';
  if (s >= 78) return 'B';
  if (s >= 62) return 'C';
  if (s >= 45) return 'D';
  return 'F';
}

/** Analyse one entry end to end. */
export function analyse(body, opts = {}) {
  const metrics = measure(body);
  const violations = evaluate(metrics, opts);
  const s = score(violations);
  return {
    metrics,
    violations,
    score: s,
    grade: grade(s),
    errors: violations.filter((x) => x.level === 'error').length,
    warnings: violations.filter((x) => x.level === 'warn').length,
  };
}

// ---------------------------------------------------------------------------
// Corpus-level checks
// ---------------------------------------------------------------------------

/**
 * Two things only visible across the whole corpus:
 *  - a section heading reused between unrelated entries
 *  - a 12-word run shared between entries (the template's fingerprint)
 */
export function corpusChecks(entries) {
  const headingMap = new Map();
  const shingleMap = new Map();

  for (const { slug, body } of entries) {
    for (const h of headingsOf(body).filter((x) => x.level === 2)) {
      const key = h.text.toLowerCase().trim();
      // "Sources" is required on every entry by the standard itself, so its
      // recurrence is compliance, not template reuse.
      if (key === 'sources') continue;
      if (!headingMap.has(key)) headingMap.set(key, new Set());
      headingMap.get(key).add(slug);
    }
    const words = wordsOf(proseOf(body)).map((w) => w.toLowerCase());
    const seen = new Set();
    for (let i = 0; i + T.sharedShingle <= words.length; i++) {
      const key = words.slice(i, i + T.sharedShingle).join(' ');
      if (seen.has(key)) continue;
      seen.add(key);
      if (!shingleMap.has(key)) shingleMap.set(key, new Set());
      shingleMap.get(key).add(slug);
    }
  }

  const duplicateHeadings = [...headingMap.entries()]
    .filter(([, slugs]) => slugs.size > 1)
    .map(([text, slugs]) => ({ text, slugs: [...slugs].sort() }))
    .sort((a, b) => b.slugs.length - a.slugs.length);

  const duplicatePassages = [...shingleMap.entries()]
    .filter(([, slugs]) => slugs.size > 1)
    .map(([text, slugs]) => ({ text, slugs: [...slugs].sort() }))
    .sort((a, b) => b.slugs.length - a.slugs.length);

  return { duplicateHeadings, duplicatePassages };
}
