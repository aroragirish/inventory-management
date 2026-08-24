/**
 * Name normalisation and fuzzy matching. Deliberately dependency-free so it can
 * be imported by the server, by the JSON repositories, and directly by the
 * Node scripts under scripts/ without any build step.
 */

/** Words that carry no identity - brand noise and packaging chatter. */
const NOISE =
  /(uc|ultraclean|ultra|clean(?=\s|$)|with|w\/o|without|and|the|pcs|pc|nos|no)/g;

/**
 * Spelling variants that mean the same thing across the two item masters.
 * Folding them here lets the qualifier check below compare like with like.
 */
const SYNONYMS: Record<string, string> = {
  refil: "refill",
  refill: "refill",
  hocky: "hockey",
  hockey: "hockey",
  dimond: "diamond",
  phynile: "phenyl",
  phenyle: "phenyl",
  phenyle1: "phenyl",
  orrisa: "orissa",
  sng: "spin",
  ms: "metal",
  ss: "steel",
  lit: "l",
  ltr: "l",
  litre: "l",
  gms: "g",
  gm: "g",
};

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(NOISE, " ")
    .split(" ")
    .filter(Boolean)
    .map((token) => SYNONYMS[token] ?? token)
    .join(" ")
    .trim();
}

/**
 * Words that flip what a product IS rather than describing it. A refill is not
 * the mop; a steel rod is not the plastic one. If one name carries such a word
 * and the other does not, they are probably different products however much
 * else they share.
 */
const QUALIFIERS = new Set([
  "refill",
  "heavy",
  "steel",
  "plastic",
  "wooden",
  "metal",
  "jumbo",
  "mini",
  "small",
  "medium",
  "big",
  "large",
  "rod",
  "container",
  "packing",
]);

function qualifierPenalty(a: string[], b: string[]): number {
  const qa = new Set(a.filter((t) => QUALIFIERS.has(t)));
  const qb = new Set(b.filter((t) => QUALIFIERS.has(t)));
  let mismatches = 0;
  for (const q of qa) if (!qb.has(q)) mismatches += 1;
  for (const q of qb) if (!qa.has(q)) mismatches += 1;
  if (mismatches === 0) return 1;
  // Each disagreement roughly halves the score; two or more is decisive.
  return Math.max(0.3, 0.55 ** mismatches);
}

/**
 * Matches item names coming from Tally onto our catalogue.
 *
 * Tally keeps its own item master, so the same product reads "Assam 3G Broom"
 * there and "3G" here, "Dimond Jala" there and "Diamond Jala" here. Two things
 * make the difference:
 *
 *  - **IDF weighting.** "broom" and "mop" appear in dozens of names and say
 *    almost nothing; "kohinoor" appears once and is decisive. Scoring by plain
 *    token overlap drowns the signal, so each token is weighted by how rare it
 *    is across the catalogue.
 *  - **Typo tolerance.** "Dimond"/"Diamond" and "Hocky"/"Hockey" are the same
 *    word to a human, so tokens within a small edit distance count as a hit at
 *    a slight discount.
 *
 * Nothing here writes anything: it only proposes. Confirmed matches are stored
 * as aliases so a name is only ever resolved by hand once.
 */

export interface MatchCandidate {
  id: string;
  name: string;
}

export interface MatchResult {
  id: string | null;
  score: number;
}

