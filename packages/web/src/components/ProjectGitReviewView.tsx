import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchGitReviewSummary,
  fetchFileDiff,
  fetchFileTree,
  fetchFileContent,
  FileTreeNode,
} from '../lib/api.js';
import { mergeCopy } from '../lib/mergeReady.js';
import { useDemoMode } from '../lib/useDemoMode.js';
import {
  RefreshCw,
  GitBranch,
  GitMerge,
  Folder,
  FolderOpen,
  FileCode,
  FilePlus2,
  FileMinus2,
  FileEdit,
  Columns,
  AlignJustify,
  File,
  Copy,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Terminal,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';

export interface ProjectGitReviewViewProps {
  projectName: string;
  repoPath?: string;
  baseBranch?: string;
  targetBranch?: string;
  requirementTitle?: string;
  onMergeToMain?: () => void;
  isMerging?: boolean;
  onToggleTerminal?: () => void;
  isTerminalOpen?: boolean;
}

type ReviewViewTab = 'changes' | 'tree' | 'commits';
type DiffMode = 'split' | 'unified' | 'raw';

export const ProjectGitReviewView: React.FC<ProjectGitReviewViewProps> = ({
  projectName,
  repoPath,
  baseBranch = 'develop',
  targetBranch = 'main',
  requirementTitle,
  onMergeToMain,
  isMerging = false,
  onToggleTerminal,
  isTerminalOpen = false,
}) => {
  const [activeTab, setActiveTab] = useState<ReviewViewTab>('changes');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>('split');
  const [copied, setCopied] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['', 'src']));

  const mergeText = mergeCopy(useDemoMode());

  // 1. Fetch Review Summary (changed files & commits)
  const {
    data: summary,
    isLoading: isSummaryLoading,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['git-review-summary', projectName, targetBranch],
    queryFn: () => (projectName ? fetchGitReviewSummary(projectName, targetBranch) : null),
    enabled: Boolean(projectName),
    refetchInterval: 6000,
  });

  // Reset/select first changed file on project or summary change
  useEffect(() => {
    if (summary?.changedFiles && summary.changedFiles.length > 0) {
      if (!selectedFilePath || !summary.changedFiles.some((f) => f.path === selectedFilePath)) {
        setSelectedFilePath(summary.changedFiles[0].path);
      }
    }
  }, [summary, projectName]);

  // 2. Fetch File Diff
  const { data: fileDiff, isLoading: isDiffLoading } = useQuery({
    queryKey: ['git-file-diff', projectName, selectedFilePath, targetBranch],
    queryFn: () =>
      projectName && selectedFilePath
        ? fetchFileDiff(projectName, selectedFilePath, targetBranch)
        : null,
    enabled: Boolean(projectName && selectedFilePath && activeTab === 'changes'),
  });

  // 3. Fetch File Tree (when in 'tree' tab)
  const { data: fileTree, isLoading: isTreeLoading } = useQuery({
    queryKey: ['git-file-tree', projectName],
    queryFn: () => (projectName ? fetchFileTree(projectName) : null),
    enabled: Boolean(projectName && activeTab === 'tree'),
  });

  // 4. Fetch Raw File Content (when exploring tree or raw mode)
  const { data: rawFile, isLoading: isRawLoading } = useQuery({
    queryKey: ['git-file-content', projectName, selectedFilePath],
    queryFn: () =>
      projectName && selectedFilePath
        ? fetchFileContent(projectName, selectedFilePath)
        : null,
    enabled: Boolean(projectName && selectedFilePath && (activeTab === 'tree' || diffMode === 'raw')),
  });

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  };

  const copyContent = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Copied file content');
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'added':
        return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/40';
      case 'deleted':
        return 'text-rose-400 bg-rose-950/60 border-rose-800/40';
      default:
        return 'text-amber-400 bg-amber-950/60 border-amber-800/40';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'added':
        return <FilePlus2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'deleted':
        return <FileMinus2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
      default:
        return <FileEdit className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
  };

  // Render Tree recursively
  const renderTreeNode = (node: FileTreeNode) => {
    if (node.type === 'directory') {
      const isExpanded = expandedFolders.has(node.path);
      return (
        <div key={node.path || node.name} className="select-none">
          <div
            onClick={() => toggleFolder(node.path)}
            className="flex items-center gap-1.5 py-1 px-2 rounded-md hover:bg-slate-800/70 text-slate-300 text-xs cursor-pointer font-medium"
          >
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-purple-400 shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-purple-400 shrink-0" />
            )}
            <span className="truncate">{node.name || 'root'}</span>
          </div>
          {isExpanded && node.children && (
            <div className="pl-3.5 border-l border-slate-800 ml-2 mt-0.5 space-y-0.5">
              {node.children.map(renderTreeNode)}
            </div>
          )}
        </div>
      );
    }

    const isSelected = selectedFilePath === node.path;
    return (
      <div
        key={node.path}
        onClick={() => setSelectedFilePath(node.path)}
        className={`flex items-center justify-between py-1 px-2 rounded-md text-xs cursor-pointer transition-colors ${
          isSelected
            ? 'bg-purple-600/25 text-purple-200 font-bold border border-purple-500/30'
            : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
        }`}
      >
        <div className="flex items-center gap-1.5 truncate">
          <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="truncate">{node.name}</span>
        </div>
        {node.size !== undefined && (
          <span className="text-[10px] text-slate-500 font-mono ml-2 shrink-0">
            {Math.round(node.size / 1024)}K
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#090a0f] text-slate-200 overflow-hidden">
      {/* Top Context Subheader */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 bg-[#12141c] border-b border-slate-800/80 gap-3 shrink-0 select-none">
        <div className="flex items-center gap-2.5 flex-wrap min-w-0">
          <span className="inline-flex items-center gap-1 text-xs font-mono font-bold text-purple-300 bg-purple-950/60 px-2.5 py-1 rounded-lg border border-purple-800/50">
            <GitBranch className="w-3.5 h-3.5 text-purple-400" />
            <span>{summary?.currentBranch || baseBranch}</span>
            <span className="text-slate-500">➔</span>
            <span>{summary?.targetBranch || targetBranch}</span>
          </span>

          {summary && (
            <div className="inline-flex items-center gap-2 text-xs font-mono text-slate-300 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800">
              <span className="text-emerald-400 font-bold">+{summary.totalAdditions}</span>
              <span className="text-rose-400 font-bold">-{summary.totalDeletions}</span>
              <span className="text-slate-400">({summary.changedFiles.length} files changed)</span>
            </div>
          )}

          {requirementTitle && (
            <span className="text-xs text-slate-400 truncate max-w-sm hidden xl:inline">
              • {requirementTitle}
            </span>
          )}

          {(repoPath || summary?.repoPath) && (
            <span className="text-[11px] text-slate-500 font-mono truncate max-w-xs hidden 2xl:inline" title={repoPath || summary?.repoPath}>
              {repoPath || summary?.repoPath}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Toggle Embedded Bottom Terminal */}
          {onToggleTerminal && (
            <button
              type="button"
              onClick={onToggleTerminal}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition border ${
                isTerminalOpen
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700 shadow-sm'
                  : 'bg-slate-900 text-slate-300 hover:text-white border-slate-700 hover:bg-slate-800'
              }`}
              title="Toggle bottom embedded shell terminal"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isTerminalOpen ? 'Hide Terminal' : 'Open Terminal'}</span>
            </button>
          )}

          {/* Refresh button */}
          <button
            type="button"
            onClick={() => refetchSummary()}
            disabled={isSummaryLoading}
            title="Refresh Git Diff"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSummaryLoading ? 'animate-spin' : ''}`} />
          </button>

          {/* 1-Click Approve & Merge to Main */}
          {onMergeToMain && (
            <button
              type="button"
              onClick={onMergeToMain}
              disabled={isMerging}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-md shadow-emerald-700/20 active:scale-95 transition-all disabled:opacity-50"
            >
              <GitMerge className="w-3.5 h-3.5" />
              <span>{isMerging ? mergeText.pending : mergeText.action}</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Diff Split Panels */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sub-Left Panel: Changes / Files / Commits */}
        <div className="w-72 sm:w-80 shrink-0 bg-[#0d0e14] border-r border-slate-800/80 flex flex-col">
          {/* View Tabs */}
          <div className="grid grid-cols-3 p-1.5 bg-[#12141a] border-b border-slate-800/80 gap-1 text-xs shrink-0 select-none">
            <button
              type="button"
              onClick={() => setActiveTab('changes')}
              className={`py-1.5 rounded-lg font-bold transition-all flex items-center justify-center gap-1 ${
                activeTab === 'changes'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <span>Changes</span>
              {summary && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/40 font-mono">
                  {summary.changedFiles.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('tree')}
              className={`py-1.5 rounded-lg font-bold transition-all flex items-center justify-center gap-1 ${
                activeTab === 'tree'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <span>Files</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('commits')}
              className={`py-1.5 rounded-lg font-bold transition-all flex items-center justify-center gap-1 ${
                activeTab === 'commits'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <span>Commits</span>
            </button>
          </div>

          {/* Subpanel List Content */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {/* Tab 1: Changed Files */}
            {activeTab === 'changes' && (
              <>
                {isSummaryLoading ? (
                  <div className="p-8 text-center text-slate-500 text-xs">Loading git diff...</div>
                ) : summary?.changedFiles && summary.changedFiles.length > 0 ? (
                  summary.changedFiles.map((file) => {
                    const isSelected = selectedFilePath === file.path;
                    return (
                      <div
                        key={file.path}
                        onClick={() => setSelectedFilePath(file.path)}
                        className={`p-2.5 rounded-xl cursor-pointer transition-all border flex items-center justify-between ${
                          isSelected
                            ? 'bg-purple-600/20 border-purple-500/40 text-white shadow-xs'
                            : 'bg-slate-900/60 border-slate-800/60 text-slate-300 hover:bg-slate-900 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {getStatusIcon(file.status)}
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">{file.path.split('/').pop()}</p>
                            <p className="text-[10px] text-slate-500 font-mono truncate">
                              {file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '.'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 text-[10px] font-mono shrink-0 ml-2">
                          <span className="text-emerald-400 font-bold">+{file.additions}</span>
                          <span className="text-rose-400 font-bold">-{file.deletions}</span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                    <p className="text-xs font-bold text-white">Working Tree is Clean</p>
                    <p className="text-[11px] text-slate-400">
                      No changes detected between {summary?.currentBranch || baseBranch} and {summary?.targetBranch || targetBranch}.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Tab 2: Full Project Tree */}
            {activeTab === 'tree' && (
              <>
                {isTreeLoading ? (
                  <div className="p-8 text-center text-slate-500 text-xs">Scanning project tree...</div>
                ) : fileTree ? (
                  renderTreeNode(fileTree)
                ) : (
                  <div className="p-8 text-center text-slate-500 text-xs">Could not load tree</div>
                )}
              </>
            )}

            {/* Tab 3: Recent Commits */}
            {activeTab === 'commits' && (
              <div className="space-y-2 p-1">
                {summary?.recentCommits && summary.recentCommits.length > 0 ? (
                  summary.recentCommits.map((cmt) => (
                    <div
                      key={cmt.hash}
                      className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-purple-400 text-[11px]">
                          {cmt.hash}
                        </span>
                        <span className="text-[10px] text-slate-500">{cmt.date}</span>
                      </div>
                      <p className="text-slate-200 font-medium text-[11px] leading-snug">
                        {cmt.message}
                      </p>
                      <p className="text-[10px] text-slate-400">by {cmt.author}</p>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-500 text-xs">No recent commits found</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sub-Right Panel: Diff Toolbar & Viewer */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#090a0f] overflow-hidden">
          {/* File Toolbar */}
          {selectedFilePath ? (
            <div className="flex items-center justify-between px-4 py-2 bg-[#12131a] border-b border-slate-800/80 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
                <span className="text-xs font-mono font-bold text-white truncate">
                  {selectedFilePath}
                </span>

                {fileDiff && (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-bold shrink-0 ${getStatusColor(
                      fileDiff.status
                    )}`}
                  >
                    {fileDiff.status}
                  </span>
                )}
              </div>

              {/* Diff View Controls */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-bold text-slate-400">
                  <button
                    type="button"
                    onClick={() => setDiffMode('split')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                      diffMode === 'split'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'hover:text-white'
                    }`}
                    title="Side-by-Side Diff"
                  >
                    <Columns className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Split Diff</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDiffMode('unified')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                      diffMode === 'unified'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'hover:text-white'
                    }`}
                    title="Unified Diff"
                  >
                    <AlignJustify className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Unified</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDiffMode('raw')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                      diffMode === 'raw'
                        ? 'bg-purple-600 text-white shadow-xs'
                        : 'hover:text-white'
                    }`}
                    title="Full File Content"
                  >
                    <File className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Raw File</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    copyContent(
                      fileDiff?.modifiedContent || rawFile?.content || ''
                    )
                  }
                  title="Copy File Content"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          ) : null}

          {/* Editor Body */}
          <div className="flex-1 overflow-auto font-mono text-xs">
            {isDiffLoading || isRawLoading ? (
              <div className="p-12 text-center text-slate-500">Loading code diff...</div>
            ) : summary?.error ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 max-w-lg mx-auto space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shadow-lg">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-white">Repository Path Diagnostic</h4>
                  <p className="text-xs text-rose-300 font-mono bg-rose-950/40 p-3 rounded-xl border border-rose-900/40 text-left whitespace-pre-wrap">
                    {summary.error}
                  </p>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The configured directory path does not exist on this machine or is not an initialized Git repository.
                  You can edit the project path in Project Settings or initialize it using the interactive terminal.
                </p>
                <div className="flex items-center gap-2 pt-2">
                  {onToggleTerminal && (
                    <button
                      type="button"
                      onClick={onToggleTerminal}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-sm"
                    >
                      <Terminal className="w-4 h-4" />
                      <span>Open Project Terminal</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => refetchSummary()}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition border border-slate-700"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Retry Check</span>
                  </button>
                </div>
              </div>
            ) : !selectedFilePath ? (
              <div className="flex flex-col h-full overflow-y-auto p-6 space-y-6 max-w-4xl mx-auto">
                {/* Clean Status Banner */}
                <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/40 to-slate-900/60 border border-emerald-800/40 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Working Tree is Clean</h4>
                      <p className="text-xs text-slate-400">
                        {summary?.changedFiles && summary.changedFiles.length > 0
                          ? `${summary.changedFiles.length} changed files available — click any file on the left to review its diff.`
                          : `No unmerged changes between branch "${summary?.currentBranch || baseBranch}" and target "${summary?.targetBranch || targetBranch}".`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {onToggleTerminal && (
                      <button
                        type="button"
                        onClick={onToggleTerminal}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-900/40 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/50 text-xs font-bold transition"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Terminal</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Quick Info Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Repository Path</span>
                    <p className="text-xs font-mono text-purple-300 truncate" title={summary?.repoPath || repoPath}>
                      {summary?.repoPath || repoPath || '.'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Current Branch</span>
                    <p className="text-xs font-mono text-emerald-300 truncate">
                      {summary?.currentBranch || baseBranch}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target Compare</span>
                    <p className="text-xs font-mono text-rose-300 truncate">
                      {summary?.targetBranch || targetBranch}
                    </p>
                  </div>
                </div>

                {/* Changed Files List If Any */}
                {summary?.changedFiles && summary.changedFiles.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Changed Files ({summary.changedFiles.length})
                      </span>
                      <span className="text-[11px] text-slate-500">Click a file to view side-by-side diff</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {summary.changedFiles.map((file) => (
                        <div
                          key={file.path}
                          onClick={() => setSelectedFilePath(file.path)}
                          className="flex items-center justify-between p-3 rounded-xl bg-slate-900/70 hover:bg-purple-950/30 border border-slate-800 hover:border-purple-600/50 cursor-pointer transition-all group"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {getStatusIcon(file.status)}
                            <span className="text-xs font-bold text-slate-200 group-hover:text-white truncate">
                              {file.path}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-mono shrink-0 ml-2">
                            <span className="text-emerald-400 font-bold">+{file.additions}</span>
                            <span className="text-rose-400 font-bold">-{file.deletions}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Commits Overview */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      Recent Commits ({summary?.recentCommits?.length || 0})
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveTab('commits')}
                      className="text-xs text-purple-400 hover:underline"
                    >
                      View in sidebar
                    </button>
                  </div>

                  {summary?.recentCommits && summary.recentCommits.length > 0 ? (
                    <div className="divide-y divide-slate-800 rounded-xl bg-slate-900/50 border border-slate-800 overflow-hidden">
                      {summary.recentCommits.map((cmt) => (
                        <div key={cmt.hash} className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-900/80 transition">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="font-mono text-purple-400 font-bold text-[11px] bg-purple-950/50 px-1.5 py-0.5 rounded border border-purple-800/40">
                              {cmt.hash}
                            </span>
                            <span className="text-slate-200 font-medium truncate">{cmt.message}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono shrink-0">
                            <span>{cmt.author}</span>
                            <span>•</span>
                            <span>{cmt.date}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-6 text-center text-xs text-slate-500 rounded-xl bg-slate-900/30 border border-slate-800/60">
                      No recent git commits found on this branch.
                    </div>
                  )}
                </div>
              </div>
            ) : diffMode === 'split' && fileDiff ? (
              /* Side-by-Side (Split) Diff View */
              <div className="grid grid-cols-2 divide-x divide-slate-800 min-h-full">
                {/* Left Column: Target Branch (Original) */}
                <div className="bg-[#0b0c10]">
                  <div className="sticky top-0 z-10 px-3 py-1.5 bg-slate-900/90 backdrop-blur border-b border-slate-800 text-[11px] font-bold text-rose-300 flex items-center justify-between">
                    <span>Base: {targetBranch} (Target)</span>
                    <span className="text-slate-500 font-normal">Original</span>
                  </div>
                  <div className="p-2 space-y-0.5">
                    {fileDiff.originalContent ? (
                      fileDiff.originalContent.split('\n').map((line, idx) => (
                        <div key={idx} className="flex hover:bg-slate-900/40 py-0.5 leading-relaxed">
                          <span className="w-10 text-right pr-3 select-none text-slate-600 shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-slate-300 whitespace-pre break-all">{line || ' '}</span>
                        </div>
                      ))
                    ) : (
                      <div className="p-6 text-center text-slate-600 italic">
                        File did not exist in {targetBranch} (New File)
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Source Branch (Modified) */}
                <div className="bg-[#0e0f14]">
                  <div className="sticky top-0 z-10 px-3 py-1.5 bg-slate-900/90 backdrop-blur border-b border-slate-800 text-[11px] font-bold text-emerald-300 flex items-center justify-between">
                    <span>Head: {summary?.currentBranch || baseBranch} (Review)</span>
                    <span className="text-slate-500 font-normal">Current Changes</span>
                  </div>
                  <div className="p-2 space-y-0.5">
                    {fileDiff.modifiedContent ? (
                      fileDiff.modifiedContent.split('\n').map((line, idx) => (
                        <div key={idx} className="flex hover:bg-slate-900/40 py-0.5 leading-relaxed">
                          <span className="w-10 text-right pr-3 select-none text-slate-600 shrink-0">
                            {idx + 1}
                          </span>
                          <span className="text-slate-100 whitespace-pre break-all">{line || ' '}</span>
                        </div>
                      ))
                    ) : (
                      <div className="p-6 text-center text-rose-500/70 italic">
                        File deleted in this branch
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : diffMode === 'unified' && fileDiff ? (
              /* Unified Diff View */
              <div className="p-3 space-y-0.5 bg-[#0a0b0e]">
                {fileDiff.diffLines && fileDiff.diffLines.length > 0 ? (
                  fileDiff.diffLines.map((line, idx) => {
                    if (line.type === 'header') {
                      return (
                        <div
                          key={idx}
                          className="bg-purple-950/40 text-purple-300 px-3 py-1 font-bold my-1 rounded border border-purple-900/40"
                        >
                          {line.content}
                        </div>
                      );
                    }
                    if (line.type === 'add') {
                      return (
                        <div
                          key={idx}
                          className="flex bg-emerald-950/40 text-emerald-200 border-l-2 border-emerald-500 py-0.5 leading-relaxed"
                        >
                          <span className="w-10 text-right pr-2 text-slate-600 select-none">
                            {line.oldLineNumber || ' '}
                          </span>
                          <span className="w-10 text-right pr-3 text-emerald-400 select-none">
                            {line.newLineNumber || ' '}
                          </span>
                          <span className="w-4 text-center select-none text-emerald-400 font-bold">+</span>
                          <span className="whitespace-pre break-all flex-1">{line.content || ' '}</span>
                        </div>
                      );
                    }
                    if (line.type === 'del') {
                      return (
                        <div
                          key={idx}
                          className="flex bg-rose-950/40 text-rose-200 border-l-2 border-rose-500 py-0.5 leading-relaxed"
                        >
                          <span className="w-10 text-right pr-2 text-rose-400 select-none">
                            {line.oldLineNumber || ' '}
                          </span>
                          <span className="w-10 text-right pr-3 text-slate-600 select-none">
                            {line.newLineNumber || ' '}
                          </span>
                          <span className="w-4 text-center select-none text-rose-400 font-bold">-</span>
                          <span className="whitespace-pre break-all flex-1">{line.content || ' '}</span>
                        </div>
                      );
                    }
                    return (
                      <div key={idx} className="flex hover:bg-slate-900/30 py-0.5 leading-relaxed">
                        <span className="w-10 text-right pr-2 text-slate-600 select-none">
                          {line.oldLineNumber || ' '}
                        </span>
                        <span className="w-10 text-right pr-3 text-slate-600 select-none">
                          {line.newLineNumber || ' '}
                        </span>
                        <span className="w-4 text-center select-none text-slate-700"> </span>
                        <span className="text-slate-300 whitespace-pre break-all flex-1">{line.content || ' '}</span>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-slate-500">No diff chunks available</div>
                )}
              </div>
            ) : (
              /* Raw Full File Content */
              <div className="p-4 bg-[#0a0b0e]">
                {rawFile?.content ? (
                  rawFile.content.split('\n').map((line, idx) => (
                    <div key={idx} className="flex hover:bg-slate-900/40 py-0.5 leading-relaxed">
                      <span className="w-12 text-right pr-4 select-none text-slate-600 shrink-0 font-mono">
                        {idx + 1}
                      </span>
                      <span className="text-slate-200 whitespace-pre break-all">{line || ' '}</span>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-slate-500">File is empty</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
