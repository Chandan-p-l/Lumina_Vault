import { loadSettings } from './config.js';
import { db, MediaRow } from './db.js';
import {
  embedText,
  indexingState,
  startIndexingQueue,
  verifyCandidatesWithGemini,
} from './gemini.js';

export interface SearchOptions {
  query: string;
  mediaType?: 'all' | 'photo' | 'video';
  folderId?: number | null;
  category?: string | null;
  year?: number | null;
  month?: number | null;
  favoriteOnly?: boolean;
  aiVerify?: boolean;
  limit?: number;
}

export interface SearchHit {
  media: MediaRow;
  score: number;
  matchReason: string;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'me',
  'my',
  'i',
  'am',
  'is',
  'are',
  'was',
  'were',
  'find',
  'show',
  'search',
  'get',
  'photo',
  'photos',
  'picture',
  'pictures',
  'image',
  'images',
  'video',
  'videos',
  'where',
  'in',
  'on',
  'at',
  'of',
  'to',
  'for',
  'with',
  'and',
  'or',
  'from',
]);

const SYNONYM_MAP: Record<string, string[]> = {
  dog: ['dog', 'puppy', 'pup', 'canine', 'retriever', 'hound', 'pet'],
  cat: ['cat', 'kitten', 'kitty', 'feline', 'pet'],
  sitting: ['sitting', 'sit', 'seated', 'crouching', 'resting'],
  smiling: ['smiling', 'smile', 'happy', 'laughing', 'grinning'],
  beach: ['beach', 'ocean', 'sea', 'coast', 'shore', 'sand'],
  car: ['car', 'vehicle', 'auto', 'sedan', 'suv', 'driving'],
  food: ['food', 'meal', 'dish', 'dinner', 'lunch', 'breakfast', 'plate', 'eating'],
  night: ['night', 'evening', 'dark', 'lights', 'neon'],
  receipt: ['receipt', 'invoice', 'bill', 'document', 'paper'],
  document: ['document', 'receipt', 'text', 'paper', 'screenshot', 'note'],
  person: ['person', 'man', 'woman', 'boy', 'girl', 'people', 'portrait', 'selfie'],
};

