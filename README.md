# Lumina Vault — AI Photo & Video Organizer

Connect any local folder on **Linux** or **Windows**, automatically organize photos and videos into separate folders, and search across everything using natural language with the **Gemini API** (e.g., `"find me a photo where I am sitting with dog"`).

## Quick Start (Web / Dev)

1. Verify `.env` contains your `GEMINI_API_KEY` (or configure it inside the app's **Settings** modal).
2. Run in development mode (API on `:4310`, Vite UI on `:5173`):
   ```bash
   npm run dev
   ```
3. Or build & run in desktop mode:
   ```bash
   npm run desktop
   ```

## Build Installers (Linux & Windows)

- **Linux (`.AppImage` & `.deb`)**:
  ```bash
  npm run dist:linux
  ```
  Outputs installers to `release/`.

- **Windows (`.exe` NSIS Setup & Portable)** (run on Windows, or via GitHub Actions `.github/workflows/release.yml`):
  ```bash
  npm run dist:win
  ```
# Lumina_Vault
