/**
 * Domain types: the DATA CONTRACT between the content pipeline (which will
 * produce questions) and the game (which consumes them).
 *
 * Rules of thumb for this file:
 *  - No React, no browser APIs. The domain layer must run in Node (tests,
 *    and later a server) exactly as it runs in the browser.
 *  - Everything is plain JSON-serialisable data, so the Python pipeline can
 *    emit it and a Postgres row can map onto it.
 */

export const CATEGORIES = ['tollywood', 'space', 'us-pop'] as const;
export type Category = (typeof CATEGORIES)[number];

/** What the player picks on the home screen. */
export type CategorySelection = Category | 'mixed';

/** A citation backing one or more answers. Never invented: must be a real URL. */
export interface Source {
  id: string;
  title: string;
  publisher: string;
  url: string;
  /** ISO date (YYYY-MM-DD) on which a human or the pipeline last verified it. */
  retrievedOn: string;
}

/**
 * Where the `familiarity` number on an answer came from. Rarity must be
 * explainable, so we record its provenance instead of pretending precision.
 */
export const FAMILIARITY_BASES = [
  /** Hand-assigned by an editor. A rough prior, not a measurement. */
  'curated-estimate',
  /** An LLM's coarse judgement (a familiarity tier), converted to a share by the pipeline. Unverified. */
  'llm-estimate',
  /** Derived from normalised external signals (pipeline, later milestone). */
  'signal-model',
] as const;
export type FamiliarityBasis = (typeof FAMILIARITY_BASES)[number];

export interface Answer {
  /** Stable id, unique within the question. */
  id: string;
  /** The display form shown on the reveal screen. */
  canonical: string;
  /** Other spellings/names that must be accepted as this same answer. */
  aliases: string[];
  /**
   * Prior estimate of the SHARE of correct responses to THIS question that
   * will be this answer (0..1). Rarity is a property of an answer *in the
   * context of one question*: Jupiter is a very common answer to "Name the
   * largest planet" but a rare one to "Name a planet with rings", where
   * Saturn dominates. Same entity, different share.
   */
  familiarity: number;
  familiarityBasis: FamiliarityBasis;
  /** Short statement of why this answer satisfies the prompt. */
  evidence: string;
  /** Ids into `Question.sources`. At least one is required. */
  sourceIds: string[];
}

/**
 * `closed`: the full set of valid answers is finite and verifiable
 *   (e.g. "the four Galilean moons"). Anything not in the bank is wrong.
 * `open`: valid answers may exist that we have not enumerated
 *   (e.g. "a Telugu film with two lead actresses"). A non-matching
 *   submission is queued for review rather than being declared wrong.
 */
export type AnswerSetKind = 'closed' | 'open';

/**
 * Where a question's facts come from.
 *  - `sourced`: every answer cites a real, fetched source (the default).
 *  - `ai-knowledge`: written from an LLM's memory, with NO sources. Used for things no tidy source
 *    lists (memes, trolls, hoaxes). It is a different trust level, so it is flagged in the data,
 *    gated more strictly, and labelled in the UI instead of being passed off as sourced.
 */
export const KNOWLEDGE_BASES = ['sourced', 'ai-knowledge'] as const;
export type KnowledgeBasis = (typeof KNOWLEDGE_BASES)[number];

export interface Question {
  id: string;
  category: Category;
  /** Absent means `sourced`, so every question written before this field existed stays valid. */
  basis?: KnowledgeBasis;
  prompt: string;
  answerSet: AnswerSetKind;
  answers: Answer[];
  /**
   * "What counts": the editorial rule for membership, shown to the player.
   * Required (by the quality gate) for open sets, where the prompt alone is
   * subjective, e.g. what makes a film a "saviour trope" film.
   */
  criteria?: string;
  /** Shown after the player answers. */
  explanation: string;
  sources: Source[];
  /** ISO date this question was approved for play. */
  approvedOn: string;
}

/** True for questions written from model memory. Absent `basis` means sourced. */
export function isAiKnowledge(question: Pick<Question, 'basis'>): boolean {
  return question.basis === 'ai-knowledge';
}

export interface QuestionBank {
  schemaVersion: 1;
  questions: Question[];
}

// ---- Scoring ----------------------------------------------------------

export const RARITY_TIERS = ['common', 'uncommon', 'rare', 'legendary'] as const;
export type RarityTier = (typeof RARITY_TIERS)[number];

/** Gameplay statistics for one answer of one question (aggregated server-side later). */
export interface AnswerObservation {
  /** Times this answer was submitted and accepted. */
  count: number;
  /** Total accepted submissions for the question (sum over answers). */
  total: number;
}

/** Looks up gameplay statistics for an answer; undefined = no data. */
export type ObservationLookup = (questionId: string, answerId: string) => AnswerObservation | undefined;

export interface ScoreBreakdown {
  tier: RarityTier;
  points: number;
  /** The share used for scoring after blending prior and observations. */
  effectiveShare: number;
  /**
   * The share of the most popular answer to the same question. The tier is
   * decided by effectiveShare / topShare, not by effectiveShare alone.
   */
  topShare: number;
  /** effectiveShare / topShare, in (0, 1]. 1 means "the most popular answer". */
  relativeShare: number;
  /** Whether observed gameplay data influenced the share. */
  usedObservations: boolean;
}