function stemToken(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function extractKeywords(query: string): string[] {
  const base = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  const expanded = new Set<string>();
  for (const w of base) {
    expanded.add(w);
    expanded.add(stemToken(w));
    const syns = SYNONYM_MAP[w];
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
  }
  return Array.from(expanded);
}

function lexicalScore(row: MediaRow, baseWords: string[], expandedWords: string[]): number {
  if (baseWords.length === 0) return 0;
  const haystack = [
    row.filename,
    row.ai_caption || '',
    row.ai_tags_json || '',
    row.ai_category || '',
    row.ai_people_pets || '',
    row.ai_objects_json || '',
    row.ai_text_ocr || '',
    String(row.year),
  ]
    .join(' ')
    .toLowerCase();

  let exactMatched = 0;
  for (const kw of baseWords) {
    if (haystack.includes(kw) || haystack.includes(stemToken(kw))) exactMatched++;
  }

  let expandedMatched = 0;
  for (const kw of expandedWords) {
    if (haystack.includes(kw)) expandedMatched++;
  }

  const exactRatio = exactMatched / baseWords.length;
  const expandedRatio = Math.min(1, expandedMatched / Math.max(1, baseWords.length * 1.5));
  return Math.max(exactRatio, expandedRatio * 0.75);
}

export async function semanticSearch(options: SearchOptions): Promise<{
  hits: SearchHit[];
  usedAiVerify: boolean;
  usedEmbeddings: boolean;
  pendingCount: number;
  hasApiKey: boolean;
  warning?: string;
}> {
  const limit = options.limit || 60;
  const settings = loadSettings();
  const hasApiKey = Boolean(settings.apiKey);

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.mediaType && options.mediaType !== 'all') {
    conditions.push('media_type = ?');
    params.push(options.mediaType);
  }
  if (options.folderId) {
    conditions.push('folder_id = ?');
    params.push(options.folderId);
  }
  if (options.category) {
    conditions.push('ai_category = ?');
    params.push(options.category);
  }
  if (options.year) {
    conditions.push('year = ?');
    params.push(options.year);
  }
  if (options.month) {
    conditions.push('month = ?');
    params.push(options.month);
  }
  if (options.favoriteOnly) {
    conditions.push('favorite = 1');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const allRows = db
    .prepare(`SELECT * FROM media ${whereClause} ORDER BY captured_at DESC`)
    .all(...params) as unknown as MediaRow[];

  const pendingRows = allRows.filter((r) => r.ai_status !== 'indexed');
  const pendingCount = pendingRows.length;

  // Auto-kick background AI indexing if user searches while items are still pending
  if (pendingCount > 0 && hasApiKey && !indexingState.running) {
    void startIndexingQueue(false);
  }

  const query = options.query.trim();
  if (!query) {
    return {
      hits: allRows.slice(0, limit).map((media) => ({
        media,
        score: 100,
        matchReason: media.ai_caption || '',
      })),
      usedAiVerify: false,
      usedEmbeddings: false,
      pendingCount,
      hasApiKey,
    };
  }

  const baseWords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  const expandedWords = extractKeywords(query);

  const qLower = query.toLowerCase();
  const wantsVideo = /\bvideos?\b/.test(qLower);
  const wantsPhoto = /\b(photos?|pictures?|images?)\b/.test(qLower);

  const ftsScores = new Map<number, number>();
  if (expandedWords.length > 0) {
    try {
      const ftsQuery = expandedWords
        .slice(0, 12)
        .map((k) => `"${k}"*`)
        .join(' OR ');
      const ftsRows = db
        .prepare(
          'SELECT media_id, bm25(media_fts) as rank FROM media_fts WHERE media_fts MATCH ? LIMIT 250'
        )
        .all(ftsQuery) as Array<{ media_id: number; rank: number }>;
      for (const r of ftsRows) {
        ftsScores.set(r.media_id, Math.min(1, Math.abs(r.rank) / 10 + 0.35));
      }
    } catch {
      // ignore malformed FTS syntax
    }
  }

  let queryVec: number[] | null = null;
  if (hasApiKey) {
    try {
      const emb = await embedText(query);
      if (emb) queryVec = emb.vector;
    } catch {
      queryVec = null;
    }
  }

  const scored = allRows.map((row) => {
    let vecSim = 0;
    if (queryVec && row.embedding_json) {
      try {
        const rowVec = JSON.parse(row.embedding_json) as number[];
        vecSim = Math.max(0, cosineSimilarity(queryVec, rowVec));
      } catch {
        vecSim = 0;
      }
    }

    const lex = lexicalScore(row, baseWords, expandedWords);
    const fts = ftsScores.get(row.id) || 0;

    let typeBonus = 0;
    if (wantsVideo && row.media_type === 'video') typeBonus = 0.08;
    if (wantsPhoto && row.media_type === 'photo') typeBonus = 0.05;

    // Score each item using the strongest available signals (don't penalize un-embedded items)
    const combined =
      queryVec && row.embedding_json
        ? Math.max(vecSim * 0.72 + lex * 0.2 + fts * 0.08, lex * 0.75 + fts * 0.25) + typeBonus
        : lex * 0.7 + fts * 0.3 + typeBonus;

    return {
      media: row,
      rawScore: combined,
      lex,
      vecSim,
    };
  });

  scored.sort((a, b) => b.rawScore - a.rawScore);

  const candidates = scored
    .filter((s) => s.rawScore > (queryVec ? 0.26 : 0.08) || s.lex > 0.25)
    .slice(0, 36);

  // Build verification pool: top hybrid candidates + up to 24 unindexed items so immediate search still works
  const verifyMap = new Map<number, MediaRow>();
  for (const c of candidates) {
    verifyMap.set(c.media.id, c.media);
  }
  if (options.aiVerify && hasApiKey && pendingRows.length > 0 && verifyMap.size < 36) {
    for (const p of pendingRows) {
      if (verifyMap.size >= 36) break;
      verifyMap.set(p.id, p);
    }
  }
  if (options.aiVerify && hasApiKey && verifyMap.size === 0) {
    for (const r of allRows.slice(0, 36)) {
      verifyMap.set(r.id, r);
    }
  }

  const verifyPool = Array.from(verifyMap.values());
  let warning: string | undefined;

  if (!hasApiKey && pendingCount > 0) {
    warning =
      'Gemini API key is not configured — searching filenames only. Add your API key in Settings for visual AI search.';
  } else if (pendingCount > 0) {
    warning = `${pendingCount} item${pendingCount === 1 ? '' : 's'} still indexing in background; checked top items visually.`;
  }

  if (options.aiVerify && hasApiKey && verifyPool.length > 0) {
    try {
      const verified = await verifyCandidatesWithGemini(query, verifyPool);
      if (verified.length > 0) {
        const verifiedHits: SearchHit[] = [];
        for (const v of verified.sort((a, b) => b.score - a.score)) {
          const media = verifyMap.get(v.id);
          if (media) {
            verifiedHits.push({
              media,
              score: v.score,
              matchReason: v.reason,
            });
          }
        }
        if (verifiedHits.length > 0) {
          return {
            hits: verifiedHits.slice(0, limit),
            usedAiVerify: true,
            usedEmbeddings: Boolean(queryVec),
            pendingCount,
            hasApiKey,
            warning,
          };
        }
      }
    } catch (err) {
      warning = `Gemini Vision verify unavailable (${
        err instanceof Error ? err.message : 'API error'
      }); showing indexed keyword/embedding matches.`;
    }
  }

  const hits: SearchHit[] = candidates.slice(0, limit).map((c) => ({
    media: c.media,
    score: Math.min(99, Math.round(c.rawScore * 100)),
    matchReason: c.media.ai_caption || c.media.filename,
  }));

  return {
    hits,
    usedAiVerify: false,
    usedEmbeddings: Boolean(queryVec),
    pendingCount,
    hasApiKey,
    warning,
  };
}

export function findSimilarMedia(mediaId: number, limit = 18): SearchHit[] {
  const target = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as unknown as
    | MediaRow
    | undefined;
  if (!target) return [];

  const others = db
    .prepare('SELECT * FROM media WHERE id != ?')
    .all(mediaId) as unknown as MediaRow[];

  let targetVec: number[] | null = null;
  if (target.embedding_json) {
    try {
      targetVec = JSON.parse(target.embedding_json) as number[];
    } catch {
      targetVec = null;
    }
  }

  let targetTags: string[] = [];
  try {
    targetTags = JSON.parse(target.ai_tags_json || '[]');
  } catch {
    targetTags = [];
  }
  const targetTagSet = new Set(targetTags);

  const scored = others.map((row) => {
    let score = 0;
    if (targetVec && row.embedding_json) {
      try {
        const vec = JSON.parse(row.embedding_json) as number[];
        score = cosineSimilarity(targetVec, vec);
      } catch {
        score = 0;
      }
    } else {
      let rowTags: string[] = [];
      try {
        rowTags = JSON.parse(row.ai_tags_json || '[]');
      } catch {
        rowTags = [];
      }
      const overlap = rowTags.filter((t) => targetTagSet.has(t)).length;
      const catBonus = row.ai_category && row.ai_category === target.ai_category ? 0.35 : 0;
      score = (targetTagSet.size > 0 ? overlap / targetTagSet.size : 0) * 0.65 + catBonus;
    }
    return {
      media: row,
      score: Math.round(score * 100),
      matchReason: row.ai_caption || row.filename,
    };
  });

  return scored
    .filter((s) => s.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
