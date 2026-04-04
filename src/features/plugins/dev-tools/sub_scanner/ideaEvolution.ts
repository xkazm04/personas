import type { DevIdea } from '@/lib/bindings/DevIdea';

// ---------------------------------------------------------------------------
// Jaccard similarity between two ideas
// ---------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ---------------------------------------------------------------------------
// Idea similarity scoring
// ---------------------------------------------------------------------------

export interface IdeaSimilarityPair {
  ideaA: DevIdea;
  ideaB: DevIdea;
  similarity: number;
  sharedTokens: string[];
}

export function findSimilarPairs(ideas: DevIdea[], threshold: number = 0.35): IdeaSimilarityPair[] {
  const pairs: IdeaSimilarityPair[] = [];

  for (let i = 0; i < ideas.length; i++) {
    for (let j = i + 1; j < ideas.length; j++) {
      const a = ideas[i]!;
      const b = ideas[j]!;
      const textA = `${a.title} ${a.description ?? ''}`;
      const textB = `${b.title} ${b.description ?? ''}`;
      const sim = jaccardSimilarity(textA, textB);

      if (sim >= threshold) {
        const tokensA = tokenize(textA);
        const tokensB = tokenize(textB);
        const shared: string[] = [];
        for (const w of tokensA) {
          if (tokensB.has(w)) shared.push(w);
        }
        pairs.push({ ideaA: a, ideaB: b, similarity: sim, sharedTokens: shared });
      }
    }
  }

  return pairs.sort((a, b) => b.similarity - a.similarity);
}

// ---------------------------------------------------------------------------
// Rejection fitness — penalizes ideas similar to rejected ones
// ---------------------------------------------------------------------------

export interface IdeaFitness {
  idea: DevIdea;
  baseFitness: number;         // From effort/impact/risk
  rejectionPenalty: number;    // 0 to 1 based on similarity to rejected ideas
  finalFitness: number;        // baseFitness * (1 - rejectionPenalty)
  similarRejections: string[]; // Titles of similar rejected ideas
}

export function computeIdeaFitness(ideas: DevIdea[]): IdeaFitness[] {
  const rejected = ideas.filter((i) => i.status === 'rejected');
  const pending = ideas.filter((i) => i.status === 'pending');

  return pending.map((idea) => {
    // Base fitness: high impact, low effort, low risk → high fitness
    const impact = idea.impact ?? 5;
    const effort = idea.effort ?? 5;
    const risk = idea.risk ?? 5;
    const baseFitness = (impact * 2 - effort - risk) / 10; // Range roughly -1 to 1, normalized

    // Rejection penalty: how similar is this to rejected ideas?
    let maxSimilarity = 0;
    const similarRejections: string[] = [];
    const ideaText = `${idea.title} ${idea.description ?? ''}`;

    for (const rej of rejected) {
      const rejText = `${rej.title} ${rej.description ?? ''}`;
      const sim = jaccardSimilarity(ideaText, rejText);
      if (sim > maxSimilarity) maxSimilarity = sim;
      if (sim > 0.3) similarRejections.push(rej.title);
    }

    const rejectionPenalty = Math.min(maxSimilarity * 1.5, 1); // Scale up, cap at 1
    const finalFitness = baseFitness * (1 - rejectionPenalty);

    return { idea, baseFitness, rejectionPenalty, finalFitness, similarRejections };
  }).sort((a, b) => b.finalFitness - a.finalFitness);
}

// ---------------------------------------------------------------------------
// Synthesis suggestions — ideas that could combine
// ---------------------------------------------------------------------------

export interface SynthesisSuggestion {
  parentA: DevIdea;
  parentB: DevIdea;
  similarity: number;
  suggestedTitle: string;
  reasoning: string;
}

export function generateSynthesisSuggestions(ideas: DevIdea[]): SynthesisSuggestion[] {
  const accepted = ideas.filter((i) => i.status === 'accepted');
  const pairs = findSimilarPairs(accepted, 0.4);

  return pairs.slice(0, 5).map(({ ideaA, ideaB, similarity, sharedTokens }) => ({
    parentA: ideaA,
    parentB: ideaB,
    similarity,
    suggestedTitle: `Combined: ${ideaA.title.split(' ').slice(0, 4).join(' ')} + ${ideaB.title.split(' ').slice(0, 4).join(' ')}`,
    reasoning: `Both ideas share concepts around ${sharedTokens.slice(0, 5).join(', ')} — combining them could yield a more impactful implementation.`,
  }));
}
