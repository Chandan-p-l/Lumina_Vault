import { db, MediaRow } from './db.js';
import { embedText, verifyCandidatesWithGemini } from './gemini.js';

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

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function lexicalScore(row: MediaRow, keywords: string[]): number {
  if (keywords.length === 0) return 0;
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

  let matched = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) matched++;
  }
  return matched / keywords.length;
}

export async function semanticSearch(options: SearchOptions): Promise<{
  hits: SearchHit[];
  usedAiVerify: boolean;
  usedEmbeddings: boolean;
}> {
  const limit = options.limit || 60;
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
    };
  }

  const keywords = extractKeywords(query);

  // Detect implicit media-type hint if user explicitly wrote "video" or "photo"
  const qLower = query.toLowerCase();
  const wantsVideo = /\bvideos?\b/.test(qLower);
  const wantsPhoto = /\b(photos?|pictures?|images?)\b/.test(qLower);

  // FTS5 fast boost map
  const ftsScores = new Map<number, number>();
  if (keywords.length > 0) {
    try {
      const ftsQuery = keywords.map((k) => `"${k}"*`).join(' OR ');
      const ftsRows = db
        .prepare('SELECT media_id, bm25(media_fts) as rank FROM media_fts WHERE media_fts MATCH ? LIMIT 200')
        .all(ftsQuery) as Array<{ media_id: number; rank: number }>;
      for (const r of ftsRows) {
        // bm25 is negative (more negative = better)
        ftsScores.set(r.media_id, Math.min(1, Math.abs(r.rank) / 10 + 0.35));
      }
    } catch {
      // ignore malformed FTS syntax
    }
  }

  // Query embedding
  let queryVec: number[] | null = null;
  try {
    const emb = await embedText(query);
    if (emb) queryVec = emb.vector;
  } catch {
    queryVec = null;
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

    const lex = lexicalScore(row, keywords);
    const fts = ftsScores.get(row.id) || 0;

    let typeBonus = 0;
    if (wantsVideo && row.media_type === 'video') typeBonus = 0.08;
    if (wantsPhoto && row.media_type === 'photo') typeBonus = 0.05;

    const combined =
      queryVec && row.embedding_json
        ? vecSim * 0.62 + lex * 0.25 + fts * 0.13 + typeBonus
        : lex * 0.65 + fts * 0.35 + typeBonus;

    return {
      media: row,
      rawScore: combined,
      lex,
      vecSim,
    };
  });

  scored.sort((a, b) => b.rawScore - a.rawScore);

  const candidates = scored
    .filter((s) => s.rawScore > (queryVec ? 0.22 : 0.08))
    .slice(0, 24);

  // If no strong indexed matches yet, pass recent/unindexed items if AI verify is requested
  const verifyPool =
    candidates.length > 0
      ? candidates.map((c) => c.media)
      : options.aiVerify
        ? allRows.slice(0, 12)
        : [];

  if (options.aiVerify && verifyPool.length > 0) {
    try {
      const verified = await verifyCandidatesWithGemini(query, verifyPool);
      if (verified.length > 0) {
        const byId = new Map(verifyPool.map((m) => [m.id, m]));
        const verifiedHits: SearchHit[] = [];
        for (const v of verified.sort((a, b) => b.score - a.score)) {
          const media = byId.get(v.id);
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
          };
        }
      }
    } catch (err) {
      console.warn('Gemini verify fallback to hybrid scores:', err);
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
  };
}

export function findSimilarMedia(mediaId: number, limit = 18): SearchHit[] {
  const target = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId) as
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
