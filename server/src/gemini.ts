import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { AppSettings, loadSettings, THUMBS_DIR } from './config.js';
import { db, MediaRow, syncMediaFts } from './db.js';
import type { DuplicatePolicy, FilenamePattern } from './sorter.js';

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

const FALLBACK_VISION_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-2.5-flash',
];

function getVisionModelChain(preferred: string): string[] {
  return Array.from(new Set([preferred, ...FALLBACK_VISION_MODELS].filter(Boolean)));
}

function isRetryableModelError(msg: string): boolean {
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('404') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('UNAVAILABLE') ||
    msg.toLowerCase().includes('quota') ||
    msg.toLowerCase().includes('high demand')
  );
}

async function withVisionFallback<T>(
  settings: AppSettings,
  fn: (client: GoogleGenAI, model: string) => Promise<T>
): Promise<{ result: T; modelUsed: string }> {
  const models = getVisionModelChain(settings.visionModel);
  let lastErr: unknown;

  for (const model of models) {
    try {
      const { result } = await withGeminiClient(settings, (client) => fn(client, model));
      return { result, modelUsed: model };
    } catch (err) {
      if (!lastErr) lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRetryableModelError(msg)) {
        throw err;
      }
      lastErr = err;
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
    const { result: modelOut } = await withVisionFallback(settings, async (client, model) => {
      const resp = await client.models.generateContent({
        model,
        contents: 'Reply with exactly: CONNECTED',
      });
      return { text: resp.text?.trim() || 'CONNECTED', model };
    });

    const isVertex = indexingState.resolvedEndpointMode === 'vertex';
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
      visionModel: modelOut.model,
      embeddingWorking,
      embeddingModelUsed,
      message: `Connected via ${isVertex ? 'Vertex AI Express Mode' : 'Gemini Developer API'} (${modelOut.model}: ${modelOut.text})`,
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

  const { result: parsed } = await withVisionFallback(settings, async (client, model) => {
    const resp = await client.models.generateContent({
      model,
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

  // Process up to 36 candidates in batches of 12 so large libraries don't miss matches
  const pool = candidates.slice(0, 36);
  const batches: MediaRow[][] = [];
  for (let i = 0; i < pool.length; i += 12) {
    batches.push(pool.slice(i, i + 12));
  }

  const batchResults = await Promise.all(
    batches.map(async (subset) => {
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        {
          text: `You are verifying search results for the user's photo/video search query: "${query}".
Inspect each numbered candidate thumbnail carefully. Score how accurately the image depicts what the user asked for (0 to 100).
Be accurate about subjects, poses, actions, and relationships (for example, if the user asks "sitting with dog", someone sitting with or beside a dog scores 80-100; a dog alone scores lower; unrelated images score < 25).
Return ONLY candidates with score >= 25, ordered from highest score to lowest.`,
        },
      ];

      let attached = 0;
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
        attached++;
      }

      if (attached === 0) return [];

      const { result } = await withVisionFallback(settings, async (client, model) => {
        const resp = await client.models.generateContent({
          model,
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
    })
  );

  return batchResults.flat().sort((a, b) => b.score - a.score);
}

async function persistAiResult(row: MediaRow, parsed: AiAnalysisResult, settings: AppSettings): Promise<void> {
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

async function analyzePhotoBatch(rows: MediaRow[]): Promise<number[]> {
  const settings = loadSettings();
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: `Analyze each numbered photo below for a personal photo search engine.
For EVERY photo ID, describe exact subjects, poses/actions (e.g., "person sitting with a brown dog"), setting, mood, and visible text.
Return a JSON object with an "items" array containing an entry for every Photo ID provided.`,
    },
  ];

  const validRows: MediaRow[] = [];
  for (const row of rows) {
    const imgParts = loadThumbPartsForMedia(row);
    if (imgParts.length === 0) continue;
    validRows.push(row);
    parts.push({ text: `Photo ID ${row.id} (filename: ${row.filename}, date: ${row.captured_at.slice(0, 10)}):` });
    parts.push(imgParts[0]);
  }
  if (validRows.length === 0) return [];

  const batchSchema = {
    type: Type.OBJECT,
    properties: {
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.INTEGER },
            ...ANALYSIS_SCHEMA.properties,
          },
          required: ['id', ...ANALYSIS_SCHEMA.required],
        },
      },
    },
    required: ['items'],
  };

  const { result } = await withVisionFallback(settings, async (client, model) => {
    const resp = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: batchSchema,
        temperature: 0.2,
      },
    });
    const parsed = JSON.parse(resp.text?.trim() || '{"items":[]}') as {
      items: Array<AiAnalysisResult & { id: number }>;
    };
    return parsed.items || [];
  });

  const byId = new Map(validRows.map((r) => [r.id, r]));
  const succeededIds: number[] = [];
  for (const entry of result) {
    const row = byId.get(entry.id);
    if (row) {
      await persistAiResult(row, entry, settings);
      succeededIds.push(row.id);
    }
  }
  return succeededIds;
}

