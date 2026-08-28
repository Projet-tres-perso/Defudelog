import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Alert, AlertLevel, AlertCategory } from "@/types";
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  Clock,
  ShieldAlert,
  KeyRound,
  Cpu,
  Lock,
  Flame,
} from "lucide-react";

const levelConfig: Record<AlertLevel, { icon: typeof AlertTriangle; className: string; label: string }> = {
  high: { icon: AlertTriangle, className: "badge-high", label: "Haute" },
  moderate: { icon: AlertCircle, className: "badge-moderate", label: "Modérée" },
  low: { icon: Info, className: "badge-low", label: "Faible" },
  benign: { icon: CheckCircle, className: "badge-benign", label: "Bénigne" },
};

const categoryConfig: Record<AlertCategory, { icon: typeof ShieldAlert; label: string; color: string }> = {
  data_leak: { icon: ShieldAlert, label: "Risque de fuite de données", color: "bg-red-500/15 text-red-400 border-red-500/30" },
  authentication: { icon: KeyRound, label: "Authentification", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  system_anomaly: { icon: Cpu, label: "Système / Panne", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  privilege_escalation: { icon: Lock, label: "Privilèges", color: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  general: { icon: Flame, label: "Générale", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
};

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [levelFilter, setLevelFilter] = useState<AlertLevel | "">("");
  const [categoryFilter, setCategoryFilter] = useState<AlertCategory | "">("");
  const [loading, setLoading] = useState(false);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const result = await invoke<{ alerts: Alert[] }>("get_alerts", {
        level: levelFilter || null,
        page: 1,
        perPage: 100,
      });
      setAlerts(result.alerts || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, [levelFilter]);

  const filteredAlerts = alerts.filter((a) => !categoryFilter || a.category === categoryFilter);

  const acknowledge = async (alertId: string) => {
    try {
      await invoke("acknowledge_alert", { alertId });
      fetchAlerts();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      <div>
        <h2 className="text-xl font-bold">Alertes & Menaces Sécurité</h2>
        <p className="text-sm text-surface-400 mt-1">
          {filteredAlerts.filter((a) => !a.acknowledged).length} alertes non acquittées sur le réseau
        </p>
      </div>

      {/* Filters Bar */}
      <div className="space-y-3 bg-surface-900/60 p-3.5 rounded-xl border border-surface-800">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="text-2xs font-semibold text-surface-400 uppercase tracking-wider w-20 shrink-0">Sévérité :</span>
          <div className="flex flex-wrap gap-1.5">
            {(["", "high", "moderate", "low", "benign"] as const).map((level) => (
              <button
                key={level}
                onClick={() => setLevelFilter(level)}
                className={`btn text-xs px-3 py-1.5 ${
                  levelFilter === level ? "btn-primary" : "btn-ghost"
                }`}
              >
                {level === "" ? "Toutes" : levelConfig[level].label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <span className="text-2xs font-semibold text-surface-400 uppercase tracking-wider w-20 shrink-0">Menace :</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCategoryFilter("")}
              className={`btn text-xs px-3 py-1.5 ${categoryFilter === "" ? "btn-primary" : "btn-ghost"}`}
            >
              Toutes les catégories
            </button>
            {(["data_leak", "authentication", "system_anomaly", "privilege_escalation"] as const).map((cat) => {
              const catConf = categoryConfig[cat];
              const CatIcon = catConf.icon;
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`btn text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap ${
                    categoryFilter === cat ? "btn-primary" : "btn-ghost"
                  }`}
                >
                  <CatIcon size={14} className="shrink-0" />
                  <span>{catConf.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Alert list */}
      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row gap-4 min-h-0">
        <div className="flex-1 overflow-auto card p-0">
          {filteredAlerts.length === 0 ? (
            <div className="p-8 text-center text-surface-500">
              {loading ? "Chargement..." : "Aucune alerte trouvée"}
            </div>
          ) : (
            filteredAlerts.map((alert) => {
              const config = levelConfig[alert.level];
              const catConf = categoryConfig[alert.category] || categoryConfig.general;
              const Icon = config.icon;
              const CatIcon = catConf.icon;

              return (
                <div
                  key={alert.id}
                  className={`flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5 border-b border-surface-800 cursor-pointer hover:bg-surface-800/50 transition-colors ${
                    !alert.acknowledged ? "bg-surface-800/30" : ""
                  }`}
                  onClick={() => setSelectedAlert(alert)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Icon size={18} className={`${config.className.replace("badge-", "text-")} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <p className="text-sm font-medium truncate" title={alert.template || alert.reasons[0]}>
                          {alert.template || alert.reasons[0] || "Alerte de sécurité"}
                        </p>
                        <span className={`px-2 py-0.5 text-3xs font-semibold rounded-full border ${catConf.color} flex items-center gap-1 shrink-0 whitespace-nowrap`}>
                          <CatIcon size={10} className="shrink-0" />
                          {catConf.label}
                        </span>
                      </div>
                      <p className="text-xs text-surface-500 mt-0.5 flex items-center gap-2">
                        <Clock size={12} className="shrink-0" />
                        <span>{new Date(alert.detected_at).toLocaleString("fr-FR")}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span className={`${config.className} shrink-0 whitespace-nowrap`}>{config.label}</span>
                    <span className="text-sm font-mono font-medium text-surface-200 shrink-0">
                      {(alert.final_score * 100).toFixed(0)}%
                    </span>
                    {!alert.acknowledged && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          acknowledge(alert.id);
                        }}
                        className="btn-ghost text-xs text-emerald-400 p-1.5 rounded-lg hover:bg-emerald-500/10 shrink-0"
                        title="Acquitter l'alerte"
                      >
                        <CheckCircle size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Alert detail panel */}
        {selectedAlert && (
          <div className="w-96 flex-shrink-0 card space-y-4 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Détail de l'alerte</h3>
              <span className={`badge-${selectedAlert.level}`}>
                {levelConfig[selectedAlert.level].label}
              </span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 text-xs font-semibold rounded-lg border ${categoryConfig[selectedAlert.category]?.color || categoryConfig.general.color} flex items-center gap-1.5`}>
                  {categoryConfig[selectedAlert.category] && React.createElement(categoryConfig[selectedAlert.category].icon, { size: 14 })}
                  {categoryConfig[selectedAlert.category]?.label || "Générale"}
                </span>
              </div>

              {selectedAlert.template && (
                <div>
                  <span className="text-2xs text-surface-500 uppercase font-semibold">Template</span>
                  <p className="font-mono text-xs bg-surface-800 rounded p-2 mt-1 break-all">
                    {selectedAlert.template}
                  </p>
                </div>
              )}

              {/* Verdict et Analyse SOC LLM */}
              {selectedAlert.llm_explanation && (
                <div className="bg-primary-950/40 border border-primary-500/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-primary-400 font-semibold text-xs">
                    <ShieldAlert size={14} />
                    <span>Verdict SOC IA (Analyse Contextuelle)</span>
                  </div>
                  <p className="text-xs text-surface-200 leading-relaxed font-sans">
                    {selectedAlert.llm_explanation}
                  </p>
                </div>
              )}

              {/* Recommandation de Remédiation SOAR */}
              {selectedAlert.mitigation_suggestion && (
                <div className="bg-amber-950/40 border border-amber-500/30 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-xs">
                    <Lock size={14} />
                    <span>Action Corrective Recommandée (SOAR)</span>
                  </div>
                  <p className="text-xs text-amber-200/90 leading-relaxed font-sans">
                    {selectedAlert.mitigation_suggestion}
                  </p>
                </div>
              )}

              <div>
                <span className="text-2xs text-surface-500 uppercase font-semibold">Raisons de détection</span>
                <ul className="mt-1 space-y-1">
                  {selectedAlert.reasons.map((r, i) => (
                    <li key={i} className="text-sm text-surface-300 flex items-start gap-2">
                      <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-surface-700">
                <div>
                  <span className="text-2xs text-surface-500 uppercase font-semibold">Score supervisé</span>
                  <p className="text-sm font-mono">
                    {selectedAlert.supervised_score != null
                      ? (selectedAlert.supervised_score * 100).toFixed(1) + "%"
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-2xs text-surface-500 uppercase font-semibold">Score anomalie</span>
                  <p className="text-sm font-mono">
                    {selectedAlert.anomaly_score != null
                      ? (selectedAlert.anomaly_score * 100).toFixed(1) + "%"
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-2xs text-surface-500 uppercase font-semibold">Cluster</span>
                  <p className="text-sm font-mono">
                    {selectedAlert.cluster_id != null ? selectedAlert.cluster_id : "N/A"}
                    {selectedAlert.is_outlier && " (outlier)"}
                  </p>
                </div>
                <div>
                  <span className="text-2xs text-surface-500 uppercase font-semibold">Score final</span>
                  <p className="text-sm font-mono font-bold text-primary-400">
                    {(selectedAlert.final_score * 100).toFixed(1)}%
                  </p>
                </div>
              </div>

              {selectedAlert.context_logs.length > 0 && (
                <div className="pt-3 border-t border-surface-700">
                  <span className="text-2xs text-surface-500 uppercase font-semibold">
                    Contexte ({selectedAlert.context_logs.length} logs)
                  </span>
                  <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                    {selectedAlert.context_logs.map((log, i) => (
                      <p key={i} className="font-mono text-xs text-surface-400 bg-surface-800 rounded px-2 py-1">
                        {log}
                      </p>
                    ))}
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
