import { useState } from 'react';
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  Download,
  Monitor,
  Globe,
  Github,
  Bug,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { APP_VERSION } from '@sp-kickstack/shared';
import { useAppUpdate, GITHUB_REPO, GITHUB_RELEASES_URL, openExternalUrl } from '../lib/appUpdate.js';
import { isTauri } from '../lib/api.js';
import { UpdateNotificationModal } from './UpdateNotificationModal.js';

export function AboutSettingsSection() {
  const {
    isChecking,
    hasUpdate,
    latestTag,
    release,
    platformAsset,
    checkForUpdates,
  } = useAppUpdate();

  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-150">
      {/* 1. App Info Header Card */}
      <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-[#2d2d2d]">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#7b68ee] to-[#ff007f] flex items-center justify-center text-white font-black text-xl shadow-md shadow-purple-600/20 shrink-0">
              ⚡
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  SP-Kickstack
                </h2>
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] dark:text-purple-300 border border-purple-200 dark:border-purple-800/40">
                  v{APP_VERSION}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Multi-Project Architecture & Contract-Isolated Agent Orchestrator
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                isTauri
                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/40'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/40'
              }`}
            >
              {isTauri ? (
                <>
                  <Monitor className="w-3.5 h-3.5" />
                  <span>Tauri Desktop App</span>
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  <span>Web App Engine</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* System & Architecture Details */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-5">
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1c1c1c] border border-slate-200/80 dark:border-[#2d2d2d]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
              Execution Runtime
            </span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              {isTauri ? 'Native Shell (Rust + Node)' : 'Web Browser Client'}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1c1c1c] border border-slate-200/80 dark:border-[#2d2d2d]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
              IPC & Server Bridge
            </span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              localhost:4100 (WAL)
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1c1c1c] border border-slate-200/80 dark:border-[#2d2d2d]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
              Governance & Safety
            </span>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              Deterministic Fan-Out
            </span>
          </div>
        </div>
      </div>

      {/* 2. Software Updates Card */}
      <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-[#7b68ee]" />
            <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              Software Updates & Releases
            </h3>
          </div>

          <button
            type="button"
            onClick={() => checkForUpdates(true)}
            disabled={isChecking}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-[#2c2c2c] hover:bg-slate-200 dark:hover:bg-[#383838] disabled:opacity-50 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-semibold border border-slate-200 dark:border-[#3a3a3a] transition cursor-pointer active:scale-95"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-[#7b68ee]' : ''}`} />
            <span>{isChecking ? 'Checking...' : 'Check for Updates'}</span>
          </button>
        </div>

        {/* Update Status Display */}
        {hasUpdate ? (
          <div className="p-4 rounded-xl bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-transparent border border-purple-200 dark:border-purple-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center shrink-0 text-[#7b68ee] mt-0.5">
                <Sparkles className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-900 dark:text-white">
                    Update Available: {latestTag}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                    Latest
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  A newer release of SP-Kickstack was published to GitHub.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#7b68ee] hover:bg-[#6c5ce7] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-600/20 transition active:scale-95 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>View Update Details</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/70 dark:border-emerald-800/40 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">
                SP-Kickstack is up to date
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                You are currently running version v{APP_VERSION}, the latest official release.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 3. Community & GitHub Resources */}
      <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
          Resources & Repository
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => openExternalUrl(`https://github.com/${GITHUB_REPO}`)}
            className="p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-[#1c1c1c] dark:hover:bg-[#252525] border border-slate-200/80 dark:border-[#2d2d2d] flex items-center justify-between text-left transition group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Github className="w-4 h-4 text-slate-700 dark:text-slate-300 group-hover:text-[#7b68ee] transition" />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  GitHub Repository
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {GITHUB_REPO}
                </div>
              </div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition" />
          </button>

          <button
            type="button"
            onClick={() => openExternalUrl(GITHUB_RELEASES_URL)}
            className="p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-[#1c1c1c] dark:hover:bg-[#252525] border border-slate-200/80 dark:border-[#2d2d2d] flex items-center justify-between text-left transition group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Download className="w-4 h-4 text-slate-700 dark:text-slate-300 group-hover:text-[#7b68ee] transition" />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  Releases & Downloads
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  DMG, MSI, DEB packages
                </div>
              </div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition" />
          </button>

          <button
            type="button"
            onClick={() => openExternalUrl(`https://github.com/${GITHUB_REPO}/issues`)}
            className="p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-[#1c1c1c] dark:hover:bg-[#252525] border border-slate-200/80 dark:border-[#2d2d2d] flex items-center justify-between text-left transition group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Bug className="w-4 h-4 text-slate-700 dark:text-slate-300 group-hover:text-[#7b68ee] transition" />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  Report an Issue
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Bug reports & feature ideas
                </div>
              </div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 transition" />
          </button>
        </div>
      </div>

      {/* Radix Modal */}
      <UpdateNotificationModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        release={release}
        currentVersion={APP_VERSION}
        platformAsset={platformAsset}
      />
    </div>
  );
}
