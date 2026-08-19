import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Alert, DashboardStats } from "@/types";
import InfoTooltip from "@/components/InfoTooltip";
import {
  FileText, Download, Sparkles, ShieldAlert, CheckCircle2,
  Clock, AlertTriangle, Cpu, KeyRound, Lock, FileSpreadsheet,
} from "lucide-react";

export default function Reports() {
  const [generating, setGenerating] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);
  const [llmUsed, setLlmUsed] = useState<boolean>(false);

  const generateReport = async () => {
    setGenerating(true);
    setReportMarkdown(null);
    try {
      // 1. Récupérer les données réelles et les paramètres
      const [stats, alertsResult, settings] = await Promise.all([
        invoke<DashboardStats>("get_dashboard_stats"),
        invoke<{ alerts: Alert[] }>("get_alerts", { level: null, page: 1, perPage: 50 }),
        invoke<any>("get_settings")
      ]);
      const alerts = alertsResult.alerts || [];

      // 2. Préparer le prompt
      const summaryText = `
Statistiques DeFuDoLog v2:
- Total logs: ${stats.total_logs}
- Total alertes: ${stats.total_alerts} (Hautes: ${stats.high_alerts}, Modérées: ${stats.moderate_alerts})
- Top 3 alertes récentes:
${alerts.slice(0, 3).map((a) => `- [Catégorie: ${a.category}] Niveau: ${a.level}, Template: ${a.template || a.reasons[0]}`).join("\n")}
      `;

      let aiResponse: string | null = null;

      // 3. Tenter d'appeler un LLM Local si configuré
      if (settings?.llm?.enabled) {
        try {
          const baseUrl = settings.llm.base_url || "http://localhost:1234/v1";
          const model = settings.llm.model || "local-model";
          
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              ...(settings.llm.api_key ? { "Authorization": `Bearer ${settings.llm.api_key}` } : {})
            },
            body: JSON.stringify({
              model: model,
              messages: [
                {
                  role: "system",
                  content: "Tu es un expert en cybersécurité (SOC / Incident Response). Génère un rapport d'analyse en Markdown professionnel sur les alertes de sécurité détectées.",
                },
                { role: "user", content: summaryText },
              ],
              temperature: 0.3,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            aiResponse = data.choices?.[0]?.message?.content;
            setLlmUsed(true);
          }
        } catch (e) {
          // LLM local non disponible ou en erreur, fallback sur le rapport analytique structuré
          console.warn("Erreur LLM, utilisation du fallback:", e);
        }
      }

      if (!aiResponse) {
        setLlmUsed(false);
        aiResponse = generateFallbackReport(stats, alerts);
      }

      setReportMarkdown(aiResponse);
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  const generateFallbackReport = (stats: DashboardStats, alerts: Alert[]) => {
    const now = new Date().toLocaleString("fr-FR");
    const dataLeaks = alerts.filter((a) => a.category === "data_leak");
    const authAlerts = alerts.filter((a) => a.category === "authentication");
    const sysAlerts = alerts.filter((a) => a.category === "system_anomaly");
    const privAlerts = alerts.filter((a) => a.category === "privilege_escalation");

    return `# 🛡️ RAPPORT D'ANALYSE DE SÉCURITÉ MULTI-MENACES — DEFUDOLOG v2

**Date de génération** : ${now}  
**Périmètre d'analyse** : Machine Hôte + Nœuds Réseau (Syslog 1514)  
**Total d'événements analysés** : ${stats.total_logs.toLocaleString()}  

---

## 1. Synthèse Exécutive

La plateforme de détection DeFuDoLog a analysé **${stats.total_logs} logs** et a relevé un total de **${stats.total_alerts} alertes de sécurité** (dont **${stats.high_alerts} critiques** et **${stats.moderate_alerts} modérées**).

### Répartition par catégorie de menace :
- **🛡️ Fuites de données** : ${dataLeaks.length} alerte(s)
- **🔑 Intrusions & Force-Brute SSH/PAM** : ${authAlerts.length} alerte(s)
- **⚡ Anomalies système & Crashs** : ${sysAlerts.length} alerte(s)
- **🔒 Élévation de privilèges (sudo/root)** : ${privAlerts.length} alerte(s)

---

## 2. Détail des Incidents Majeurs

${alerts.slice(0, 5).map((a, i) => `
### Incident #${i + 1} — ${a.template || "Règle de détection"}
- **Catégorie** : \`${a.category.toUpperCase()}\`
- **Niveau** : **${a.level.toUpperCase()}** (Score final: ${(a.final_score * 100).toFixed(1)}%)
- **Horodatage** : ${new Date(a.detected_at).toLocaleString("fr-FR")}
- **Raisons de levée d'alerte** :
${a.reasons.map((r) => `  * ${r}`).join("\n")}
`).join("\n")}

---

## 3. Recommandations de Remédiation

1. **Isolation des IPs suspectes** : Configurer le pare-feu local/réseau pour bloquer les IPs associées aux tentatives d'authentification infructueuses.
2. **Contrôle d'accès aux données** : Restreindre les privilèges d'exportation de données et auditer les accès aux fichiers confidentiels.
3. **Surveillance continue** : Maintenir l'écouteur Syslog réseau (port 1514) actif pour capter les logs de toutes les machines distantes.
`;
  };

  const [notification, setNotification] = useState<{ type: "success" | "error"; message: string; filename?: string; size?: string } | null>(null);
  const [exportingFormat, setExportingFormat] = useState<string | null>(null);

  const showNotification = (message: string, filename?: string, size?: string) => {
    setNotification({ type: "success", message, filename, size });
    setTimeout(() => setNotification(null), 5000);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const downloadReportMarkdown = () => {
    if (!reportMarkdown) return;
    const blob = new Blob([reportMarkdown], { type: "text/markdown" });
    const filename = `rapport_secu_defudolog_${Date.now()}.md`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    showNotification("Rapport Markdown téléchargé avec succès.", filename, formatFileSize(blob.size));
  };

  const exportAlertsJson = async () => {
    setExportingFormat("json");
    try {
      const alertsResult = await invoke<{ alerts: Alert[] }>("get_alerts", { level: null, page: 1, perPage: 1000 });
      const alerts = alertsResult.alerts || [];
      const content = JSON.stringify(alerts, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const filename = `alertes_defudolog_${Date.now()}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      showNotification(`Export JSON réussi (${alerts.length} alertes).`, filename, formatFileSize(blob.size));
    } catch (e: any) {
      setNotification({ type: "error", message: "Erreur lors de l'export JSON : " + (e?.message || e) });
    } finally {
      setExportingFormat(null);
    }
  };

  const exportAlertsCsv = async () => {
    setExportingFormat("csv");
    try {
      const alertsResult = await invoke<{ alerts: Alert[] }>("get_alerts", { level: null, page: 1, perPage: 1000 });
      const alerts = alertsResult.alerts || [];
      const headers = ["ID", "Horodatage", "Niveau", "Catégorie", "Score", "Modèle/Template", "Explication IA"];
      const rows = alerts.map(a => [
        `"${a.id}"`,
        `"${new Date(a.detected_at).toLocaleString('fr-FR')}"`,
        `"${a.level}"`,
        `"${a.category}"`,
        `"${(a.final_score * 100).toFixed(0)}%"`,
        `"${(a.template || '').replace(/"/g, '""')}"`,
        `"${(a.llm_explanation || '').replace(/"/g, '""')}"`
      ]);
      const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const filename = `alertes_defudolog_${Date.now()}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      showNotification(`Export CSV réussi (${alerts.length} alertes exportées).`, filename, formatFileSize(blob.size));
    } catch (e: any) {
      setNotification({ type: "error", message: "Erreur lors de l'export CSV : " + (e?.message || e) });
    } finally {
      setExportingFormat(null);
    }
  };

  const exportSiem = async (format: "cef" | "leef" | "syslog") => {
    setExportingFormat(format);
    try {
      const exportedContent = await invoke<string>("export_alerts_siem", { format });
      const ext = format === "cef" ? "cef" : format === "leef" ? "leef" : "log";
      const blob = new Blob([exportedContent], { type: "text/plain" });
      const filename = `alertes_siem_${format}_${Date.now()}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      const formatName = format === "cef" ? "CEF (ArcSight / Splunk)" : format === "leef" ? "LEEF (IBM QRadar)" : "Syslog RFC 5424";
      showNotification(`Export ${formatName} téléchargé avec succès.`, filename, formatFileSize(blob.size));
    } catch (e: any) {
      setNotification({ type: "error", message: "Erreur lors de l'export SIEM : " + (e?.message || e) });
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Toast Notification */}
      {notification && (
        <div className={`p-4 rounded-xl border flex items-center justify-between shadow-2xl transition-all animate-in fade-in slide-in-from-top-2 ${
          notification.type === "success"
            ? "bg-emerald-950/80 border-emerald-500/50 text-emerald-200"
            : "bg-red-950/80 border-red-500/50 text-red-200"
        }`}>
          <div className="flex items-center gap-3">
            <CheckCircle2 size={20} className={notification.type === "success" ? "text-emerald-400" : "text-red-400"} />
            <div>
              <p className="text-xs font-bold">{notification.message}</p>
              {notification.filename && (
                <p className="text-2xs font-mono text-surface-300 mt-0.5">
                  Fichier : <strong className="text-white">{notification.filename}</strong> {notification.size && `(${notification.size})`}
                </p>
              )}
            </div>
          </div>
          <button onClick={() => setNotification(null)} className="text-xs opacity-70 hover:opacity-100 px-2 py-1">✕</button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">Rapports d'Analyse & Export SIEM</h2>
            <InfoTooltip title="Rapports & Exporter SIEM" content="Permet de générer des synthèses d'incident enrichies par IA ou d'exporter le journal d'alertes vers vos outils de supervision SIEM (ArcSight, Splunk, QRadar)." />
          </div>
          <p className="text-sm text-surface-400 mt-1">
            Génération de rapports d'incidents IA (LLM Local) et synthèses SIEM (CEF / LEEF)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* SIEM Export Group */}
          <div className="flex items-center gap-1 bg-surface-900 p-1 rounded-xl border border-surface-700">
            <span className="text-3xs text-surface-400 font-semibold px-2">SIEM:</span>
            <button
              onClick={() => exportSiem("cef")}
              disabled={exportingFormat !== null}
              className="btn-secondary text-2xs py-1 px-2.5 hover:text-blue-400 transition"
              title="CEF (Common Event Format) pour Splunk, ArcSight"
            >
              {exportingFormat === "cef" ? "..." : "CEF"}
            </button>
            <button
              onClick={() => exportSiem("leef")}
              disabled={exportingFormat !== null}
              className="btn-secondary text-2xs py-1 px-2.5 hover:text-amber-400 transition"
              title="LEEF (Log Event Extended Format) pour IBM QRadar"
            >
              {exportingFormat === "leef" ? "..." : "LEEF"}
            </button>
            <button
              onClick={() => exportSiem("syslog")}
              disabled={exportingFormat !== null}
              className="btn-secondary text-2xs py-1 px-2.5 hover:text-emerald-400 transition"
              title="Standard Syslog RFC 5424"
            >
              {exportingFormat === "syslog" ? "..." : "Syslog"}
            </button>
          </div>

          <button
            onClick={exportAlertsCsv}
            disabled={exportingFormat !== null}
            className="btn-secondary flex items-center gap-1.5 text-xs"
            title="Exporter les alertes au format CSV pour Excel"
          >
            <FileSpreadsheet size={15} className="text-emerald-400" />
            {exportingFormat === "csv" ? "Export..." : "CSV (Excel)"}
          </button>

          <button
            onClick={exportAlertsJson}
            disabled={exportingFormat !== null}
            className="btn-secondary flex items-center gap-1.5 text-xs"
            title="Exporter les alertes au format JSON brut"
          >
            <Download size={15} className="text-blue-400" />
            {exportingFormat === "json" ? "Export..." : "JSON"}
          </button>

          <button
            onClick={generateReport}
            disabled={generating}
            className="btn-primary flex items-center gap-2 text-xs"
          >
            <Sparkles size={16} className="text-amber-300" />
            {generating ? "Génération IA..." : "Générer Rapport IA"}
          </button>
        </div>
      </div>

      {!reportMarkdown ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center space-y-4">
          <FileText size={48} className="text-primary-400 opacity-60" />
          <div>
            <h3 className="text-lg font-semibold text-surface-200">
              Générez votre rapport d'analyse de sécurité
            </h3>
            <p className="text-sm text-surface-400 mt-2 max-w-md">
              Cliquez sur <strong>"Générer Rapport IA"</strong> pour obtenir une synthèse synthétisant les alertes de fuites de données, d'intrusions, et de pannes système.
            </p>
          </div>
          <button onClick={generateReport} disabled={generating} className="btn-primary mt-2">
            <Sparkles size={16} />
            Lancer l'analyse du rapport
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card flex items-center justify-between bg-primary-950/20 border-primary-500/30">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={20} className="text-emerald-400" />
              <div>
                <p className="text-sm font-semibold">Rapport généré avec succès</p>
                <p className="text-2xs text-surface-400">
                  {llmUsed ? "Analyse effectuée par LLM Local (LM Studio / Ollama)" : "Synthèse analytique structurée DeFuDoLog"}
                </p>
              </div>
            </div>
            <button onClick={downloadReportMarkdown} className="btn-primary flex items-center gap-2 text-xs">
              <Download size={14} />
              Télécharger (.md)
            </button>
          </div>

          <div className="card p-6 bg-surface-900 border border-surface-700">
            <pre className="whitespace-pre-wrap font-mono text-xs text-surface-200 leading-relaxed overflow-x-auto">
              {reportMarkdown}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
