import { useMemo } from 'react';
import {
  Sparkles,
  Download,
  ExternalLink,
  Calendar,
  FileCode,
  ArrowRight,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog.js';
import {
  GitHubRelease,
  GitHubReleaseAsset,
  openExternalUrl,
  GITHUB_RELEASES_URL,
} from '../lib/appUpdate.js';

interface UpdateNotificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  release: GitHubRelease | null;
  currentVersion: string;
  platformAsset: GitHubReleaseAsset | null;
  onDismiss?: () => void;
}

function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDate(dateString: string): string {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateString;
  }
}

export function UpdateNotificationModal({
  open,
  onOpenChange,
  release,
  currentVersion,
  platformAsset,
  onDismiss,
}: UpdateNotificationModalProps) {
  const latestTag = release?.tag_name || '';
  const formattedDate = useMemo(() => (release ? formatDate(release.published_at) : ''), [release]);

  if (!release) return null;

  const handleDownload = () => {
    if (platformAsset?.browser_download_url) {
      openExternalUrl(platformAsset.browser_download_url);
    } else if (release.html_url) {
      openExternalUrl(release.html_url);
    }
  };

  const handleViewRelease = () => {
    openExternalUrl(release.html_url || GITHUB_RELEASES_URL);
  };

  const handleRemindLater = () => {
    onDismiss?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 overflow-hidden rounded-2xl border border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1b26] shadow-2xl">
        {/* Top Gradient Banner */}
        <div className="bg-gradient-to-r from-purple-600 via-[#7b68ee] to-indigo-600 p-6 text-white relative">
          <DialogHeader className="space-y-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-inner">
                <Sparkles className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/20 text-white border border-white/20">
                    New Release
                  </span>
                  {formattedDate && (
                    <span className="text-xs text-purple-100 flex items-center gap-1">
                      <Calendar className="w-3 h-3 opacity-70" />
                      {formattedDate}
                    </span>
                  )}
                </div>
                <DialogTitle className="text-xl font-black tracking-tight text-white mt-1">
                  SP-Kickstack {latestTag}
                </DialogTitle>
                <DialogDescription className="text-xs text-purple-100/90 mt-0.5">
                  A new official release is available for download.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {/* Version Transition Badge */}
          <div className="mt-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/20 backdrop-blur-xs border border-white/10 text-xs font-mono">
            <span className="text-purple-200">Current: v{currentVersion}</span>
            <ArrowRight className="w-3.5 h-3.5 text-white/60" />
            <span className="text-amber-300 font-bold">New: {latestTag}</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Release Notes */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <span>What's New in This Release</span>
              <button
                type="button"
                onClick={handleViewRelease}
                className="text-[#7b68ee] dark:text-purple-400 hover:underline flex items-center gap-1 font-semibold normal-case"
              >
                <span>GitHub Release</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#14151f] border border-slate-200 dark:border-[#27293a] max-h-52 overflow-y-auto text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed font-sans scrollbar-thin">
              {release.body && release.body.trim().length > 0 ? (
                release.body
              ) : (
                <div className="text-slate-400 italic">
                  No detailed release notes provided. View full commit history on GitHub.
                </div>
              )}
            </div>
          </div>

          {/* Platform Download Option */}
          {platformAsset ? (
            <div className="p-3.5 rounded-xl bg-purple-50/70 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800/40 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center shrink-0 text-[#7b68ee]">
                  <Download className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {platformAsset.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <span>Installer package</span>
                    <span>•</span>
                    <span className="font-mono">{formatBytes(platformAsset.size)}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownload}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-[#7b68ee] hover:bg-[#6c5ce7] text-white rounded-lg text-xs font-semibold shadow-md shadow-purple-600/20 transition active:scale-95 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#14151f] border border-slate-200 dark:border-[#27293a] flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <FileCode className="w-4 h-4 text-[#7b68ee]" />
                <span>Installers & binaries available on GitHub</span>
              </div>
              <button
                type="button"
                onClick={handleViewRelease}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-200 dark:bg-[#252738] hover:bg-slate-300 dark:hover:bg-[#2e3146] text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                <span>View Assets</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50/80 dark:bg-[#151622] border-t border-slate-200 dark:border-[#27293a] flex items-center justify-between">
          <button
            type="button"
            onClick={handleRemindLater}
            className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition cursor-pointer"
          >
            Remind Me Later
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleViewRelease}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#35384d] hover:bg-slate-100 dark:hover:bg-[#232536] text-xs font-semibold text-slate-700 dark:text-slate-300 transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>Release Page</span>
              <ExternalLink className="w-3 h-3 opacity-70" />
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="px-4 py-1.5 bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-600/25 transition active:scale-95 flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Get Update</span>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
