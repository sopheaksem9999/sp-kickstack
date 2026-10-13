import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchProjects,
  testProjectConnection,
  updateProject,
  deleteProject,
  openProjectFolder,
  createProject,
} from '../lib/api.js';
import { Project, EngineType } from '@sp-kickstack/shared';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { toast } from 'sonner';
import {
  RefreshCw,
  Plus,
  X,
  FolderGit2,
  FolderOpen,
  Pencil,
  Trash2,
  Copy,
  Check,
  Code2,
  Terminal,
  Search,
  LayoutGrid,
  Columns,
  GitBranch,
  Laptop,
  Server,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { Portal } from '../components/ui/portal.js';
import { WorkspaceSelect } from '../components/WorkspaceSelect.js';
import { ProjectGitReviewView } from '../components/ProjectGitReviewView.js';
import { ProjectTerminalView } from '../components/ProjectTerminalView.js';
import { OpenInIdeButton } from '../components/OpenInIdeButton.js';

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeWorkspaceId, workspaces } = useWorkspace();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: () => fetchProjects(activeWorkspaceId),
  });

  // Create Project modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(
    activeWorkspaceId || 'default'
  );
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'backend' | 'frontend' | 'mobile' | 'other'>('backend');
  const [repoPath, setRepoPath] = useState('');
  const [engineType, setEngineType] = useState<EngineType>('manual');
  const [engineUrl, setEngineUrl] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [contractPath, setContractPath] = useState('');
  const [testCommand, setTestCommand] = useState('');

  // Open Details modal state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);



  // Edit Project modal state
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editWorkspaceId, setEditWorkspaceId] = useState('');
  const [editKind, setEditKind] = useState<'backend' | 'frontend' | 'mobile' | 'other'>('backend');
  const [editRepoPath, setEditRepoPath] = useState('');
  const [editEngineType, setEditEngineType] = useState<EngineType>('manual');
  const [editEngineUrl, setEditEngineUrl] = useState('');
  const [editBaseBranch, setEditBaseBranch] = useState('main');
  const [editContractPath, setEditContractPath] = useState('');
  const [editTestCommand, setEditTestCommand] = useState('');

  // Delete Project dialog state
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  // Copy feedback state
  const [copiedPath, setCopiedPath] = useState(false);

  // Tab & Project URL synchronization (e.g. ?project=backend&tab=terminal)
  const urlProject = searchParams.get('project');
  const urlTab = searchParams.get('tab') as 'review' | 'terminal' | null;

  const viewMode: 'grid' | 'split' = urlProject || urlTab ? 'split' : 'grid';
  const splitRightTab: 'review' | 'terminal' = urlTab === 'terminal' ? 'terminal' : 'review';
  const activeSplitProjectName = urlProject || (projects[0]?.name ?? '');
  const [splitSearch, setSplitSearch] = useState('');

  const activeSplitProject = useMemo(() => {
    if (activeSplitProjectName) {
      const found = projects.find((p) => p.name === activeSplitProjectName);
      if (found) return found;
    }
    return projects[0] || null;
  }, [projects, activeSplitProjectName]);

  const filteredSplitProjects = useMemo(() => {
    if (!splitSearch.trim()) return projects;
    const q = splitSearch.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.kind && p.kind.toLowerCase().includes(q)) ||
        (p.repo_path && p.repo_path.toLowerCase().includes(q))
    );
  }, [projects, splitSearch]);

  const getProjectKindIcon = (kind?: string) => {
    switch (kind) {
      case 'frontend':
        return <Laptop className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
      case 'backend':
        return <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
      case 'mobile':
        return <Smartphone className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
      default:
        return <FolderGit2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
  };

  useEffect(() => {
    if (activeWorkspaceId) {
      setWorkspaceId(activeWorkspaceId);
    }
  }, [activeWorkspaceId]);

  // When editing project is opened, populate form
  const handleOpenEdit = (proj: Project) => {
    setEditingProject(proj);
    setEditWorkspaceId(proj.workspace_id || 'default');
    setEditKind(proj.kind as any);
    setEditRepoPath(proj.repo_path);
    setEditEngineType(proj.engine_type);
    setEditEngineUrl(proj.engine_url || '');
    setEditBaseBranch(proj.base_branch || 'main');
    setEditContractPath(proj.contract_path || '');
    setEditTestCommand(proj.test_command || '');
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(true);
    toast.success('Path copied to clipboard');
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const testMutation = useMutation({
    mutationFn: (projName: string) => testProjectConnection(projName),
    onSuccess: (res, projName) => {
      if (res.ok) {
        toast.success(`Connection to engine for ${projName} verified`);
      } else {
        toast.error(`Engine for ${projName} is unreachable`);
      }
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Connection test failed'),
  });

  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (created) => {
      toast.success(`Project ${created.name} registered`);
      setIsModalOpen(false);
      setName('');
      setRepoPath('');
      setEngineUrl('');
      setContractPath('');
      setTestCommand('');
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create project'),
  });

  const updateMutation = useMutation({
    mutationFn: (variables: { name: string; payload: Partial<Project> }) =>
      updateProject(variables.name, variables.payload),
    onSuccess: (updated) => {
      toast.success(`Project ${updated.name} updated`);
      setEditingProject(null);
      if (selectedProject?.name === updated.name) {
        setSelectedProject(updated);
      }
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update project'),
  });

  const deleteMutation = useMutation({
    mutationFn: (projName: string) => deleteProject(projName),
    onSuccess: (_, projName) => {
      toast.success(`Project ${projName} deleted`);
      setDeletingProject(null);
      if (selectedProject?.name === projName) {
        setSelectedProject(null);
      }
      queryClient.invalidateQueries();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete project'),
  });

  const openFolderMutation = useMutation({
    mutationFn: (projName: string) => openProjectFolder(projName),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`Opened project directory in file manager`);
      } else {
        toast.info(`Repository path: ${res.path || 'Folder'}`);
      }
    },
    onError: (err: any) => toast.error(err.message || 'Could not open folder'),
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !repoPath.trim()) {
      toast.error('Name and Repository Path are required');
      return;
    }

    createMutation.mutate({
      name: name.trim().toLowerCase(),
      workspace_id: workspaceId || 'default',
      kind,
      repo_path: repoPath.trim(),
      engine_type: engineType,
      engine_url: engineUrl.trim() || undefined,
      base_branch: baseBranch.trim() || 'main',
      contract_path: contractPath.trim() || undefined,
      test_command: testCommand.trim() || undefined,
      done_means: 'merged',
      enabled: true,
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;

    updateMutation.mutate({
      name: editingProject.name,
      payload: {
        workspace_id: editWorkspaceId || 'default',
        kind: editKind,
        repo_path: editRepoPath.trim(),
        engine_type: editEngineType,
        engine_url: editEngineUrl.trim() || undefined,
        base_branch: editBaseBranch.trim() || 'main',
        contract_path: editContractPath.trim() || undefined,
        test_command: editTestCommand.trim() || undefined,
      },
    });
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
      {viewMode === 'split' ? (
        /* ======================================================= */
        /* IN-CONTAINER SPLIT VIEW (Similar to AI Chat Layout)     */
        /* ======================================================= */
        <div className="flex-1 flex min-h-0 overflow-hidden bg-slate-50 dark:bg-[#0c0d12]">
          {/* Column 1: Projects List Sidebar (Like AI Chat Sessions) */}
          <aside className="w-72 sm:w-80 shrink-0 bg-[#0c0d12] border-r border-slate-800/90 flex flex-col min-h-0 h-full">
            {/* Header & Filter */}
            <div className="p-3 bg-[#11131a] border-b border-slate-800/80 space-y-2 shrink-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FolderGit2 className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Projects</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300">
                    {filteredSplitProjects.length} repos
                  </span>
                  <button
                    type="button"
                    onClick={() => setSearchParams({})}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    title="Switch to Cards Grid View"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={splitSearch}
                  onChange={(e) => setSplitSearch(e.target.value)}
                  placeholder="Filter projects..."
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900/90 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                />
              </div>
            </div>

            {/* Project List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
              {filteredSplitProjects.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 space-y-2">
                  <FolderGit2 className="w-6 h-6 mx-auto text-slate-600" />
                  <p>No matching projects found</p>
                </div>
              ) : (
                filteredSplitProjects.map((p) => {
                  const isActive = p.name === activeSplitProject?.name;
                  return (
                    <div
                      key={p.name}
                      onClick={() => setSearchParams({ project: p.name, tab: splitRightTab })}
                      className={`group relative flex items-start justify-between p-2.5 rounded-xl cursor-pointer transition-all border ${
                        isActive
                          ? 'bg-purple-600/20 border-purple-500/50 text-white shadow-sm ring-1 ring-purple-500/30'
                          : 'hover:bg-slate-900/90 bg-slate-900/30 border-slate-800/60 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-1.5">
                        <div className="flex items-center gap-1.5">
                          {getProjectKindIcon(p.kind)}
                          <span className={`text-xs font-bold truncate ${isActive ? 'text-white' : 'text-slate-200'}`}>
                            {p.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-400 font-mono truncate">
                          <span className="px-1.5 py-0.2 rounded bg-slate-950 border border-slate-800/80 text-slate-300">
                            {p.kind || 'repo'}
                          </span>
                          <span className="flex items-center gap-1 text-purple-300 truncate">
                            <GitBranch className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{p.base_branch || 'main'}</span>
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSearchParams({ project: p.name, tab: 'terminal' });
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-300 hover:bg-emerald-950/60 transition shrink-0 opacity-80 group-hover:opacity-100"
                        title={`Open terminal tab for ${p.name}`}
                      >
                        <Terminal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sidebar Footer */}
            <div className="p-2.5 border-t border-slate-800/80 bg-[#11131a] flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-200 hover:text-white text-xs font-semibold transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add New Project</span>
              </button>
            </div>
          </aside>

          {/* Right Main Container */}
          <main className="flex-1 flex flex-col min-w-0 min-h-0 h-full bg-[#090a0f] overflow-hidden">
            {activeSplitProject ? (
              <>
                {/* Context Header Bar */}
                <header className="px-5 py-2.5 bg-[#111218] border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2 rounded-xl bg-purple-600/20 text-[#7b68ee] border border-purple-500/30 shrink-0">
                      <FolderGit2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-white capitalize">{activeSplitProject.name}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40">
                          {activeSplitProject.kind}
                        </span>
                        <span className="text-xs text-slate-400 font-mono truncate max-w-xs hidden md:inline">
                          • {activeSplitProject.repo_path}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right Container View Tabs & Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Tab Selector: Git Review vs Terminal with Active URL sync */}
                    <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-bold text-slate-400">
                      <button
                        type="button"
                        onClick={() => setSearchParams({ project: activeSplitProject.name, tab: 'review' })}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                          splitRightTab === 'review'
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'hover:text-white'
                        }`}
                        title="Git Review Tab"
                      >
                        <Code2 className="w-3.5 h-3.5" />
                        <span>Git Review</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSearchParams({ project: activeSplitProject.name, tab: 'terminal' })}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
                          splitRightTab === 'terminal'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'hover:text-white'
                        }`}
                        title="Terminal Tab"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Terminal</span>
                      </button>
                    </div>

                    <OpenInIdeButton
                      projectName={activeSplitProject.name}
                      repoPath={activeSplitProject.repo_path}
                      variant="split"
                    />

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(activeSplitProject)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition"
                      title="Edit Project Settings"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setSearchParams({})}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                      title="Back to Cards Grid"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Cards View</span>
                    </button>
                  </div>
                </header>

                {/* Main Container Body */}
                <div className="flex-1 min-h-0 overflow-hidden flex flex-col h-full">
                  {splitRightTab === 'review' ? (
                    <ProjectGitReviewView
                      projectName={activeSplitProject.name}
                      repoPath={activeSplitProject.repo_path}
                      baseBranch={activeSplitProject.base_branch || 'develop'}
                      targetBranch="HEAD"
                      onToggleTerminal={() => setSearchParams({ project: activeSplitProject.name, tab: 'terminal' })}
                      isTerminalOpen={false}
                      className="h-full flex-1"
                    />
                  ) : (
                    <ProjectTerminalView
                      projectName={activeSplitProject.name}
                      project={activeSplitProject}
                      repoPath={activeSplitProject.repo_path}
                      showHeader={true}
                      className="h-full flex-1 min-h-0 border-none rounded-none"
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-2 p-8">
                <FolderGit2 className="w-12 h-12 text-slate-700" />
                <p className="text-sm font-bold text-slate-300">Select a project to inspect</p>
                <p className="text-xs">Choose any repository from the left sidebar to review code or run terminal commands.</p>
              </div>
            )}
          </main>
        </div>
      ) : (
        /* ======================================================= */
        /* CARDS GRID VIEW                                         */
        /* ======================================================= */
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="w-full max-w-[1600px] mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                  <span>Repositories & Engines</span>
                </div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  Connected Projects & Agent Runtimes
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Decoupled per-repo agent engines orchestrated across workspaces
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                {/* View Mode Switcher */}
                <div className="inline-flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#202128] border border-slate-200 dark:border-[#2d2f3d] text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setSearchParams({})}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${
                      viewMode === 'grid'
                        ? 'bg-white dark:bg-[#2a2b36] text-purple-600 dark:text-purple-300 shadow-xs font-bold'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>Cards</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const projName = activeSplitProjectName || projects[0]?.name;
                      if (projName) {
                        setSearchParams({ project: projName, tab: 'review' });
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all"
                  >
                    <Columns className="w-3.5 h-3.5" />
                    <span>Container View</span>
                  </button>
                </div>

                <button
                  onClick={() => setIsModalOpen(true)}
                  className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Project</span>
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="p-16 text-center text-slate-400 text-sm">Loading projects...</div>
            ) : projects.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-slate-300 dark:border-[#2d2d2d] rounded-2xl bg-white dark:bg-[#1e1e1e] shadow-sm">
                <p className="text-slate-500 dark:text-slate-400 mb-3 text-sm font-medium">
                  No projects registered in this workspace yet.
                </p>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="text-xs font-bold text-[#7b68ee] hover:underline inline-flex items-center gap-1"
                >
                  Register your first project <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map((proj) => (
                  <div
                    key={proj.name}
                    className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4 group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div
                            onClick={() => setSelectedProject(proj)}
                            className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-[#7b68ee] dark:text-purple-300 flex items-center justify-center font-bold cursor-pointer hover:scale-105 transition"
                            title="Open Details"
                          >
                            <FolderGit2 className="w-4 h-4" />
                          </div>
                          <div>
                            <h3
                              onClick={() => setSelectedProject(proj)}
                              className="font-bold text-sm text-slate-900 dark:text-white capitalize cursor-pointer hover:text-[#7b68ee] transition-colors"
                            >
                              {proj.name}
                            </h3>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-[#2e2e2e] text-slate-600 dark:text-slate-400">
                                {proj.kind}
                              </span>
                              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40">
                                📁 {proj.workspace_id || 'default'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Header Actions: Engine Status & Top Action Buttons */}
                        <div className="flex items-center gap-1">
                          {/* Status Pill */}
                          {proj.engine_status === 'ok' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online
                            </span>
                          ) : proj.engine_status === 'down' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Down
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-[#2a2a2a] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#333333]">
                              <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> {proj.engine_type}
                            </span>
                          )}

                          {/* Top Action Icon Buttons: Open, Edit, Delete */}
                          <button
                            onClick={() => setSelectedProject(proj)}
                            className="p-1 rounded-md text-slate-400 hover:text-[#7b68ee] hover:bg-slate-100 dark:hover:bg-[#2e2e2e] transition"
                            title="Open Project Details"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(proj)}
                            className="p-1 rounded-md text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-[#2e2e2e] transition"
                            title="Edit Project"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeletingProject(proj)}
                            className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-[#2e2e2e] transition"
                            title="Delete Project"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Metadata List */}
                      <div className="space-y-1.5 text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#1a1a1a] p-3 rounded-lg border border-slate-100 dark:border-[#2d2d2d]">
                        <div className="flex justify-between">
                          <span className="text-slate-400 dark:text-slate-500">Engine:</span>
                          <span className="text-slate-800 dark:text-slate-200 font-semibold">{proj.engine_type}</span>
                        </div>
                        <div className="flex justify-between truncate">
                          <span className="text-slate-400 dark:text-slate-500">URL:</span>
                          <span className="text-[#7b68ee] truncate max-w-[170px]">{proj.engine_url || 'local/manual'}</span>
                        </div>
                        <div className="flex justify-between truncate">
                          <span className="text-slate-400 dark:text-slate-500">Repo:</span>
                          <span className="text-slate-700 dark:text-slate-300 truncate max-w-[170px]" title={proj.repo_path}>
                            {proj.repo_path}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400 dark:text-slate-500">Branch:</span>
                          <span className="text-slate-700 dark:text-slate-300">{proj.base_branch}</span>
                        </div>
                        {proj.contract_path && (
                          <div className="flex justify-between">
                            <span className="text-slate-400 dark:text-slate-500">Contract:</span>
                            <span className="text-purple-600 dark:text-purple-300 font-semibold">{proj.contract_path}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Card Footer Actions: Only Git Review, Terminal, and Test */}
                    <div className="pt-2.5 border-t border-slate-100 dark:border-[#2d2d2d] flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setSearchParams({ project: proj.name, tab: 'review' });
                          }}
                          className="flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                          title="Open Git Review tab"
                        >
                          <Code2 className="w-3.5 h-3.5" />
                          <span>Git Review</span>
                        </button>
                        <span className="text-slate-300 dark:text-slate-600">|</span>
                        <button
                          onClick={() => {
                            setSearchParams({ project: proj.name, tab: 'terminal' });
                          }}
                          className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                          title="Open Terminal tab"
                        >
                          <Terminal className="w-3.5 h-3.5" />
                          <span>Terminal</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <OpenInIdeButton projectName={proj.name} repoPath={proj.repo_path} variant="card" />
                        <button
                          onClick={() => testMutation.mutate(proj.name)}
                          disabled={testMutation.isPending}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-[#2a2a2a] hover:bg-slate-200 dark:hover:bg-[#333333] transition-colors disabled:opacity-50"
                          title="Test Connection"
                        >
                          <RefreshCw className={`w-3 h-3 ${testMutation.isPending ? 'animate-spin' : ''}`} />
                          <span>Test</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 1. Open Project Details Modal                            */}
      {/* ======================================================== */}
      {selectedProject && (
        <Portal>
          <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 w-full max-w-xl space-y-5 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-200 dark:border-[#2d2d2d]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-[#7b68ee] flex items-center justify-center font-bold">
                  <FolderGit2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900 dark:text-white capitalize">
                      {selectedProject.name}
                    </h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40">
                      {selectedProject.kind}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Workspace: <span className="font-semibold text-slate-700 dark:text-slate-300">{selectedProject.workspace_id || 'default'}</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {selectedProject.engine_status === 'ok' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold uppercase bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online
                  </span>
                ) : selectedProject.engine_status === 'down' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold uppercase bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span> Down
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-[#2a2a2a] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#333333]">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> {selectedProject.engine_type}
                  </span>
                )}
                <button
                  onClick={() => setSelectedProject(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2a2a2a] transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="space-y-4 text-xs">
              {/* Repo Path Card */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  Repository Location
                </label>
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] font-mono text-slate-800 dark:text-slate-200">
                  <span className="truncate mr-2 text-xs" title={selectedProject.repo_path}>
                    {selectedProject.repo_path}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopyPath(selectedProject.repo_path)}
                      className="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-[#2a2a2a] text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
                      title="Copy path"
                    >
                      {copiedPath ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => openFolderMutation.mutate(selectedProject.name)}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-[#7b68ee]/10 text-[#7b68ee] hover:bg-[#7b68ee]/20 font-sans font-semibold transition"
                      title="Open directory in file manager"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>Open Folder</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Grid Specifications */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Engine Type</span>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{selectedProject.engine_type}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Engine URL</span>
                  <p className="font-semibold text-[#7b68ee] truncate">{selectedProject.engine_url || 'local / manual'}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Base Branch</span>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">{selectedProject.base_branch}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Contract Path</span>
                  <p className="font-semibold text-purple-600 dark:text-purple-300 truncate">
                    {selectedProject.contract_path || 'None specified'}
                  </p>
                </div>
              </div>

              {selectedProject.test_command && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Test Command</span>
                  <p className="font-semibold text-slate-800 dark:text-slate-200 font-mono">{selectedProject.test_command}</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 text-[11px] text-slate-400">
                <span>Created: {new Date(selectedProject.created_at).toLocaleDateString()}</span>
                <span>Updated: {new Date(selectedProject.updated_at).toLocaleDateString()}</span>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-3.5 border-t border-slate-200 dark:border-[#2d2d2d] flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const proj = selectedProject;
                  setSelectedProject(null);
                  setDeletingProject(proj);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Project</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const proj = selectedProject;
                    setSelectedProject(null);
                    setSearchParams({ project: proj.name, tab: 'review' });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-sm transition"
                  title="Open in-app git & code reviewer"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Review Code & Git</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const proj = selectedProject;
                    setSelectedProject(null);
                    setSearchParams({ project: proj.name, tab: 'terminal' });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-sm transition"
                  title="Open interactive project shell terminal"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Terminal</span>
                </button>
                <OpenInIdeButton
                  projectName={selectedProject.name}
                  repoPath={selectedProject.repo_path}
                  variant="modal"
                />
                <button
                  type="button"
                  onClick={() => testMutation.mutate(selectedProject.name)}
                  disabled={testMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-[#2a2a2a] hover:bg-slate-200 dark:hover:bg-[#333333] transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testMutation.isPending ? 'animate-spin' : ''}`} />
                  <span>Test Connection</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const proj = selectedProject;
                    setSelectedProject(null);
                    handleOpenEdit(proj);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[#7b68ee] hover:bg-[#6c5ce7] text-white shadow-sm transition"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
      )}

      {/* ======================================================== */}
      {/* 2. Edit Project Modal Dialog                             */}
      {/* ======================================================== */}
      {editingProject && (
        <Portal>
          <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#2d2d2d]">
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Edit: {editingProject.name}
              </h3>
              <button
                onClick={() => setEditingProject(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdate} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Workspace
                </label>
                <select
                  value={editWorkspaceId}
                  onChange={(e) => setEditWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                >
                  <option value="default">📁 default</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      📁 {ws.name} ({ws.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Repository Path (Absolute)
                </label>
                <input
                  type="text"
                  required
                  value={editRepoPath}
                  onChange={(e) => setEditRepoPath(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Kind
                  </label>
                  <select
                    value={editKind}
                    onChange={(e) => setEditKind(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="backend">Backend</option>
                    <option value="frontend">Frontend</option>
                    <option value="mobile">Mobile</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine Type
                  </label>
                  <select
                    value={editEngineType}
                    onChange={(e) => setEditEngineType(e.target.value as EngineType)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="manual">Manual</option>
                    <option value="stoneforge">Stoneforge</option>
                    <option value="command">Command</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Base Branch
                  </label>
                  <input
                    type="text"
                    value={editBaseBranch}
                    onChange={(e) => setEditBaseBranch(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine URL
                  </label>
                  <input
                    type="text"
                    value={editEngineUrl}
                    onChange={(e) => setEditEngineUrl(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Contract Path
                </label>
                <input
                  type="text"
                  value={editContractPath}
                  onChange={(e) => setEditContractPath(e.target.value)}
                  placeholder="api/openapi.yaml"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Test Command (Optional)
                </label>
                <input
                  type="text"
                  value={editTestCommand}
                  onChange={(e) => setEditTestCommand(e.target.value)}
                  placeholder="npm ci && npm test"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-[#2d2d2d] flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingProject(null)}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2a2a2a]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white shadow-md shadow-purple-600/20 disabled:opacity-50"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      </Portal>
      )}

      {/* ======================================================== */}
      {/* 3. Delete Project Modal Dialog                           */}
      {/* ======================================================== */}
      {deletingProject && (
        <Portal>
          <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Delete Project</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Are you sure you want to unregister <span className="font-bold text-slate-900 dark:text-white">{deletingProject.name}</span>?
              This removes the engine configuration from SP-Kickstack. Local files on disk will NOT be touched.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingProject(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deletingProject.name)}
                disabled={deleteMutation.isPending}
                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-sm disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </Portal>
      )}

      {/* ======================================================== */}
      {/* 4. Create Project Modal Dialog                           */}
      {/* ======================================================== */}
      {isModalOpen && (
        <Portal>
          <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#2d2d2d]">
              <h3 className="text-base font-black text-slate-900 dark:text-white">Register Project</h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Workspace
                </label>
                <WorkspaceSelect
                  value={workspaceId}
                  onValueChange={setWorkspaceId}
                  workspaces={workspaces}
                  className="bg-slate-50 dark:bg-[#141414] border-slate-300 dark:border-[#333333]"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. backend, web-app, mobile"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Repository Path (Absolute)
                </label>
                <input
                  type="text"
                  required
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/Users/username/dev/my-project"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Kind
                  </label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="backend">Backend</option>
                    <option value="frontend">Frontend</option>
                    <option value="mobile">Mobile</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine Type
                  </label>
                  <select
                    value={engineType}
                    onChange={(e) => setEngineType(e.target.value as EngineType)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="manual">Manual</option>
                    <option value="stoneforge">Stoneforge</option>
                    <option value="command">Command</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Base Branch
                  </label>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder="main"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine URL (Optional)
                  </label>
                  <input
                    type="text"
                    value={engineUrl}
                    onChange={(e) => setEngineUrl(e.target.value)}
                    placeholder="http://127.0.0.1:3457"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Contract Path (Optional)
                </label>
                <input
                  type="text"
                  value={contractPath}
                  onChange={(e) => setContractPath(e.target.value)}
                  placeholder="api/openapi.yaml"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Test Command (Optional)
                </label>
                <input
                  type="text"
                  value={testCommand}
                  onChange={(e) => setTestCommand(e.target.value)}
                  placeholder="npm ci && npm test"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-[#2d2d2d] flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2a2a2a]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] hover:from-[#6c5ce7] hover:to-[#5f3dc4] text-white shadow-md shadow-purple-600/20 disabled:opacity-50"
                >
                  Save Project
                </button>
              </div>
            </form>
          </div>
        </div>
      </Portal>
      )}

    </div>
  );
}
