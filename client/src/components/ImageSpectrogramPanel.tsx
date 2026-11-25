import { useEffect, useRef, useState } from 'react';
import type { MediaTelemetry } from '../types';

interface ImageSpectrogramPanelProps {
  imageUrl: string | null;
  telemetry: MediaTelemetry | null;
  loadingTelemetry: boolean;
}

function formatShutter(sec: number | null): string | null {
  if (!sec || !Number.isFinite(sec)) return null;
  if (sec >= 1) return `${sec.toFixed(1)}s`;
  return `1/${Math.max(1, Math.round(1 / sec))}s`;
}

// Separable 2D DFT on a small N x N luminance grid (N=48 runs in ~2ms)
function compute2DSpectrum(luma: Float32Array, N: number): Float32Array {
  const realRow = new Float32Array(N * N);
  const imagRow = new Float32Array(N * N);
  const cosTable = new Float32Array(N * N);
  const sinTable = new Float32Array(N * N);

  for (let k = 0; k < N; k++) {
    for (let n = 0; n < N; n++) {
      const angle = (-2 * Math.PI * k * n) / N;
      cosTable[k * N + n] = Math.cos(angle);
      sinTable[k * N + n] = Math.sin(angle);
    }
  }

  // Row-wise 1D DFT
  for (let y = 0; y < N; y++) {
    const rowOff = y * N;
    for (let k = 0; k < N; k++) {
      let re = 0;
      let im = 0;
      const kOff = k * N;
      for (let x = 0; x < N; x++) {
        // Center shift (-1)^(x+y)
        const sign = (x + y) % 2 === 0 ? 1 : -1;
        const val = luma[rowOff + x] * sign;
        re += val * cosTable[kOff + x];
        im += val * sinTable[kOff + x];
      }
      realRow[rowOff + k] = re;
      imagRow[rowOff + k] = im;
    }
  }

  // Column-wise 1D DFT -> log magnitude
  const mag = new Float32Array(N * N);
  let maxMag = 0.0001;
  for (let x = 0; x < N; x++) {
    for (let ky = 0; ky < N; ky++) {
      let re = 0;
      let im = 0;
      const kOff = ky * N;
      for (let y = 0; y < N; y++) {
        const idx = y * N + x;
        const c = cosTable[kOff + y];
        const s = sinTable[kOff + y];
        re += realRow[idx] * c - imagRow[idx] * s;
        im += realRow[idx] * s + imagRow[idx] * c;
      }
      const m = Math.log1p(Math.hypot(re, im));
      mag[ky * N + x] = m;
      if (m > maxMag) maxMag = m;
    }
  }

  for (let i = 0; i < mag.length; i++) {
    mag[i] = mag[i] / maxMag;
  }
  return mag;
}

function heatColor(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  if (t < 0.28) {
    const k = t / 0.28;
    return [Math.round(12 + k * 68), Math.round(14 + k * 8), Math.round(22 + k * 115)];
  }
  if (t < 0.58) {
    const k = (t - 0.28) / 0.3;
    return [Math.round(80 + k * 140), Math.round(22 + k * 34), Math.round(137 - k * 70)];
  }
  if (t < 0.84) {
    const k = (t - 0.58) / 0.26;
    return [Math.round(220 + k * 35), Math.round(56 + k * 155), Math.round(67 - k * 35)];
  }
  const k = (t - 0.84) / 0.16;
  return [255, Math.round(211 + k * 44), Math.round(32 + k * 223)];
}

