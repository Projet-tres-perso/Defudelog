import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, Update } from "@tauri-apps/plugin-updater";
import { Sparkles, Download, RefreshCw, X, CheckCircle2, AlertCircle, ChevronUp } from "lucide-react";

export default function UpdateNotification() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [backendUpdateInfo, setBackendUpdateInfo] = useState<{ version: string; body?: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [downloaded, setDownloaded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const checkForUpdates = useCallback(async (notifyIfNone = false) => {
    try {
      // 1. Essayer le plugin-updater standard
      let updateResult: Update | null = null;
      try {
        updateResult = await check();
      } catch (plugErr) {
        console.debug("plugin-updater check error, fallback to backend:", plugErr);
      }

      if (updateResult && updateResult.available) {
        setUpdate(updateResult);
        setBackendUpdateInfo({ version: updateResult.version, body: updateResult.body || undefined });
        setMinimized(false);
        window.dispatchEvent(new CustomEvent("defudelog-update-found", { detail: { version: updateResult.version } }));
        return;
      }

      // 2. Fallback backend Rust natif
      const backendRes = await invoke<{ available: boolean; version?: string; body?: string }>("check_for_updates_backend");
      if (backendRes && backendRes.available && backendRes.version) {
        setBackendUpdateInfo({ version: backendRes.version, body: backendRes.body || undefined });
        setMinimized(false);
        window.dispatchEvent(new CustomEvent("defudelog-update-found", { detail: { version: backendRes.version } }));
      } else {
        window.dispatchEvent(new CustomEvent("defudelog-update-not-found"));
        if (notifyIfNone) {
          console.info("DefuDelog est à jour (aucune nouvelle version).");
        }
      }
    } catch (e) {
      console.debug("Vérification mise à jour:", e);
      window.dispatchEvent(new CustomEvent("defudelog-update-error", { detail: String(e) }));
    }
  }, []);

  useEffect(() => {
    checkForUpdates();

    const handleTriggerCheck = () => {
      checkForUpdates(true);
    };

    window.addEventListener("defudelog-check-update", handleTriggerCheck);
    const interval = setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000);

    return () => {
      window.removeEventListener("defudelog-check-update", handleTriggerCheck);
      clearInterval(interval);
    };
  }, [checkForUpdates]);

  const handleInstallUpdate = async () => {
    setDownloading(true);
    setErrorMsg(null);
    setProgress(0);

    try {
      if (update) {
        let downloadedBytes = 0;
        let totalBytes = 0;

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case "Started":
              totalBytes = event.data.contentLength || 0;
              break;
            case "Progress":
              downloadedBytes += event.data.chunkLength;
              if (totalBytes > 0) {
                setProgress(Math.round((downloadedBytes / totalBytes) * 100));
              }
              break;
            case "Finished":
              setDownloaded(true);
              break;
          }
        });
      } else {
        // Installation via backend Rust
        await invoke("install_update_backend");
      }

      setDownloaded(true);
    } catch (e) {
      console.error("Erreur lors de la mise à jour:", e);
      setErrorMsg("Échec du téléchargement: " + String(e));
      setDownloading(false);
    }
  };

  const activeVersion = update?.version || backendUpdateInfo?.version;
  const activeBody = update?.body || backendUpdateInfo?.body;

  if (!activeVersion) return null;

  // Si l'utilisateur a minimisé la boîte, afficher une pastille compacte et élégante
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white text-xs font-semibold py-2 px-3.5 rounded-full shadow-2xl border border-primary-400/40 animate-bounce transition-all hover:scale-105"
        title="Ouvrir la notification de mise à jour"
      >
        <Sparkles size={14} className="text-yellow-300" />
        <span>Mise à jour v{activeVersion} disponible !</span>
        <ChevronUp size={14} />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-md w-full animate-in fade-in slide-in-from-bottom-5 duration-300">
      <div className="bg-surface-900/95 border border-primary-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur-xl space-y-3">
        {/* Header with badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary-500/20 text-primary-400 border border-primary-500/30">
              <Sparkles size={16} className="animate-pulse" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white flex items-center gap-2">
                <span>Mise à jour disponible</span>
                <span className="badge bg-emerald-500/20 text-emerald-300 text-3xs font-mono">
                  v{activeVersion}
                </span>
              </h4>
              <p className="text-3xs text-surface-400">
                Vos données, règles et logs sont 100% conservés.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMinimized(true)}
              className="text-surface-500 hover:text-surface-300 p-1 rounded-lg transition-colors"
              title="Minimiser sous forme de pastille"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Release Notes Preview */}
        {activeBody && (
          <div className="bg-surface-950/60 rounded-xl p-2.5 text-2xs text-surface-300 max-h-24 overflow-y-auto border border-surface-800 font-sans leading-relaxed">
            {activeBody}
          </div>
        )}

        {/* Progress bar when downloading */}
        {downloading && !downloaded && (
          <div className="space-y-1">
            <div className="flex justify-between text-3xs text-surface-400 font-mono">
              <span>Téléchargement de la mise à jour...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-surface-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-primary-500 to-emerald-400 h-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error message if any */}
        {errorMsg && (
          <div className="text-3xs text-red-400 flex items-center gap-1.5 bg-red-950/40 p-2 rounded-lg border border-red-800/40">
            <AlertCircle size={13} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Action button */}
        <div className="pt-1 flex items-center justify-end gap-2">
          {downloaded ? (
            <div className="flex items-center gap-1.5 text-2xs text-emerald-400 font-medium">
              <CheckCircle2 size={14} />
              <span>Mise à jour prête ! Redémarrez l'application pour appliquer.</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleInstallUpdate}
              disabled={downloading}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-lg shadow-primary-500/20"
            >
              {downloading ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  <span>Installation en cours...</span>
                </>
              ) : (
                <>
                  <Download size={13} />
                  <span>Mettre à jour maintenant</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
