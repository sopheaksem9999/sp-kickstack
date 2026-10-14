import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Terminal,
  X,
  Play,
  RotateCw,
  ExternalLink,
  GitPullRequest,
  Copy,
  Check,
  Shield,
  Layers,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { BridgeTask } from '@sp-kickstack/shared';
import { fetchTaskLogs, runTaskCli } from '../lib/api.js';
import { StatusBadge } from './StatusBadge.js';
import { useDemoMode } from '../lib/useDemoMode.js';
import { Portal } from './ui/portal.js';

interface LiveTaskLogsDrawerProps {
  task: BridgeTask | null;
  isOpen: boolean;
  onClose: () => void;
}

export function LiveTaskLogsDrawer({ task, isOpen, onClose }: LiveTaskLogsDrawerProps) {
  const queryClient = useQueryClient();
  // The CLI runner is a simulation, offered only when the server runs with DEMO_MODE=1.
  const demoMode = useDemoMode();
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // Poll logs every 2 seconds when open
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['task-logs', task?.id],
    queryFn: () => (task ? fetchTaskLogs(task.id) : null),
    enabled: Boolean(task && isOpen),
    refetchInterval: isOpen ? 2500 : false,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!task) throw new Error('No task selected');
      return runTaskCli(task.id);
    },
    onSuccess: () => {
      toast.success(`AI CLI task executed for ${task?.project}!`);
      queryClient.invalidateQueries({ queryKey: ['task-logs', task?.id] });
      queryClient.invalidateQueries({ queryKey: ['requirement-graph'] });
      queryClient.invalidateQueries({ queryKey: ['requirement'] });
      refetch();
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to execute CLI task');
    },
  });

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [data?.logs, autoScroll]);

  if (!isOpen || !task) return null;

  const currentTask = data?.task || task;
  const logs = data?.logs || [];

  const handleCopyLogs = () => {
    const text = logs
      .map((l) => `[${new Date(l.created_at).toLocaleTimeString()}] [${l.stream.toUpperCase()}] ${l.message}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Terminal logs copied to clipboard');
  };

  return (
    <Portal>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
      >
      <div className="w-full max-w-3xl h-full bg-[#12131a] text-slate-100 shadow-2xl flex flex-col border-l border-[#272938]">
        {/* Drawer Header */}
        <div className="p-4 border-b border-[#272938] bg-[#161722] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>Task #{currentTask.id}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-purple-300 font-mono">{currentTask.project}</span>
                </h2>
                <StatusBadge status={currentTask.status} size="xs" />
              </div>
              <p className="text-xs text-slate-400 truncate max-w-md mt-0.5">
                {currentTask.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {demoMode && (
              <button
                type="button"
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || currentTask.status === 'done'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#6366f1] hover:from-[#6c5ce7] hover:to-[#4f46e5] text-white text-xs font-bold shadow transition-all disabled:opacity-40 active:scale-95"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{runMutation.isPending ? 'Executing...' : 'Run with AI CLI'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => refetch()}
              className="p-1.5 rounded-lg hover:bg-[#232535] text-slate-400 hover:text-white transition-colors"
              title="Refresh logs"
            >
              <RotateCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#232535] text-slate-400 hover:text-white transition-colors"
              title="Close drawer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Task Meta Ribbon */}
        <div className="px-5 py-2.5 bg-[#181926] border-b border-[#272938] flex items-center justify-between text-xs flex-wrap gap-2">
          <div className="flex items-center gap-4 text-slate-300">
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-400">Protocol:</span>
              <span className="font-semibold text-emerald-300">Strategy A (Headless)</span>
            </span>

            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-slate-400">Role:</span>
              <span className="font-mono text-purple-300">{currentTask.role}</span>
            </span>

            {(currentTask.total_tokens != null || currentTask.cost_usd != null) && (
              <span className="flex items-center gap-1.5 font-mono text-xs text-slate-300">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-slate-400">Tokens:</span>
                <span className="font-semibold text-amber-300">
                  {currentTask.total_tokens?.toLocaleString() ?? 0}
                  {currentTask.input_tokens != null && currentTask.output_tokens != null
                    ? ` (${currentTask.input_tokens.toLocaleString()} in / ${currentTask.output_tokens.toLocaleString()} out)`
                    : ''}
                </span>
                {currentTask.cost_usd != null && (
                  <>
                    <span className="text-slate-500">·</span>
                    <span className="text-emerald-400 font-semibold">${currentTask.cost_usd.toFixed(2)}</span>
                  </>
                )}
              </span>
            )}
          </div>

          {currentTask.pr_url && (
            <a
              href={currentTask.pr_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 underline font-mono"
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              <span>View GitHub Pull Request</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Live Terminal Console Area */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 bg-[#0d0e15]">
          {/* Terminal Controls Bar */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#202230] text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-mono font-semibold text-slate-300">
                LIVE PROCESS STREAM ({logs.length} entries)
              </span>
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded border-[#303348] text-purple-600 focus:ring-0 bg-[#161722]"
                />
                <span>Auto-scroll</span>
              </label>

              <button
                type="button"
                onClick={handleCopyLogs}
                className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Monospace Output */}
          <div className="flex-1 overflow-y-auto font-mono text-xs space-y-1 pr-2 select-text">
            {isLoading && logs.length === 0 ? (
              <div className="text-slate-500 py-8 text-center italic">
                Connecting to local CLI daemon and loading process logs...
              </div>
            ) : logs.length === 0 ? (
              <div className="text-slate-500 py-8 text-center italic">
                {demoMode
                  ? 'No logs recorded yet. Click "Run with AI CLI" to initiate execution.'
                  : 'No logs recorded yet. Engine activity for this task will appear here.'}
              </div>
            ) : (
              logs.map((log) => {
                const time = new Date(log.created_at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                let streamBadge = 'text-slate-400';
                let messageColor = 'text-slate-200';

                if (log.stream === 'system') {
                  streamBadge = 'text-cyan-400';
                  messageColor = 'text-cyan-200';
                } else if (log.stream === 'stderr') {
                  streamBadge = 'text-rose-400';
                  messageColor = 'text-rose-300';
                } else if (log.message.includes('$')) {
                  messageColor = 'text-emerald-300 font-bold';
                }

                return (
                  <div key={log.id} className="flex items-start gap-2 leading-relaxed hover:bg-white/5 py-0.5 px-1 rounded">
                    <span className="text-[10px] text-slate-500 shrink-0 select-none">
                      {time}
                    </span>
                    <span className={`text-[10px] uppercase font-bold shrink-0 select-none ${streamBadge}`}>
                      [{log.stream}]
                    </span>
                    <span className={`break-all ${messageColor}`}>
                      {log.message}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={terminalEndRef} />
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="p-3 border-t border-[#272938] bg-[#161722] flex items-center justify-between text-xs text-slate-400">
          <span>Engine: <strong className="text-slate-200">{currentTask.engine_status_raw || 'Local AI CLI'}</strong></span>
          <span className="font-mono text-[11px]">Updated: {new Date(currentTask.updated_at).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  </Portal>
  );
}
