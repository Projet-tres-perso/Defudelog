import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RawLog, LogSource } from "@/types";
import { Search, RefreshCw, ChevronLeft, ChevronRight, Globe, Monitor, BookOpen, Layers, Server, ShieldCheck, ShieldAlert } from "lucide-react";

export default function LogViewer() {
  const [logs, setLogs] = useState<RawLog[]>([]);
  const [sources, setSources] = useState<LogSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("all");
  const [displayMode, setDisplayMode] = useState<"hybrid" | "meaning_only">("hybrid");
  const [search, setSearch] = useState("");
  const [networkTypeFilter, setNetworkTypeFilter] = useState<"all" | "local" | "network">("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const perPage = 50;

  // États du modal d'édition sémantique
  const [showEditModal, setShowEditModal] = useState(false);
  const [editPattern, setEditPattern] = useState("");
  const [editFormat, setEditFormat] = useState("");
  const [editExplanation, setEditExplanation] = useState("");
  const [editRecommendation, setEditRecommendation] = useState("");
  const [editLevel, setEditLevel] = useState("info");

  const fetchSources = async () => {
    try {
      const srcList = await invoke<LogSource[]>("list_log_sources");
      setSources(srcList || []);
    } catch (e) {
      console.error("Failed to fetch sources:", e);
    }
  };

  const isNetworkLog = (log: RawLog) => {
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(log.hostname) && log.hostname !== "127.0.0.1";
    return log.source_id.startsWith("network_") || isIp;
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<{ logs: RawLog[]; total: number }>("get_raw_logs", {
        limit: perPage,
        offset: (page - 1) * perPage,
        search: search.trim() ? search.trim() : null,
        sourceId: selectedSourceId !== "all" ? selectedSourceId : null,
      });

      setLogs(result?.logs || []);
      setTotal(result?.total || 0);
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    } finally {
      setLoading(false);
    }
  }, [search, selectedSourceId, page]);

  useEffect(() => {
    fetchSources();
    fetchLogs();
    const interval = setInterval(fetchLogs, 4000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const [contextLogs, setContextLogs] = useState<RawLog[]>([]);
  const [selectedRawLog, setSelectedRawLog] = useState<RawLog | null>(null);

  const viewContext = async (log: RawLog) => {
    setSelectedRawLog(log);
    try {
      const neighbors = await invoke<RawLog[]>("get_log_context", {
        logId: log.id,
        hostname: log.hostname,
        timestamp: log.timestamp,
        windowSize: 10,
      });
      setContextLogs(neighbors || []);
    } catch (e) {
      console.error("Erreur get_log_context:", e);
    }
  };

  const filteredLogs = logs.filter((l) => {
    if (networkTypeFilter === "all") return true;
    if (networkTypeFilter === "network") return isNetworkLog(l);
    if (networkTypeFilter === "local") return !isNetworkLog(l);
    return true;
  });

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="p-6 space-y-5 h-full flex flex-col">
      {/* Header & Source isolation selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <span>Explorateur & Traducteur Sémantique</span>
            <span className="text-2xs bg-primary-500/20 text-primary-400 font-mono px-2 py-0.5 rounded-full border border-primary-500/30">
              Sens Métier Actif
            </span>
          </h2>
          <p className="text-sm text-surface-400 mt-0.5">
            {total.toLocaleString()} événements traduits et indexés
          </p>
        </div>

        {/* View Mode Switcher + Action buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode Switcher: Hybrid vs Meaning Only */}
          <div className="flex items-center gap-1 bg-surface-800 p-1 rounded-xl border border-surface-700 text-xs">
            <button
              onClick={() => setDisplayMode("hybrid")}
              className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 ${
                displayMode === "hybrid"
                  ? "bg-surface-600 text-white shadow-sm"
                  : "text-surface-400 hover:text-surface-200"
              }`}
              title="Affiche le log brut et son explication vulgarisée"
            >
              <Layers size={14} />
              <span>Vue Hybride (Brut + Sens)</span>
            </button>
            <button
              onClick={() => setDisplayMode("meaning_only")}
              className={`px-3 py-1.5 rounded-lg transition-all font-medium flex items-center gap-1.5 ${
                displayMode === "meaning_only"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-sm font-semibold"
                  : "text-surface-400 hover:text-surface-200"
              }`}
              title="Masque le log brut pour n'afficher que le récit en français clair"
            >
              <BookOpen size={14} />
              <span>Vue Vulgarisée (Sens uniquement)</span>
            </button>
          </div>

          <button onClick={fetchLogs} className="btn-secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Control bar: Machine/Source Picker + Network Filter + Search */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        {/* Source / Machine Dedicated Selector */}
        <div className="md:col-span-4 flex items-center gap-2 bg-surface-800/80 border border-surface-700/80 rounded-xl px-3 py-2">
          <Server size={16} className="text-primary-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <label className="block text-3xs font-semibold uppercase text-surface-400 tracking-wider">
              Entité Source / Machine
            </label>
            <select
              value={selectedSourceId}
              onChange={(e) => { setSelectedSourceId(e.target.value); setPage(1); }}
              className="w-full bg-transparent text-xs text-white font-medium focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-surface-800 text-white">
                🌐 Toutes les entités & machines ({sources.length})
              </option>
              {sources.map((s) => (
                <option key={s.id} value={s.id} className="bg-surface-800 text-white">
                  {s.priority === "critical" ? "🔴" : s.priority === "high" ? "🟠" : "💻"} {s.name} ({s.hostname})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Network vs Local Scope */}
        <div className="md:col-span-3 flex items-center gap-1 bg-surface-800/80 p-1.5 rounded-xl border border-surface-700/80 text-xs">
          <button
            onClick={() => setNetworkTypeFilter("all")}
            className={`flex-1 py-1.5 rounded-lg text-center font-medium transition-colors ${
              networkTypeFilter === "all" ? "bg-surface-600 text-white" : "text-surface-400 hover:text-surface-200"
            }`}
          >
            Tous
          </button>
          <button
            onClick={() => setNetworkTypeFilter("local")}
            className={`flex-1 py-1.5 rounded-lg text-center font-medium flex items-center justify-center gap-1 transition-colors ${
              networkTypeFilter === "local" ? "bg-purple-900/80 text-purple-200" : "text-surface-400 hover:text-surface-200"
            }`}
          >
            <Monitor size={13} />
            Local
          </button>
          <button
            onClick={() => setNetworkTypeFilter("network")}
            className={`flex-1 py-1.5 rounded-lg text-center font-medium flex items-center justify-center gap-1 transition-colors ${
              networkTypeFilter === "network" ? "bg-cyan-900/80 text-cyan-200" : "text-surface-400 hover:text-surface-200"
            }`}
          >
            <Globe size={13} />
            Réseau
          </button>
        </div>

        {/* Search bar */}
        <div className="md:col-span-5 relative flex items-center">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            className="input pl-10 w-full text-xs"
            placeholder="Rechercher par mot-clé, IP, commande, sens en français..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Log Feed Display */}
      <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
        <div className="flex-1 overflow-auto card p-0 flex flex-col border border-surface-800">
          <div className="overflow-y-auto flex-1 divide-y divide-surface-800/60">
            {filteredLogs.length === 0 ? (
              <div className="p-16 text-center text-surface-500 space-y-2">
                <ShieldCheck size={36} className="mx-auto text-surface-600 opacity-60" />
                <p className="text-sm font-medium">
                  {loading ? "Chargement des logs en cours..." : "Aucun événement ne correspond à vos critères de recherche."}
                </p>
                <p className="text-xs text-surface-600">
                  Vérifiez vos filtres ou sélectionnez une autre source machine.
                </p>
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isNet = isNetworkLog(log);
                const isSelected = selectedRawLog?.id === log.id;
                const meaning = log.meaning || log.raw_message;

                return (
                  <div
                    key={log.id}
                    onClick={() => viewContext(log)}
                    className={`cursor-pointer p-3 hover:bg-surface-800/50 transition-all ${
                      isSelected ? "bg-primary-500/10 border-l-4 border-l-primary-500 shadow-inner" : ""
                    }`}
                  >
                    {/* Top Metadata Row */}
                    <div className="flex items-center justify-between text-2xs mb-1.5 gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-surface-400 font-mono">
                          {new Date(log.timestamp).toLocaleTimeString("fr-FR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>

                        {isNet ? (
                          <span className="text-3xs font-semibold px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 flex items-center gap-1 font-mono">
                            <Globe size={10} />
                            {log.hostname}
                          </span>
                        ) : (
                          <span className="text-3xs font-semibold px-2 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60 flex items-center gap-1 font-mono">
                            💻 {log.hostname}
                          </span>
                        )}
                      </div>

                      <span className="text-3xs text-surface-500 font-mono">
                        Source ID: {log.source_id}
                      </span>
                    </div>

                    {/* Meaning / Interpretation (Sens Vulgarisé) */}
                    <div className="text-xs leading-relaxed text-surface-100 font-medium">
                      {meaning}
                    </div>

                    {/* Raw Log Details (Shown only in Hybrid Mode) */}
                    {displayMode === "hybrid" && (
                      <div className="mt-1.5 pt-1.5 border-t border-surface-800/40 font-mono text-2xs text-surface-400 truncate opacity-80 hover:opacity-100 transition-opacity">
                        <span className="text-surface-500 select-none mr-1.5">Brut :</span>
                        {log.raw_message}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination bar */}
          {totalPages > 1 && (
            <div className="p-3 border-t border-surface-800 flex items-center justify-between text-xs text-surface-400 bg-surface-900/60">
              <span>Page {page} sur {totalPages} ({total.toLocaleString()} logs)</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-ghost p-1.5 disabled:opacity-30"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="btn-ghost p-1.5 disabled:opacity-30"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Investigation & Storyline Side Panel */}
        {selectedRawLog && (
          <div className="w-96 flex-shrink-0 card space-y-4 overflow-y-auto border border-surface-800">
            <div className="flex items-center justify-between border-b border-surface-800 pb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <ShieldAlert size={16} className="text-amber-400" />
                <span>Investigation de l'Entité</span>
              </h3>
              <span className="badge bg-primary-500/20 text-primary-400 text-2xs">
                {contextLogs.length} voisins
              </span>
            </div>
            
            <div className="space-y-4">
              {/* Sens Métier & Détail Multi-Niveaux */}
              <div className="bg-surface-800/40 p-3 rounded-xl border border-surface-700/60 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-3xs text-primary-400 uppercase font-bold tracking-wider">
                    1. Sens Métier Immédiat
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditPattern(selectedRawLog.raw_message);
                      setEditFormat(selectedRawLog.meaning || selectedRawLog.raw_message);
                      setEditExplanation(selectedRawLog.explanation || "");
                      setEditRecommendation(selectedRawLog.recommendation || "");
                      setEditLevel("info");
                      setShowEditModal(true);
                    }}
                    className="text-3xs px-2 py-0.5 rounded bg-primary-600/20 text-primary-300 hover:bg-primary-600/30 border border-primary-500/30 font-medium transition-all"
                    title="Personnaliser ou corriger l'interprétation de ce log"
                  >
                    ✏️ Modifier
                  </button>
                </div>
                
                <p className="text-xs text-white leading-relaxed font-semibold">
                  {selectedRawLog.meaning || selectedRawLog.raw_message}
                </p>

                {/* 2. Explication Didactique Approfondie */}
                {selectedRawLog.explanation && (
                  <div className="pt-2 border-t border-surface-700/40 space-y-1">
                    <span className="text-3xs text-surface-400 uppercase font-semibold">
                      2. Explication Didactique
                    </span>
                    <p className="text-2xs text-surface-300 leading-relaxed font-sans bg-surface-900/60 p-2 rounded-lg border border-surface-800">
                      💡 {selectedRawLog.explanation}
                    </p>
                  </div>
                )}

                {/* 3. Recommandation SOC / Action Opérationnelle */}
                {selectedRawLog.recommendation && (
                  <div className="pt-2 border-t border-surface-700/40 space-y-1">
                    <span className="text-3xs text-emerald-400 uppercase font-semibold">
                      3. Action & Recommandation SOC
                    </span>
                    <p className="text-2xs text-emerald-200/90 leading-relaxed font-sans bg-emerald-950/40 p-2 rounded-lg border border-emerald-800/40">
                      🛡️ {selectedRawLog.recommendation}
                    </p>
                  </div>
                )}

                <div className="pt-2 border-t border-surface-700/40 text-2xs text-surface-400 font-mono space-y-1">
                  <div>Machine : <span className="text-surface-200">{selectedRawLog.hostname}</span></div>
                  <div>Horodatage : <span className="text-surface-200">{new Date(selectedRawLog.timestamp).toLocaleString("fr-FR")}</span></div>
                </div>
              </div>

              {/* Log Brut Technique */}
              <div>
                <span className="text-3xs text-surface-500 uppercase font-semibold">Télémétrie Brute</span>
                <p className="font-mono text-2xs text-amber-300 bg-surface-900 border border-amber-500/20 rounded-lg p-2.5 mt-1 break-all leading-normal">
                  {selectedRawLog.raw_message}
                </p>
              </div>

              {/* Storyline Context */}
              {contextLogs.length > 0 && (
                <div className="pt-2 border-t border-surface-800">
                  <span className="text-3xs text-surface-400 uppercase font-bold tracking-wider">
                    Storyline Chronologique (±10 logs)
                  </span>
                  <div className="mt-2 space-y-2 max-h-80 overflow-y-auto pr-1">
                    {contextLogs.map((c) => {
                      const isTarget = c.id === selectedRawLog.id;
                      return (
                        <div
                          key={c.id}
                          className={`p-2.5 rounded-lg text-2xs transition-all ${
                            isTarget
                              ? "bg-amber-500/15 border border-amber-500/40 text-amber-200 shadow-sm"
                              : "bg-surface-900/80 text-surface-300 border border-surface-800 hover:border-surface-700"
                          }`}
                        >
                          <div className="flex justify-between text-surface-500 text-3xs mb-1 font-mono">
                            <span>{new Date(c.timestamp).toLocaleTimeString("fr-FR")}</span>
                            {isTarget && <span className="text-amber-400 font-bold">ÉVÉNEMENT CIBLE</span>}
                          </div>
                          <p className="font-medium text-surface-100">{c.meaning || c.raw_message}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal d'Édition Personnalisée de l'Interprétation */}
      {showEditModal && (
        <div className="fixed inset-0 bg-surface-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-900 border border-surface-700 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-surface-800 pb-3">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <span>✏️ Personnaliser l'Interprétation Sémantique</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="text-surface-500 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-3xs text-surface-400 uppercase font-semibold mb-1">Motif de journal (Pattern)</label>
                <input
                  type="text"
                  className="input font-mono text-2xs w-full"
                  value={editPattern}
                  onChange={(e) => setEditPattern(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-3xs text-surface-400 uppercase font-semibold mb-1">1. Sens Métier Court (Gabarit avec variables : &#123;user&#125;, &#123;ip&#125;, &#123;port&#125;...)</label>
                <textarea
                  className="input text-xs w-full h-16 resize-none"
                  value={editFormat}
                  onChange={(e) => setEditFormat(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-3xs text-surface-400 uppercase font-semibold mb-1">2. Explication Didactique Détaillée (Optionnel)</label>
                <textarea
                  className="input text-xs w-full h-14 resize-none"
                  placeholder="Détaillez la cause technique et le contexte métier de cet événement..."
                  value={editExplanation}
                  onChange={(e) => setEditExplanation(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-3xs text-surface-400 uppercase font-semibold mb-1">3. Action / Recommandation SOC (Optionnel)</label>
                <textarea
                  className="input text-xs w-full h-14 resize-none"
                  placeholder="Conseils de remédiation, règles pare-feu à appliquer..."
                  value={editRecommendation}
                  onChange={(e) => setEditRecommendation(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-3xs text-surface-400 uppercase font-semibold mb-1">Niveau d'état visuel</label>
                <select
                  className="input text-xs w-full"
                  value={editLevel}
                  onChange={(e) => setEditLevel(e.target.value)}
                >
                  <option value="info">🔵 Information (Normal)</option>
                  <option value="success">🟢 Succès (Validation)</option>
                  <option value="warning">⚠️ Avertissement (Suspicion)</option>
                  <option value="error">🔴 Erreur / Alerte Critique</option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-surface-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="btn-secondary text-xs"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await invoke("save_template_translation", {
                      templatePattern: editPattern,
                      frenchFormat: editFormat,
                      explanation: editExplanation.trim() ? editExplanation : null,
                      recommendation: editRecommendation.trim() ? editRecommendation : null,
                      statusLevel: editLevel,
                    });
                    setShowEditModal(false);
                    fetchLogs();
                    alert("Interprétation personnalisée enregistrée avec succès dans votre base SQLite !");
                  } catch (e) {
                    alert("Erreur lors de l'enregistrement: " + String(e));
                  }
                }}
                className="btn-primary text-xs"
              >
                Enregistrer la règle
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

