import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { DashboardStats, Alert, RawLog, AlertCategory, TimeSeriesPoint } from "@/types";
import {
  AlertTriangle, ScrollText, Radio, Activity,
  ShieldAlert, KeyRound, Cpu, Lock, Zap, Clock,
  RefreshCw, CheckCircle2, Terminal, ChevronRight,
} from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [timeseries, setTimeseries] = useState<TimeSeriesPoint[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [recentLogs, setRecentLogs] = useState<RawLog[]>([]);
  const [generating, setGenerating] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchAllData = async () => {
    try {
      const s = await invoke<DashboardStats>("get_dashboard_stats");
      setStats(s);

      const ts = await invoke<TimeSeriesPoint[]>("get_timeseries_stats");
      setTimeseries(ts || []);

      const alertsRes = await invoke<{ alerts: Alert[] }>("get_alerts", { level: null, page: 1, perPage: 6 });
      setRecentAlerts(alertsRes.alerts || []);

      const logsRes = await invoke<[RawLog[], number]>("get_raw_logs", { limit: 6, offset: 0, query: null, sourceId: null });
      if (Array.isArray(logsRes) && logsRes[0]) {
        setRecentLogs(logsRes[0]);
      } else if (Array.isArray(logsRes)) {
        setRecentLogs(logsRes as unknown as RawLog[]);
      }

      setLastRefreshed(new Date());
    } catch (e) {
      console.error("Erreur mise à jour Dashboard:", e);
    }
  };

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 2500); // 2.5s real-time polling
    return () => clearInterval(interval);
  }, []);

  const generateDemoLogs = async () => {
    setGenerating(true);
    try {
      await invoke("generate_demo_logs");
      await fetchAllData();
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  // Décompte dynamique par catégorie de menace
  const categoryCounts = recentAlerts.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1;
    return acc;
  }, {} as Record<AlertCategory, number>);

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
      {/* Dynamic Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Dashboard Sécurité Multi-Menaces</h2>
          <p className="text-sm text-surface-400 mt-1 flex items-center gap-2">
            <span>Surveillance et détection d'anomalies en temps réel</span>
            <span>•</span>
            <span className="text-2xs text-surface-500">Mis à jour à {lastRefreshed.toLocaleTimeString()}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchAllData} className="btn-ghost p-2 text-surface-400 hover:text-surface-200" title="Rafraîchir">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={generateDemoLogs}
            disabled={generating}
            className="btn-primary flex items-center gap-2 text-xs"
          >
            <Zap size={14} className="text-amber-300 animate-bounce" />
            {generating ? "Génération & Analyse..." : "Simuler logs de démonstration"}
          </button>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">Monitoring actif</span>
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

      {/* Timeseries Graph */}
      <div className="card w-full h-[300px]">
        <div className="card-header mb-4">Activité globale (24h)</div>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={timeseries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorLogs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorAlerts" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="time" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', color: '#e4e4e7' }}
              itemStyle={{ color: '#e4e4e7' }}
            />
            <Area type="monotone" dataKey="logs" name="Logs reçus" stroke="#3b82f6" fillOpacity={1} fill="url(#colorLogs)" />
            <Area type="monotone" dataKey="alerts" name="Alertes" stroke="#ef4444" fillOpacity={1} fill="url(#colorAlerts)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Threat categories & Alert breakdown */}
      <div className="grid grid-cols-3 gap-4">
        {/* Threat Categories Coverage */}
        <div className="card col-span-2">
          <div className="card-header flex items-center justify-between">
            <span>Périmètre de détection des menaces</span>
            <span className="text-xs font-normal text-surface-400">Classifieur dynamique actif</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {threatCategories.map(({ key, label, icon: Icon, color, bg, border }) => {
              const count = categoryCounts[key] || 0;
              return (
                <div key={label} className={`p-3 rounded-xl border ${border} bg-surface-800/40 flex items-center justify-between`}>
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${bg}`}>
                      <Icon size={18} className={color} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{label}</p>
                      <p className="text-2xs text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
                        <CheckCircle2 size={10} />
                        Moteur IA & Règles actifs
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-bold tabular-nums text-surface-100">{count}</span>
                    <p className="text-3xs text-surface-400 uppercase">Alertes</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Alert severity */}
        <div className="card">
          <div className="card-header">Sévérité des alertes</div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-sm flex-1">Critiques</span>
              <span className="text-sm font-semibold tabular-nums">{stats?.high_alerts ?? 0}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-amber-500" />
              <span className="text-sm flex-1">Modérées</span>
              <span className="text-sm font-semibold tabular-nums">{stats?.moderate_alerts ?? 0}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-surface-500" />
              <span className="text-sm flex-1">Total alertes</span>
              <span className="text-sm font-semibold tabular-nums">{stats?.total_alerts ?? 0}</span>
            </div>
          </div>
          {stats && stats.total_alerts > 0 && (
            <div className="mt-4 pt-4 border-t border-surface-700">
              <div className="flex h-2 rounded-full overflow-hidden bg-surface-800">
                <div
                  className="bg-red-500 transition-all"
                  style={{ width: `${(stats.high_alerts / stats.total_alerts) * 100}%` }}
                />
                <div
                  className="bg-amber-500 transition-all"
                  style={{ width: `${(stats.moderate_alerts / stats.total_alerts) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Real-Time Live Feeds Section */}
      <div className="grid grid-cols-2 gap-4">
        {/* Real-Time Alert Feed */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400" />
              Flux d'alertes en temps réel
            </span>
            <span className="badge bg-amber-500/10 text-amber-400 text-2xs">Temps réel</span>
          </div>
          <div className="space-y-2 mt-2">
            {recentAlerts.length === 0 ? (
              <p className="text-sm text-surface-500 py-6 text-center">Aucune alerte récente</p>
            ) : (
              recentAlerts.map((alert) => (
                <div key={alert.id} className="p-2.5 rounded-lg bg-surface-800/60 border border-surface-700/50 flex items-center justify-between">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${alert.level === 'high' ? 'bg-red-500' : 'bg-amber-500'}`} />
                    <div className="truncate">
                      <p className="text-xs font-semibold truncate text-surface-200">{alert.template || alert.reasons[0]}</p>
                      <p className="text-3xs text-surface-400 truncate">
                        {alert.category.toUpperCase()} • Score: {(alert.final_score * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                  <span className="text-3xs text-surface-400 flex items-center gap-1 flex-shrink-0">
                    <Clock size={10} />
                    {new Date(alert.detected_at).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Real-Time Log Stream */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Terminal size={16} className="text-primary-400" />
              Flux de logs récents
            </span>
            <span className="badge bg-primary-500/10 text-primary-400 text-2xs">Live Stream</span>
          </div>
          <div className="space-y-2 mt-2">
            {recentLogs.length === 0 ? (
              <p className="text-sm text-surface-500 py-6 text-center">Aucun log récent</p>
            ) : (
              recentLogs.map((log) => (
                <div key={log.id} className="p-2.5 rounded-lg bg-surface-800/60 border border-surface-700/50 flex items-center justify-between font-mono text-xs">
                  <div className="truncate flex items-center gap-2">
                    <span className="text-3xs px-1.5 py-0.5 rounded bg-surface-700 text-primary-300 font-semibold">{log.hostname}</span>
                    <span className="truncate text-surface-300">{log.raw_message}</span>
                  </div>
                  <span className="text-3xs text-surface-500 flex-shrink-0 ml-2">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
