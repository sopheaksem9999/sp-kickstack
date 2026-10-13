import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchIdeStatus,
  startIdeServer,
  stopIdeServer,
  fetchProjectIdeUrl,
} from '../lib/api.js';
import {
  X,
  RefreshCw,
  ExternalLink,
  Power,
  GitBranch,
  GitMerge,
  Terminal,
  FolderGit2,
  Copy,
  Check,
  Code2,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Portal } from './ui/portal.js';

interface EmbeddedIdeModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName?: string;
  projectPath?: string;
  requirementTitle?: string;
  baseBranch?: string;
  targetBranch?: string;
  onMergeToMain?: () => void;
  isMerging?: boolean;
}

export const EmbeddedIdeModal: React.FC<EmbeddedIdeModalProps> = ({
  isOpen,
  onClose,
  projectName,
  projectPath,
  requirementTitle,
  baseBranch = 'develop',
  targetBranch = 'main',
  onMergeToMain,
  isMerging = false,
}) => {
  const queryClient = useQueryClient();
  const [iframeKey, setIframeKey] = useState(1);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Poll IDE status every 3s while modal is active
  const { data: ideStatus, isLoading: isStatusLoading } = useQuery({
    queryKey: ['ide-status'],
    queryFn: fetchIdeStatus,
    enabled: isOpen,
    refetchInterval: isOpen ? 3000 : false,
  });

  // Fetch project URL
  const { data: projectUrlData } = useQuery({
    queryKey: ['ide-project-url', projectName],
    queryFn: () => (projectName ? fetchProjectIdeUrl(projectName) : null),
    enabled: Boolean(isOpen && projectName),
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startIdeServer({
        project_name: projectName,
        folder_path: projectPath,
      }),
    onSuccess: () => {
      toast.success('Embedded IDE server started');
      queryClient.invalidateQueries({ queryKey: ['ide-status'] });
      setIframeKey((k) => k + 1);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to start IDE server');
    },
  });

  const stopMutation = useMutation({
    mutationFn: stopIdeServer,
    onSuccess: () => {
      toast.info('IDE server stopped');
      queryClient.invalidateQueries({ queryKey: ['ide-status'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to stop IDE server');
    },
  });

  if (!isOpen) return null;

  const targetUrl =
    projectUrlData?.url ||
    ideStatus?.url ||
    (projectPath
      ? `http://${ideStatus?.host || '127.0.0.1'}:${ideStatus?.port || 8443}/?folder=${encodeURIComponent(projectPath)}`
      : `http://${ideStatus?.host || '127.0.0.1'}:${ideStatus?.port || 8443}`);

  const isServerRunning = Boolean(ideStatus?.running);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(label);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-in fade-in duration-200 p-2 sm:p-4">
      <div className="flex flex-col w-full h-[95vh] max-w-[1700px] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Top Header Bar */}
        <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-slate-950 border-b border-slate-800/80 gap-3">
          {/* Left: Project & Branch Context */}
          <div className="flex items-center gap-3">
            <div className="p-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-white flex items-center gap-1.5">
                  <FolderGit2 className="w-4 h-4 text-slate-400" />
                  {projectName || 'Workspace Project'}
                </span>
                <span className="text-xs text-slate-400 font-mono hidden md:inline">
                  {projectPath || projectUrlData?.repo_path || ''}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/40">
                  <GitBranch className="w-3 h-3 text-purple-400" />
                  {baseBranch} ➔ {targetBranch}
                </span>
                {requirementTitle && (
                  <span className="text-[11px] text-slate-400 truncate max-w-xs hidden lg:inline">
                    • {requirementTitle}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Actions & Server Controls */}
          <div className="flex items-center gap-2">
            {/* Status Indicator */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-slate-900 border border-slate-800 text-slate-300">
              <span
                className={`w-2 h-2 rounded-full ${
                  isServerRunning ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span>{isServerRunning ? `IDE Online (Port ${ideStatus?.port})` : 'IDE Offline'}</span>
            </div>

            {/* Merge to Main button if reviewing requirement */}
            {onMergeToMain && (
              <button
                type="button"
                onClick={onMergeToMain}
                disabled={isMerging}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-700/20 active:scale-95 transition-all disabled:opacity-50"
              >
                <GitMerge className="w-3.5 h-3.5" />
                <span>{isMerging ? 'Merging...' : 'Approve & Merge to Main'}</span>
              </button>
            )}

            {/* Reload Webview */}
            {isServerRunning && (
              <button
                type="button"
                onClick={() => setIframeKey((k) => k + 1)}
                title="Reload Webview"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            {/* Open in external browser tab */}
            {isServerRunning && (
              <a
                href={targetUrl}
                target="_blank"
                rel="noreferrer"
                title="Open in Full Browser Tab"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}

            {/* Start / Stop Toggle */}
            <button
              type="button"
              onClick={() => (isServerRunning ? stopMutation.mutate() : startMutation.mutate())}
              disabled={startMutation.isPending || stopMutation.isPending}
              title={isServerRunning ? 'Stop IDE Server' : 'Start IDE Server'}
              className={`p-1.5 rounded-lg transition-colors ${
                isServerRunning
                  ? 'text-rose-400 hover:bg-rose-950/60'
                  : 'text-emerald-400 hover:bg-emerald-950/60'
              }`}
            >
              <Power className="w-4 h-4" />
            </button>

            {/* Close Modal */}
            <button
              type="button"
              onClick={onClose}
              title="Close Review"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 w-full h-full bg-[#1e1e1e] relative overflow-hidden">
          {isServerRunning ? (
            <iframe
              key={iframeKey}
              src={targetUrl}
              title="Embedded VS Code"
              className="w-full h-full border-0"
              allow="clipboard-read; clipboard-write; cross-origin-isolated"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center max-w-xl mx-auto space-y-6">
              <div className="p-4 rounded-2xl bg-slate-800/80 border border-slate-700 text-blue-400 shadow-xl">
                <Terminal className="w-10 h-10" />
              </div>

              <div className="space-y-2">
                <h3 className="text-xl font-bold text-white">
                  Embedded VS Code Server is Offline
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Review the full project repository, explore git diffs, and inspect code
                  directly inside SP-Kickstack before merging and deploying.
                </p>
              </div>

              {/* Start Button if installed */}
              {ideStatus?.installed ? (
                <div className="space-y-3 w-full">
                  <button
                    type="button"
                    onClick={() => startMutation.mutate()}
                    disabled={startMutation.isPending}
                    className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-lg shadow-blue-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <Power className="w-4 h-4" />
                    <span>{startMutation.isPending ? 'Starting Server...' : 'Start Embedded IDE Server'}</span>
                  </button>
                  <p className="text-[11px] text-slate-500 font-mono">
                    Binary found: {ideStatus.binaryPath}
                  </p>
                </div>
              ) : (
                /* Install Instructions */
                <div className="w-full space-y-4 text-left bg-slate-950/80 p-4 rounded-xl border border-slate-800 text-xs">
                  <div className="flex items-center gap-2 text-amber-400 font-bold">
                    <AlertCircle className="w-4 h-4" />
                    <span>Setup Required: Install code-server locally</span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    Install <code className="text-blue-400">code-server</code> or <code className="text-blue-400">openvscode-server</code> using your preferred package manager:
                  </p>

                  {/* Brew command */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300">
                    <span>brew install code-server</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard('brew install code-server', 'brew')}
                      className="text-slate-400 hover:text-white"
                    >
                      {copiedCmd === 'brew' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* NPM command */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300">
                    <span>npm install -g code-server</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard('npm install -g code-server', 'npm')}
                      className="text-slate-400 hover:text-white"
                    >
                      {copiedCmd === 'npm' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {/* Manual start command */}
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-slate-300">
                    <span>code-server --auth none --bind-addr 127.0.0.1:8443</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard('code-server --auth none --bind-addr 127.0.0.1:8443', 'run')}
                      className="text-slate-400 hover:text-white"
                    >
                      {copiedCmd === 'run' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => queryClient.invalidateQueries({ queryKey: ['ide-status'] })}
                    disabled={isStatusLoading}
                    className="w-full mt-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isStatusLoading ? 'animate-spin' : ''}`} />
                    <span>Check Again</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  </Portal>
  );
};
