import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { AppSettings, loadSettings, THUMBS_DIR } from './config.js';
import { db, MediaRow, syncMediaFts } from './db.js';

export interface AiAnalysisResult {
  caption: string;
  peopleAndPets: string;
  category: string;
  tags: string[];
  objects: string[];
  mood: string;
  visibleText: string;
}

export interface IndexingState {
  running: boolean;
  paused: boolean;
  totalPending: number;
  processedInRun: number;
  succeededInRun: number;
  failedInRun: number;
  currentFilename: string | null;
  lastError: string | null;
  resolvedEndpointMode: 'gemini' | 'vertex' | null;
}

export const indexingState: IndexingState = {
  running: false,
  paused: false,
  totalPending: 0,
  processedInRun: 0,
  succeededInRun: 0,
  failedInRun: 0,
  currentFilename: null,
  lastError: null,
  resolvedEndpointMode: null,
};

let stopRequested = false;

function buildClient(apiKey: string, useVertex: boolean): GoogleGenAI {
  if (useVertex) {
    return new GoogleGenAI({ vertexai: true, apiKey });
  }
  return new GoogleGenAI({ apiKey });
}

function getEndpointOrder(settings: AppSettings): boolean[] {
  if (settings.apiMode === 'vertex') return [true];
  if (settings.apiMode === 'gemini') return [false];
  if (indexingState.resolvedEndpointMode === 'vertex') return [true, false];
  if (indexingState.resolvedEndpointMode === 'gemini') return [false, true];
  // Try Gemini Developer API first, then Vertex AI Express Mode fallback
  return [false, true];
}

async function withGeminiClient<T>(
  settings: AppSettings,
  fn: (client: GoogleGenAI, isVertex: boolean) => Promise<T>
): Promise<{ result: T; isVertex: boolean }> {
  if (!settings.apiKey) {
    throw new Error('Gemini API key is not configured. Open Settings to add your API key.');
  }

  const order = getEndpointOrder(settings);
  let lastErr: unknown;

  for (const useVertex of order) {
    try {
      const client = buildClient(settings.apiKey, useVertex);
      const result = await fn(client, useVertex);
      indexingState.resolvedEndpointMode = useVertex ? 'vertex' : 'gemini';
      return { result, isVertex: useVertex };
    } catch (err) {
      if (!lastErr) lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Only fall back to the alternate endpoint on auth/key-mode mismatch errors
      const isKeyMismatch =
        msg.includes('API_KEY_INVALID') ||
        msg.includes('API key not valid') ||
        msg.includes('401') ||
        msg.includes('UNAUTHENTICATED');
      if (!isKeyMismatch) {
        throw err;
      }
    }
  }

  throw lastErr;
}

export async function testGeminiConnection(overrideSettings?: Partial<AppSettings>): Promise<{
  ok: boolean;
  mode: 'vertex' | 'gemini' | null;
  visionModel: string;
  embeddingWorking: boolean;
  embeddingModelUsed: string | null;
  message: string;
}> {
  const settings = { ...loadSettings(), ...overrideSettings };
  try {
    const { result, isVertex } = await withGeminiClient(settings, async (client) => {
      const resp = await client.models.generateContent({
        model: settings.visionModel,
        contents: 'Reply with exactly: CONNECTED',
      });
      return resp.text?.trim() || 'CONNECTED';
    });

    let embeddingWorking = false;
    let embeddingModelUsed: string | null = null;
    try {
      const emb = await embedText('test photo of a dog', settings);
      if (emb && emb.vector.length > 0) {
        embeddingWorking = true;
        embeddingModelUsed = emb.model;
      }
    } catch {
      embeddingWorking = false;
    }

    return {
      ok: true,
      mode: isVertex ? 'vertex' : 'gemini',
      visionModel: settings.visionModel,
      embeddingWorking,
      embeddingModelUsed,
      message: `Connected via ${isVertex ? 'Vertex AI Express Mode' : 'Gemini Developer API'} (${result})`,
    };
  } catch (err) {
    return {
      ok: false,
      mode: null,
      visionModel: settings.visionModel,
      embeddingWorking: false,
      embeddingModelUsed: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function embedText(
  text: string,
  overrideSettings?: AppSettings
): Promise<{ vector: number[]; model: string } | null> {
  const settings = overrideSettings || loadSettings();
  if (!settings.apiKey || !text.trim()) return null;

  const candidateModels = Array.from(
    new Set([settings.embeddingModel, 'text-embedding-004', 'gemini-embedding-001'])
  );

  for (const model of candidateModels) {
    try {
      const { result } = await withGeminiClient(settings, async (client) => {
        const resp = await client.models.embedContent({
          model,
          contents: text,
        });
        const values = resp.embeddings?.[0]?.values;
        if (!values || values.length === 0) {
          throw new Error('Empty embedding values');
        }
        return values;
      });
      return { vector: result, model };
    } catch {
      // try next embedding model
    }
  }
  return null;
}

const ANALYSIS_PROMPT = `Analyze this photo or video keyframes carefully for a personal photo & video search engine.
Describe exact actions, poses, relationships between people and animals/objects (e.g. "person sitting on grass with a brown dog", "woman holding a coffee cup"), setting, clothing, colors, mood, and any visible text.
Return strict JSON matching the schema.`;

const ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    caption: {
      type: Type.STRING,
      description: 'Detailed 1-2 sentence description of the scene, people, animals, actions, poses, and environment.',
    },
    peopleAndPets: {
      type: Type.STRING,
      description: 'Who or what animals are in the scene and what they are doing together. Empty string if none.',
    },
    category: {
      type: Type.STRING,
      description:
        'Best single category from: Pets & Animals, People & Portraits, Travel & Nature, Food & Dining, Events & Celebrations, Documents & Receipts, Screenshots & UI, Vehicles & Urban, Art & Creative, Indoor & Home, Other.',
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '6 to 12 concise lowercase search tags including objects, actions, animals, setting, colors.',
    },
    objects: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Key visible objects in the scene.',
    },
    mood: {
      type: Type.STRING,
      description: '1-3 words describing mood or lighting (e.g. "warm, candid, sunny").',
    },
    visibleText: {
      type: Type.STRING,
      description: 'Any legible text, signs, or document text visible in the image. Empty string if none.',
    },
  },
  required: ['caption', 'peopleAndPets', 'category', 'tags', 'objects', 'mood', 'visibleText'],
};

