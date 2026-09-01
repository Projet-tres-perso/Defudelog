import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import {
  Wand2,
  CheckCircle2,
  AlertTriangle,
  Shield,
  ShieldCheck,
  Radio,
  Cpu,
  Zap,
  ArrowRight,
  ArrowLeft,
  X,
  Sparkles,
  Server,
  FolderOpen,
  Eye,
} from "lucide-react";

interface QuickSetupWizardProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickSetupWizard({ isOpen, onClose }: QuickSetupWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [osType, setOsType] = useState<"windows" | "macos" | "linux">("windows");
  const [isAdmin, setIsAdmin] = useState(true);
  
  // Sources sélectionnées
  const [enableWindowsEvents, setEnableWindowsEvents] = useState(true);
  const [enableSyslog, setEnableSyslog] = useState(true);
  const [syslogPort, setSyslogPort] = useState(514);
  const [enableFolderWatcher, setEnableFolderWatcher] = useState(false);
  const [folderPath, setFolderPath] = useState("C:\\logs");
  
  // Profil IA
  const [aiProfile, setAiProfile] = useState<"balanced" | "aggressive" | "quiet">("balanced");
  const [isApplying, setIsApplying] = useState(false);
  const [appliedSuccess, setAppliedSuccess] = useState(false);

  useEffect(() => {
    // Détection basique de l'OS via user-agent
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) {
      setOsType("windows");
      setFolderPath("C:\\inetpub\\logs\\LogFiles");
    } else if (ua.includes("mac")) {
      setOsType("macos");
      setFolderPath("/var/log");
    } else {
      setOsType("linux");
      setFolderPath("/var/log/auth.log");
    }
  }, []);

  const handleApplyConfig = async (withDemoLogs = false) => {
    setIsApplying(true);
    try {
      // 1. Sauvegarder les paramètres IA selon le profil
      const minClusterSize = aiProfile === "aggressive" ? 3 : aiProfile === "quiet" ? 8 : 5;
      const anomalyThreshold = aiProfile === "aggressive" ? 0.65 : aiProfile === "quiet" ? 0.85 : 0.75;
      
      const currentSettings = await invoke<any>("get_settings").catch(() => ({}));
      const updatedSettings = {
        ...currentSettings,
        detection: {
          ...currentSettings?.detection,
          min_cluster_size: minClusterSize,
          anomaly_threshold: anomalyThreshold,
          ai_assisted_analysis: true,
        },
      };
      await invoke("save_settings", { settings: updatedSettings });

      // 2. Si démo demandée, générer des logs de test
      if (withDemoLogs) {
        await invoke("generate_demo_logs");
      }

      setAppliedSuccess(true);
      setTimeout(() => {
        setIsApplying(false);
        onClose();
        navigate(withDemoLogs ? "/alerts" : "/");
      }, 1200);
    } catch (e) {
      console.error(e);
      setIsApplying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 border border-primary-500/40 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden text-surface-100 flex flex-col animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-surface-950 border-b border-surface-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary-500/20 text-primary-400 border border-primary-500/30">
              <Wand2 size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Assistant de Configuration Rapide</span>
                <span className="text-3xs font-mono bg-primary-500/20 text-primary-300 px-2 py-0.5 rounded">
                  Étape {step}/4
                </span>
              </h2>
              <p className="text-2xs text-surface-400">
                Configurez la surveillance et le moteur de détection IA en quelques secondes.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-surface-800 text-surface-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-surface-800 h-1">
          <div
            className="bg-gradient-to-r from-primary-500 to-emerald-400 h-full transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%` }}
          ></div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {/* Étape 1 : Environnement & Privilèges */}
          {step === 1 && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-center gap-3 p-3 bg-surface-950/80 rounded-xl border border-surface-800">
                <ShieldCheck size={28} className="text-emerald-400 shrink-0" />
                <div>
                  <h4 className="text-sm font-semibold text-white">Environnement Détecté : {osType.toUpperCase()}</h4>
                  <p className="text-2xs text-surface-400 mt-0.5">
                    Le moteur de détection multi-axes (Règles DLP + HDBSCAN + BGE-small) est prêt à être initialisé.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-surface-300">Sélectionnez le système cible principal :</label>
                <div className="grid grid-cols-3 gap-3">
                  {(["windows", "macos", "linux"] as const).map((os) => (
                    <button
                      key={os}
                      type="button"
                      onClick={() => setOsType(os)}
                      className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition ${
                        osType === os
                          ? "bg-primary-600/20 border-primary-500 text-white font-bold"
                          : "bg-surface-950/50 border-surface-800 text-surface-400 hover:border-surface-700"
                      }`}
                    >
                      <Server size={20} className={osType === os ? "text-primary-400" : ""} />
                      <span className="text-xs capitalize">{os}</span>
                    </button>
                  ))}
                </div>
              </div>

              {osType === "windows" && (
                <div className="p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 text-2xs text-blue-300 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-blue-200">Recommandation Windows :</span>
                    <p className="mt-0.5 text-surface-300">
                      Pour capturer les journaux de sécurité (EventID 4624/4625, élévation de privilèges), lancez DefuDelog avec élévation Administrateur.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Étape 2 : Activation des Sources */}
          {step === 2 && (
            <div className="space-y-3 animate-fade-in">
              <h3 className="text-xs font-semibold text-surface-300 mb-2">
                Quelles sources de logs souhaitez-vous surveiller ?
              </h3>

              {/* Source Windows Events */}
              {osType === "windows" && (
                <label className="flex items-start gap-3 p-3 rounded-xl border border-surface-800 bg-surface-950/50 hover:bg-surface-950 cursor-pointer transition">
                  <input
                    type="checkbox"
                    checked={enableWindowsEvents}
                    onChange={(e) => setEnableWindowsEvents(e.target.checked)}
                    className="mt-1 rounded border-surface-700 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <span>Journaux Windows (Security, Application, System)</span>
                      <span className="badge bg-primary-500/20 text-primary-300 text-3xs font-mono">Natif</span>
                    </span>
                    <p className="text-3xs text-surface-400 mt-0.5">
                      Capture automatique des événements de connexions, échecs d'authentification et modifications système.
                    </p>
                  </div>
                </label>
              )}

              {/* Source Syslog UDP */}
              <label className="flex items-start gap-3 p-3 rounded-xl border border-surface-800 bg-surface-950/50 hover:bg-surface-950 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={enableSyslog}
                  onChange={(e) => setEnableSyslog(e.target.checked)}
                  className="mt-1 rounded border-surface-700 text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-2">
                      <span>Serveur Syslog UDP</span>
                      <span className="badge bg-emerald-500/20 text-emerald-300 text-3xs font-mono">Port {syslogPort}</span>
                    </span>
                  </div>
                  <p className="text-3xs text-surface-400 mt-0.5">
                    Permet de recevoir en direct les logs de vos pare-feu, routeurs, serveurs Linux et équipements distants.
                  </p>
                </div>
              </label>

              {/* Source Dossier / Fichier Watcher */}
              <label className="flex items-start gap-3 p-3 rounded-xl border border-surface-800 bg-surface-950/50 hover:bg-surface-950 cursor-pointer transition">
                <input
                  type="checkbox"
                  checked={enableFolderWatcher}
                  onChange={(e) => setEnableFolderWatcher(e.target.checked)}
                  className="mt-1 rounded border-surface-700 text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <span>Surveillance d'un Répertoire de Fichiers (.log / .txt)</span>
                  </span>
                  <p className="text-3xs text-surface-400 mt-0.5">
                    Lit en continu les nouveaux ajouts dans vos fichiers de logs applicatifs (Apache, Nginx, BDD).
                  </p>
                  {enableFolderWatcher && (
                    <input
                      type="text"
                      className="input text-xs mt-2 w-full font-mono"
                      value={folderPath}
                      onChange={(e) => setFolderPath(e.target.value)}
                      placeholder="Chemin du dossier de logs"
                    />
                  )}
                </div>
              </label>
            </div>
          )}

          {/* Étape 3 : Calibrage IA */}
          {step === 3 && (
            <div className="space-y-3 animate-fade-in">
              <h3 className="text-xs font-semibold text-surface-300 mb-2">
                Choisissez le profil de détection pour l'IA :
              </h3>

              <div className="grid grid-cols-1 gap-2.5">
                {[
                  {
                    id: "balanced",
                    title: "Profil Recommandé (SOC Standard)",
                    desc: "Équilibre parfait entre réduction des faux positifs et détection proactive des menaces inconnues.",
                    badge: "Idéal pour débuter",
                    color: "border-primary-500 bg-primary-950/20",
                  },
                  {
                    id: "aggressive",
                    title: "Haute Sensibilité (Strict DLP & Zero Trust)",
                    desc: "Détecte les plus petites anomalies sémantiques. Idéal pour les environnements hautement sécurisés.",
                    badge: "Haute Détection",
                    color: "border-amber-500/50 bg-amber-950/20",
                  },
                  {
                    id: "quiet",
                    title: "Mode Discret (Tolérance Élevée)",
                    desc: "Ne signale que les déviations statistiques massives et les menaces critiques avérées.",
                    badge: "Minimaliste",
                    color: "border-surface-700 bg-surface-950/50",
                  },
                ].map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setAiProfile(item.id as any)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start gap-3 ${
                      aiProfile === item.id
                        ? `${item.color} border-2`
                        : "border-surface-800 bg-surface-950/40 hover:border-surface-700"
                    }`}
                  >
                    <div className="mt-0.5">
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                          aiProfile === item.id
                            ? "border-primary-400 bg-primary-500 text-white"
                            : "border-surface-600"
                        }`}
                      >
                        {aiProfile === item.id && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{item.title}</span>
                        <span className="text-3xs font-mono bg-surface-800 text-surface-300 px-1.5 py-0.5 rounded">
                          {item.badge}
                        </span>
                      </div>
                      <p className="text-2xs text-surface-400 mt-1">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Étape 4 : Validation & Lancement */}
          {step === 4 && (
            <div className="space-y-4 animate-fade-in text-center py-2">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                <Sparkles size={28} className="animate-pulse" />
              </div>

              <div>
                <h3 className="text-base font-bold text-white">Configuration Prête !</h3>
                <p className="text-xs text-surface-400 mt-1 max-w-md mx-auto">
                  Votre plateforme DefuDelog est prête à surveiller vos flux et à isoler les comportements suspects en temps réel.
                </p>
              </div>

              <div className="p-3 bg-surface-950 rounded-xl border border-surface-800 text-left text-2xs space-y-1.5 font-mono max-w-md mx-auto">
                <div className="flex justify-between">
                  <span className="text-surface-500">Système :</span>
                  <span className="text-white capitalize">{osType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-500">Profil IA :</span>
                  <span className="text-primary-300 font-semibold uppercase">{aiProfile}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-500">Syslog UDP :</span>
                  <span className={enableSyslog ? "text-emerald-400" : "text-surface-500"}>
                    {enableSyslog ? `Actif (Port ${syslogPort})` : "Désactivé"}
                  </span>
                </div>
              </div>

              {/* Action options */}
              <div className="pt-2 flex flex-col sm:flex-row gap-2.5 justify-center max-w-md mx-auto">
                <button
                  type="button"
                  onClick={() => handleApplyConfig(true)}
                  disabled={isApplying}
                  className="btn bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 text-white text-xs py-2 px-4 flex items-center justify-center gap-2 font-bold shadow-lg shadow-primary-600/30"
                >
                  <Zap size={14} />
                  <span>Démarrer avec Logs de Test (Recommandé)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyConfig(false)}
                  disabled={isApplying}
                  className="btn-secondary text-xs py-2 px-4 flex items-center justify-center gap-1.5"
                >
                  <span>Démarrer en Mode Silencieux</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation Controls */}
        <div className="p-4 bg-surface-950 border-t border-surface-800 flex items-center justify-between">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 text-surface-300 hover:text-white"
            >
              <ArrowLeft size={14} />
              <span>Précédent</span>
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5"
            >
              <span>Suivant</span>
              <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
