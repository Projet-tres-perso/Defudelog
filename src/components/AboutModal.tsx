import React, { useEffect } from "react";
import logo from "../assets/logo.png";
import {
  X,
  ShieldCheck,
  Cpu,
  Database,
  Lock,
  Zap,
  Activity,
  Github,
  BookOpen,
  Award,
  Terminal,
  Layers,
  Sparkles,
  ExternalLink,
} from "lucide-react";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
  // Support touche Échap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/80 backdrop-blur-md animate-fade-in">
      <div
        className="relative w-full max-w-2xl bg-surface-900/95 border border-surface-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header avec Dégradé et Bouton Fermer */}
        <div className="relative p-6 pb-5 bg-gradient-to-r from-primary-950/60 via-surface-900 to-indigo-950/40 border-b border-surface-700/70">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"
            title="Fermer (Échap)"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-4">
            <div className="relative">
              <img
                src={logo}
                alt="DefuDelog Logo"
                className="w-14 h-14 object-contain drop-shadow-md rounded-xl p-1 bg-surface-950/50 border border-surface-700/50"
              />
              <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-surface-900"></span>
              </span>
            </div>

            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-white tracking-tight">DefuDelog</h2>
                <span className="badge bg-primary-500/15 text-primary-300 border border-primary-500/30 text-2xs font-mono font-bold">
                  v2.0.0
                </span>
                <span className="badge bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-3xs font-semibold">
                  Stable
                </span>
              </div>
              <p className="text-xs text-surface-300 mt-1">
                Plateforme de Détection des Risques de Fuite de Données & Vulgarisation SIEM
              </p>
            </div>
          </div>
        </div>

        {/* Corps défilable */}
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1 text-xs text-surface-300">
          {/* Mission */}
          <div className="p-3.5 bg-surface-950/60 rounded-xl border border-surface-800 leading-relaxed space-y-2">
            <div className="flex items-center gap-2 text-primary-400 font-semibold text-xs">
              <Sparkles size={15} />
              <span>Mission & Philosophie</span>
            </div>
            <p className="text-surface-300 text-2xs leading-relaxed">
              DefuDelog a été conçu pour allier la puissance d’analyse des SOC d’entreprise (détection des risques de fuite de données, clustering d'anomalies, corrélation multi-sources) avec une vulgarisation pédagogique accessible. Il permet à chaque administrateur et utilisateur de comprendre en temps réel ce qui se passe sur sa machine et son réseau sans jargon obscur.
            </p>
          </div>

          {/* Grille des Piliers Techniques */}
          <div>
            <h4 className="text-xs font-semibold text-white mb-3 flex items-center gap-2">
              <Layers size={15} className="text-cyan-400" />
              <span>Architecture & Moteurs Internes</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Carte 1 : Backend Rust */}
              <div className="p-3 bg-surface-950/40 rounded-xl border border-surface-800/80 space-y-1.5 hover:border-surface-700 transition-colors">
                <div className="flex items-center gap-2 text-amber-400 font-medium text-xs">
                  <Cpu size={14} />
                  <span>Rust Natif & Tauri v2</span>
                </div>
                <p className="text-3xs text-surface-400 leading-relaxed">
                  Consommation ultra-réduite (~35-65 Mo RAM en veille). Pas de runtime Chromium lourd. Utilisation de la WebView native de l'OS.
                </p>
              </div>

              {/* Carte 2 : IA & Clustering */}
              <div className="p-3 bg-surface-950/40 rounded-xl border border-surface-800/80 space-y-1.5 hover:border-surface-700 transition-colors">
                <div className="flex items-center gap-2 text-indigo-400 font-medium text-xs">
                  <Activity size={14} />
                  <span>HDBSCAN & Drain Parser</span>
                </div>
                <p className="text-3xs text-surface-400 leading-relaxed">
                  Extraction sémantique des templates en temps réel O(1), embeddings BGE vectoriels et détection non supervisée des menaces sans signature.
                </p>
              </div>

              {/* Carte 3 : SQLite SQLCipher */}
              <div className="p-3 bg-surface-950/40 rounded-xl border border-surface-800/80 space-y-1.5 hover:border-surface-700 transition-colors">
                <div className="flex items-center gap-2 text-emerald-400 font-medium text-xs">
                  <Database size={14} />
                  <span>Confidentialité & Chiffrement</span>
                </div>
                <p className="text-3xs text-surface-400 leading-relaxed">
                  Base SQLite chiffrée en local (SQLCipher). Mode 100% hors-ligne garanti sans télémétrie ni fuite externe.
                </p>
              </div>

              {/* Carte 4 : DLP & SOAR */}
              <div className="p-3 bg-surface-950/40 rounded-xl border border-surface-800/80 space-y-1.5 hover:border-surface-700 transition-colors">
                <div className="flex items-center gap-2 text-rose-400 font-medium text-xs">
                  <ShieldCheck size={14} />
                  <span>DLP Multi-Axes & SOAR</span>
                </div>
                <p className="text-3xs text-surface-400 leading-relaxed">
                  Détection des exfiltrations (dump SQL, cartes, clés .pem), alertes automatiques et exécution de scripts de remédiation en direct.
                </p>
              </div>
            </div>
          </div>

          {/* Raccourcis Clavier Rapides */}
          <div className="p-3.5 bg-surface-950/40 rounded-xl border border-surface-800 space-y-2">
            <h4 className="text-xs font-semibold text-white flex items-center gap-2">
              <Terminal size={14} className="text-primary-400" />
              <span>Raccourcis Clavier Essentiels</span>
            </h4>
            <div className="grid grid-cols-2 gap-2 text-2xs">
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-900 border border-surface-800">
                <span className="text-surface-300">Palette de commandes</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-surface-200 font-mono text-3xs border border-surface-700">Ctrl + F</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-900 border border-surface-800">
                <span className="text-surface-300">Recherche rapide</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-surface-200 font-mono text-3xs border border-surface-700">Ctrl + K</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-900 border border-surface-800">
                <span className="text-surface-300">Fermer une modale</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-surface-200 font-mono text-3xs border border-surface-700">Échap (ESC)</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-surface-900 border border-surface-800">
                <span className="text-surface-300">Navigation onglets</span>
                <kbd className="px-1.5 py-0.5 rounded bg-surface-800 text-surface-200 font-mono text-3xs border border-surface-700">1 à 7</kbd>
              </div>
            </div>
          </div>
        </div>

        {/* Footer avec Licence et Liens */}
        <div className="p-4 bg-surface-950 border-t border-surface-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-2xs text-surface-400">
          <div className="flex items-center gap-2">
            <Award size={14} className="text-yellow-400 shrink-0" />
            <span>Licence <strong>MIT</strong> — Open Source & Respect de la vie privée</span>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://github.com/Projet-tres-perso/Defudelog"
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1.5 rounded-lg bg-surface-900 hover:bg-surface-800 text-surface-300 hover:text-white border border-surface-700 flex items-center gap-1.5 transition-colors"
            >
              <Github size={13} />
              <span>Dépôt GitHub</span>
            </a>
            <button
              onClick={onClose}
              className="btn-primary text-xs py-1.5 px-4 shadow-sm"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
