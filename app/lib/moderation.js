// Keyword-based prompt moderation, enforcing the "Strict Content Policy" in
// app/terms/page.js (zero tolerance for sexual, nude, pornographic, adult,
// exploitative, minor-related, or non-consensual content, including
// intimate deepfakes). This runs server-side, before any credit is
// reserved or any provider is called, so a blocked request costs the user
// nothing and never reaches Alibaba/Replicate.
//
// This is a first line of defense, not a complete solution: it catches
// explicit, unambiguous requests cheaply and instantly, with no extra API
// calls or cost. It will not catch heavily reworded/coded language, and it
// makes no attempt to inspect uploaded reference images at all - both are
// known gaps or the next step is a real moderation model/API in front of
// (or in addition to) this.
//
// Deliberate design choice: any explicit/adult term blocks the prompt
// outright, regardless of whether a minor-related term is also present.
// Since the policy bans sexual/adult/nude content entirely (not only in
// combination with minors), this single check also automatically covers
// the minor+sexual combination - a minor-related word on its own (e.g. "a
// child playing in a park", "a teenager reading a book") is never blocked.

const EXPLICIT_TERMS = [
  'nude', 'nudity', 'naked', 'nsfw', 'porn', 'pornographic', 'pornography',
  'erotic', 'erotica', 'hentai', 'ecchi', 'fetish', 'bdsm', 'orgasm',
  'masturbat', 'genitals', 'genitalia', 'penis', 'vagina', 'breasts exposed',
  'topless', 'bottomless', 'sex tape', 'sexual act', 'explicit sex',
  'having sex', 'sexually explicit', 'strip naked', 'onlyfans',
  // Hungarian equivalents
  'meztelen', 'pucér', 'pornó', 'szexuális aktus', 'erotikus',
];

const NON_CONSENSUAL_TERMS = [
  'deepfake', 'deep fake', 'without her consent', 'without his consent',
  'without their consent', 'non-consensual', 'nonconsensual', 'revenge porn',
  'upskirt', 'hidden camera', 'spy cam',
];

const MINOR_TERMS = [
  'child', 'children', 'kid', 'kids', 'minor', 'minors', 'underage',
  'under-age', 'toddler', 'infant', 'preteen', 'pre-teen', 'tween',
  'schoolgirl', 'schoolboy', 'loli', 'lolita', 'shota',
  // Hungarian equivalents
  'gyerek', 'gyermek', 'kiskorú',
];

// Sexualized descriptors that are not explicit on their own but should never
// be paired with a minor-related term above - unlike EXPLICIT_TERMS, these
// have entirely ordinary uses on their own (e.g. "a sexy sports car"), so
// they're only checked in combination with MINOR_TERMS, never alone.
const SUGGESTIVE_TERMS = [
  'sexy', 'seductive', 'sensual', 'provocative', 'aroused', 'flirtatious',
  'szexi', 'csábító',
];

// Loose separators (spaces, dots, dashes, underscores) between every letter
// of a flagged word are a common, trivial way to dodge a plain substring
// check (e.g. "n.u.d.e", "n u d e"). This collapses runs of non-letters
// down to nothing before matching, on top of the normal whole-word check,
// so both "nude" and "n u d e" are caught by the same term.
function normalize(text) {
  return (text || '').toLowerCase();
}

function collapsedSpaced(text) {
  return normalize(text).replace(/[^a-z0-9]+/g, '');
}

function containsTerm(normalizedText, collapsedText, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole-word-ish match on the normal text (avoids flagging unrelated
  // words that merely contain the term as a substring).
  const wordBoundary = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  if (wordBoundary.test(normalizedText)) return true;
  // Also check the letters-only collapsed form to catch spaced-out evasion.
  const collapsedTerm = term.replace(/[^a-z0-9]/g, '');
  if (collapsedTerm.length >= 3 && collapsedText.includes(collapsedTerm)) return true;
  return false;
}

function findMatch(normalizedText, collapsedText, terms) {
  return terms.find(term => containsTerm(normalizedText, collapsedText, term)) || null;
}

// Checks one or more pieces of prompt text together (e.g. the main prompt
// and the negative prompt). Returns null if nothing was flagged, or
// { category, term } describing the first match found.
export function moderatePromptText(...texts) {
  const combined = texts.filter(Boolean).join(' \n ');
  const normalized = normalize(combined);
  const collapsed = collapsedSpaced(combined);

  const explicitMatch = findMatch(normalized, collapsed, EXPLICIT_TERMS);
  if (explicitMatch) return { category: 'explicit', term: explicitMatch };

  const nonConsensualMatch = findMatch(normalized, collapsed, NON_CONSENSUAL_TERMS);
  if (nonConsensualMatch) return { category: 'non_consensual', term: nonConsensualMatch };

  const minorMatch = findMatch(normalized, collapsed, MINOR_TERMS);
  if (minorMatch) {
    const suggestiveMatch = findMatch(normalized, collapsed, SUGGESTIVE_TERMS);
    if (suggestiveMatch) return { category: 'minor_suggestive', term: `${minorMatch} + ${suggestiveMatch}` };
  }

  return null;
}

export const MODERATION_MESSAGE = 'This request looks like it may violate our content policy (no sexual, nude, or non-consensual content). Please rephrase your prompt. Repeated attempts may result in account suspension.';
