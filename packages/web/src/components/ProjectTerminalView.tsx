import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Terminal,
  Play,
  RotateCw,
  Trash2,
  Square,
  Check,
  Copy,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Project } from '@sp-kickstack/shared';
import {
  fetchProjectTerminal,
  sendProjectTerminalInput,
  interruptProjectTerminal,
  restartProjectTerminal,
  clearProjectTerminal,
  fetchActiveTerminals,
  BASE,
} from '../lib/api.js';

interface ProjectTerminalViewProps {
  projectName: string;
  project?: Project;
  repoPath?: string;
  className?: string;
  showHeader?: boolean;
  onClose?: () => void;
}

/**
 * Lightweight ANSI color to formatted React elements parser
 */
function renderAnsiText(text: string) {
  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentColorClass = '';
  let currentWeightClass = '';

  const colorMap: Record<string, string> = {
    '30': 'text-slate-500',
    '31': 'text-rose-400 font-semibold',
    '32': 'text-emerald-400 font-semibold',
    '33': 'text-amber-400 font-semibold',
    '34': 'text-blue-400 font-semibold',
    '35': 'text-purple-400 font-semibold',
    '36': 'text-cyan-400 font-semibold',
    '37': 'text-slate-200',
    '90': 'text-slate-500',
    '91': 'text-rose-300',
    '92': 'text-emerald-300',
    '93': 'text-amber-300',
    '94': 'text-blue-300',
    '95': 'text-purple-300',
    '96': 'text-cyan-300',
    '97': 'text-white',
  };

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const slice = text.substring(lastIndex, match.index);
      parts.push(
        <span key={parts.length} className={`${currentColorClass} ${currentWeightClass}`}>
          {slice}
        </span>
      );
    }

    const codes = (match[1] || '0').split(';');
    for (const code of codes) {
      if (code === '0' || code === '') {
        currentColorClass = '';
        currentWeightClass = '';
      } else if (code === '1') {
        currentWeightClass = 'font-bold';
      } else if (colorMap[code]) {
        currentColorClass = colorMap[code];
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(
      <span key={parts.length} className={`${currentColorClass} ${currentWeightClass}`}>
        {text.substring(lastIndex)}
      </span>
    );
  }

  return parts.length > 0 ? parts : text;
}

