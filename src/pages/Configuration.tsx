import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, DetectionSettings, KafkaSettings, LlmSettings } from "@/types";
import InfoTooltip from "@/components/InfoTooltip";
import { Save, RotateCcw, Send, Bell, Eye, EyeOff, Brain, Check, X, Server } from "lucide-react";

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

  useEffect(() => {
    invoke<AppSettings>("get_settings").then((res) => {
      setSettings(res);
    }).catch(console.error);
  }, []);

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

            <h4 className="text-xs font-semibold text-surface-300 uppercase tracking-wider pt-2">3. Clustering DBSCAN (Outliers)</h4>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-surface-400">DBSCAN Epsilon (Rayon $\epsilon$)</span>
                <input
                  type="number"
                  step="0.1"
                  className="input mt-1"
                  value={settings.detection.dbscan_eps}
                  onChange={(e) => updateDetection({ dbscan_eps: parseFloat(e.target.value) || 0.5 })}
                />
                <p className="text-3xs text-surface-500 mt-1">Distance max entre deux logs pour être dans le même cluster</p>
              </label>
              <label className="block">
                <span className="text-xs text-surface-400">DBSCAN Min Samples (Min $Pts$)</span>
                <input
                  type="number"
                  className="input mt-1"
                  value={settings.detection.dbscan_min_samples}
                  onChange={(e) => updateDetection({ dbscan_min_samples: parseInt(e.target.value) || 5 })}
                />
                <p className="text-3xs text-surface-500 mt-1">Nombre min de voisins pour former un cluster dense</p>
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
              <p className="text-sm text-surface-500">
                Kafka n'est pas configuré. Le pipeline fonctionne en mode base de données locale.
              </p>
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
                <InfoTooltip title="LLM Local (LM Studio / Ollama)" content="Connecte DeFuDoLog à votre IA locale. Vos logs ne quittent jamais votre machine !" />
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
        </div>
      </div>
    </div>
  );
}
