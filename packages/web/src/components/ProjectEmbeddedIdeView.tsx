import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  fetchIdeStatus,
  fetchProjectIdeUrl,
  startIdeServer,
  stopIdeServer,
} from '../lib/api.js';
import {
  Code2,
  FolderGit2,
  Power,
  RefreshCw,
  ExternalLink,
  Maximize2,
  Settings,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmbeddedIdeModal } from './EmbeddedIdeModal.js';
import { OpenInIdeButton } from './OpenInIdeButton.js';

export interface ProjectEmbeddedIdeViewProps {
  projectName: string;
  repoPath?: string;
  baseBranch?: string;
  targetBranch?: string;
  className?: string;
}

export const ProjectEmbeddedIdeView: React.FC<ProjectEmbeddedIdeViewProps> = ({
  projectName,
  repoPath,
  baseBranch = 'develop',
  targetBranch = 'main',
  className = '',
}) => {
  const queryClient = useQueryClient();
  const [iframeKey, setIframeKey] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Poll IDE status every 4s while view is mounted
  const { data: ideStatus } = useQuery({
    queryKey: ['ide-status'],
    queryFn: fetchIdeStatus,
    refetchInterval: 4000,
  });

  // Fetch project URL
  const { data: projectUrlData } = useQuery({
    queryKey: ['ide-project-url', projectName],
    queryFn: () => (projectName ? fetchProjectIdeUrl(projectName) : null),
    enabled: Boolean(projectName),
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startIdeServer({
        project_name: projectName,
        folder_path: repoPath,
      }),
    onSuccess: () => {
      toast.success('Embedded VS Code server started');
      queryClient.invalidateQueries({ queryKey: ['ide-status'] });
      queryClient.invalidateQueries({ queryKey: ['ide-project-url', projectName] });
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

  const isServerRunning = Boolean(ideStatus?.running);

  const targetUrl =
    projectUrlData?.url ||
    ideStatus?.url ||
    (repoPath
      ? `http://${ideStatus?.host || '127.0.0.1'}:${ideStatus?.port || 8443}/?folder=${encodeURIComponent(repoPath)}`
      : `http://${ideStatus?.host || '127.0.0.1'}:${ideStatus?.port || 8443}`);

  return (
    <div className={`flex flex-col h-full w-full bg-[#0d0e14] overflow-hidden ${className}`}>
      {/* Subheader Toolbar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-[#12131c] border-b border-slate-800/90 gap-2 shrink-0">
        {/* Left: Status & Folder Path */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-slate-900 border border-slate-800 text-slate-300">
            <span
              className={`w-2 h-2 rounded-full ${
                isServerRunning ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span>{isServerRunning ? `Online (Port ${ideStatus?.port || 8443})` : 'Offline'}</span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono truncate">
            <FolderGit2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="truncate max-w-xs sm:max-w-md" title={repoPath || projectName}>
              {repoPath || projectName}
            </span>
          </div>
        </div>

        {/* Right: Actions & Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Reload Iframe */}
          <button
            type="button"
            onClick={() => {
              setIframeKey((k) => k + 1);
              toast.info('Reloading code editor...');
            }}
            disabled={!isServerRunning}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-40"
            title="Reload Editor Frame"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* Open in New Tab */}
          {isServerRunning && (
            <a
              href={targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 transition"
              title="Open VS Code in new browser tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Tab</span>
            </a>
          )}

          {/* Full-Screen Popout Modal */}
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 transition"
            title="Open Fullscreen IDE Modal"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Pop Out</span>
          </button>

          {/* Power Button */}
          <button
            type="button"
            onClick={() => (isServerRunning ? stopMutation.mutate() : startMutation.mutate())}
            disabled={startMutation.isPending || stopMutation.isPending}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition ${
              isServerRunning
                ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60 hover:bg-rose-900/60'
                : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm'
            }`}
            title={isServerRunning ? 'Stop IDE Server' : 'Start IDE Server'}
          >
            {startMutation.isPending || stopMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Power className="w-3.5 h-3.5" />
            )}
            <span>{isServerRunning ? 'Stop' : 'Start'}</span>
          </button>

          {/* Link to Settings */}
          <Link
            to="/settings?tab=ide"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Configure in Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Editor Body or Offline Banner */}
      <div className="flex-1 min-h-0 relative overflow-hidden bg-slate-950">
        {isServerRunning ? (
          <iframe
            key={iframeKey}
            src={targetUrl}
            title={`Embedded VS Code - ${projectName}`}
            className="w-full h-full border-0 bg-slate-950"
            allow="clipboard-read; clipboard-write;"
          />
        ) : (
          <div className="flex items-center justify-center h-full w-full p-6 text-slate-200">
            <div className="max-w-lg w-full p-8 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl text-center space-y-5 animate-in fade-in-50 duration-200">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-600/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shadow-inner">
                <Code2 className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Embedded VS Code Server is Offline
                </h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Start the local code-server service to inspect files, edit code, and review branches directly inside this window.
                </p>
              </div>

              {/* Binary Status / Info */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 text-left space-y-1.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Service:</span>
                  <span className="text-slate-300 font-semibold">code-server / OpenVSCode</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Port:</span>
                  <span className="text-blue-400 font-bold">{ideStatus?.port || 8443}</span>
                </div>
                {ideStatus?.installed && (
                  <div className="flex items-center justify-between truncate">
                    <span className="text-slate-500">Binary:</span>
                    <span className="text-emerald-400 truncate max-w-[240px]" title={ideStatus.binaryPath}>
                      {ideStatus.binaryPath}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => startMutation.mutate()}
                  disabled={startMutation.isPending}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-600/20 active:scale-95 transition disabled:opacity-50"
                >
                  {startMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Power className="w-4 h-4" />
                  )}
                  <span>Start Server (Port {ideStatus?.port || 8443})</span>
                </button>

                <Link
                  to="/settings?tab=ide"
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
                >
                  <Settings className="w-4 h-4" />
                  <span>Configure Settings</span>
                </Link>
              </div>

              {/* Alternative local app launcher */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-center gap-2 text-xs text-slate-500">
                <span>Or open in your desktop app:</span>
                <OpenInIdeButton projectName={projectName} repoPath={repoPath} variant="card" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Popout Fullscreen Modal */}
      <EmbeddedIdeModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        projectName={projectName}
        projectPath={repoPath}
        baseBranch={baseBranch}
        targetBranch={targetBranch}
      />
    </div>
  );
};
