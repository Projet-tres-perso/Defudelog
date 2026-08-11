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
      const result = await invoke<{ logs: RawLog[]; total: number }>("query_logs", {
        search,
        sourceId: sourceFilter || null,
        page,
        perPage,
      });
      setLogs(result.logs);
      setTotal(result.total);
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

  const viewParsed = async (logId: string) => {
    try {
      const parsed = await invoke<ParsedLog>("get_log_detail", { logId });
      setSelectedLog(parsed);
    } catch (e) {
      console.error(e);
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
                  onClick={() => viewParsed(log.id)}
                  className="log-line cursor-pointer flex items-start gap-3"
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

        {/* Detail panel */}
        {selectedLog && (
          <div className="w-96 flex-shrink-0 card space-y-4 overflow-y-auto">
            <h3 className="font-semibold text-sm">Détail du log</h3>
            <div className="space-y-3">
              <div>
                <span className="text-2xs text-surface-500 uppercase">Template détecté</span>
                <p className="font-mono text-xs bg-surface-800 rounded p-2 mt-1 break-all">
                  {selectedLog.template}
                </p>
              </div>
              <div>
                <span className="text-2xs text-surface-500 uppercase">Paramètres extraits</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedLog.parameters.map((p, i) => (
                    <span key={i} className="text-xs bg-primary-600/15 text-primary-400 px-2 py-0.5 rounded">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-2xs text-surface-500 uppercase">Template ID</span>
                <p className="text-sm font-mono">{selectedLog.template_id}</p>
              </div>
              <div className="pt-3 border-t border-surface-700">
                <span className="text-2xs text-surface-500 uppercase">Message brut</span>
                <p className="font-mono text-xs text-surface-300 mt-1 break-all">
                  {selectedLog.raw_message}
                </p>
              </div>
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