export const ProjectTerminalView: React.FC<ProjectTerminalViewProps> = ({
  projectName,
  project,
  repoPath,
  className = 'h-full',
  showHeader = true,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const [commandInput, setCommandInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [liveBuffer, setLiveBuffer] = useState<string>('');

  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 1. Fetch active background running terminals
  const { data: activeTerminals = [] } = useQuery({
    queryKey: ['terminals-active'],
    queryFn: fetchActiveTerminals,
    refetchInterval: 3000,
  });

  // 2. Fetch Terminal Status & Buffer snapshot
  const {
    data: terminalStatus,
    refetch: refetchTerminal,
  } = useQuery({
    queryKey: ['project-terminal', projectName],
    queryFn: () => (projectName ? fetchProjectTerminal(projectName) : null),
    enabled: Boolean(projectName),
    refetchInterval: 4000,
  });

  // Keep live buffer synced with fetched snapshot
  useEffect(() => {
    if (terminalStatus?.buffer !== undefined) {
      setLiveBuffer(terminalStatus.buffer);
    }
  }, [terminalStatus?.buffer, projectName]);

  // 3. Connect to live SSE output stream
  useEffect(() => {
    if (!projectName) return;

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(`${BASE}/projects/${encodeURIComponent(projectName)}/terminal/stream`);

      eventSource.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.type === 'init' && payload.session?.buffer) {
            setLiveBuffer(payload.session.buffer);
          } else if (payload.type === 'chunk' && payload.chunk) {
            setLiveBuffer((prev) => prev + payload.chunk);
          }
        } catch {
          // ignore stream parse errors
        }
      };

      eventSource.onerror = () => {
        eventSource?.close();
      };
    } catch {
      // ignore
    }

    return () => {
      eventSource?.close();
    };
  }, [projectName]);

  // Auto-scroll terminal output
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveBuffer, autoScroll]);

  // Focus input on project change
  useEffect(() => {
    if (projectName) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [projectName]);

  // Send Command Mutation
  const sendMutation = useMutation({
    mutationFn: (cmd: string) => sendProjectTerminalInput(projectName, cmd),
    onSuccess: (status) => {
      setLiveBuffer(status.buffer);
      queryClient.invalidateQueries({ queryKey: ['terminals-active'] });
      queryClient.invalidateQueries({ queryKey: ['project-terminal', projectName] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to send command');
    },
  });

  // Interrupt Mutation (Ctrl+C)
  const interruptMutation = useMutation({
    mutationFn: () => interruptProjectTerminal(projectName),
    onSuccess: () => {
      toast.info(`Sent SIGINT (Ctrl+C) to ${projectName}`);
      queryClient.invalidateQueries({ queryKey: ['project-terminal', projectName] });
      refetchTerminal();
    },
  });

  // Restart Shell Mutation
  const restartMutation = useMutation({
    mutationFn: () => restartProjectTerminal(projectName),
    onSuccess: (status) => {
      setLiveBuffer(status.buffer);
      toast.success(`Restarted terminal shell for ${projectName}`);
      queryClient.invalidateQueries({ queryKey: ['terminals-active'] });
      queryClient.invalidateQueries({ queryKey: ['project-terminal', projectName] });
    },
  });

  // Clear Buffer Mutation
  const clearMutation = useMutation({
    mutationFn: () => clearProjectTerminal(projectName),
    onSuccess: () => {
      setLiveBuffer('');
      queryClient.invalidateQueries({ queryKey: ['project-terminal', projectName] });
      toast.success('Terminal output cleared');
    },
  });

  const handleSendCommand = (cmdToSend?: string) => {
    const cmd = (cmdToSend !== undefined ? cmdToSend : commandInput).trim();
    if (!cmd || sendMutation.isPending) return;

    // Add to history
    setCommandHistory((prev) => [cmd, ...prev.filter((c) => c !== cmd)]);
    setHistoryIndex(-1);
    setCommandInput('');

    sendMutation.mutate(cmd);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const nextIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(nextIndex);
        setCommandInput(commandHistory[nextIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setCommandInput(commandHistory[nextIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCommandInput('');
      }
    }
  };

  const copyLogs = () => {
    navigator.clipboard.writeText(liveBuffer);
    setCopied(true);
    toast.success('Terminal log copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const quickPills = [
    { label: 'npm run dev', cmd: 'npm run dev' },
    { label: 'npm test', cmd: 'npm test' },
    { label: 'git status', cmd: 'git status' },
    { label: 'git branch', cmd: 'git branch -v' },
    { label: 'ls -la', cmd: 'ls -la' },
    { label: 'pwd', cmd: 'pwd' },
  ];

  const isRunning = terminalStatus?.running || activeTerminals.includes(projectName);

  return (
    <div className={`flex flex-col flex-1 min-h-0 bg-[#0f1015] border border-slate-800 rounded-xl overflow-hidden font-mono text-xs ${className}`}>
      {/* Top Header Bar */}
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between px-4 py-2.5 bg-[#161720] border-b border-slate-800/90 gap-2 shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5 p-1 rounded-md bg-emerald-950/60 border border-emerald-800/40 text-emerald-400">
              <Terminal className="w-3.5 h-3.5" />
              <span className="font-bold text-[11px] font-sans uppercase tracking-wider">Shell Terminal</span>
            </div>

            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
              <span>{projectName}</span>
              <span className="text-slate-500 font-normal">({repoPath || project?.repo_path || terminalStatus?.repoPath || ''})</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Status indicator */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10px]">
              <span
                className={`w-2 h-2 rounded-full ${
                  isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span className={isRunning ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                {isRunning ? (
                  terminalStatus?.pid ? `PID: ${terminalStatus.pid}` : 'Running'
                ) : (
                  'Idle Shell'
                )}
              </span>
            </div>

            {/* Device Shell / Local PC Indicator */}
            {terminalStatus?.shell && (
              <div
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-800/40 text-[10px] text-purple-300 font-mono"
                title={`Host device shell: ${terminalStatus.shell} (with local PC environment)`}
              >
                <span>{terminalStatus.shell.split('/').pop()}</span>
                <span className="text-[9px] text-purple-400/80 font-sans">local env</span>
              </div>
            )}

            {/* Interrupt (Ctrl+C) */}
            <button
              type="button"
              onClick={() => interruptMutation.mutate()}
              disabled={interruptMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/50 transition-colors text-[11px]"
              title="Send Ctrl+C (Interrupt command)"
            >
              <Square className="w-2.5 h-2.5 fill-rose-400 text-rose-400" />
              <span>Ctrl+C</span>
            </button>

            {/* Restart Shell */}
            <button
              type="button"
              onClick={() => restartMutation.mutate()}
              disabled={restartMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors text-[11px]"
              title="Kill & restart shell process"
            >
              <RotateCw className={`w-2.5 h-2.5 ${restartMutation.isPending ? 'animate-spin' : ''}`} />
              <span>Restart</span>
            </button>

            {/* Clear Screen */}
            <button
              type="button"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors text-[11px]"
              title="Clear terminal output"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>Clear</span>
            </button>

            {/* Copy Output */}
            <button
              type="button"
              onClick={copyLogs}
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/60 transition-colors text-[11px]"
              title="Copy output to clipboard"
            >
              {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1"
                title="Hide bottom terminal panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Terminal Output Area */}
      <div className="flex-1 overflow-y-auto p-3 bg-[#0a0b0e] text-slate-200 font-mono leading-relaxed select-text space-y-0.5 min-h-0">
        {liveBuffer ? (
          <div className="whitespace-pre-wrap break-all">{renderAnsiText(liveBuffer)}</div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-1.5 select-none py-8">
            <Terminal className="w-7 h-7 text-slate-700" />
            <p className="text-xs">Interactive terminal shell ready for project &ldquo;{projectName}&rdquo;</p>
            <p className="text-[11px] text-slate-700 font-sans">
              Type a command below (e.g. <code>npm run dev</code> or <code>git status</code>) or click a quick shortcut.
            </p>
          </div>
        )}
        <div ref={terminalEndRef} />
      </div>

      {/* Quick Command Pills Bar */}
      <div className="px-3 py-1.5 bg-[#12131c] border-t border-slate-800/70 flex items-center gap-1.5 overflow-x-auto scrollbar-none shrink-0">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold shrink-0">
          Quick:
        </span>
        {quickPills.map((pill) => (
          <button
            key={pill.label}
            type="button"
            onClick={() => handleSendCommand(pill.cmd)}
            disabled={sendMutation.isPending}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 hover:text-white border border-slate-700/60 text-[10px] transition-colors shrink-0 flex items-center gap-1"
          >
            <span>{pill.label}</span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1 cursor-pointer select-none text-[10px] text-slate-400 hover:text-slate-200">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-slate-700 bg-slate-800 text-purple-600 focus:ring-0 w-3 h-3"
            />
            <span>Auto-scroll</span>
          </label>
        </div>
      </div>

      {/* Command Input Prompt Bar */}
      <div className="p-2.5 bg-[#161722] border-t border-slate-800 flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-1 text-emerald-400 font-bold select-none pl-1">
          <span>{projectName}</span>
          <span className="text-slate-500">$</span>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Run command in ${projectName} (e.g. npm run dev, cargo test, git status)...`}
          className="flex-1 bg-[#0d0e13] border border-slate-700/80 rounded-lg px-3 py-1.5 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 font-mono text-xs"
        />

        <button
          type="button"
          onClick={() => handleSendCommand()}
          disabled={sendMutation.isPending || !commandInput.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white font-bold text-xs shadow-md shadow-purple-600/20 disabled:opacity-40 transition-all font-sans"
        >
          <Play className="w-3 h-3 fill-white" />
          <span>Run</span>
        </button>
      </div>
    </div>
  );
};