export function pauseIndexing(): void {
  stopRequested = true;
  indexingState.paused = true;
}

export async function startIndexingQueue(
  includeErrors = false,
  onBatchComplete?: (mediaIds: number[]) => void
): Promise<void> {
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

    const photos = rows.filter((r) => r.media_type === 'photo');
    const videos = rows.filter((r) => r.media_type === 'video');

    // Batch photos in groups of 6 to save 6x Gemini API quota
    const photoBatches: MediaRow[][] = [];
    for (let i = 0; i < photos.length; i += 6) {
      photoBatches.push(photos.slice(i, i + 6));
    }

    for (const batch of photoBatches) {
      if (stopRequested) break;
      indexingState.currentFilename = `${batch[0].filename} (+${Math.max(0, batch.length - 1)})`;
      for (const r of batch) {
        db.prepare(`UPDATE media SET ai_status = 'processing' WHERE id = ?`).run(r.id);
      }

      try {
        const doneIds = new Set(await analyzePhotoBatch(batch));
        const completedBatchIds: number[] = [];
        for (const r of batch) {
          if (doneIds.has(r.id)) {
            indexingState.succeededInRun++;
            indexingState.processedInRun++;
            completedBatchIds.push(r.id);
          } else {
            try {
              await analyzeMediaItem(r);
              indexingState.succeededInRun++;
              completedBatchIds.push(r.id);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              indexingState.failedInRun++;
              indexingState.lastError = msg;
              db.prepare(`UPDATE media SET ai_status = 'error', ai_error = ? WHERE id = ?`).run(
                msg,
                r.id
              );
            } finally {
              indexingState.processedInRun++;
            }
          }
        }
        if (onBatchComplete && completedBatchIds.length > 0) {
          try {
            onBatchComplete(completedBatchIds);
          } catch {
            // ignore hook errors
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        indexingState.lastError = msg;
        for (const r of batch) {
          indexingState.failedInRun++;
          indexingState.processedInRun++;
          db.prepare(`UPDATE media SET ai_status = 'error', ai_error = ? WHERE id = ?`).run(
            msg,
            r.id
          );
        }
        if (msg.includes('429')) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    // Videos use 3 keyframes each, analyzed individually
    const concurrency = Math.max(1, Math.min(4, settings.concurrency || 2));
    let vCursor = 0;
    async function videoWorker(): Promise<void> {
      while (!stopRequested) {
        const idx = vCursor++;
        if (idx >= videos.length) break;
        const item = videos[idx];
        indexingState.currentFilename = item.filename;
        db.prepare(`UPDATE media SET ai_status = 'processing' WHERE id = ?`).run(item.id);
        try {
          await analyzeMediaItem(item);
          indexingState.succeededInRun++;
          if (onBatchComplete) {
            try {
              onBatchComplete([item.id]);
            } catch {
              // ignore
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          indexingState.failedInRun++;
          indexingState.lastError = msg;
          db.prepare(`UPDATE media SET ai_status = 'error', ai_error = ? WHERE id = ?`).run(
            msg,
            item.id
          );
        } finally {
          indexingState.processedInRun++;
        }
      }
    }
    if (videos.length > 0) {
      await Promise.all(Array.from({ length: concurrency }, () => videoWorker()));
    }
  } finally {
    db.prepare(`UPDATE media SET ai_status = 'pending' WHERE ai_status = 'processing'`).run();
    indexingState.running = false;
    indexingState.currentFilename = null;
  }
}

export interface ParsedSortPromptResult {
  folderPattern: string;
  filenamePattern: FilenamePattern;
  mediaFilter: 'all' | 'photo' | 'video';
  duplicatePolicy: DuplicatePolicy;
  separateScreenshots: boolean;
  classifyFirst: boolean;
  mode: 'copy' | 'move';
  explanation: string;
  usedGemini: boolean;
}

function parseSortPromptLocally(prompt: string): ParsedSortPromptResult {
  const q = prompt.toLowerCase();
  const segments: string[] = [];

  if (/\b(separate|split|by)\b.*\b(photo|video|media|type)\b/.test(q) || /\bphotos?\s*(and|&)\s*videos?\b/.test(q)) {
    segments.push('{type}');
  }
  if (/\b(category|categories|topic|subject|event|scene|ai|dog|pet|people|travel)\b/.test(q)) {
    segments.push('{category}');
  }
  if (/\byear\b/.test(q)) segments.push('{year}');
  if (/\bmonth\b/.test(q)) segments.push('{month_name}');
  if (/\b(day|daily|date)\b/.test(q) && !/\bmonth\b/.test(q)) segments.push('{day}');
  if (/\b(camera|device|phone|iphone|lens)\b/.test(q)) segments.push('{camera}');
  if (/\b(orientation|portrait|landscape|square)\b/.test(q)) segments.push('{orientation}');
  if (/\b(resolution|4k|hd|quality)\b/.test(q)) segments.push('{resolution}');
  if (/\b(extension|format|jpg|png|mp4|raw)\b/.test(q)) segments.push('{extension}');
  if (/\b(source|original folder)\b/.test(q)) segments.push('{source}');

  if (segments.length === 0) {
    segments.push('{type}', '{year}', '{month_name}');
  }

  const filenamePattern: FilenamePattern = /\b(caption|describe|description)\b/.test(q)
    ? 'date_caption'
    : /\b(sequence|number|numbered|0001)\b/.test(q)
      ? 'sequence'
      : /\b(rename|date.*name|prefix.*date|with date)\b/.test(q)
        ? 'date_original'
        : 'original';

  const mediaFilter: 'all' | 'photo' | 'video' =
    /\bonly\s+photos?\b|\bphotos?\s+only\b/.test(q)
      ? 'photo'
      : /\bonly\s+videos?\b|\bvideos?\s+only\b/.test(q)
        ? 'video'
        : 'all';

  const duplicatePolicy: DuplicatePolicy = /\b(skip|ignore|drop)\b.*\bdup/.test(q)
    ? 'skip'
    : /\b(separate|folder|isolate|move)\b.*\bdup/.test(q)
      ? 'separate_folder'
      : 'rename';

  const separateScreenshots = !/\b(don'?t|do not|no)\b.*\bscreenshot/.test(q) && /\bscreenshot/.test(q);
  const classifyFirst = segments.includes('{category}') || filenamePattern === 'date_caption' || /\bai\b|\bclassify\b/.test(q);
  const mode: 'copy' | 'move' = /\bcopy\b|\bkeep original/.test(q) ? 'copy' : 'move';
  const folderPattern = segments.join('/');

  return {
    folderPattern,
    filenamePattern,
    mediaFilter,
    duplicatePolicy,
    separateScreenshots,
    classifyFirst,
    mode,
    explanation: `Parsed rule: ${folderPattern} (${mode}, naming: ${filenamePattern}, duplicates: ${duplicatePolicy}).`,
    usedGemini: false,
  };
}

export async function parseSortPromptWithGemini(prompt: string): Promise<ParsedSortPromptResult> {
  const clean = prompt.trim();
  if (!clean) {
    throw new Error('Please enter sorting instructions.');
  }

  const settings = loadSettings();
  if (!settings.apiKey) {
    return parseSortPromptLocally(clean);
  }

  const promptSchema = {
    type: Type.OBJECT,
    properties: {
      folderPattern: {
        type: Type.STRING,
        description:
          'Slash-separated folder template using supported tokens: {type}, {year}, {month_name}, {month}, {day}, {category}, {camera}, {orientation}, {resolution}, {extension}, {source}, and optional literal folder names.',
      },
      filenamePattern: {
        type: Type.STRING,
        description: 'One of: original, date_original, date_caption, sequence',
      },
      mediaFilter: {
        type: Type.STRING,
        description: 'One of: all, photo, video',
      },
      duplicatePolicy: {
        type: Type.STRING,
        description: 'One of: rename, separate_folder, skip',
      },
      separateScreenshots: {
        type: Type.BOOLEAN,
        description: 'True if screenshots should be routed into Screenshots/ folder',
      },
      classifyFirst: {
        type: Type.BOOLEAN,
        description: 'True if AI categorization or AI captions are needed before sorting',
      },
      mode: {
        type: Type.STRING,
        description: 'One of: move, copy',
      },
      explanation: {
        type: Type.STRING,
        description: 'Concise 1-sentence confirmation of the exact sorting rule created.',
      },
    },
    required: [
      'folderPattern',
      'filenamePattern',
      'mediaFilter',
      'duplicatePolicy',
      'separateScreenshots',
      'classifyFirst',
      'mode',
      'explanation',
    ],
  };

  const sysPrompt = `Convert the user's plain-English photo & video sorting request into structured parameters for our file organizer.
Available folder tokens (combine with "/"):
- {type} -> "Photos" or "Videos"
- {year} -> 4-digit year (e.g. 2026)
- {month_name} -> "01_January" .. "12_December"
- {month} -> "01" .. "12"
- {day} -> "YYYY-MM-DD"
- {category} -> AI smart category (e.g. "Pets & Animals", "Travel & Nature", "People & Portraits", "Documents & Receipts")
- {camera} -> Camera make & model
- {orientation} -> "Landscape", "Portrait", or "Square"
- {resolution} -> "4K & Ultra-HD", "Full HD (1080p+)", or "Standard Res"
- {extension} -> File extension ("JPG", "PNG", "MP4", etc.)
- {source} -> Original connected folder name
You may also include literal folder prefixes if the user asks for a named root folder (e.g. "FamilyArchive/{year}/{category}").
Rules:
- filenamePattern must be one of: "original", "date_original", "date_caption", "sequence".
- mediaFilter must be one of: "all", "photo", "video".
- duplicatePolicy must be one of: "rename", "separate_folder", "skip".
- mode must be "move" unless user explicitly asks to copy or keep originals.
- Set classifyFirst=true whenever {category} or date_caption is used.
User request: "${clean}"`;

  try {
    const { result } = await withVisionFallback(settings, async (client, model) => {
      const resp = await client.models.generateContent({
        model,
        contents: sysPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: promptSchema,
          temperature: 0.1,
        },
      });
      return JSON.parse(resp.text?.trim() || '{}') as Omit<ParsedSortPromptResult, 'usedGemini'>;
    });

    const validFilename: FilenamePattern[] = ['original', 'date_original', 'date_caption', 'sequence'];
    const validFilter: Array<'all' | 'photo' | 'video'> = ['all', 'photo', 'video'];
    const validDup: DuplicatePolicy[] = ['rename', 'separate_folder', 'skip'];

    return {
      folderPattern: result.folderPattern?.trim() || '{type}/{year}/{month_name}',
      filenamePattern: validFilename.includes(result.filenamePattern)
        ? result.filenamePattern
        : 'original',
      mediaFilter: validFilter.includes(result.mediaFilter) ? result.mediaFilter : 'all',
      duplicatePolicy: validDup.includes(result.duplicatePolicy)
        ? result.duplicatePolicy
        : 'rename',
      separateScreenshots: Boolean(result.separateScreenshots),
      classifyFirst: Boolean(result.classifyFirst),
      mode: result.mode === 'copy' ? 'copy' : 'move',
      explanation: result.explanation || `Folder rule: ${result.folderPattern}`,
      usedGemini: true,
    };
  } catch {
    return parseSortPromptLocally(clean);
  }
}