/** Distance capped at `max` - we never care how far apart two long words are. */
function withinEditDistance(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
      current.push(value);
      if (value < rowBest) rowBest = value;
    }
    if (rowBest > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

/** One typo allowed from 5 characters, two from 9. */
function editBudget(token: string) {
  if (token.length >= 9) return 2;
  if (token.length >= 5) return 1;
  return 0;
}

const tokensOf = (value: string) =>
  normalizeName(value).split(" ").filter((t) => t.length > 0);

export class NameMatcher {
  private readonly entries: { id: string; tokens: string[] }[];
  private readonly idf = new Map<string, number>();
  private readonly exact = new Map<string, string>();

  constructor(candidates: MatchCandidate[]) {
    this.entries = candidates.map((c) => ({ id: c.id, tokens: tokensOf(c.name) }));

    for (const c of candidates) {
      const key = normalizeName(c.name);
      // First name wins, so an earlier catalogue entry is not shadowed later.
      if (!this.exact.has(key)) this.exact.set(key, c.id);
    }

    const documentCount = new Map<string, number>();
    for (const entry of this.entries) {
      for (const token of new Set(entry.tokens)) {
        documentCount.set(token, (documentCount.get(token) ?? 0) + 1);
      }
    }
    const total = Math.max(1, this.entries.length);
    for (const [token, count] of documentCount) {
      this.idf.set(token, Math.log(total / count) + 1);
    }
  }

  /** Weight of an unseen token: treat it as maximally rare. */
  private weight(token: string) {
    return this.idf.get(token) ?? Math.log(Math.max(1, this.entries.length)) + 1;
  }

  /** An identical normalised name - no scoring needed. */
  exactMatch(name: string): string | null {
    return this.exact.get(normalizeName(name)) ?? null;
  }

  match(name: string): MatchResult {
    const direct = this.exactMatch(name);
    if (direct) return { id: direct, score: 1 };

    const tokens = tokensOf(name);
    if (tokens.length === 0) return { id: null, score: 0 };

    const queryWeight = tokens.reduce((sum, t) => sum + this.weight(t), 0);
    let bestId: string | null = null;
    let bestScore = 0;

    for (const entry of this.entries) {
      if (entry.tokens.length === 0) continue;

      const available = [...entry.tokens];
      let shared = 0;

      for (const token of tokens) {
        let hitIndex = available.indexOf(token);
        let discount = 1;

        if (hitIndex === -1) {
          const budget = editBudget(token);
          if (budget > 0) {
            hitIndex = available.findIndex((candidate) =>
              withinEditDistance(token, candidate, budget),
            );
            // A near-miss counts, but never as much as an exact word.
            if (hitIndex !== -1) discount = 0.82;
          }
        }

        if (hitIndex !== -1) {
          shared += this.weight(token) * discount;
          available.splice(hitIndex, 1);
        }
      }

      const entryWeight = entry.tokens.reduce((sum, t) => sum + this.weight(t), 0);
      // Weighted Dice: rewards covering both names, not just overlapping once.
      const dice = (2 * shared) / (queryWeight + entryWeight);
      const score = dice * qualifierPenalty(tokens, entry.tokens);
      if (score > bestScore) {
        bestScore = score;
        bestId = entry.id;
      }
    }

    return { id: bestId, score: Math.round(bestScore * 1000) / 1000 };
  }
}

/** Above this a suggestion is strong enough to confirm in bulk. */
export const AUTO_ACCEPT = 0.6;

/**
 * Below this we say nothing rather than guess.
 *
 * A weak guess is worse than none: it has to be undone, and if two rows guess
 * at the same product it manufactures a clash that blocks the whole import.
 * Measured against a real Tally export, a floor of 0.3 produced 33 clashing
 * products from pairings like "Dishwash 500ml" and "Handwash 500ml"; at 0.5,
 * with the de-duplication below, none survive.
 */
export const SUGGEST_FLOOR = 0.5;

export interface Claim {
  productId: string | null;
  matchedBy: "alias" | "exact" | "suggested" | "none";
  confidence: number;
}

/**
 * Makes sure at most one row lays claim to each product.
 *
 * A confirmed mapping (alias) or an identical name (exact) always wins. Among
 * guesses the most confident wins, and the rest are handed back unmatched for
 * a person to place - which is honest, because the matcher genuinely does not
 * know which of them is right.
 *
 * Returns the indices that lost their claim.
 */
export function dedupeClaims(claims: Claim[]): Set<number> {
  const rank = (claim: Claim) =>
    claim.matchedBy === "alias" || claim.matchedBy === "exact"
      ? Number.POSITIVE_INFINITY
      : claim.confidence;

  const best = new Map<string, number>();
  for (let i = 0; i < claims.length; i += 1) {
    const claim = claims[i];
    if (!claim.productId) continue;
    const current = best.get(claim.productId);
    if (current === undefined || rank(claim) > rank(claims[current])) {
      best.set(claim.productId, i);
    }
  }

  const losers = new Set<number>();
  for (let i = 0; i < claims.length; i += 1) {
    const claim = claims[i];
    if (!claim.productId) continue;
    if (best.get(claim.productId) !== i) losers.add(i);
  }
  return losers;
}
