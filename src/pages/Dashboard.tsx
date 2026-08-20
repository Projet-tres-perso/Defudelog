import React, { useEffect, useState, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { DashboardStats, Alert, RawLog, AlertCategory, TimeSeriesPoint } from "@/types";
import {
  AlertTriangle, ScrollText, Radio, Activity,
  ShieldAlert, KeyRound, Cpu, Lock, Play, Pause,
  RefreshCw, Terminal, Globe, ShieldCheck, ShieldAlert as ShieldIcon,
  Zap, ExternalLink, ChevronLeft, ChevronRight
} from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [timeseries, setTimeseries] = useState<TimeSeriesPoint[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [recentLogs, setRecentLogs] = useState<RawLog[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [logFilter, setLogFilter] = useState<"all" | "local" | "network">("all");
  const [isLivePaused, setIsLivePaused] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const [logsTotal, setLogsTotal] = useState(0);
  const logsPerPage = 10;
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const pendingLogsRef = useRef<RawLog[]>([]);

  const checkAdminStatus = async () => {
    try {
      const admin = await invoke<boolean>("check_is_admin");
      setIsAdmin(admin);
    } catch (e) {
      console.warn("Erreur check_is_admin:", e);
      setIsAdmin(false);
    }
  };

  const handleRelaunchAdmin = async () => {
    try {
      await invoke("relaunch_as_admin");
    } catch (e) {
      alert("Erreur lors de la demande d'élévation: " + String(e));
    }
  };

  const fetchPageLogs = async (targetPage: number) => {
    try {
      const logsRes = await invoke<{ logs: RawLog[]; total: number }>("get_raw_logs", {
        limit: logsPerPage,
        offset: (targetPage - 1) * logsPerPage,
      });
      setRecentLogs(logsRes?.logs || []);
      setLogsTotal(logsRes?.total || 0);
    } catch (e) {
      console.error("Erreur fetchPageLogs:", e);
    }
  };

  const fetchAllData = async () => {
    try {
      const s = await invoke<DashboardStats>("get_dashboard_stats");
      setStats(s);

      const ts = await invoke<TimeSeriesPoint[]>("get_timeseries_stats");
      setTimeseries(ts || []);

      const alertsRes = await invoke<{ alerts: Alert[] }>("get_alerts", { level: null, page: 1, perPage: 6 });
      setRecentAlerts(alertsRes.alerts || []);

      // Si nous sommes sur la page 1 et en mode direct, on met à jour les logs récents
      if (logsPage === 1 && !isLivePaused) {
        const logsRes = await invoke<{ logs: RawLog[]; total: number }>("get_raw_logs", { limit: logsPerPage, offset: 0 });
        setRecentLogs(logsRes?.logs || []);
        setLogsTotal(logsRes?.total || 0);
      }

      const monStatus = await invoke<{ monitoring: boolean }>("get_monitoring_status");
      setIsMonitoring(monStatus?.monitoring ?? false);

      setLastRefreshed(new Date());
    } catch (e) {
      console.error("Erreur mise à jour Dashboard:", e);
    }
  };

  const handlePageChange = async (newPage: number) => {
    setLogsPage(newPage);
    if (newPage > 1) {
      // Auto-freeze : fige automatiquement le défilement dès qu'on feuillette les pages
      setIsLivePaused(true);
      await fetchPageLogs(newPage);
    } else {
      // Revenir à la première page
      await fetchPageLogs(1);
    }
  };

  const resumeLiveStream = async () => {
    setLogsPage(1);
    setIsLivePaused(false);
    await fetchPageLogs(1);
  };

  useEffect(() => {
    checkAdminStatus();
    fetchAllData();

    // Polling régulier de sécurité
    const interval = setInterval(fetchAllData, 3000);

    // Écoute réactive en arrière-plan avec BUFFERING / BATCHING
    let unlistenFn: (() => void) | undefined;
    listen<RawLog>("log-ingested", (event) => {
      if (event.payload) {
        pendingLogsRef.current.push(event.payload);
      }
    }).then((unlisten) => {
      unlistenFn = unlisten;
    }).catch((e) => console.warn("Erreur listen log-ingested:", e));

    // Flush régulé du buffer toutes les 350ms (uniquement si en direct et sur la page 1)
    const flushInterval = setInterval(() => {
      if (pendingLogsRef.current.length > 0 && !isLivePaused && logsPage === 1) {
        const batch = [...pendingLogsRef.current];
        pendingLogsRef.current = [];
        setRecentLogs((prev) => [...batch.reverse(), ...prev].slice(0, logsPerPage));
        setLogsTotal((prev) => prev + batch.length);
      }
    }, 350);

    return () => {
      clearInterval(interval);
      clearInterval(flushInterval);
      if (unlistenFn) unlistenFn();
    };
  }, [isLivePaused, logsPage]);

  const toggleMonitoring = async () => {
    setMonitoringLoading(true);
    try {
      if (isMonitoring) {
        await invoke("stop_monitoring");
        setIsMonitoring(false);
      } else {
        await invoke("start_monitoring");
        setIsMonitoring(true);
      }
      await fetchAllData();
    } catch (e) {
      console.error("Erreur toggle monitoring:", e);
    } finally {
      setMonitoringLoading(false);
    }
  };

  const isNetworkLog = (log: RawLog) => {
    const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(log.hostname) && log.hostname !== "127.0.0.1";
    return log.source_id.startsWith("network_") || isIp;
  };

  const filteredLogs = useMemo(() => {
    return recentLogs.filter((l) => {
      if (logFilter === "all") return true;
      if (logFilter === "network") return isNetworkLog(l);
      if (logFilter === "local") return !isNetworkLog(l);
      return true;
    });
  }, [recentLogs, logFilter]);

  const categoryCounts = useMemo(() => {
    return recentAlerts.reduce((acc, a) => {
      acc[a.category] = (acc[a.category] || 0) + 1;
      return acc;
    }, {} as Record<AlertCategory, number>);
  }, [recentAlerts]);

  const statCards = [
    { label: "Logs (24h)", value: stats?.logs_last_24h ?? 0, icon: ScrollText, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Total logs", value: stats?.total_logs ?? 0, icon: Activity, color: "text-emerald-400", bg: "bg-emerald-500/10" },
    { label: "Sources actives", value: stats?.active_sources ?? 0, icon: Radio, color: "text-violet-400", bg: "bg-violet-500/10" },
    { label: "Alertes (24h)", value: stats?.alerts_last_24h ?? 0, icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10" },
  ];

  const threatCategories = [
    { key: "data_leak" as AlertCategory, label: "Fuite de données", icon: ShieldAlert, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
    { key: "authentication" as AlertCategory, label: "Authentification / Force-brute", icon: KeyRound, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
    { key: "system_anomaly" as AlertCategory, label: "Anomalies système", icon: Cpu, color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/30" },
    { key: "privilege_escalation" as AlertCategory, label: "Élévation de privilèges", icon: Lock, color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/30" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Bandeau d'alerte Privilèges Administrateur (UAC) */}
      {isAdmin === false && (
        <div className="card bg-amber-950/40 border-amber-500/50 p-4 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <ShieldIcon size={22} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-amber-200">Mode Standard Détecté (Privilèges restreints)</h4>
              <p className="text-xs text-amber-300/80 mt-0.5">
                Pour surveiller les journaux sensibles Windows EventLog (Security, Sysmon) ou modifier les règles réseau, l'accès Administrateur est requis.
              </p>
            </div>
          </div>
          <button
            onClick={handleRelaunchAdmin}
            className="btn bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs flex items-center gap-1.5 px-3.5 py-2 shadow-md transition-transform active:scale-95"
          >
            <Zap size={14} className="fill-current" />
            Relancer en tant qu'Administrateur (UAC)
          </button>
        </div>
      )}

      {/* Dynamic Header & Admin Control */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Dashboard Sécurité & DLP</h2>
          <p className="text-sm text-surface-400 mt-1 flex items-center gap-2">
            <span>Surveillance multi-axes en temps réel & Tâche de fond</span>
            <span>•</span>
            <span className="text-2xs text-surface-500">Mis à jour à {lastRefreshed.toLocaleTimeString()}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchAllData} className="btn-ghost p-2 text-surface-400 hover:text-surface-200" title="Rafraîchir">
            <RefreshCw size={16} />
          </button>

          {/* Admin Monitoring Activation Button */}
          <button
            onClick={toggleMonitoring}
            disabled={monitoringLoading}
            className={`btn flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-lg ${
              isMonitoring
                ? "bg-amber-600/90 hover:bg-amber-600 text-white shadow-amber-900/20 border border-amber-500/30"
                : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20 border border-emerald-500/30"
            }`}
          >
            {isMonitoring ? (
              <>
                <Pause size={15} />
                {monitoringLoading ? "Arrêt..." : "Suspendre la surveillance"}
              </>
            ) : (
              <>
                <Play size={15} className="fill-current" />
                {monitoringLoading ? "Démarrage..." : "Autoriser & Démarrer la surveillance (Admin)"}
              </>
            )}
          </button>

          {/* Live Status Indicator */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
            isMonitoring
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-amber-500/10 border-amber-500/30 text-amber-400"
          }`}>
            <div className={`w-2 h-2 rounded-full ${
              isMonitoring ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
            }`} />
            <span className="text-xs font-medium">
              {isMonitoring ? "Surveillance active (Systray)" : "Surveillance en pause"}
            </span>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="card flex items-start justify-between">
            <div>
              <p className="stat-label">{label}</p>
              <p className="stat-value mt-1 tabular-nums">{value.toLocaleString()}</p>
            </div>
            <div className={`p-2 rounded-lg ${bg}`}>
              <Icon size={20} className={color} />
            </div>
          </div>
        ))}
      </div>

      {/* Threat Category Cards */}
      <div className="grid grid-cols-4 gap-4">
        {threatCategories.map(({ key, label, icon: Icon, color, bg, border }) => {
          const count = categoryCounts[key] || 0;
          return (
            <div key={key} className={`card flex items-center justify-between border ${border} ${bg}`}>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-surface-900/60">
                  <Icon size={18} className={color} />
                </div>
                <div>
                  <p className="text-xs text-surface-400 font-medium">{label}</p>
                  <p className="text-lg font-bold tabular-nums mt-0.5">{count}</p>
                </div>
              </div>
              {count > 0 ? (
                <span className="badge bg-red-500/20 text-red-400 text-2xs animate-pulse">Détecté</span>
              ) : (
                <span className="badge bg-emerald-500/10 text-emerald-400 text-2xs flex items-center gap-1">
                  <ShieldCheck size={12} />
                  Sain
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Timeseries Graph */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-surface-200">Activité des logs & Détection d'anomalies (24h)</h3>
          <span className="text-2xs text-surface-500 font-mono">Résolution: 1 heure</span>
        </div>
        <div className="h-64 w-full">
          {timeseries.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeseries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="logGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                  </linearGradient>
                  <linearGradient id="alertGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.6}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis dataKey="time" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "0.5rem", fontSize: "12px" }}
                  itemStyle={{ color: "#e2e8f0" }}
                />
                <Area type="monotone" dataKey="logs" name="Logs reçus" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#logGradient)" />
                <Area type="monotone" dataKey="alerts" name="Alertes qualifiées" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#alertGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-surface-500 text-xs">
              En attente de données chronologiques...
            </div>
          )}
        </div>
      </div>

      {/* Two columns : Recent Alerts & Recent Ingested Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" />
              Derniers Incidents & Alertes
            </h3>
            <span className="text-xs text-surface-500">{recentAlerts.length} alertes</span>
          </div>

          <div className="space-y-2">
            {recentAlerts.length === 0 ? (
              <div className="text-center py-8 text-surface-500 text-xs">
                <ShieldCheck size={28} className="mx-auto mb-2 text-emerald-500/60" />
                Aucune alerte de sécurité active. Le système est protégé.
              </div>
            ) : (
              recentAlerts.map((a) => (
                <div key={a.id} className="p-3 rounded-lg bg-surface-900 border border-surface-800 flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`badge text-2xs uppercase ${
                        a.level === "high" ? "bg-red-500/20 text-red-400" :
                        a.level === "moderate" ? "bg-amber-500/20 text-amber-400" :
                        "bg-blue-500/20 text-blue-400"
                      }`}>
                        {a.level}
                      </span>
                      <span className="text-xs font-semibold text-surface-200 capitalize">
                        {a.category.replace("_", " ")}
                      </span>
                      <span className="text-2xs text-surface-500">
                        Score: {(a.final_score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="text-xs font-mono text-surface-300 truncate">{a.template}</p>
                    {a.llm_explanation && (
                      <p className="text-2xs text-primary-300 bg-primary-950/40 border border-primary-900/50 rounded px-2 py-1 mt-1">
                        💡 SOC IA: {a.llm_explanation}
                      </p>
                    )}
                  </div>
                  <span className="text-2xs text-surface-500 whitespace-nowrap">
                    {new Date(a.detected_at).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live Raw Logs Ingestion with Filter */}
        <div className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Terminal size={16} className="text-primary-400" />
              <span>Flux des Logs Ingestés en Direct</span>
              {isLivePaused ? (
                <span className="badge bg-amber-500/20 text-amber-300 text-3xs border border-amber-500/30">
                  Défilement Figé (Pause)
                </span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" title="Flux temps réel actif" />
              )}
            </h3>
            
            <div className="flex items-center gap-2">
              {/* Pause / Resume Button */}
              <button
                type="button"
                onClick={() => setIsLivePaused(!isLivePaused)}
                className={`text-2xs px-2.5 py-1 rounded-lg border flex items-center gap-1 font-medium transition-all ${
                  isLivePaused
                    ? "bg-amber-900/60 border-amber-600/60 text-amber-200 hover:bg-amber-800/80"
                    : "bg-surface-800 border-surface-700 text-surface-300 hover:text-white"
                }`}
                title={isLivePaused ? "Reprendre le défilement temps réel" : "Figer le flux pour lire tranquillement"}
              >
                {isLivePaused ? <Play size={11} className="fill-current" /> : <Pause size={11} />}
                <span>{isLivePaused ? "Reprendre" : "Pause"}</span>
              </button>

              {/* Filter buttons */}
              <div className="flex items-center gap-1 bg-surface-900 p-0.5 rounded-lg border border-surface-800 text-2xs">
                <button
                  onClick={() => setLogFilter("all")}
                  className={`px-2 py-1 rounded transition-colors ${logFilter === "all" ? "bg-surface-700 text-white font-medium" : "text-surface-400 hover:text-surface-200"}`}
                >
                  Tous ({recentLogs.length})
                </button>
                <button
                  onClick={() => setLogFilter("local")}
                  className={`px-2 py-1 rounded transition-colors ${logFilter === "local" ? "bg-purple-900/60 text-purple-200 font-medium" : "text-surface-400 hover:text-surface-200"}`}
                >
                  💻 Locaux
                </button>
                <button
                  onClick={() => setLogFilter("network")}
                  className={`px-2 py-1 rounded transition-colors ${logFilter === "network" ? "bg-cyan-900/60 text-cyan-200 font-medium" : "text-surface-400 hover:text-surface-200"}`}
                >
                  🌐 Réseau (IP)
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-2xs">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-8 text-surface-500 text-xs font-sans">
                {recentLogs.length === 0 ? "En attente d'ingestion de logs..." : "Aucun log correspondant au filtre."}
              </div>
            ) : (
              filteredLogs.map((l: RawLog) => {
                const isNet = isNetworkLog(l);
                const meaning = l.meaning || l.raw_message;
                return (
                  <div key={l.id} className="p-2.5 rounded-lg bg-surface-900/80 border border-surface-800/80 flex items-start justify-between gap-3 hover:border-surface-700 transition-colors">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      {isNet ? (
                        <span className="text-3xs font-semibold px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 flex items-center gap-1 shrink-0 font-mono mt-0.5">
                          <Globe size={10} />
                          {l.hostname}
                        </span>
                      ) : (
                        <span className="text-3xs font-semibold px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60 flex items-center gap-1 shrink-0 font-mono mt-0.5">
                          💻 {l.hostname}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-surface-100 font-medium text-xs leading-snug">{meaning}</p>
                        {l.meaning && (
                          <p className="text-surface-500 font-mono text-3xs truncate mt-0.5">{l.raw_message}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-surface-500 whitespace-nowrap font-mono text-3xs mt-0.5">
                      {new Date(l.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Smart Pagination Bar with Auto-Freeze Controls */}
          <div className="p-3 border-t border-surface-800/80 rounded-b-xl flex flex-wrap items-center justify-between gap-3 text-xs bg-surface-900/60">
            {/* Left Status indicator */}
            <div className="flex items-center gap-2">
              {logsPage === 1 && !isLivePaused ? (
                <div className="flex items-center gap-1.5 text-emerald-400 font-medium text-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>Flux direct actif (Page 1)</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={resumeLiveStream}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 text-2xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
                  title="Revenir immédiatement au direct et réactiver le flux temps réel"
                >
                  <Play size={11} className="fill-current text-emerald-400" />
                  <span>Reprendre le Direct</span>
                </button>
              )}
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center gap-3">
              <span className="text-2xs text-surface-400 font-mono">
                Page {logsPage} sur {Math.max(1, Math.ceil(logsTotal / logsPerPage))} {logsTotal > 0 && `(${logsTotal.toLocaleString()} logs)`}
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handlePageChange(Math.max(1, logsPage - 1))}
                  disabled={logsPage === 1}
                  className="btn-ghost p-1 disabled:opacity-30 text-surface-300 hover:text-white"
                  title="Page précédente (Fige automatiquement le flux)"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => handlePageChange(logsPage + 1)}
                  disabled={logsPage >= Math.ceil(logsTotal / logsPerPage)}
                  className="btn-ghost p-1 disabled:opacity-30 text-surface-300 hover:text-white"
                  title="Page suivante (Fige automatiquement le flux)"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
