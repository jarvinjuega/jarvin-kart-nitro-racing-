import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Globe, Laptop, MonitorDown, Smartphone, Sparkles, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PUBLIC_GAME_URL = 'https://ais-pre-fjs3dqszjqtu7t5r3ryrvu-411543389306.us-east1.run.app';

interface AppDownloadModalProps {
  isOpen: boolean;
  unlockedAlready?: boolean;
  onAppDownloaded?: () => void;
  onClose: () => void;
}

export const AppDownloadModal: React.FC<AppDownloadModalProps> = ({
  isOpen,
  unlockedAlready = false,
  onAppDownloaded,
  onClose,
}) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, topInstallUrl, install } = usePWAInstall();
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showManualHint, setShowManualHint] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    if (isInstalled && !unlockedAlready) {
      onAppDownloaded?.();
    }
  }, [isInstalled, unlockedAlready, onAppDownloaded]);

  if (!isOpen) return null;

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : PUBLIC_GAME_URL;
  const isDevOrLocal =
    currentOrigin.includes('ais-dev-') ||
    currentOrigin.includes('localhost') ||
    currentOrigin.includes('127.0.0.1');
  const rawUrl = isDevOrLocal ? currentOrigin : currentOrigin;
  const shareUrl = /^https?:\/\//i.test(rawUrl)
    ? rawUrl.replace(/["<>`&|\r\n]/g, '')
    : PUBLIC_GAME_URL;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownloadOpenSourceZip = async () => {
    if (downloadingZip) return;
    setDownloadingZip(true);
    setDownloadError('');
    try {
      const res = await fetch('/api/download/opensource.zip', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'JarvinKartTurbo_CodigoLibre.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      onAppDownloaded?.();
    } catch {
      setDownloadError('No se pudo descargar el archivo .zip. Intenta de nuevo en unos segundos.');
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleInstallPwa = async () => {
    const ok = await install();
    if (ok) {
      setShowManualHint(false);
      onAppDownloaded?.();
    } else {
      setShowManualHint(true);
      onAppDownloaded?.();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-3xl bg-[#0b101b] border border-white/20 rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col gap-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Download className="w-5 h-5 text-emerald-400" />
            <h2 className="font-display text-lg sm:text-xl font-bold text-white">
              App Independiente, Código Libre y Link Público
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Exclusive Character Reward Banner */}
        <div className="bg-cyan-500/15 border border-cyan-400/40 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-cyan-300 shrink-0" />
            <div className="text-xs text-slate-100">
              <div className="font-display font-bold text-cyan-300">
                ¡Recompensa Exclusiva por Descargar o Instalar la App!
              </div>
              <div className="text-slate-300">
                Al instalar la App o descargar el proyecto desbloqueas a <strong>Celular Kart</strong> y <strong>PC Gamer</strong> en el Garaje.
              </div>
            </div>
          </div>
          {unlockedAlready && (
            <span className="px-2.5 py-1 rounded-md bg-emerald-500 text-slate-950 font-bold text-[11px] shrink-0">
              Desbloqueado
            </span>
          )}
        </div>

        {/* Active Playable Link */}
        <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-emerald-400">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              <span>{isDevOrLocal ? 'Link Activo del Juego (Vista Actual)' : 'Link Público del Juego (Online)'}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              onClick={(e) => e.currentTarget.select()}
              className="flex-1 bg-[#090d14] border border-white/15 rounded-lg px-3 py-1.5 text-xs font-mono-tabular text-slate-200 select-all"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer whitespace-nowrap"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedUrl ? '¡Copiado!' : 'Copiar'}</span>
            </button>
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10"
              title="Abrir link en pestaña nueva"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
          {isDevOrLocal && (
            <div className="text-[11px] text-slate-400">
              Nota: Para compartir con amigos fuera de tu cuenta, usa el botón <strong>Share / Publish</strong> arriba para activar el link público.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Native Standalone PWA App Installation (PC & Mobile without browser bars!) */}
          <div className="bg-slate-900/90 border border-cyan-500/35 rounded-xl p-3.5 flex flex-col justify-between gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2.5">
                <Smartphone className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-display font-bold text-sm text-white">
                    Instalar App Independiente Sin Navegador
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5">
                    Instala el juego directo en Windows / PC o Celular en su propia ventana independiente sin pestañas ni barra URL.
                  </div>
                </div>
              </div>

              {!isInstalled && (showManualHint || !isInstallable) && (
                <div className="text-xs text-slate-300 bg-[#090d14] border border-white/10 rounded-lg p-2.5 leading-relaxed">
                  {isInIframe && !isInstallable
                    ? 'En esta vista previa el navegador bloquea el instalador directo. Pulsa el botón de abajo para abrir en pestaña directa e instalarlo en tu PC con 1 clic.'
                    : isIOS
                      ? 'En iPhone/iPad Safari: toca el botón Compartir y elige "Añadir a pantalla de inicio".'
                      : 'En Chrome o Edge (PC/Android): pulsa el ícono Instalar en la esquina derecha de la barra de direcciones (o Menú ⋮ → Guardar y compartir → Instalar Jarvin Kart Turbo 3D).'}
                </div>
              )}
            </div>

            {isInstalled ? (
              <span className="w-full text-center px-3 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-400 text-emerald-300 text-xs font-bold">
                App Independiente Instalada
              </span>
            ) : isInstallable ? (
              <button
                type="button"
                data-testid="install-pwa-btn"
                onClick={() => void handleInstallPwa()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-xs sm:text-sm cursor-pointer shadow-lg"
              >
                <MonitorDown className="w-4 h-4" />
                <span>Instalar App en PC / Móvil</span>
              </button>
            ) : isInIframe ? (
              <a
                data-testid="open-top-install-link"
                href={topInstallUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onAppDownloaded?.()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-xs sm:text-sm cursor-pointer shadow-lg text-center"
              >
                <MonitorDown className="w-4 h-4" />
                <span>Abrir e Instalar App en PC</span>
              </a>
            ) : (
              <button
                type="button"
                data-testid="install-pwa-guide-btn"
                onClick={() => void handleInstallPwa()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-display font-bold text-xs sm:text-sm cursor-pointer shadow-lg"
              >
                <MonitorDown className="w-4 h-4" />
                <span>Instalar App Independiente</span>
              </button>
            )}
          </div>

          {/* Open-Source Folder with .ogg Audio, .png Textures, MIT License, DLLs & Code */}
          <div className="bg-slate-900/90 border border-white/15 rounded-xl p-3.5 flex flex-col justify-between gap-3">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm font-display font-bold text-white">
                <Laptop className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Carpeta Código Libre (.ogg, .png, .dll)</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Descarga el paquete abierto <strong>MIT</strong> con carpetas <code className="text-emerald-300">codigo-libre/</code>, audios <code className="text-cyan-300">.ogg</code>, texturas <code className="text-amber-300">.png</code>, <code className="text-slate-200">LICENSE</code> y librerías <code className="text-emerald-300">.dll</code> para instalar o compilar la app de escritorio (<code className="text-amber-300">app.exe</code>).
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {downloadError && (
                <div className="text-[11px] text-rose-300 bg-rose-500/15 border border-rose-400/40 rounded-lg px-2.5 py-1.5">
                  {downloadError}
                </div>
              )}
              <button
                type="button"
                data-testid="download-opensource-zip"
                disabled={downloadingZip}
                onClick={() => void handleDownloadOpenSourceZip()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 font-display font-bold text-xs sm:text-sm cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{downloadingZip ? 'Preparando descarga (.zip)...' : 'Descargar Código Libre (.zip)'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
