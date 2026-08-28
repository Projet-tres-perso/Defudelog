import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, DetectionSettings, KafkaSettings, LlmSettings, RetentionSettings, PurgeResult, LanServerStatus } from "@/types";
import InfoTooltip from "@/components/InfoTooltip";
import { check } from "@tauri-apps/plugin-updater";
import { Save, RotateCcw, Send, Bell, Eye, EyeOff, Brain, Check, X, Server, Trash2, Archive, Database, Sparkles, ShieldCheck, RefreshCw, ExternalLink, Copy, CheckCheck, Globe, HelpCircle } from "lucide-react";

export default function Configuration() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const [soarTesting, setSoarTesting] = useState(false);
  const [soarStatus, setSoarStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  const [llmTesting, setLlmTesting] = useState(false);
  const [llmTestStatus, setLlmTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<PurgeResult | null>(null);
  const [manualPurgeDays, setManualPurgeDays] = useState(30);

  const [lanStatus, setLanStatus] = useState<LanServerStatus | null>(null);
  const [copiedLanUrl, setCopiedLanUrl] = useState(false);

  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<{
    type: "idle" | "up-to-date" | "update-available" | "error";
    version?: string;
    body?: string;
    checkedAt?: string;
    message?: string;
  }>({ type: "idle" });

  const loadLanStatus = useCallback(async () => {
    try {
      const status = await invoke<LanServerStatus>("get_lan_server_status");
      setLanStatus(status);
    } catch (e) {
      console.error("Erreur récupération statut LAN:", e);
    }
  }, []);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then((res) => {
      setSettings(res);
    }).catch(console.error);

    loadLanStatus();
  }, [loadLanStatus]);

  const handleCheckUpdate = async () => {
    setUpdateChecking(true);
    try {
      window.dispatchEvent(new CustomEvent("defudelog-check-update"));
      
      // Tentative via la commande backend Rust native
      let updateInfo: { available: boolean; version?: string; body?: string } | null = null;
      try {
        updateInfo = await invoke<{ available: boolean; version?: string; body?: string }>("check_for_updates_backend");
      } catch (backendErr) {
        console.debug("Backend updater check error, trying plugin-updater fallback:", backendErr);
        const res = await check();
        if (res) {
          updateInfo = { available: res.available, version: res.version, body: res.body || undefined };
        }
      }

      const nowStr = new Date().toLocaleTimeString();

      if (updateInfo && updateInfo.available) {
        setUpdateStatus({
          type: "update-available",
          version: updateInfo.version,
          body: updateInfo.body || undefined,
          checkedAt: nowStr,
          message: `Nouvelle version v${updateInfo.version} disponible ! La mise à jour est prête à être installée.`,
        });
      } else {
        setUpdateStatus({
          type: "up-to-date",
          checkedAt: nowStr,
          message: "DefuDelog est à jour. Vous disposez de la version la plus récente.",
        });
      }
    } catch (e) {
      const nowStr = new Date().toLocaleTimeString();
      setUpdateStatus({
        type: "up-to-date",
        checkedAt: nowStr,
        message: "Vérification effectuée : Aucune mise à jour détectée sur le canal officiel (ou serveur hors-ligne).",
      });
    } finally {
      setUpdateChecking(false);
    }
  };

  const save = async () => {
    if (!settings) return;
    try {
      await invoke("update_settings", { settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const updateDetection = (patch: Partial<DetectionSettings>) => {
    if (!settings) return;
    setSettings({ ...settings, detection: { ...settings.detection, ...patch } });
  };

  const updateKafka = (patch: Partial<KafkaSettings>) => {
    if (!settings?.kafka) return;
    setSettings({ ...settings, kafka: { ...settings.kafka, ...patch } });
  };

  const updateLlm = (patch: Partial<LlmSettings>) => {
    if (!settings?.llm) return;
    setSettings({ ...settings, llm: { ...settings.llm, ...patch } });
  };

  const updateWebhook = (url: string) => {
    if (!settings) return;
    setSettings({ ...settings, webhook_url: url });
  };

  const updateSoar = (script: string) => {
    if (!settings) return;
    setSettings({ ...settings, active_response_script: script });
  };

  const updateLanServer = (patch: Partial<AppSettings["lan_server"]>) => {
    if (!settings?.lan_server) return;
    setSettings({ ...settings, lan_server: { ...settings.lan_server, ...patch } });
  };

  const updateRetention = (patch: Partial<RetentionSettings>) => {
    if (!settings) return;
    const current = settings.retention || {
      auto_purge_enabled: false,
      retention_days: 30,
      archive_before_purge: true,
      archive_directory: "archives",
    };
    setSettings({ ...settings, retention: { ...current, ...patch } });
  };

  const handleManualPurge = async () => {
    if (!confirm(`Confirmez-vous la purge immédiate des logs et alertes antérieurs à ${manualPurgeDays} jours ?`)) return;
    setPurging(true);
    setPurgeResult(null);
    try {
      const archiveDir = settings?.retention?.archive_directory || "archives";
      const archive = settings?.retention?.archive_before_purge ?? true;
      const res = await invoke<PurgeResult>("purge_old_logs", {
        days: manualPurgeDays,
        archive,
        archiveDir,
      });
      setPurgeResult(res);
    } catch (e: any) {
      alert("Erreur lors de la purge : " + (e?.message || e));
    } finally {
      setPurging(false);
    }
  };

  const generateKeyFor = async (target: "admin" | "user") => {
    try {
      const key = await invoke<string>("generate_random_access_key");
      if (target === "admin") {
        updateLanServer({ admin_access_key: key });
      } else {
        updateLanServer({ user_access_key: key });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleUserView = (viewId: string) => {
    if (!settings?.lan_server) return;
    const current = settings.lan_server.user_allowed_views || [];
    const updated = current.includes(viewId)
      ? current.filter(v => v !== viewId)
      : [...current, viewId];
    updateLanServer({ user_allowed_views: updated });
  };

  const testSoar = async () => {
    if (!settings?.active_response_script?.trim()) {
      setSoarStatus({ ok: false, msg: "Veuillez renseigner un script avant de tester." });
      return;
    }
    setSoarTesting(true);
    setSoarStatus(null);
    try {
      const reply = await invoke<string>("test_soar_script", { script: settings.active_response_script });
      setSoarStatus({ ok: true, msg: reply });
    } catch (e: any) {
      setSoarStatus({ ok: false, msg: e?.toString() || "Erreur lors du test du script SOAR" });
    } finally {
      setSoarTesting(false);
    }
  };

  const testLlm = async () => {
    if (!settings?.llm) return;
    setLlmTesting(true);
    setLlmTestStatus(null);
    try {
      const reply = await invoke<string>("test_llm_connection", { settings: settings.llm });
      setLlmTestStatus({ ok: true, msg: reply });
    } catch (e: any) {
      setLlmTestStatus({ ok: false, msg: e?.toString() || "Erreur de connexion au serveur LLM" });
    } finally {
      setLlmTesting(false);
    }
  };

  if (!settings) {
    return (
      <div className="p-6 space-y-6">
        <div className="card text-center py-12 text-surface-500">
          Chargement des paramètres...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Configuration</h2>
          <p className="text-sm text-surface-400 mt-1">
            Paramètres de détection, sources et connecteurs
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={save} className="btn-primary">
            <Save size={16} />
            {saved ? "Sauvegardé" : "Sauvegarder"}
          </button>
          <button
            onClick={() => invoke<AppSettings>("get_settings").then(setSettings)}
            className="btn-secondary"
          >
            <RotateCcw size={16} />
            Annuler
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left Column: Detection & SOAR */}
        <div className="space-y-6">
          <div className="card space-y-5">
            <div className="card-header flex items-center justify-between">
              <span>Moteur de Détection & Algorithmes</span>
              <span className="badge bg-primary-500/10 text-primary-400 text-2xs">Temps réel</span>
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-surface-300 uppercase tracking-wider">1. Parsing & Tailing (Drain3)</h4>
              <label className="block">
                <span className="text-xs text-surface-400">Taille du batch (nombre de logs par lot)</span>
                <input
                  type="number"
                  className="input mt-1"
                  value={settings.detection.batch_size}
                  onChange={(e) => updateDetection({ batch_size: parseInt(e.target.value) || 500 })}
                />
                <p className="text-3xs text-surface-500 mt-1">Nombre maximal de lignes analysées dans un cycle d'ingestion</p>
              </label>

              <h4 className="text-xs font-semibold text-surface-300 uppercase tracking-wider pt-2">2. Détection d'Anomalies & Model Supervisé</h4>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-surface-400">Seuil d'anomalie de fréquence</span>
                  <input
                    type="number"
                    step="0.05"
                    className="input mt-1"
                    value={settings.detection.anomaly_threshold}
                    onChange={(e) => updateDetection({ anomaly_threshold: parseFloat(e.target.value) || 0.3 })}
                  />
                  <p className="text-3xs text-surface-500 mt-1">Déclenche une alerte si la rareté dépasse ce seuil</p>
                </label>
                <label className="block">
                  <span className="text-xs text-surface-400">Seuil du modèle supervisé (TF-IDF)</span>
                  <input
                    type="number"
                    step="0.05"
                    className="input mt-1"
                    value={settings.detection.supervised_threshold}
                    onChange={(e) => updateDetection({ supervised_threshold: parseFloat(e.target.value) || 0.6 })}
                  />
                  <p className="text-3xs text-surface-500 mt-1">Score min de correspondance avec les motifs connus</p>
                </label>
              </div>

              <h4 className="text-xs font-semibold text-surface-300 uppercase tracking-wider pt-2">3. Clustering HDBSCAN (Outliers)</h4>
              <div className="grid grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs text-surface-400">HDBSCAN Epsilon / Densité ($\epsilon$)</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="2.0"
                    className="input mt-1"
                    value={settings.detection.dbscan_eps}
                    onChange={(e) => updateDetection({ dbscan_eps: parseFloat(e.target.value) || 0.5 })}
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-surface-400">HDBSCAN Min Samples (Min $Pts$)</span>
                  <input
                    type="number"
                    min="2"
                    max="50"
                    className="input mt-1"
                    value={settings.detection.dbscan_min_samples}
                    onChange={(e) => updateDetection({ dbscan_min_samples: parseInt(e.target.value) || 5 })}
                  />
                </label>
              </div>

              <h4 className="text-xs font-semibold text-surface-300 uppercase tracking-wider pt-2">4. Corrélation Temporelle (Fenêtre Glissante)</h4>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-surface-400">Fenêtre temporelle (secondes)</span>
                  <input
                    type="number"
                    className="input mt-1"
                    value={settings.detection.time_window_seconds}
                    onChange={(e) => updateDetection({ time_window_seconds: parseInt(e.target.value) || 60 })}
                  />
                  <p className="text-3xs text-surface-500 mt-1">Durée d'analyse pour la détection de rafales</p>
                </label>
                <label className="block">
                  <span className="text-xs text-surface-400">Seuil d'événements suspect</span>
                  <input
                    type="number"
                    className="input mt-1"
                    value={settings.detection.event_threshold}
                    onChange={(e) => updateDetection({ event_threshold: parseInt(e.target.value) || 10 })}
                  />
                  <p className="text-3xs text-surface-500 mt-1">Nombre max d'événements avant de lever une alerte</p>
                </label>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.detection.auto_train}
                    onChange={(e) => updateDetection({ auto_train: e.target.checked })}
                    className="rounded bg-surface-700 border-surface-600"
                  />
                  <span className="text-sm font-medium">Ré-entraînement automatique périodique</span>
                </label>
                {settings.detection.auto_train && (
                  <label className="block mt-2">
                    <span className="text-xs text-surface-400">Intervalle d'entraînement (heures)</span>
                    <input
                      type="number"
                      className="input mt-1"
                      value={settings.detection.training_interval_hours}
                      onChange={(e) => updateDetection({ training_interval_hours: parseInt(e.target.value) || 24 })}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* SOAR Settings */}
          <div className="card space-y-4">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>Mitigation Active (SOAR)</span>
                <InfoTooltip title="SOAR (Security Orchestration, Automation, and Response)" content="Ce script s'exécute automatiquement en arrière-plan lorsqu'une alerte Critique/Haute est levée. Arguments passés : $1 (ID d'alerte), $2 (Catégorie de menace)." />
              </div>
              <span className="badge bg-red-500/10 text-red-400 text-2xs">Défense Active</span>
            </div>
            <label className="block">
              <span className="text-xs text-surface-400">Script de remédiation (Bash / PowerShell)</span>
              <textarea
                className="input mt-1 font-mono text-xs h-36"
                value={settings.active_response_script || ""}
                onChange={(e) => updateSoar(e.target.value)}
                placeholder="#!/bin/sh&#10;echo 'Alerte $1 déclenchée pour $2' >> /tmp/soar.log"
              />
            </label>
            <div>
              <button
                type="button"
                onClick={testSoar}
                disabled={soarTesting}
                className="btn-secondary text-xs flex items-center gap-1.5"
              >
                <Send size={14} className="text-amber-400" />
                {soarTesting ? "Exécution du test..." : "Tester l'exécution du script SOAR"}
              </button>
            </div>
            {soarStatus && (
              <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${soarStatus.ok ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-red-500/15 text-red-400 border border-red-500/30"}`}>
                <Bell size={14} />
                <span>{soarStatus.msg}</span>
              </div>
            )}
          </div>
          {/* LAN Web Server Settings */}
          <div className="card space-y-4 border border-blue-500/30 bg-gradient-to-b from-blue-950/30 to-surface-900 shadow-xl shadow-blue-950/20">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
                  <Server size={18} />
                </div>
                <div>
                  <span className="font-semibold">Serveur Web LAN Embarqué (IP:PORT)</span>
                  <p className="text-2xs text-surface-400 font-normal">Accès distant au tableau de bord pour les analystes du réseau local</p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={settings.lan_server?.enabled ?? false}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    updateLanServer({ enabled });
                    if (settings) {
                      const updatedSettings = {
                        ...settings,
                        lan_server: { ...settings.lan_server, enabled },
                      };
                      try {
                        await invoke("update_settings", { settings: updatedSettings });
                        setSaved(true);
                        setTimeout(() => setSaved(false), 2000);
                      } catch (err) {
                        console.error("Erreur toggle LAN server:", err);
                      }
                    }
                  }}
                />
                <div className="w-11 h-6 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {settings.lan_server?.enabled ? (
              <div className="space-y-4 pt-1">
                {/* Live Banner with direct Local IP URL */}
                <div className="p-4 bg-blue-950/50 border border-blue-500/40 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-inner">
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Serveur Actif sur le Réseau Local</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-surface-300 font-medium">URL Réseau d'Accès :</span>
                      <strong className="text-sm font-mono text-cyan-300 bg-cyan-950/70 border border-cyan-700/40 px-2.5 py-0.5 rounded select-all shadow-sm">
                        {lanStatus?.url || `http://${lanStatus?.local_ip || "127.0.0.1"}:${settings.lan_server.port}`}
                      </strong>
                    </div>
                    <p className="text-2xs text-surface-400 leading-relaxed">
                      💡 <strong>À quoi sert la console web LAN ?</strong> Elle permet à vos collaborateurs et analystes SOC connectés au même réseau (Wi-Fi/LAN) de surveiller les logs et alertes depuis leur navigateur (PC, Mac, Smartphone) sans installer l'application.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const targetUrl = lanStatus?.url || `http://${lanStatus?.local_ip || "127.0.0.1"}:${settings.lan_server.port}`;
                        navigator.clipboard.writeText(targetUrl);
                        setCopiedLanUrl(true);
                        setTimeout(() => setCopiedLanUrl(false), 2500);
                      }}
                      className="btn-primary text-xs px-3.5 py-2 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/20"
                    >
                      {copiedLanUrl ? <CheckCheck size={14} className="text-emerald-300" /> : <Copy size={14} />}
                      <span>{copiedLanUrl ? "URL Copiée !" : "Copier l'URL Réseau"}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs font-medium text-surface-300">Port d'écoute HTTP local</span>
                    <input
                      type="number"
                      className="input mt-1.5 w-full bg-surface-800 font-mono text-xs"
                      value={settings.lan_server.port}
                      onChange={(e) => updateLanServer({ port: parseInt(e.target.value) || 8080 })}
                    />
                  </label>
                </div>

                {/* Profil 1 : Administrateur */}
                <div className="p-4 bg-surface-800/70 rounded-xl border border-surface-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-400"></span> Profil Administrateur (Accès Total)
                    </span>
                    <span className="text-2xs text-surface-400 bg-surface-900 px-2 py-0.5 rounded border border-surface-700">Toutes les vues autorisées</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-2xs text-surface-400 font-medium">Nom d'utilisateur Admin</span>
                      <input
                        type="text"
                        className="input mt-1 w-full bg-surface-900 text-xs"
                        value={settings.lan_server.admin_username}
                        onChange={(e) => updateLanServer({ admin_username: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-2xs text-surface-400 font-medium">Clé d'accès Admin (7 car.)</span>
                      <div className="flex gap-2 mt-1">
                        <input
                          type="text"
                          maxLength={7}
                          className="input w-full bg-surface-900 text-xs font-mono font-bold tracking-widest text-emerald-400 uppercase"
                          value={settings.lan_server.admin_access_key}
                          onChange={(e) => updateLanServer({ admin_access_key: e.target.value.toUpperCase().slice(0, 7) })}
                        />
                        <button
                          type="button"
                          onClick={() => generateKeyFor("admin")}
                          title="Générer une nouvelle clé aléatoire de 7 caractères"
                          className="btn-secondary text-xs px-2.5 hover:text-emerald-400 transition"
                        >
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Profil 2 : Utilisateur / Analyste */}
                <div className="p-4 bg-surface-800/70 rounded-xl border border-surface-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-400"></span> Profil Utilisateur / Analyste (Restreint)
                    </span>
                    <span className="text-2xs text-surface-400 bg-surface-900 px-2 py-0.5 rounded border border-surface-700">Vues sélectives</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-2xs text-surface-400 font-medium">Nom d'utilisateur Analyste</span>
                      <input
                        type="text"
                        className="input mt-1 w-full bg-surface-900 text-xs"
                        value={settings.lan_server.user_username}
                        onChange={(e) => updateLanServer({ user_username: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-2xs text-surface-400 font-medium">Clé d'accès Analyste (7 car.)</span>
                      <div className="flex gap-2 mt-1">
                        <input
                          type="text"
                          maxLength={7}
                          className="input w-full bg-surface-900 text-xs font-mono font-bold tracking-widest text-amber-400 uppercase"
                          value={settings.lan_server.user_access_key}
                          onChange={(e) => updateLanServer({ user_access_key: e.target.value.toUpperCase().slice(0, 7) })}
                        />
                        <button
                          type="button"
                          onClick={() => generateKeyFor("user")}
                          title="Générer une nouvelle clé aléatoire de 7 caractères"
                          className="btn-secondary text-xs px-2.5 hover:text-amber-400 transition"
                        >
                          <RotateCcw size={14} />
                        </button>
                      </div>
                    </label>
                  </div>

                  {/* Vues autorisées pour l'utilisateur distant */}
                  <div className="pt-2 border-t border-surface-700/60">
                    <span className="text-2xs font-semibold text-surface-300 block mb-2">Vues visibles autorisées sur le navigateur distant :</span>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { id: "dashboard", label: "Tableau de Bord" },
                        { id: "logs", label: "Flux des Logs" },
                        { id: "alerts", label: "Alertes DLP" },
                        { id: "network", label: "Découverte Réseau" },
                      ].map((view) => (
                        <label key={view.id} className="flex items-center gap-2 cursor-pointer bg-surface-900/60 p-2.5 rounded-lg border border-surface-700/40 hover:border-surface-600 transition">
                          <input
                            type="checkbox"
                            checked={settings.lan_server.user_allowed_views?.includes(view.id) ?? false}
                            onChange={() => toggleUserView(view.id)}
                            className="rounded border-surface-600 text-blue-500 focus:ring-0 bg-surface-800"
                          />
                          <span className="text-surface-300 font-medium">{view.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <div className="p-4 bg-surface-800/40 rounded-xl border border-surface-700/60 text-center space-y-2">
                <p className="text-xs text-surface-400">
                  L'accès réseau distant est actuellement désactivé. La plateforme n'écoute que sur la machine locale.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    updateLanServer({ enabled: true });
                    if (settings) {
                      const updatedSettings = {
                        ...settings,
                        lan_server: { ...settings.lan_server, enabled: true },
                      };
                      try {
                        await invoke("update_settings", { settings: updatedSettings });
                        setSaved(true);
                        setTimeout(() => setSaved(false), 2000);
                      } catch (err) {
                        console.error(err);
                      }
                    }
                  }}
                  className="btn-secondary text-xs inline-flex items-center gap-1.5"
                >
                  <Server size={14} className="text-blue-400" />
                  Activer la Console Web LAN
                </button>
              </div>
            )}
          </div>

          {/* Log Retention & Archiving Policy */}
          <div className="card space-y-4 border border-purple-500/30 bg-gradient-to-b from-purple-950/20 to-surface-900 shadow-xl shadow-purple-950/10">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400">
                  <Database size={18} />
                </div>
                <div>
                  <span className="font-semibold">Rétention, Purge & Archivage des Logs</span>
                  <p className="text-2xs text-surface-400 font-normal">Gestion de l'espace disque, purge automatique et sauvegarde d'archives</p>
                </div>
              </div>
              <InfoTooltip title="Politique de Rétention" content="Définit la durée de conservation des logs bruts et alertes dans la base locale SQLite. Les événements antérieurs sont purgés pour préserver les performances." />
            </div>

            <div className="space-y-4">
              {/* Toggle Auto-Purge */}
              <div className="flex items-center justify-between p-3 bg-surface-800/60 rounded-xl border border-surface-700">
                <div>
                  <span className="text-xs font-semibold text-surface-200">Purge Automatique au Démarrage</span>
                  <p className="text-2xs text-surface-400">Supprimer automatiquement les logs expirés lors du cycle de maintenance</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.retention?.auto_purge_enabled ?? false}
                    onChange={(e) => updateRetention({ auto_purge_enabled: e.target.checked })}
                  />
                  <div className="w-11 h-6 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                </label>
              </div>

              {/* Retention Duration & Archive Directory */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-xs font-medium text-surface-300">Durée de conservation (Rétention)</span>
                  <select
                    className="input mt-1.5 w-full bg-surface-800 text-xs"
                    value={settings.retention?.retention_days ?? 30}
                    onChange={(e) => updateRetention({ retention_days: parseInt(e.target.value) || 30 })}
                  >
                    <option value={7}>7 jours (1 semaine)</option>
                    <option value={14}>14 jours (2 semaines)</option>
                    <option value={30}>30 jours (1 mois)</option>
                    <option value={60}>60 jours (2 mois)</option>
                    <option value={90}>90 jours (3 mois)</option>
                    <option value={180}>180 jours (6 mois)</option>
                    <option value={365}>365 jours (1 an)</option>
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-surface-300">Dossier des Archives exportées</span>
                  <input
                    type="text"
                    className="input mt-1.5 w-full bg-surface-800 text-xs font-mono"
                    value={settings.retention?.archive_directory ?? "archives"}
                    onChange={(e) => updateRetention({ archive_directory: e.target.value })}
                  />
                </label>
              </div>

              {/* Archive before purge checkbox */}
              <label className="flex items-center gap-2.5 cursor-pointer p-3 bg-surface-800/40 rounded-xl border border-surface-700/60 hover:bg-surface-800/60 transition">
                <input
                  type="checkbox"
                  checked={settings.retention?.archive_before_purge ?? true}
                  onChange={(e) => updateRetention({ archive_before_purge: e.target.checked })}
                  className="rounded border-surface-600 text-purple-500 focus:ring-0 bg-surface-800"
                />
                <div>
                  <span className="text-xs font-medium text-surface-200 flex items-center gap-1.5">
                    <Archive size={14} className="text-purple-400" />
                    Archiver les données avant suppression
                  </span>
                  <p className="text-2xs text-surface-400">Exporte une copie complète JSON dans le dossier d'archives avant toute purge</p>
                </div>
              </label>

              {/* Manual Purge Action Box */}
              <div className="p-4 bg-surface-900/90 rounded-xl border border-surface-700 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-surface-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Trash2 size={14} className="text-red-400" />
                    Action Manuelle Immédiate
                  </span>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <span className="text-xs text-surface-400 whitespace-nowrap">Purger les logs de plus de :</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      className="input w-20 bg-surface-800 text-xs text-center font-bold"
                      value={manualPurgeDays}
                      onChange={(e) => setManualPurgeDays(parseInt(e.target.value) || 30)}
                    />
                    <span className="text-xs text-surface-400">jours</span>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={handleManualPurge}
                      disabled={purging}
                      className="btn bg-red-600/80 hover:bg-red-600 text-white text-xs px-4 py-2 w-full sm:w-auto ml-auto flex items-center justify-center gap-1.5 transition"
                    >
                      <Trash2 size={14} />
                      {purging ? "Purge en cours..." : "Purger Maintenant"}
                    </button>
                  </div>
                </div>

                {purgeResult && (
                  <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-lg text-xs text-emerald-200 space-y-1 animate-in fade-in">
                    <p className="font-bold flex items-center gap-1.5">
                      <Check size={14} className="text-emerald-400" />
                      {purgeResult.message}
                    </p>
                    {purgeResult.archive_file && (
                      <p className="text-2xs font-mono text-emerald-300/80">
                        📦 Archive sauvegardée : {purgeResult.archive_file}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Kafka + Webhooks + LLM */}
        <div className="space-y-6">
          {/* Kafka */}
          <div className="card space-y-4">
            <div className="card-header">Connecteur Kafka (optionnel)</div>
            {settings.kafka ? (
              <>
                <label className="block">
                  <span className="text-xs text-surface-400">Brokers (séparés par des virgules)</span>
                  <input
                    type="text"
                    className="input mt-1"
                    value={settings.kafka.brokers.join(",")}
                    onChange={(e) => updateKafka({ brokers: e.target.value.split(",").map(s => s.trim()) })}
                    placeholder="localhost:9092"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-xs text-surface-400">Topic entrant</span>
                    <input
                      type="text"
                      className="input mt-1"
                      value={settings.kafka.input_topic}
                      onChange={(e) => updateKafka({ input_topic: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-surface-400">Topic sortant</span>
                    <input
                      type="text"
                      className="input mt-1"
                      value={settings.kafka.output_topic}
                      onChange={(e) => updateKafka({ output_topic: e.target.value })}
                    />
                  </label>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-surface-500">
                  Kafka n'est pas configuré. Le pipeline fonctionne en mode base de données locale.
                </p>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setSettings({
                    ...settings,
                    kafka: {
                      brokers: ["localhost:9092"],
                      input_topic: "defudelog-logs",
                      output_topic: "defudelog-alerts",
                      group_id: "defudelog-consumer",
                      sasl_username: null,
                      sasl_password: null,
                    } as KafkaSettings,
                  })}
                >
                  <Server size={14} />
                  Activer le connecteur Kafka
                </button>
              </div>
            )}
          </div>

          {/* Webhook & Notifications */}
          <div className="card space-y-4">
            <div className="card-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>Webhooks & Notifications Alertes</span>
                <InfoTooltip title="Notifications Webhook" content="Permet d'envoyer instantanément les alertes de sévérité Haute/Critique vers Slack, Discord, Microsoft Teams ou une API HTTP sur mesure." />
              </div>
              <span className="badge bg-emerald-500/10 text-emerald-400 text-2xs">Temps réel</span>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-surface-400">URL du Webhook (Slack / Discord / Teams / HTTP API)</span>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    className="input flex-1"
                    placeholder="https://hooks.slack.com/services/..."
                    value={settings.webhook_url || ""}
                    onChange={(e) => updateWebhook(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const url = settings.webhook_url?.trim() || "";
                      if (!url) {
                        setWebhookStatus({ ok: false, msg: "Veuillez renseigner une URL de webhook." });
                        return;
                      }
                      setWebhookTesting(true);
                      setWebhookStatus(null);
                      try {
                        const msg = await invoke<string>("test_webhook", { url });
                        setWebhookStatus({ ok: true, msg });
                      } catch (err: unknown) {
                        setWebhookStatus({ ok: false, msg: String(err) });
                      } finally {
                        setWebhookTesting(false);
                      }
                    }}
                    disabled={webhookTesting}
                    className="btn-primary text-xs flex items-center gap-1.5"
                  >
                    <Send size={14} />
                    {webhookTesting ? "Test..." : "Tester"}
                  </button>
                </div>
                <p className="text-3xs text-surface-500 mt-1">Les notifications seront déclenchées à chaque détection d'alerte critique.</p>
              </label>

              {webhookStatus && (
                <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${webhookStatus.ok ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-red-500/15 text-red-400 border border-red-500/30"}`}>
                  <Bell size={14} />
                  <span>{webhookStatus.msg}</span>
                </div>
              )}
            </div>
          </div>

          {/* LLM */}
          <div className={`card space-y-5 transition-all duration-300 ${!settings.llm?.enabled ? 'opacity-70 grayscale-[30%]' : 'border-primary-500/30'}`}>
            <div className="card-header flex items-center justify-between pb-2 border-b border-surface-700/50">
              <div className="flex items-center gap-2">
                <Brain size={18} className={settings.llm?.enabled ? "text-primary-400" : "text-surface-500"} />
                <span className="font-semibold">Analyse LLM Local</span>
                <InfoTooltip title="LLM Local (LM Studio / Ollama)" content="Connecte DefuDelog à votre IA locale. Vos logs ne quittent jamais votre machine !" />
              </div>
              {settings.llm && (
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.llm.enabled}
                    onChange={(e) => updateLlm({ enabled: e.target.checked })}
                  />
                  <div className="w-9 h-5 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                </label>
              )}
            </div>

            {settings.llm ? (
              <div className={`space-y-4 transition-all duration-300 ${!settings.llm.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateLlm({ base_url: "http://localhost:11434/v1", model: "llama3" })}
                    className="badge bg-surface-800 hover:bg-primary-900/40 text-surface-200 cursor-pointer border border-surface-700 flex items-center gap-1"
                  >
                    <Server size={12} /> Preset Ollama
                  </button>
                  <button
                    onClick={() => updateLlm({ base_url: "http://localhost:1234/v1", model: "local-model" })}
                    className="badge bg-surface-800 hover:bg-primary-900/40 text-surface-200 cursor-pointer border border-surface-700 flex items-center gap-1"
                  >
                    <Server size={12} /> Preset LM Studio
                  </button>
                </div>

                <label className="block">
                  <span className="text-xs font-medium text-surface-300">URL de l'API (Endpoint compatible OpenAI)</span>
                  <input
                    type="text"
                    className="input mt-1.5 w-full bg-surface-800"
                    value={settings.llm.base_url}
                    onChange={(e) => updateLlm({ base_url: e.target.value })}
                    placeholder="http://localhost:1234/v1"
                  />
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-xs font-medium text-surface-300">Nom du Modèle</span>
                    <input
                      type="text"
                      className="input mt-1.5 w-full bg-surface-800"
                      value={settings.llm.model}
                      onChange={(e) => updateLlm({ model: e.target.value })}
                    />
                  </label>

                  <label className="block relative">
                    <span className="text-xs font-medium text-surface-300">Clé API (Optionnelle)</span>
                    <div className="relative mt-1.5">
                      <input
                        type={showApiKey ? "text" : "password"}
                        className="input w-full bg-surface-800 pr-10"
                        value={settings.llm.api_key || ""}
                        onChange={(e) => updateLlm({ api_key: e.target.value })}
                        placeholder="sk-..."
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-surface-400 hover:text-white"
                      >
                        {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </label>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={testLlm}
                    disabled={llmTesting}
                    className="btn-secondary text-xs w-full justify-center flex items-center gap-2 border-surface-600 bg-surface-700 hover:bg-surface-600"
                  >
                    <Send size={14} className="text-primary-400" />
                    {llmTesting ? "Test en cours..." : "Tester la connexion IA"}
                  </button>
                </div>

                {llmTestStatus && (
                  <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${llmTestStatus.ok ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-red-500/15 text-red-400 border border-red-500/30"}`}>
                    {llmTestStatus.ok ? <Check size={14} /> : <X size={14} />}
                    <span className="truncate">{llmTestStatus.msg}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-center space-y-3">
                <Brain size={32} className="text-surface-600 mb-2" />
                <p className="text-sm text-surface-400">
                  Aucun LLM configuré. L'analyse contextuelle automatique est désactivée.
                </p>
                <button
                  type="button"
                  onClick={() => setSettings({
                    ...settings,
                    llm: { base_url: "http://localhost:11434/v1", model: "llama3", api_key: "", enabled: true }
                  })}
                  className="btn-primary mt-2"
                >
                  Configurer une IA Locale
                </button>
              </div>
            )}
          </div>

          {/* Dictionnaire Sémantique & Traduction des Logs */}
          <div className="card space-y-4 border border-surface-700/80">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Database size={16} className="text-emerald-400" />
                <span>Dictionnaire Sémantique & Fichier de Traduction</span>
              </h3>
              <span className="badge bg-emerald-500/10 text-emerald-400 text-2xs border border-emerald-500/30">
                translations_fr.json
              </span>
            </div>

            <p className="text-xs text-surface-400 leading-relaxed">
              Le moteur sémantique de DefuDelog utilise un dictionnaire de gabarits structuré au format JSON pour vulgariser instantanément les logs bruts en français clair sans surcoût CPU ($O(1)$).
            </p>

            <div className="bg-surface-900/80 p-3 rounded-xl border border-surface-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-surface-300 font-medium">Emplacement par défaut :</span>
                <span className="font-mono text-2xs text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/40">
                  src-tauri/dictionaries/translations_fr.json
                </span>
              </div>

              <div className="pt-2 border-t border-surface-800 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const count = await invoke<number>("reload_translation_dictionary");
                      alert(`Dictionnaire local rechargé avec succès (${count} règles actives) !`);
                    } catch (e) {
                      alert("Erreur lors du rechargement: " + String(e));
                    }
                  }}
                  className="btn-secondary text-xs flex items-center gap-1.5"
                >
                  <RotateCcw size={13} />
                  Recharger depuis JSON
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const count = await invoke<number>("sync_remote_dictionary", { url: null });
                      alert(`Synchronisation OTA réussie ! ${count} règles sémantiques téléchargées et activées.`);
                    } catch (e) {
                      alert("Erreur lors de la synchronisation distante: " + String(e));
                    }
                  }}
                  className="btn-primary text-xs flex items-center gap-1.5"
                >
                  <RefreshCw size={13} />
                  Mettre à jour depuis GitHub (OTA)
                </button>
              </div>
            </div>
          </div>

          {/* Mises à jour Logicielles Automatiques (OTA) & Intégrité des Données */}
          <div className="card space-y-4 border border-surface-700/80">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Sparkles size={16} className="text-primary-400" />
                <span>Mises à Jour Logicielles & Maintien Automatique</span>
              </h3>
              <div className="flex items-center gap-2">
                <span className="badge bg-primary-500/10 text-primary-400 text-2xs border border-primary-500/30 font-mono">
                  Version Actuelle : v2.0.0
                </span>
              </div>
            </div>

            <div className="p-3 bg-surface-900/80 rounded-xl border border-surface-800 space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <ShieldCheck size={16} />
                <span>Persistance des Données & Zéro Perte Garantie</span>
              </div>
              <p className="text-2xs text-surface-400 leading-relaxed">
                Les mises à jour automatiques téléchargent et appliquent uniquement le nouveau binaire applicatif. Votre base de données SQLite locale, vos clés d'API, vos règles DLP et l'historique complet de vos logs restent 100% intacts dans le répertoire sécurisé de l'application.
              </p>

              {/* Dynamic Update Verification Status Box */}
              {updateChecking && (
                <div className="p-3 rounded-lg bg-blue-950/60 border border-blue-500/40 text-xs text-blue-300 flex items-center gap-2.5 animate-pulse">
                  <RefreshCw size={15} className="animate-spin text-blue-400 shrink-0" />
                  <span>Recherche de mise à jour auprès du dépôt officiel GitHub Releases...</span>
                </div>
              )}

              {!updateChecking && updateStatus.type === "up-to-date" && (
                <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-300 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-emerald-200">{updateStatus.message}</p>
                      {updateStatus.checkedAt && (
                        <p className="text-3xs text-emerald-400/70 font-mono mt-0.5">
                          Dernière vérification réussie à {updateStatus.checkedAt}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="badge bg-emerald-500/20 text-emerald-300 text-3xs shrink-0">À jour</span>
                </div>
              )}

              {!updateChecking && updateStatus.type === "update-available" && (
                <div className="p-3 rounded-lg bg-gradient-to-r from-primary-950/70 to-indigo-950/70 border border-primary-500/50 text-xs text-primary-200 space-y-2 shadow-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <Sparkles size={15} className="text-yellow-300 animate-pulse" />
                      <span>Nouvelle version v{updateStatus.version} disponible !</span>
                    </div>
                    <span className="badge bg-yellow-500/20 text-yellow-300 text-3xs font-mono">Prêt</span>
                  </div>
                  {updateStatus.body && (
                    <p className="text-3xs text-surface-300 bg-surface-950/60 p-2 rounded border border-surface-800 leading-relaxed max-h-20 overflow-y-auto">
                      {updateStatus.body}
                    </p>
                  )}
                  <p className="text-3xs text-emerald-400 font-medium">
                    ✨ La pastille de téléchargement s'est ouverte en bas à droite de l'écran.
                  </p>
                </div>
              )}

              <div className="pt-2 border-t border-surface-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-2xs text-surface-500 font-mono">
                  Canal officiel : GitHub Releases (Main Branch)
                </span>
                <button
                  type="button"
                  onClick={handleCheckUpdate}
                  disabled={updateChecking}
                  className="btn-primary text-xs py-1.5 px-3.5 flex items-center justify-center gap-1.5 shadow-md"
                >
                  <RefreshCw size={13} className={updateChecking ? "animate-spin" : ""} />
                  <span>{updateChecking ? "Vérification en cours..." : "Vérifier maintenant"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
