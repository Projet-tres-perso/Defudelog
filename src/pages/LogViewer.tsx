import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RawLog, ParsedLog } from "@/types";
import { Search, Filter, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";

export default function LogViewer() {
  const [logs, setLogs] = useState<RawLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<ParsedLog | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const perPage = 50;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<{ logs: RawLog[]; total: number }>("get_raw_logs", {
        search: search.trim() ? search.trim() : null,
        page,
        perPage,
      });
      setLogs(result.logs || []);
      setTotal(result.total || 0);
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    } finally {
      setLoading(false);
    }
  }, [search, sourceFilter, page]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const [contextLogs, setContextLogs] = useState<RawLog[]>([]);
  const [selectedRawLog, setSelectedRawLog] = useState<RawLog | null>(null);

  const viewContext = async (log: RawLog) => {
    setSelectedRawLog(log);
    try {
      const neighbors = await invoke<RawLog[]>("get_log_context", {
        logId: log.id,
        before: 10,
        after: 10,
      });
      setContextLogs(neighbors || []);
    } catch (e) {
      console.error("Erreur get_log_context:", e);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Explorateur de logs</h2>
          <p className="text-sm text-surface-400 mt-1">
            {total.toLocaleString()} logs indexés
          </p>
        </div>
        <button onClick={fetchLogs} className="btn-secondary" disabled={loading}>
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Actualiser
        </button>
      </div>

      {/* Search bar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            className="input pl-10"
            placeholder="Rechercher dans les logs..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="select w-48"
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
        >
          <option value="">Toutes les sources</option>
          <option value="file">Fichier</option>
          <option value="journald">Journald</option>
          <option value="macos">macOS Unified Log</option>
          <option value="windows">Windows EventLog</option>
        </select>
      </div>

      {/* Log table */}
      <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
        <div className="flex-1 overflow-auto card p-0">
          <div className="overflow-y-auto max-h-full">
            {logs.length === 0 ? (
              <div className="p-8 text-center text-surface-500">
                {loading ? "Chargement..." : "Aucun log trouvé"}
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  onClick={() => viewContext(log)}
                  className={`log-line cursor-pointer flex items-start gap-3 transition-colors ${
                    selectedRawLog?.id === log.id ? "bg-primary-500/10 border-l-2 border-primary-500" : ""
                  }`}
                >
                  <span className="text-surface-500 whitespace-nowrap text-2xs mt-0.5">
                    {new Date(log.timestamp).toLocaleString("fr-FR", {
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  <span className="text-surface-300 truncate flex-1 text-xs">
                    {log.raw_message}
                  </span>
                  <span className="text-surface-600 text-2xs whitespace-nowrap">
                    {log.hostname}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Detail & Context panel */}
        {selectedRawLog && (
          <div className="w-96 flex-shrink-0 card space-y-4 overflow-y-auto">
            <h3 className="font-semibold text-sm flex items-center justify-between">
              <span>Investigation Chronologique</span>
              <span className="badge bg-primary-500/20 text-primary-400 text-2xs">
                {contextLogs.length} voisins
              </span>
            </h3>
            
            <div className="space-y-3">
              <div>
                <span className="text-2xs text-surface-500 uppercase font-semibold">Log Ciblé</span>
                <p className="font-mono text-xs text-amber-300 bg-surface-900 border border-amber-500/30 rounded p-2.5 mt-1 break-all">
                  {selectedRawLog.raw_message}
                </p>
                <p className="text-2xs text-surface-500 mt-1">
                  Hôte: {selectedRawLog.hostname} · Hash: {selectedRawLog.log_hash.substring(0, 12)}...
                </p>
              </div>

              {contextLogs.length > 0 && (
                <div className="pt-2 border-t border-surface-800">
                  <span className="text-2xs text-surface-400 uppercase font-semibold">
                    Storyline (Contexte Immédiat)
                  </span>
                  <div className="mt-2 space-y-1.5 max-h-96 overflow-y-auto">
                    {contextLogs.map((c) => {
                      const isTarget = c.id === selectedRawLog.id;
                      return (
                        <div
                          key={c.id}
                          className={`p-2 rounded font-mono text-2xs transition-colors ${
                            isTarget
                              ? "bg-amber-500/15 border border-amber-500/40 text-amber-200"
                              : "bg-surface-900/80 text-surface-400 border border-surface-800"
                          }`}
                        >
                          <div className="flex justify-between text-surface-500 text-3xs mb-0.5">
                            <span>{new Date(c.timestamp).toLocaleTimeString("fr-FR")}</span>
                            {isTarget && <span className="text-amber-400 font-bold">CIBLE</span>}
                          </div>
                          <p className="break-all">{c.raw_message}</p>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-surface-400">
            Page {page} sur {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary text-xs"
            >
              <ChevronLeft size={14} />
              Précédent
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="btn-secondary text-xs"
            >
              Suivant
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