export function ImageSpectrogramPanel({
  imageUrl,
  telemetry,
  loadingTelemetry,
}: ImageSpectrogramPanelProps) {
  const histCanvasRef = useRef<HTMLCanvasElement>(null);
  const specCanvasRef = useRef<HTMLCanvasElement>(null);
  const [specReady, setSpecReady] = useState(false);

  useEffect(() => {
    setSpecReady(false);
    if (!imageUrl) return;
    let cancelled = false;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const N = 48;
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 160;
      sampleCanvas.height = 160;
      const sCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!sCtx) return;
      sCtx.drawImage(img, 0, 0, 160, 160);
      const imgData = sCtx.getImageData(0, 0, 160, 160).data;

      // 1. Compute RGB + Luminance Histogram
      const rBins = new Uint32Array(256);
      const gBins = new Uint32Array(256);
      const bBins = new Uint32Array(256);
      const lBins = new Uint32Array(256);

      for (let i = 0; i < imgData.length; i += 4) {
        const r = imgData[i];
        const g = imgData[i + 1];
        const b = imgData[i + 2];
        const l = Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
        rBins[r]++;
        gBins[g]++;
        bBins[b]++;
        lBins[l]++;
      }

      const hCanvas = histCanvasRef.current;
      if (hCanvas) {
        const hCtx = hCanvas.getContext('2d');
        if (hCtx) {
          const w = hCanvas.width;
          const h = hCanvas.height;
          hCtx.clearRect(0, 0, w, h);
          hCtx.fillStyle = '#090a0d';
          hCtx.fillRect(0, 0, w, h);

          // Subtle grid
          hCtx.strokeStyle = 'rgba(255,255,255,0.06)';
          hCtx.lineWidth = 1;
          for (let gx = 1; gx < 4; gx++) {
            const x = (w / 4) * gx;
            hCtx.beginPath();
            hCtx.moveTo(x, 0);
            hCtx.lineTo(x, h);
            hCtx.stroke();
          }

          let maxBin = 1;
          for (let i = 4; i < 252; i++) {
            maxBin = Math.max(maxBin, rBins[i], gBins[i], bBins[i], lBins[i]);
          }

          const drawChannel = (bins: Uint32Array, stroke: string, fill: string) => {
            hCtx.beginPath();
            hCtx.moveTo(0, h);
            for (let i = 0; i < 256; i++) {
              const x = (i / 255) * w;
              const norm = Math.min(1, bins[i] / maxBin);
              const y = h - norm * (h - 6);
              hCtx.lineTo(x, y);
            }
            hCtx.lineTo(w, h);
            hCtx.closePath();
            hCtx.fillStyle = fill;
            hCtx.fill();
            hCtx.strokeStyle = stroke;
            hCtx.lineWidth = 1.25;
            hCtx.stroke();
          };

          drawChannel(rBins, 'rgba(248,113,113,0.85)', 'rgba(248,113,113,0.14)');
          drawChannel(gBins, 'rgba(74,222,128,0.85)', 'rgba(74,222,128,0.14)');
          drawChannel(bBins, 'rgba(96,165,250,0.85)', 'rgba(96,165,250,0.14)');
          drawChannel(lBins, 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0.07)');
        }
      }

      // 2. Compute 2D Spatial-Frequency Spectrogram (48x48 DFT)
      const fCanvas = document.createElement('canvas');
      fCanvas.width = N;
      fCanvas.height = N;
      const fCtx = fCanvas.getContext('2d', { willReadFrequently: true });
      if (fCtx) {
        fCtx.drawImage(img, 0, 0, N, N);
        const fData = fCtx.getImageData(0, 0, N, N).data;
        const luma = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) {
          const p = i * 4;
          luma[i] = (0.2126 * fData[p] + 0.7152 * fData[p + 1] + 0.0722 * fData[p + 2]) / 255;
        }
        const mag = compute2DSpectrum(luma, N);

        const sCanvas = specCanvasRef.current;
        if (sCanvas) {
          const ctx = sCanvas.getContext('2d');
          if (ctx) {
            const outImg = ctx.createImageData(N, N);
            for (let i = 0; i < N * N; i++) {
              const [r, g, b] = heatColor(mag[i]);
              outImg.data[i * 4] = r;
              outImg.data[i * 4 + 1] = g;
              outImg.data[i * 4 + 2] = b;
              outImg.data[i * 4 + 3] = 255;
            }
            const tmp = document.createElement('canvas');
            tmp.width = N;
            tmp.height = N;
            tmp.getContext('2d')?.putImageData(outImg, 0, 0);
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(tmp, 0, 0, sCanvas.width, sCanvas.height);
          }
        }
      }

      setSpecReady(true);
    };
    img.src = imageUrl;

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  const wb = telemetry?.whiteBalance;
  const exp = telemetry?.exposure;
  const kelvinPos = wb ? Math.max(0, Math.min(100, ((wb.kelvin - 2000) / 8000) * 100)) : 45;
  const shutterStr = formatShutter(exp?.exposureTime ?? null);

  return (
    <div className="space-y-4">
      {/* White Balance & Exposure */}
      <div className="p-3.5 rounded-2xl bg-[#101216] border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            White Balance
          </h4>
          <span className="text-[11px] font-mono text-zinc-300">
            {loadingTelemetry ? '...' : wb ? `${wb.kelvin} K • ${wb.mode}` : '—'}
          </span>
        </div>

        {wb && (
          <>
            {/* Warm-to-Cool Kelvin Scale Bar */}
            <div className="space-y-1">
              <div className="relative h-2 rounded-full bg-gradient-to-r from-amber-500 via-zinc-100 to-sky-400">
                <span
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-zinc-950 shadow"
                  style={{ left: `${kelvinPos}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                <span>2000K Warm</span>
                <span className="text-zinc-300">{wb.tempLabel}</span>
                <span>10000K Cool</span>
              </div>
            </div>

            {/* Channel Gains + Tint */}
            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
              <div className="px-2.5 py-1.5 rounded-xl bg-black/40 border border-white/[0.06]">
                <span className="text-zinc-500 block text-[10px]">RGB Balance</span>
                <span className="font-mono text-zinc-200">
                  {wb.rgbGains.r} / {wb.rgbGains.g} / {wb.rgbGains.b}
                </span>
              </div>
              <div className="px-2.5 py-1.5 rounded-xl bg-black/40 border border-white/[0.06]">
                <span className="text-zinc-500 block text-[10px]">Tint / Space</span>
                <span className="font-mono text-zinc-200">
                  {wb.tint >= 0 ? `+${wb.tint}` : wb.tint} • {wb.colorSpace}
                </span>
              </div>
            </div>
          </>
        )}

        {exp && (exp.fNumber || shutterStr || exp.iso || exp.focalLength) && (
          <div className="pt-1 border-t border-white/[0.06] flex flex-wrap gap-2 text-[11px] font-mono text-zinc-400">
            {exp.focalLength && <span>{Math.round(exp.focalLength)}mm</span>}
            {exp.fNumber && <span>f/{exp.fNumber}</span>}
            {shutterStr && <span>{shutterStr}</span>}
            {exp.iso && <span>ISO {exp.iso}</span>}
          </div>
        )}
      </div>

      {/* RGB Histogram & 2D Image Spectrogram */}
      <div className="p-3.5 rounded-2xl bg-[#101216] border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            RGB Histogram &amp; Spectrogram
          </h4>
          <span className="text-[10px] font-mono text-zinc-500">
            {specReady ? '2D FFT + RGB' : 'Computing...'}
          </span>
        </div>

        <div className="space-y-2.5">
          <div>
            <span className="text-[10px] font-mono text-zinc-500 block mb-1">
              RGB / Luminance Distribution
            </span>
            <canvas
              ref={histCanvasRef}
              width={280}
              height={72}
              className="w-full h-[72px] rounded-xl border border-white/10 bg-[#090a0d]"
            />
          </div>

          <div className="flex items-center gap-3">
            <canvas
              ref={specCanvasRef}
              width={112}
              height={112}
              className="w-24 h-24 rounded-xl border border-white/10 bg-[#090a0d] shrink-0"
            />
            <div className="text-[11px] text-zinc-400 space-y-1">
              <p className="font-medium text-zinc-200">2D Frequency Spectrogram</p>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Center shows low-frequency tone energy; outer edges show sharp edges, grain, and texture detail.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
