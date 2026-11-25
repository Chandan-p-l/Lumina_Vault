import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, ShieldAlert, X } from 'lucide-react';
import { api } from '../api';
import type { SettingsData } from '../types';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [newApiKey, setNewApiKey] = useState('');
  const [apiMode, setApiMode] = useState<'auto' | 'gemini' | 'vertex'>('auto');
  const [visionModel, setVisionModel] = useState('gemini-2.5-flash');
  const [concurrency, setConcurrency] = useState(3);
  const [autoIndexOnScan, setAutoIndexOnScan] = useState(true);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setNewApiKey('');
    api.getSettings().then((data) => {
      setSettings(data);
      setApiMode(data.apiMode);
      setVisionModel(data.visionModel);
      setConcurrency(data.concurrency);
      setAutoIndexOnScan(data.autoIndexOnScan);
    });
  }, [open]);

  if (!open) return null;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testSettings({
        apiKey: newApiKey.trim() || undefined,
        apiMode,
      });
      setTestResult({
        ok: res.ok,
        message: `${res.message}${
          res.embeddingWorking
            ? ` • Embeddings active (${res.embeddingModelUsed})`
            : ' • Fallback hybrid text+vision search active'
        }`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveSettings({
        ...(newApiKey.trim() ? { apiKey: newApiKey.trim() } : {}),
        apiMode,
        visionModel,
        concurrency,
        autoIndexOnScan,
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-violet-500/15 text-violet-300">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-base text-zinc-100">
                Gemini AI & Vault Settings
              </h2>
              <p className="text-xs text-zinc-400">
                Stored securely on your local backend (.env / .photovault)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Gemini API Key
            </label>
            {settings?.hasApiKey && (
              <p className="text-xs text-zinc-400">
                Current key: <code className="text-emerald-400">{settings.maskedApiKey}</code>
              </p>
            )}
            <input
              type="password"
              value={newApiKey}
              onChange={(e) => setNewApiKey(e.target.value)}
              placeholder="Paste a new key to replace current key..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-100 outline-none focus:border-violet-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                API Endpoint Mode
              </label>
              <select
                value={apiMode}
                onChange={(e) => setApiMode(e.target.value as 'auto' | 'gemini' | 'vertex')}
                className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 outline-none"
              >
                <option value="auto">Auto Detect (Recommended)</option>
                <option value="gemini">Gemini Developer API</option>
                <option value="vertex">Vertex AI Express Mode</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Vision Model
              </label>
              <select
                value={visionModel}
                onChange={(e) => setVisionModel(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 outline-none"
              >
                <option value="gemini-2.5-flash">gemini-2.5-flash (Fast & Accurate)</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro (Deep Reasoning)</option>
                <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-2xl bg-zinc-900/60 border border-zinc-800">
            <div>
              <p className="text-xs font-medium text-zinc-200">Auto-index with Gemini on scan</p>
              <p className="text-[11px] text-zinc-500">
                Automatically analyze new photos & video frames when a folder is connected
              </p>
            </div>
            <input
              type="checkbox"
              checked={autoIndexOnScan}
              onChange={(e) => setAutoIndexOnScan(e.target.checked)}
              className="w-4 h-4 accent-violet-500 cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-zinc-400">
              <span>Parallel AI Workers</span>
              <span className="text-zinc-200 font-semibold">{concurrency}</span>
            </div>
            <input
              type="range"
              min={1}
              max={6}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
                testResult.ok
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer"
          >
            {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Test Gemini Connection
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-xs font-medium text-zinc-300 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-semibold text-white cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
