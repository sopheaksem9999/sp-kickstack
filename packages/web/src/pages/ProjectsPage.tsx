import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchProjects,
  testProjectConnection,
  updateProject,
  deleteProject,
  openProjectFolder,
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
  ExternalLink,
  AlertTriangle,
  Code2,
} from 'lucide-react';
import { ProjectGitReviewModal } from '../components/ProjectGitReviewModal.js';

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { activeWorkspaceId, workspaces } = useWorkspace();

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: () => fetchProjects(activeWorkspaceId),
  });

  // Create Project modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(
    activeWorkspaceId !== 'all' ? activeWorkspaceId : 'default'
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

  // Embedded IDE Review state
  const [ideReviewProject, setIdeReviewProject] = useState<Project | null>(null);

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

  useEffect(() => {
    if (activeWorkspaceId !== 'all') {
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
    mutationFn: async (payload: Partial<Project>) => {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create project');
      return res.json();
    },
    onSuccess: (created) => {
      toast.success(`Project ${created.name} registered`);
      setIsModalOpen(false);
      setName('');
      setRepoPath('');
      setEngineUrl('');
      setContractPath('');
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
    if (!editRepoPath.trim()) {
      toast.error('Repository Path is required');
      return;
    }

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
        test_command: editTestCommand.trim() || null,
      },
    });
  };

  return (
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

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white rounded-lg text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Project</span>
        </button>
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

                  {/* Header Actions: Engine Status & Action Buttons */}
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

                    {/* Action Icon Buttons */}
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

              {/* Card Footer Actions */}
              <div className="pt-2.5 border-t border-slate-100 dark:border-[#2d2d2d] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelectedProject(proj)}
                    className="flex items-center gap-1 text-xs font-semibold text-[#7b68ee] hover:underline"
                    title="Open full project specifications"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Open</span>
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <button
                    onClick={() => setIdeReviewProject(proj)}
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    title="Review project code and git diffs"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>Git Review</span>
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <button
                    onClick={() => handleOpenEdit(proj)}
                    className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>Edit</span>
                  </button>
                  <span className="text-slate-300 dark:text-slate-600">|</span>
                  <button
                    onClick={() => setDeletingProject(proj)}
                    className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-rose-500 transition"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete</span>
                  </button>
                </div>

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
          ))}
        </div>
      )}

      {/* ======================================================== */}
      {/* 1. Open Project Details Modal */}
      {/* ======================================================== */}
      {selectedProject && (
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
                  <p className="font-mono text-[#7b68ee] truncate">{selectedProject.engine_url || 'local/manual'}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Base Branch</span>
                  <p className="font-mono text-slate-800 dark:text-slate-200">{selectedProject.base_branch || 'main'}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">Contract Path</span>
                  <p className="font-mono text-purple-600 dark:text-purple-300 truncate">
                    {selectedProject.contract_path || 'None'}
                  </p>
                </div>
              </div>

              {/* Timestamps */}
              <div className="flex justify-between text-[11px] text-slate-400 dark:text-slate-500 px-1 pt-1 font-mono">
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
                    setIdeReviewProject(proj);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-sm transition"
                  title="Open in-app git & code reviewer"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>Review Code & Git</span>
                </button>
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
                  <span>Edit Project</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. Edit Project Modal */}
      {/* ======================================================== */}
      {editingProject && (
        <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 w-full max-w-lg space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#2d2d2d]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-500 text-white flex items-center justify-center font-bold text-xs">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Edit Project: <span className="capitalize">{editingProject.name}</span>
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setEditingProject(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg"
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
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:border-[#7b68ee]"
                >
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      📁 {ws.name} ({ws.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Kind
                </label>
                <select
                  value={editKind}
                  onChange={(e) => setEditKind(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                >
                  <option value="backend">backend</option>
                  <option value="frontend">frontend</option>
                  <option value="mobile">mobile</option>
                  <option value="other">other</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Repository Path
                </label>
                <input
                  type="text"
                  value={editRepoPath}
                  onChange={(e) => setEditRepoPath(e.target.value)}
                  placeholder="/Users/sopheak/projects/my-repo"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine Type
                  </label>
                  <select
                    value={editEngineType}
                    onChange={(e) => setEditEngineType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="manual">manual (human / simulated)</option>
                    <option value="stoneforge">stoneforge</option>
                    <option value="clinekanban">clinekanban</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine URL
                  </label>
                  <input
                    type="text"
                    value={editEngineUrl}
                    onChange={(e) => setEditEngineUrl(e.target.value)}
                    placeholder="http://127.0.0.1:3457"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
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
                <p className="mt-1 text-[10px] text-slate-400">
                  Runs in a fresh checkout of the merge result before the base branch moves; it must install what it needs.
                </p>
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
                    placeholder="main"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Contract Path (Optional)
                  </label>
                  <input
                    type="text"
                    value={editContractPath}
                    onChange={(e) => setEditContractPath(e.target.value)}
                    placeholder="api/openapi.yaml"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  />
                </div>
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
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-[#7b68ee] hover:bg-[#6c5ce7] text-white shadow-md shadow-purple-600/20 disabled:opacity-50"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. Delete Project Confirmation Dialog */}
      {/* ======================================================== */}
      {deletingProject && (
        <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Delete Project "{deletingProject.name}"?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  This will unregister the repository and remove associated bridge task bindings.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300">
              ⚠️ Are you sure? This action cannot be undone.
            </div>

            <div className="pt-2 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingProject(null)}
                className="px-3.5 py-2 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2a2a2a]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(deletingProject.name)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-md shadow-rose-600/20 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. Add Project Modal */}
      {/* ======================================================== */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-[#1e1e1e] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 w-full max-w-lg space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#2d2d2d]">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#ec4899] text-white flex items-center justify-center font-bold text-xs">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Register New Project</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Workspace
                </label>
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:border-[#7b68ee]"
                >
                  {workspaces.map((ws) => (
                    <option key={ws.id} value={ws.id}>
                      📁 {ws.name} ({ws.id})
                    </option>
                  ))}
                  {!workspaces.some((ws) => ws.id === workspaceId) && (
                    <option value={workspaceId}>📁 {workspaceId}</option>
                  )}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. backend"
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Kind
                  </label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="backend">backend</option>
                    <option value="frontend">frontend</option>
                    <option value="mobile">mobile</option>
                    <option value="other">other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                  Repository Path
                </label>
                <input
                  type="text"
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/Users/sopheak/projects/my-repo"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine Type
                  </label>
                  <select
                    value={engineType}
                    onChange={(e) => setEngineType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#7b68ee]"
                  >
                    <option value="manual">manual (human / simulated)</option>
                    <option value="stoneforge">stoneforge</option>
                    <option value="clinekanban">clinekanban</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                    Engine URL
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
                  Test Command (Optional)
                </label>
                <input
                  type="text"
                  value={testCommand}
                  onChange={(e) => setTestCommand(e.target.value)}
                  placeholder="npm ci && npm test"
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-[#7b68ee]"
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Runs in a fresh checkout of the merge result before the base branch moves; it must install what it needs.
                </p>
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
      )}

      {/* In-App Native Git Review Modal (100% Self-Contained) */}
      <ProjectGitReviewModal
        isOpen={Boolean(ideReviewProject)}
        onClose={() => setIdeReviewProject(null)}
        projectName={ideReviewProject?.name}
        baseBranch={ideReviewProject?.base_branch || 'develop'}
        targetBranch="main"
      />
    </div>
  );
}
