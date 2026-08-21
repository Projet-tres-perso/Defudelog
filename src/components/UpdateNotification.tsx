import React, { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { Sparkles, Download, RefreshCw, X, CheckCircle2, AlertCircle } from "lucide-react";

export default function UpdateNotification() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number>(0);
  const [downloaded, setDownloaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const checkForUpdates = async () => {
    try {
      const updateResult = await check();
      if (updateResult && updateResult.available) {
        setUpdate(updateResult);
      }
    } catch (e) {
      // Ignorer silencieusement en dev ou si hors-ligne
      console.debug("Vérification mise à jour (Tauri Updater):", e);
    }
  };

  useEffect(() => {
    checkForUpdates();
    // Vérification périodique toutes les 4 heures
    const interval = setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleInstallUpdate = async () => {
    if (!update) return;
    setDownloading(true);
    setErrorMsg(null);
    setProgress(0);

    try {
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

      setDownloaded(true);
    } catch (e) {
      console.error("Erreur lors de la mise à jour:", e);
      setErrorMsg("Échec du téléchargement: " + String(e));
      setDownloading(false);
    }
  };

  if (!update || dismissed) return null;

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
                  v{update.version}
                </span>
              </h4>
              <p className="text-3xs text-surface-400">
                Vos données, règles et logs sont 100% conservés.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-surface-500 hover:text-surface-300 p-1 rounded-lg transition-colors"
            title="Masquer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Release Notes Preview */}
        {update.body && (
          <div className="bg-surface-950/60 rounded-xl p-2.5 text-2xs text-surface-300 max-h-24 overflow-y-auto border border-surface-800 font-sans leading-relaxed">
            {update.body}
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
              <span>Mise à jour prête ! Redémarrez l'application.</span>
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
