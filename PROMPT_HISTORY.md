# Lumina Vault — Prompt History & Development Log

This document records the chronological prompts and engineering milestones used to build **Lumina Vault**, an AI-powered photo & video organizer and semantic search desktop/web application.

> **Security Note:** Any API credentials shared during setup are redacted (`[REDACTED_GEMINI_API_KEY]`). API keys are stored strictly in untracked local `.env` / OS user-data settings and excluded via `.gitignore`.

---

## Session Timeline

### 1. Architecture & Planning
**User Prompt:**
> "i wanted to build a website in which i can connect any folder and that will short all the photos videos propperly and even if we search find me a a photo where i am sitting with dog so that will be found out from entire shorted folders and the images using the gemini api and make one of the best ui/ux and the propper working `[REDACTED_GEMINI_API_KEY]` use this api key and before that tell me how this will be done in detail"

**Outcome:**
- Designed a local full-stack architecture (`React + TypeScript + Vite + Tailwind CSS` frontend, `Node.js + Express + TypeScript` backend, `node:sqlite` with FTS5, `sharp` + `exifr` + `ffmpeg`, and `@google/genai`).
- Planned a two-stage Gemini search pipeline (background multimodal captioning + vector embeddings, followed by hybrid FTS5/cosine retrieval + Gemini Vision verification) and safe dry-run/undo file sorting.

---

### 2. Initial Full-Stack Build
**User Prompt:**
> "ok so start building"

**Outcome:**
- Implemented backend modules: `config.ts`, `db.ts`, `fsBrowser.ts`, `scanner.ts`, `gemini.ts`, `search.ts`, `sorter.ts`, and `index.ts`.
- Implemented frontend gallery, search header, lightbox inspector, folder picker, sort studio, indexing HUD, and settings modal.
- Verified TypeScript/Vite build, thumbnail/keyframe generation, sort plan/undo, and live Gemini API connectivity.

---

### 3. Cross-Platform Linux & Windows Desktop Installers + Auto-Organize
**User Prompts:**
> "can we do like this so that we can install this application inside the linux and windows so that this tool can auto make the files and move the images in the seprate folders to organize the photos and the videos"
>
> "ok so do this"

**Outcome:**
- Added Electron desktop wrapper (`electron/main.cjs`, `electron/preload.cjs`) with native OS folder picker (`dialog.showOpenDialog`) and OS user-data storage (`LUMINA_DATA_DIR`).
- Bundled `@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe` and added Windows drive-letter browsing in `fsBrowser.ts`.
- Added automatic `Photos/` & `Videos/` subfolder creation and file moving (`autoOrganizeFolder`) plus live `fs.watch` folder monitoring (`server/src/watcher.ts`).
- Configured `electron-builder` for Linux (`.AppImage`, `.deb`) and Windows (`.exe` NSIS setup & portable) along with `.github/workflows/release.yml`.

---

### 4. Dynamic Editorial UI & Low-End Device Performance
**User Prompt:**
> "take this images as the refrence and make the ui Dynamic and refresing and use the frames to make the entire animation and the effects smooth so that it wont get lagg in any device even in low end devices" *(with 2 UI reference images)*

**Outcome:**
- Redesigned interface with dark studio grid aesthetics (`studio-grid-bg`), full-bleed `HeroShowcase.tsx`, and floating bottom navigation dock (`FloatingDock.tsx`).
- Added `requestAnimationFrame`-driven carousel/reveal hooks (`useFrameEffects.ts`), GPU-only `transform`/`opacity` animations, `content-visibility: auto`, incremental scroll windowing, and hover-intent video previews.

---

### 5. Minimal Branding, Central Media Cluster & Live Sorting Presentation
**User Prompt:**
> "remove the false icons and the logos which gives the application a ai generated feel take this refrences ince we add the folder the entire images and videos sghould comes in the centre and when we start the sorting then it should show the false folder generation and the image shorting in the screen just for the UI presentation and the real folder mkdir creation and the all image videos shorting will be done ate the background in the real time" *(with 3 UI reference images)*

**Outcome:**
- Removed all `Sparkles` icons and generic AI-style logo badges across the UI, replacing them with clean `LV / LUMINA` typographic branding.
- Added a central photo/video mosaic cluster in `HeroShowcase.tsx`.
- Created `SortingTheater.tsx` and real-time `sortProgress` tracking in `sorter.ts` so visual folder creation and animated file sorting play smoothly on screen while real `mkdir` and file moves run on disk in the background.

---

### 6. Image Finder Fixes + White Balance & 2D Image Spectrogram
**User Prompt:**
> "image finder is not working propperlly even in image details sho thw whict balance and the spectrogram of the image"

**Outcome:**
- Diagnosed Free-Tier `429` daily quota exhaustion on `gemini-2.5-flash`; switched default model to `gemini-3.5-flash-lite` with automatic fallback (`gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-flash-lite-latest` → `gemini-3.8-flash` → `gemini-2.5-flash`) and 6-photo batch indexing (`analyzePhotoBatch`).
- Updated `semanticSearch` and `App.tsx` to search across the entire vault, expand synonyms/stems, check unindexed items, and display actionable warnings.
- Added `/api/media/:id/telemetry` (EXIF White Balance + McCamy Kelvin CCT + RGB Gains + Exposure) and `ImageSpectrogramPanel.tsx` (Kelvin scale, RGB/Luminance Histogram, and 2D DFT Spatial-Frequency Spectrogram).

---

### 7. Custom Sorting Parameters & Plain-English Sort Prompt Builder
**User Prompts:**
> "i want that we can write the poaramenters in a normal primpting language and gemini will make it in language understood perameters"
>
> "i want each and every image should be propperlly shorted and also in in this make a changes so that we can set our own peramitters that how we wanted to short the images and videos" *(with UI screenshots)*

**Outcome:**
- Built a custom parameter template engine in `sorter.ts` supporting `{type}`, `{year}`, `{month_name}`, `{month}`, `{day}`, `{category}`, `{camera}`, `{orientation}`, `{resolution}`, `{extension}`, `{source}`, custom file naming rules, duplicate handling (`rename`, `separate_folder`, `skip`), screenshot separation, and `classifyFirst`.
- Added `parseSortPromptWithGemini` (`POST /api/sort/parse-prompt`) + natural-language prompt builder UI in `SortStudio.tsx` and `FolderPickerModal.tsx`.

---

### 8. Visible Grid Fix & Live On-Screen Sorting During Indexing
**User Prompt:**
> "while the indexing library all the images should get shorted on live screen images should be visible" *(with UI screenshot)*

**Outcome:**
- Fixed `.card-reveal` invisible-card bug in `index.css` so every image card remains visible at `opacity: 1` during live refreshes.
- Added **Live Sorted Folders** view in `MediaGrid.tsx` so images visibly group into category folders in real time as Gemini classifies each batch.
- Added incremental per-batch disk moves in `watcher.ts` + `gemini.ts` and fixed `scanProgress.scanning` clearing before background AI indexing in `scanner.ts`.

---

### 9. Prompt History Documentation & Git Push
**User Prompt:**
> "ok do one thing make the prompt history .md file as well as push and commit this"

**Outcome:**
- Added `PROMPT_HISTORY.md` and committed & pushed all changes cleanly to `origin/main`.