function loadThumbPartsForMedia(row: MediaRow): Array<{ inlineData: { mimeType: string; data: string } }> {
  const parts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

  if (row.media_type === 'video') {
    let keyframes: string[] = [];
    try {
      keyframes = JSON.parse(row.keyframes_json || '[]');
    } catch {
      keyframes = [];
    }
    for (const kf of keyframes.slice(0, 3)) {
      const full = path.join(THUMBS_DIR, kf);
      if (fs.existsSync(full)) {
        parts.push({
          inlineData: {
            mimeType: 'image/webp',
            data: fs.readFileSync(full).toString('base64'),
          },
        });
      }
    }
  }

  if (parts.length === 0 && row.thumb_path) {
    const full = path.join(THUMBS_DIR, row.thumb_path);
    if (fs.existsSync(full)) {
      parts.push({
        inlineData: {
          mimeType: 'image/webp',
          data: fs.readFileSync(full).toString('base64'),
        },
      });
    }
  }

  return parts;
}

export async function analyzeMediaItem(row: MediaRow): Promise<void> {
  const settings = loadSettings();
  const imageParts = loadThumbPartsForMedia(row);

  if (imageParts.length === 0) {
    throw new Error(`No thumbnail available for ${row.filename}`);
  }

  const contextHint =
    row.media_type === 'video'
      ? `These are ${imageParts.length} sequential keyframes from a video named "${row.filename}" captured on ${row.captured_at.slice(0, 10)}.`
      : `Photo named "${row.filename}" captured on ${row.captured_at.slice(0, 10)}.`;

  const { result: parsed } = await withGeminiClient(settings, async (client) => {
    const resp = await client.models.generateContent({
      model: settings.visionModel,
      contents: [
        {
          role: 'user',
          parts: [
            ...imageParts,
            { text: `${ANALYSIS_PROMPT}\nContext: ${contextHint}` },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: ANALYSIS_SCHEMA,
        temperature: 0.2,
      },
    });

    const raw = resp.text?.trim() || '{}';
    return JSON.parse(raw) as AiAnalysisResult;
  });

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : [];
  const objects = Array.isArray(parsed.objects)
    ? parsed.objects.map((o) => String(o).trim().toLowerCase()).filter(Boolean)
    : [];

  const embeddingInput = [
    parsed.caption,
    parsed.peopleAndPets,
    parsed.category,
    tags.join(', '),
    objects.join(', '),
    parsed.visibleText,
    row.media_type,
    String(row.year),
  ]
    .filter(Boolean)
    .join(' | ');

  let embeddingVector: number[] | null = null;
  try {
    const emb = await embedText(embeddingInput, settings);
    if (emb) embeddingVector = emb.vector;
  } catch {
    embeddingVector = null;
  }

  db.prepare(
    `UPDATE media SET
      ai_status = 'indexed',
      ai_error = NULL,
      ai_caption = ?,
      ai_tags_json = ?,
      ai_category = ?,
      ai_objects_json = ?,
      ai_people_pets = ?,
      ai_mood = ?,
      ai_text_ocr = ?,
      embedding_json = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    parsed.caption || '',
    JSON.stringify(tags),
    parsed.category || 'Other',
    JSON.stringify(objects),
    parsed.peopleAndPets || '',
    parsed.mood || '',
    parsed.visibleText || '',
    embeddingVector ? JSON.stringify(embeddingVector) : null,
    new Date().toISOString(),
    row.id
  );

  syncMediaFts(row.id);
}

export async function verifyCandidatesWithGemini(
  query: string,
  candidates: MediaRow[]
): Promise<Array<{ id: number; score: number; reason: string }>> {
  const settings = loadSettings();
  if (!settings.apiKey || candidates.length === 0) return [];

  const subset = candidates.slice(0, 12);
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `You are verifying search results for the user's photo/video search query: "${query}".
Inspect each numbered candidate thumbnail carefully. Score how accurately the image depicts what the user asked for (0 to 100).
Be strict about poses, actions, and relationships (for example, if the user asks "sitting with dog", a photo with only a dog or someone standing far away scores lower than someone actually sitting with a dog).
Return ONLY candidates with score >= 35, ordered from highest score to lowest.`,
    },
  ];

  for (const item of subset) {
    if (!item.thumb_path) continue;
    const full = path.join(THUMBS_DIR, item.thumb_path);
    if (!fs.existsSync(full)) continue;
    parts.push({ text: `Candidate ID ${item.id} (${item.media_type}, ${item.filename}):` });
    parts.push({
      inlineData: {
        mimeType: 'image/webp',
        data: fs.readFileSync(full).toString('base64'),
      },
    });
  }

  const verifySchema = {
    type: Type.OBJECT,
    properties: {
      matches: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER },
            score: { type: Type.INTEGER },
            reason: { type: Type.STRING },
          },
          required: ['id', 'score', 'reason'],
        },
      },
    },
    required: ['matches'],
  };

  const { result } = await withGeminiClient(settings, async (client) => {
    const resp = await client.models.generateContent({
      model: settings.visionModel,
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: verifySchema,
        temperature: 0.1,
      },
    });
    const parsed = JSON.parse(resp.text?.trim() || '{"matches":[]}') as {
      matches: Array<{ id: number; score: number; reason: string }>;
    };
    return parsed.matches || [];
  });

  return result;
}

export function pauseIndexing(): void {
  stopRequested = true;
  indexingState.paused = true;
}

export async function startIndexingQueue(includeErrors = false): Promise<void> {
  if (indexingState.running) return;
  const settings = loadSettings();
  if (!settings.apiKey) {
    indexingState.lastError = 'No Gemini API key configured.';
    return;
  }

  stopRequested = false;
  indexingState.running = true;
  indexingState.paused = false;
  indexingState.processedInRun = 0;
  indexingState.succeededInRun = 0;
  indexingState.failedInRun = 0;
  indexingState.lastError = null;

  try {
    const statusFilter = includeErrors ? `ai_status IN ('pending', 'error')` : `ai_status = 'pending'`;
    const rows = db
      .prepare(`SELECT * FROM media WHERE ${statusFilter} ORDER BY captured_at DESC`)
      .all() as unknown as MediaRow[];

    indexingState.totalPending = rows.length;
    if (rows.length === 0) return;

    const concurrency = Math.max(1, Math.min(6, settings.concurrency || 3));
    let cursor = 0;

    async function worker(): Promise<void> {
      while (!stopRequested) {
        const idx = cursor++;
        if (idx >= rows.length) break;
        const item = rows[idx];
        indexingState.currentFilename = item.filename;
        db.prepare(`UPDATE media SET ai_status = 'processing' WHERE id = ?`).run(item.id);

        try {
          await analyzeMediaItem(item);
          indexingState.succeededInRun++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          indexingState.failedInRun++;
          indexingState.lastError = msg;
          db.prepare(`UPDATE media SET ai_status = 'error', ai_error = ? WHERE id = ?`).run(
            msg,
            item.id
          );
          // Back off briefly if rate-limited
          if (msg.includes('429')) {
            await new Promise((r) => setTimeout(r, 3000));
          }
        } finally {
          indexingState.processedInRun++;
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  } finally {
    // Reset any items stuck in 'processing' if paused mid-flight
    db.prepare(`UPDATE media SET ai_status = 'pending' WHERE ai_status = 'processing'`).run();
    indexingState.running = false;
    indexingState.currentFilename = null;
  }
}
