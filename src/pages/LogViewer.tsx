import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { RawLog, ParsedLog } from "@/types";
import { Search, Filter, RefreshCw, ChevronLeft, ChevronRight, Globe, Monitor } from "lucide-react";

export default function LogViewer() {
  const [logs, setLogs] = useState<RawLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<ParsedLog | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [networkTypeFilter, setNetworkTypeFilter] = useState<"all" | "local" | "network">("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const perPage = 50;

  const isNetworkLog = (log: RawLog) => {
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(log.hostname) && log.hostname !== "127.0.0.1";
    return log.source_id.startsWith("network_") || isIp;
  };

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<[RawLog[], number]>("get_raw_logs", {
        limit: perPage,
        offset: (page - 1) * perPage,
        query: search.trim() ? search.trim() : null,
        sourceId: sourceFilter.trim() ? sourceFilter.trim() : null,
      });

      if (Array.isArray(result) && result[0]) {
        setLogs(result[0]);
        setTotal(result[1] || 0);
      } else if (Array.isArray(result)) {
        setLogs(result as unknown as RawLog[]);
        setTotal(result.length);
      }
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    } finally {
      setLoading(false);
    }
  }, [search, sourceFilter, page]);

  useEffect(() => {
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
    <div className="p-6 space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Explorateur de logs</h2>
          <p className="text-sm text-surface-400 mt-1">
            {total.toLocaleString()} logs indexés et chiffrés
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Network vs Local Tabs */}
          <div className="flex items-center gap-1 bg-surface-800 p-1 rounded-xl border border-surface-700 text-xs">
            <button
              onClick={() => setNetworkTypeFilter("all")}
              className={`px-3 py-1.5 rounded-lg transition-colors font-medium ${
                networkTypeFilter === "all" ? "bg-surface-600 text-white shadow-sm" : "text-surface-400 hover:text-surface-200"
              }`}
            >
              Tous
            </button>
            <button
              onClick={() => setNetworkTypeFilter("local")}
              className={`px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1.5 ${
                networkTypeFilter === "local" ? "bg-purple-900/70 text-purple-200 shadow-sm border border-purple-700/50" : "text-surface-400 hover:text-surface-200"
              }`}
            >
              <Monitor size={13} />
              💻 Hôte Local
            </button>
            <button
              onClick={() => setNetworkTypeFilter("network")}
              className={`px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1.5 ${
                networkTypeFilter === "network" ? "bg-cyan-900/70 text-cyan-200 shadow-sm border border-cyan-700/50" : "text-surface-400 hover:text-surface-200"
              }`}
            >
              <Globe size={13} />
              🌐 Réseau (IP)
            </button>
          </div>

          <button onClick={fetchLogs} className="btn-secondary" disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            className="input pl-10 w-full"
            placeholder="Rechercher par mot-clé, IP, commande, motif DLP..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Log table */}
      <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
        <div className="flex-1 overflow-auto card p-0 flex flex-col">
          <div className="overflow-y-auto flex-1">
            {filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-surface-500">
                {loading ? "Chargement des logs..." : "Aucun log correspondant au filtre sélectionné."}
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isNet = isNetworkLog(log);
                const isSelected = selectedRawLog?.id === log.id;
                return (
                  <div
                    key={log.id}
                    onClick={() => viewContext(log)}
                    className={`log-line cursor-pointer flex items-center gap-3 p-2.5 border-b border-surface-800/60 hover:bg-surface-800/40 transition-colors ${
                      isSelected ? "bg-primary-500/10 border-l-4 border-l-primary-500" : ""
                    }`}
                  >
                    <span className="text-surface-500 whitespace-nowrap text-2xs font-mono">
                      {new Date(log.timestamp).toLocaleString("fr-FR", {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>

                    {/* Source Origin Badge */}
                    {isNet ? (
                      <span className="text-3xs font-semibold px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-400 border border-cyan-800/60 flex items-center gap-1 shrink-0 font-mono">
                        <Globe size={11} />
                        {log.hostname}
                      </span>
                    ) : (
                      <span className="text-3xs font-semibold px-2 py-0.5 rounded bg-purple-950/90 text-purple-300 border border-purple-800/60 flex items-center gap-1 shrink-0 font-mono">
                        💻 {log.hostname}
                      </span>
                    )}

                    <span className="text-surface-200 truncate flex-1 font-mono text-xs">
                      {log.raw_message}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="p-3 border-t border-surface-800 flex items-center justify-between text-xs text-surface-400 bg-surface-900/40">
              <span>Page {page} sur {totalPages}</span>
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
                <span className="text-2xs text-surface-500 uppercase font-semibold">Log Sélectionné</span>
                <p className="font-mono text-xs text-amber-300 bg-surface-900 border border-amber-500/30 rounded p-2.5 mt-1 break-all">
                  {selectedRawLog.raw_message}
                </p>
                <p className="text-2xs text-surface-500 mt-1 font-mono">
                  Hôte: {selectedRawLog.hostname} · Source: {selectedRawLog.source_id}
                </p>
              </div>

              {contextLogs.length > 0 && (
                <div className="pt-2 border-t border-surface-800">
                  <span className="text-2xs text-surface-400 uppercase font-semibold">
                    Storyline (Contexte Immédiat ±10 logs)
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
    </div>
  );
}
