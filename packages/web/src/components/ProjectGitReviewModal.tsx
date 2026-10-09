import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchGitReviewSummary,
  fetchFileDiff,
  fetchFileTree,
  fetchFileContent,
  FileTreeNode,
} from '../lib/api.js';
import {
  X,
  RefreshCw,
  GitBranch,
  GitMerge,
  FolderGit2,
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
} from 'lucide-react';
import { toast } from 'sonner';

interface ProjectGitReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName?: string;
  projectNames?: string[]; // for multi-project requirements
  requirementTitle?: string;
  baseBranch?: string;
  targetBranch?: string;
  onMergeToMain?: () => void;
  isMerging?: boolean;
}

type ReviewViewTab = 'changes' | 'tree' | 'commits';
type DiffMode = 'split' | 'unified' | 'raw';

export const ProjectGitReviewModal: React.FC<ProjectGitReviewModalProps> = ({
  isOpen,
  onClose,
  projectName: initialProjectName,
  projectNames = [],
  requirementTitle,
  baseBranch = 'develop',
  targetBranch = 'main',
  onMergeToMain,
  isMerging = false,
}) => {
  // If multiple projects are provided, default to the first one
  const allProjects = Array.from(new Set([initialProjectName, ...projectNames].filter(Boolean))) as string[];
  const [selectedProject, setSelectedProject] = useState<string>(allProjects[0] || '');

  const [activeTab, setActiveTab] = useState<ReviewViewTab>('changes');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [diffMode, setDiffMode] = useState<DiffMode>('split');
  const [copied, setCopied] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['', 'src']));

  const activeProject = selectedProject || allProjects[0] || '';

  // 1. Fetch Review Summary (changed files & commits)
  const {
    data: summary,
    isLoading: isSummaryLoading,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['git-review-summary', activeProject, targetBranch],
    queryFn: () => (activeProject ? fetchGitReviewSummary(activeProject, targetBranch) : null),
    enabled: Boolean(isOpen && activeProject),
    refetchInterval: isOpen ? 6000 : false,
  });

  // Select first changed file if none selected
  React.useEffect(() => {
    if (summary?.changedFiles && summary.changedFiles.length > 0 && !selectedFilePath) {
      setSelectedFilePath(summary.changedFiles[0].path);
    }
  }, [summary, selectedFilePath]);

  // 2. Fetch File Diff
  const { data: fileDiff, isLoading: isDiffLoading } = useQuery({
    queryKey: ['git-file-diff', activeProject, selectedFilePath, targetBranch],
    queryFn: () =>
      activeProject && selectedFilePath
        ? fetchFileDiff(activeProject, selectedFilePath, targetBranch)
        : null,
    enabled: Boolean(isOpen && activeProject && selectedFilePath && activeTab === 'changes'),
  });

  // 3. Fetch File Tree (when in 'tree' tab)
  const { data: fileTree, isLoading: isTreeLoading } = useQuery({
    queryKey: ['git-file-tree', activeProject],
    queryFn: () => (activeProject ? fetchFileTree(activeProject) : null),
    enabled: Boolean(isOpen && activeProject && activeTab === 'tree'),
  });

  // 4. Fetch Raw File Content (when exploring tree)
  const { data: rawFile, isLoading: isRawLoading } = useQuery({
    queryKey: ['git-file-content', activeProject, selectedFilePath],
    queryFn: () =>
      activeProject && selectedFilePath
        ? fetchFileContent(activeProject, selectedFilePath)
        : null,
    enabled: Boolean(isOpen && activeProject && selectedFilePath && (activeTab === 'tree' || diffMode === 'raw')),
  });

  if (!isOpen) return null;

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
        return <FilePlus2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'deleted':
        return <FileMinus2 className="w-3.5 h-3.5 text-rose-400" />;
      default:
        return <FileEdit className="w-3.5 h-3.5 text-amber-400" />;
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
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            )}
            {isExpanded ? (
              <FolderOpen className="w-4 h-4 text-purple-400" />
            ) : (
              <Folder className="w-4 h-4 text-purple-400" />
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
          <span className="text-[10px] text-slate-500 font-mono ml-2">
            {Math.round(node.size / 1024)}K
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 p-2 sm:p-4">
      <div className="flex flex-col w-full h-[95vh] max-w-[1700px] bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* ========================================================= */}
        {/* Top Header Bar */}
        {/* ========================================================= */}
        <div className="flex flex-wrap items-center justify-between px-5 py-3 bg-[#111218] border-b border-slate-800/80 gap-3">
          {/* Left: Project Selector & Branch Context */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-600/20 text-[#7b68ee] border border-purple-500/30 shadow-xs">
              <FolderGit2 className="w-5 h-5" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                {allProjects.length > 1 ? (
                  <select
                    value={activeProject}
                    onChange={(e) => {
                      setSelectedProject(e.target.value);
                      setSelectedFilePath(null);
                    }}
                    className="bg-slate-900 border border-slate-700 text-white font-bold text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] cursor-pointer"
                  >
                    {allProjects.map((p) => (
                      <option key={p} value={p}>
                        Project: {p}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="font-bold text-sm text-white">
                    {activeProject || 'Repository'}
                  </span>
                )}

                <span className="text-xs text-slate-400 font-mono hidden md:inline truncate max-w-sm">
                  {summary?.repoPath}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 text-[11px] font-mono text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/40">
                  <GitBranch className="w-3 h-3 text-purple-400" />
                  {summary?.currentBranch || baseBranch} ➔ {summary?.targetBranch || targetBranch}
                </span>

                {summary && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    <span className="text-emerald-400 font-bold">+{summary.totalAdditions}</span>
                    <span className="text-rose-400 font-bold">-{summary.totalDeletions}</span>
                    <span className="text-slate-400">({summary.changedFiles.length} files)</span>
                  </span>
                )}

                {requirementTitle && (
                  <span className="text-[11px] text-slate-400 truncate max-w-xs hidden lg:inline">
                    • {requirementTitle}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => refetchSummary()}
              disabled={isSummaryLoading}
              title="Refresh Git Diff"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isSummaryLoading ? 'animate-spin' : ''}`} />
            </button>

            {/* 1-Click Approve & Merge to Main */}
            {onMergeToMain && (
              <button
                type="button"
                onClick={onMergeToMain}
                disabled={isMerging}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-700/20 active:scale-95 transition-all disabled:opacity-50"
              >
                <GitMerge className="w-3.5 h-3.5" />
                <span>{isMerging ? 'Merging to Main...' : 'Approve & Merge to Main'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              title="Close Review"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================= */}
        {/* Main Workspace Layout */}
        {/* ========================================================= */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ------------------------------------------------------- */}
          {/* Left Sidebar: Changed Files / File Tree / Commits       */}
          {/* ------------------------------------------------------- */}
          <div className="w-80 shrink-0 bg-[#0d0e12] border-r border-slate-800/80 flex flex-col">
            {/* Tab Switcher */}
            <div className="grid grid-cols-3 p-2 bg-[#12141a] border-b border-slate-800/80 gap-1 text-xs">
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

            {/* List Content */}
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
                              ? 'bg-purple-600/20 border-purple-500/40 text-white'
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

          {/* ------------------------------------------------------- */}
          {/* Main Area: Split / Unified Diff or Raw File Viewer      */}
          {/* ------------------------------------------------------- */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#090a0f] overflow-hidden">
            {/* File Toolbar */}
            {selectedFilePath ? (
              <div className="flex items-center justify-between px-4 py-2 bg-[#12131a] border-b border-slate-800/80">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="text-xs font-mono font-bold text-white truncate">
                    {selectedFilePath}
                  </span>

                  {fileDiff && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-bold ${getStatusColor(
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
              ) : !selectedFilePath ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2">
                  <FileCode className="w-12 h-12 text-slate-700" />
                  <p className="text-sm font-bold text-slate-400">Select a file from the left to review</p>
                  <p className="text-xs">Compare changes between {baseBranch} and {targetBranch}</p>
                </div>
              ) : diffMode === 'split' && fileDiff ? (
                /* ======================================================= */
                /* Mode 1: Side-by-Side (Split) Diff View                  */
                /* ======================================================= */
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
                /* ======================================================= */
                /* Mode 2: Unified Diff View                               */
                /* ======================================================= */
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
                /* ======================================================= */
                /* Mode 3: Raw Full File Content                           */
                /* ======================================================= */
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
    </div>
  );
};
