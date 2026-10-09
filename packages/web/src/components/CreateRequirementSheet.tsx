import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProjects, fetchSprints, createRequirement, startRequirementFanOut } from '../lib/api.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import { toast } from 'sonner';
import {
  X,
  Plus,
  Trash2,
  BookOpen,
  Sparkles,
  CheckCircle2,
  FolderGit2,
  ArrowRight,
  Layers,
  Paperclip,
  Bold,
  Italic,
  Heading2,
  List as ListIcon,
  ListOrdered,
  Code,
  Quote,
  Eye,
  Edit3,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  FileCode,
  Send,
  Bot,
  User,
  Cpu,
  Terminal,
  Wand2,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  Priority,
  RequirementStatus,
  AttachmentItem,
  BranchMergePolicy,
  AiChatMessage,
  DraftRequirementResult,
} from '@sp-kickstack/shared';
import { sendAiChatMessage } from '../lib/api.js';
import { Sheet, SheetContent } from './ui/sheet.js';

export function CreateRequirementSheet() {
  const { isOpen, closeSheet } = useCreateRequirement();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeWorkspaceId, workspaces } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [workspaceId, setWorkspaceId] = useState(
    activeWorkspaceId !== 'all' ? activeWorkspaceId : 'default'
  );

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => fetchProjects(workspaceId),
  });

  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', workspaceId],
    queryFn: () => fetchSprints(workspaceId),
  });

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  // Form Fields
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [userStory, setUserStory] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [status, setStatus] = useState<RequirementStatus>('draft');
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [mergePolicy, setMergePolicy] = useState<'inherit' | BranchMergePolicy>('inherit');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [activeGoalTab, setActiveGoalTab] = useState<'write' | 'preview'>('write');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [showAiBar, setShowAiBar] = useState(false);
  const [selectedAiProvider, setSelectedAiProvider] = useState<string>('auto');

  const { data: aiProviders } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: async () => {
      const res = await fetch('/api/ai/providers');
      if (!res.ok) return [];
      return (await res.json()) as Array<{ id: string; name: string; available: boolean; note?: string }>;
    },
    staleTime: 30000,
  });

  // Synchronize workspace when opening or workspace changes
  useEffect(() => {
    if (activeWorkspaceId !== 'all') {
      setWorkspaceId(activeWorkspaceId);
    }
  }, [activeWorkspaceId, isOpen]);

  // Auto-select all projects in workspace by default
  useEffect(() => {
    if (projects.length > 0 && selectedProjects.length === 0) {
      setSelectedProjects(projects.map((p) => p.name));
    }
  }, [workspaceId, projects]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeSheet();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeSheet]);

  const resetForm = () => {
    setTitle('');
    setGoal('');
    setUserStory('');
    setPriority('normal');
    setStatus('draft');
    setSprintId(null);
    setMergePolicy('inherit');
    setSelectedProjects([]);
    setCriteria(['']);
    setAttachments([]);
    setActiveGoalTab('write');
  };

  const handleClose = () => {
    resetForm();
    closeSheet();
  };

  const handleAiDraft = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Please enter a brief feature idea or prompt');
      return;
    }
    setIsAiDrafting(true);
    try {
      const res = await fetch('/api/ai/draft-requirement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          workspace_id: workspaceId,
          provider: selectedAiProvider !== 'auto' ? selectedAiProvider : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to draft requirement');
      }
      const data = await res.json();
      if (data.title) setTitle(data.title);
      if (data.goal) setGoal(data.goal);
      if (data.user_story) setUserStory(data.user_story);
      if (Array.isArray(data.acceptance_criteria) && data.acceptance_criteria.length > 0) {
        setCriteria(data.acceptance_criteria);
      }
      if (Array.isArray(data.affected_projects) && data.affected_projects.length > 0) {
        setSelectedProjects(data.affected_projects);
      }
      toast.success(`Generated by ${data.provider_used || 'AI Drafter'}!`);
      setShowAiBar(false);
    } catch (err: any) {
      toast.error(err.message || 'AI drafting error');
    } finally {
      setIsAiDrafting(false);
    }
  };

  // Option 2: AI Co-Architect Chat Mode
  const [activeMode, setActiveMode] = useState<'form' | 'chat'>('form');
  const [chatMessages, setChatMessages] = useState<AiChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content: `👋 Hello! I am your **Local AI Principal Architect** running right on your Mac with **Zero Cloud API Keys**.

I am primed with your workspace context:
- Repositories: **${projects.map((p) => p.name).join(', ') || 'backend, frontend'}**
- Base Branch: **develop**
- Target Policy: **Contract-isolated multi-repo fan-out**

What feature, solution, or refactoring would you like to design today? You can share a brief problem statement, and we will formulate the multi-repo requirement spec together!`,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [isChatSending, setIsChatSending] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeMode === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages, activeMode]);

  const handleSendChatMessage = async (textToSend?: string) => {
    const content = (textToSend || chatInput).trim();
    if (!content || isChatSending) return;

    const userMsg: AiChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setChatInput('');
    setIsChatSending(true);

    try {
      const res = await sendAiChatMessage({
        messages: newHistory,
        workspace_id: workspaceId,
        provider: selectedAiProvider !== 'auto' ? selectedAiProvider as any : undefined,
      });

      setChatMessages((prev) => [...prev, res.message]);
    } catch (err: any) {
      toast.error(err.message || 'AI chat failed');
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ Failed to get reply from local AI: ${err.message || 'Unknown error'}. Check that your local CLI is running or switch to heuristic mode.`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsChatSending(false);
    }
  };

  const applySpecToForm = (spec: DraftRequirementResult) => {
    if (spec.title) setTitle(spec.title);
    if (spec.goal) setGoal(spec.goal);
    if (spec.user_story) setUserStory(spec.user_story);
    if (Array.isArray(spec.acceptance_criteria) && spec.acceptance_criteria.length > 0) {
      setCriteria(spec.acceptance_criteria);
    }
    if (Array.isArray(spec.affected_projects) && spec.affected_projects.length > 0) {
      setSelectedProjects(spec.affected_projects);
    }
    setActiveMode('form');
    toast.success('✨ Transferred AI Architect spec to requirement form! Review and click Create & Dispatch.');
  };

  const toggleProject = (name: string) => {
    setSelectedProjects((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
  };

  const addCriterion = () => setCriteria([...criteria, '']);
  const updateCriterion = (index: number, val: string) => {
    const next = [...criteria];
    next[index] = val;
    setCriteria(next);
  };
  const removeCriterion = (index: number) => {
    setCriteria(criteria.filter((_, i) => i !== index));
  };

  // Rich Text Formatting Action
  const applyFormatting = (prefix: string, suffix: string = '') => {
    const textarea = document.getElementById('goal-editor-textarea') as HTMLTextAreaElement | null;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = goal.substring(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;
    const newGoal = goal.substring(0, start) + replacement + goal.substring(end);
    setGoal(newGoal);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + (selected.length || 4)
      );
    }, 20);
  };

  // File Upload Handler (Images, Excel, MD, CSV, etc.)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const item: AttachmentItem = {
          name: file.name,
          size: file.size,
          type: file.type || file.name.split('.').pop() || 'file',
          data_url: reader.result as string,
        };
        setAttachments((prev) => [...prev, item]);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = '';
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const getAttachmentIcon = (name: string, type?: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
      return <FileSpreadsheet className="w-4 h-4 text-emerald-500" />;
    }
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.svg') || lower.endsWith('.gif') || type?.startsWith('image/')) {
      return <ImageIcon className="w-4 h-4 text-sky-500" />;
    }
    if (lower.endsWith('.md') || lower.endsWith('.json') || lower.endsWith('.yaml') || lower.endsWith('.yml')) {
      return <FileCode className="w-4 h-4 text-purple-500" />;
    }
    return <FileText className="w-4 h-4 text-slate-400" />;
  };

  const insertTemplate = () => {
    const template = `### Background & Problem\nDescribe the business context and technical requirements here.\n\n### Technical Scope\n- Implementation details across selected repositories`;
    setGoal((prev) => (prev.trim() ? `${prev}\n\n${template}` : template));
  };

  const handleSubmit = async (andStart: boolean) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error('Requirement Title is required');
      return;
    }
    const effectiveGoal = goal.trim() || trimmedTitle;

    const filteredCriteria = criteria.filter((c) => c.trim().length > 0);
    if (selectedProjects.length === 0) {
      toast.error('Please select at least one affected project');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createRequirement({
        workspace_id: workspaceId,
        title: trimmedTitle,
        goal: effectiveGoal,
        user_story: userStory || undefined,
        priority,
        status: andStart ? 'ready' : status,
        sprint_id: sprintId || undefined,
        merge_policy: mergePolicy !== 'inherit' ? mergePolicy : undefined,
        affected_projects: selectedProjects,
        acceptance_criteria: filteredCriteria,
        attachments,
      });

      queryClient.invalidateQueries({ queryKey: ['requirements'] });
      handleClose();

      toast.success(`Created ${created.id}: ${created.title}`, {
        action: {
          label: 'View Spec',
          onClick: () => navigate(`/requirements/${created.id}`),
        },
      });

      if (andStart) {
        await startRequirementFanOut(created.id);
        queryClient.invalidateQueries({ queryKey: ['requirements'] });
        toast.success(`Fanned out to ${selectedProjects.join(', ')}`);
        navigate(`/requirements/${created.id}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create requirement');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent side="right" className="p-0 overflow-hidden sm:max-w-2xl flex flex-col w-screen">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/70 dark:bg-[#1a1b23]/70">
          <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#ec4899] flex items-center justify-center font-black text-white text-sm shadow-md shadow-purple-500/20">
                ⚡
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                  New Cross-Repo Requirement
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Slide-over specification sheet & attachments
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Workspace Picker */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-200/80 dark:bg-[#23242e] border border-slate-300 dark:border-[#2d2f3d] text-xs">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Workspace:</span>
                <select
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(e.target.value)}
                  className="bg-transparent text-slate-800 dark:text-slate-200 font-semibold focus:outline-none cursor-pointer"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id} className="bg-white dark:bg-[#242424] text-slate-800 dark:text-slate-100">
                      {w.name}
                    </option>
                  ))}
                  {!workspaces.some((w) => w.id === workspaceId) && (
                    <option value={workspaceId} className="bg-white dark:bg-[#242424] text-slate-800 dark:text-slate-100">
                      {workspaceId}
                    </option>
                  )}
                </select>
              </div>

              {/* Close Button */}
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#2a2a2a] transition-colors"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Mode Selector: Specification Form vs. Discuss with Local AI (Option 2) */}
          <div className="px-6 py-2.5 bg-slate-100/70 dark:bg-[#1a1b23]/70 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-[#23242e] rounded-lg flex-1 max-w-md">
              <button
                type="button"
                onClick={() => setActiveMode('form')}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-semibold transition-all',
                  activeMode === 'form'
                    ? 'bg-white dark:bg-[#2d2f3d] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                )}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Specification Form</span>
                {title.trim().length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Draft in progress" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveMode('chat')}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-semibold transition-all',
                  activeMode === 'chat'
                    ? 'bg-gradient-to-r from-[#7b68ee] to-[#6366f1] text-white shadow-sm shadow-indigo-500/25'
                    : 'text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300'
                )}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>💬 Discuss with Local AI</span>
                <span className="text-[9px] uppercase tracking-wider font-mono px-1 py-0.5 rounded bg-purple-200/50 dark:bg-purple-900/60 text-purple-900 dark:text-purple-200 font-bold">
                  Option 2
                </span>
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <Terminal className="w-3.5 h-3.5 text-emerald-500" />
              <span>0 API Keys · Local PC AI</span>
            </div>
          </div>

          {activeMode === 'form' ? (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Shared Workspace Rules & Architecture Context Notification */}
            {currentWorkspace && (currentWorkspace.rules || currentWorkspace.context) && (
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 flex items-start gap-2.5 text-xs">
                <BookOpen className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                <div className="text-slate-700 dark:text-slate-300">
                  <span className="font-bold text-purple-700 dark:text-purple-300">
                    Workspace Shared Context Active:
                  </span>{' '}
                  This requirement will automatically encapsulate {currentWorkspace.name}&apos;s architectural guidelines and shared rules during agent fan-out.
                </div>
              </div>
            )}

            {/* AI Requirement Drafter Banner & Expandable Panel */}
            <div className="rounded-xl border border-purple-200 dark:border-purple-900/50 bg-gradient-to-r from-purple-50/70 via-indigo-50/40 to-pink-50/50 dark:from-purple-950/30 dark:via-indigo-950/20 dark:to-pink-950/20 p-3.5 space-y-2.5 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-purple-800 dark:text-purple-300">
                  <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  <span>Draft with AI Assistant</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300">
                    Claude · Codex · AGY · Ollama
                  </span>
                </div>
                {!showAiBar && (
                  <button
                    type="button"
                    onClick={() => setShowAiBar(true)}
                    className="text-xs font-semibold text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100 flex items-center gap-1 transition-colors"
                  >
                    <span>Use Prompt</span> <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>

              {showAiBar && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">Engine:</span>
                      <select
                        value={selectedAiProvider}
                        onChange={(e) => setSelectedAiProvider(e.target.value)}
                        className="bg-purple-100/70 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200 rounded px-2 py-0.5 font-medium cursor-pointer focus:outline-none text-[11px]"
                      >
                        <option value="auto">⚡ Auto (Local Claude / AGY CLI — No API Key)</option>
                        {aiProviders?.map((p) => (
                          <option key={p.id} value={p.id} disabled={!p.available}>
                            {p.name} {!p.available ? '(Offline)' : '✓'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      🔒 Zero Cloud API Key Needed
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Describe your feature idea or user story. The AI will generate a structured Title, Goal, Acceptance Criteria checklist, and select affected projects automatically.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAiDraft();
                        }
                      }}
                      placeholder="e.g. Real-time driver location stream with rate limit on backend and map view in mobile"
                      className="flex-1 px-3 py-2 text-xs rounded-lg border border-purple-200 dark:border-purple-800/80 bg-white dark:bg-[#1f2028] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <button
                      type="button"
                      disabled={isAiDrafting}
                      onClick={handleAiDraft}
                      className="px-3.5 py-2 text-xs font-bold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-sm disabled:opacity-50 flex items-center gap-1.5 shrink-0 transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{isAiDrafting ? 'Drafting...' : 'Generate'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAiBar(false)}
                      className="px-2 py-2 text-xs font-medium rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-purple-100 dark:hover:bg-purple-950/40 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Title Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>Requirement Title *</span>
                <span className="text-[11px] font-normal text-slate-400">Clear, unambiguous feature goal</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Rider can see nearby drivers on live map"
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />
            </div>

            {/* Input State, Priority, Sprint & Merge Policy Select Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* State Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  State
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as RequirementStatus)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] cursor-pointer"
                >
                  <option value="draft">📋 ToDo (Backlog)</option>
                  <option value="in_progress">⚡ In-Progress</option>
                  <option value="qa">🧪 QA / Testing</option>
                  <option value="done">✅ Done / Complete</option>
                </select>
              </div>

              {/* Priority Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] cursor-pointer"
                >
                  <option value="urgent">🔴 Urgent</option>
                  <option value="high">🟠 High</option>
                  <option value="normal">🔵 Normal</option>
                  <option value="low">⚪ Low</option>
                </select>
              </div>

              {/* Sprint Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Sprint
                </label>
                <select
                  value={sprintId || ''}
                  onChange={(e) => setSprintId(e.target.value ? e.target.value : null)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] cursor-pointer"
                >
                  <option value="">📋 Product Backlog</option>
                  {sprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.status === 'active' ? '🏃 Active: ' : s.status === 'completed' ? '🏁 ' : '⏳ Planned: '}
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Merge Policy Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Merge into Main
                </label>
                <select
                  value={mergePolicy}
                  onChange={(e) => setMergePolicy(e.target.value as any)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] cursor-pointer"
                >
                  <option value="inherit">⚙️ Workspace Default</option>
                  <option value="manual_review_merge">🛡️ Manual Review & Merge</option>
                  <option value="auto_merge">🚀 Automatic Merge to Main</option>
                </select>
              </div>
            </div>

            {/* Affected Repositories / Engines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <FolderGit2 className="w-3.5 h-3.5" />
                  <span>Affected Repositories / Engines *</span>
                </label>
                <div className="flex items-center gap-2 text-[11px]">
                  {projects.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSelectedProjects(projects.map((p) => p.name))}
                        className="text-purple-600 dark:text-purple-400 font-semibold hover:underline"
                      >
                        Select All
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => setSelectedProjects([])}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:underline"
                      >
                        Clear
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                    </>
                  )}
                  <span className={`font-bold ${selectedProjects.length === 0 ? 'text-rose-500 animate-pulse' : 'text-purple-600 dark:text-purple-400'}`}>
                    {selectedProjects.length} selected {selectedProjects.length === 0 && '(at least 1 required)'}
                  </span>
                </div>
              </div>

              {projects.length === 0 ? (
                <div className="p-3.5 rounded-lg border border-dashed border-slate-200 dark:border-[#303030] text-center text-xs text-slate-500">
                  No projects registered in this workspace yet. Add projects in the Projects tab.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {projects.map((proj) => {
                    const isSelected = selectedProjects.includes(proj.name);
                    return (
                      <button
                        key={proj.name}
                        type="button"
                        onClick={() => toggleProject(proj.name)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all ${
                          isSelected
                            ? 'bg-purple-50/70 dark:bg-purple-950/30 border-[#7b68ee] text-purple-900 dark:text-purple-200 shadow-sm'
                            : 'border-slate-200 dark:border-[#303030] bg-slate-50/60 dark:bg-[#242424] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-[#3a3a3a]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-bold text-xs truncate flex items-center gap-1.5">
                            <span>{proj.name}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded font-mono font-medium bg-slate-200 dark:bg-[#2c2c2c] text-slate-600 dark:text-slate-400">
                              {proj.engine_type}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                            {proj.repo_path} · <span className="font-semibold text-purple-600 dark:text-purple-400">{proj.base_branch || 'develop'}</span>
                          </div>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-[#7b68ee] border-[#7b68ee] text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Goal & Problem Context (Rich Text Editor + Attachments) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5 text-purple-500" />
                  <span>Goal & Problem Context (Rich Text)</span>
                  <span className="text-[10px] normal-case font-normal text-slate-400 dark:text-slate-500">
                    (optional · defaults to Title)
                  </span>
                </label>

                {/* Tabs: Write vs Preview */}
                <div className="flex items-center rounded-lg bg-slate-100 dark:bg-[#242424] p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setActiveGoalTab('write')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                      activeGoalTab === 'write'
                        ? 'bg-white dark:bg-[#2e2e2e] text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Write</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveGoalTab('preview')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                      activeGoalTab === 'preview'
                        ? 'bg-white dark:bg-[#2e2e2e] text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Eye className="w-3 h-3" />
                    <span>Preview</span>
                  </button>
                </div>
              </div>

              {/* Rich Text Toolbar (when writing) */}
              {activeGoalTab === 'write' && (
                <div className="flex flex-wrap items-center gap-1 p-1.5 rounded-t-lg border border-b-0 border-slate-200 dark:border-[#303030] bg-slate-100/80 dark:bg-[#242424]/80 text-slate-600 dark:text-slate-300">
                  <button
                    type="button"
                    onClick={() => applyFormatting('**', '**')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2e2e2e] transition-colors"
                    title="Bold (**text**)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('*', '*')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2e2e2e] transition-colors"
                    title="Italic (*text*)"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('### ')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2e2e2e] transition-colors"
                    title="Heading (### Section)"
                  >
                    <Heading2 className="w-3.5 h-3.5" />
                  </button>

                  <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

                  <button
                    type="button"
                    onClick={() => applyFormatting('- ')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2e2e2e] transition-colors"
                    title="Bullet List (- item)"
                  >
                    <ListIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('1. ')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2e2e2e] transition-colors"
                    title="Numbered List (1. item)"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('> ')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2e2e2e] transition-colors"
                    title="Quote (> blockquote)"
                  >
                    <Quote className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('```ts\n', '\n```')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2e2e2e] transition-colors"
                    title="Code Block"
                  >
                    <Code className="w-3.5 h-3.5" />
                  </button>

                  <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

                  <button
                    type="button"
                    onClick={insertTemplate}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-950/60 transition-colors"
                    title="Insert structured template"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Template</span>
                  </button>

                  {/* Add Attachment Button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-[#7b68ee] hover:bg-purple-100 dark:hover:bg-purple-950/60 transition-colors ml-auto"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span>Attach Files</span>
                  </button>
                </div>
              )}

              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.xlsx,.xls,.csv,.md,.txt,.pdf,.json,.yaml"
                onChange={handleFileUpload}
                className="hidden"
              />

              {activeGoalTab === 'write' ? (
                <textarea
                  id="goal-editor-textarea"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={4}
                  placeholder="Describe the business context, problem, or technical scope (optional: defaults to Title)..."
                  className="w-full px-3.5 py-2.5 rounded-b-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all leading-relaxed"
                />
              ) : (
                <div className="min-h-[100px] p-4 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#171717] text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {goal.trim() ? goal : <span className="text-slate-400 italic">No goal text entered yet.</span>}
                </div>
              )}

              {/* Attachments Section */}
              {attachments.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold">
                    <span>Attached Assets ({attachments.length}):</span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[#7b68ee] hover:underline flex items-center gap-1 text-[11px]"
                    >
                      <Plus className="w-3 h-3" /> Add more
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {attachments.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-[#242424] border border-slate-200 dark:border-[#303030] text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          {getAttachmentIcon(file.name, file.type)}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 truncate text-[11px]">
                              {file.name}
                            </p>
                            <p className="text-[10px] text-slate-400">
                              {file.size ? Math.round(file.size / 1024) + ' KB' : 'Document'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachment(idx)}
                          className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* User Story (Optional) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>User Story (Optional)</span>
                <span className="text-[11px] font-normal text-slate-400">As a... I want... So that...</span>
              </label>
              <input
                type="text"
                value={userStory}
                onChange={(e) => setUserStory(e.target.value)}
                placeholder="As a rider, I want to see real-time drivers so I can book immediately."
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />
            </div>

            {/* Acceptance Criteria */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span>Acceptance Criteria (Optional)</span>
                </label>
                <button
                  type="button"
                  onClick={addCriterion}
                  className="flex items-center gap-1 text-xs font-semibold text-[#7b68ee] hover:text-[#6c5ce7] transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Criterion</span>
                </button>
              </div>

              <div className="space-y-2">
                {criteria.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-slate-400 dark:text-slate-500 w-5 text-right">
                      {idx + 1}.
                    </span>
                    <input
                      type="text"
                      value={item}
                      onChange={(e) => updateCriterion(idx, e.target.value)}
                      placeholder="e.g. Implementation complete and verified (optional)"
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
                    />
                    {criteria.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCriterion(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 dark:bg-[#13141a]">
              {/* Context Bar */}
              <div className="px-6 py-2.5 border-b border-slate-200 dark:border-[#262732] bg-white dark:bg-[#1a1b23] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <FolderGit2 className="w-4 h-4 text-purple-500" />
                  <span className="font-semibold text-slate-700 dark:text-slate-200">Connected Hub Repos:</span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {projects.map((p) => (
                      <span
                        key={p.name}
                        className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-mono text-[10px] font-semibold border border-purple-200 dark:border-purple-900/50"
                      >
                        {p.name}
                      </span>
                    ))}
                    {projects.length === 0 && (
                      <span className="text-[10px] text-slate-400 italic">No repos registered</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={selectedAiProvider}
                    onChange={(e) => setSelectedAiProvider(e.target.value)}
                    className="bg-slate-100 dark:bg-[#23242e] border border-slate-200 dark:border-[#2d2f3d] rounded px-2 py-1 text-slate-800 dark:text-slate-200 text-[11px] font-medium focus:outline-none cursor-pointer"
                  >
                    <option value="auto">Auto (Best Local Engine)</option>
                    <option value="claude-cli">Claude Code CLI</option>
                    <option value="agy-cli">Antigravity CLI (agy)</option>
                    <option value="codex-cli">Codex CLI</option>
                    <option value="ollama">Local Ollama</option>
                    <option value="heuristic">Offline Heuristic</option>
                  </select>
                </div>
              </div>

              {/* Messages Feed */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={clsx(
                      'flex gap-3 text-xs',
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#6366f1] flex items-center justify-center text-white shrink-0 shadow-sm mt-0.5">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}

                    <div
                      className={clsx(
                        'max-w-[85%] rounded-2xl px-4 py-3 space-y-2.5 leading-relaxed shadow-sm',
                        msg.role === 'user'
                          ? 'bg-gradient-to-r from-[#7b68ee] to-[#6c5ce7] text-white rounded-tr-none'
                          : 'bg-white dark:bg-[#1e1f2a] border border-slate-200 dark:border-[#2d2f3d] text-slate-800 dark:text-slate-200 rounded-tl-none'
                      )}
                    >
                      <div className="whitespace-pre-wrap font-sans text-xs">
                        {msg.content}
                      </div>

                      {/* Spec Proposal Card */}
                      {msg.suggested_spec && (
                        <div className="mt-3 p-3.5 rounded-xl border border-purple-300 dark:border-purple-800/60 bg-purple-50/80 dark:bg-purple-950/40 text-slate-800 dark:text-slate-200 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 font-bold text-purple-900 dark:text-purple-200 text-xs">
                              <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                              <span>Architect Spec Proposed</span>
                            </div>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-200 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 font-semibold">
                              {msg.suggested_spec.affected_projects.length} Repos
                            </span>
                          </div>

                          <div className="text-xs font-semibold text-slate-900 dark:text-white">
                            {msg.suggested_spec.title}
                          </div>

                          <div className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2">
                            {msg.suggested_spec.goal}
                          </div>

                          <div className="flex items-center gap-1 pt-1 flex-wrap">
                            <span className="text-[10px] text-slate-500 font-medium">Affected:</span>
                            {msg.suggested_spec.affected_projects.map((proj) => (
                              <span
                                key={proj}
                                className="px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300 text-[10px] font-mono font-medium"
                              >
                                {proj}
                              </span>
                            ))}
                          </div>

                          <button
                            type="button"
                            onClick={() => applySpecToForm(msg.suggested_spec!)}
                            className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#6366f1] hover:from-[#6c5ce7] hover:to-[#4f46e5] text-white font-bold text-xs shadow transition-all active:scale-[0.98]"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            <span>Transfer to Requirement Form</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>

                    {msg.role === 'user' && (
                      <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-[#2d2f3d] flex items-center justify-center text-slate-700 dark:text-slate-200 shrink-0 mt-0.5">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                ))}

                {isChatSending && (
                  <div className="flex gap-3 text-xs justify-start items-center text-slate-500 dark:text-slate-400 italic">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#6366f1] flex items-center justify-center text-white shrink-0 animate-pulse">
                      <Bot className="w-4 h-4" />
                    </div>
                    <span>Local AI Architect is analyzing workspace contracts and formulating architecture...</span>
                  </div>
                )}
              </div>

              {/* Suggestion Chips */}
              <div className="px-6 py-2 border-t border-slate-200 dark:border-[#262732] bg-white/50 dark:bg-[#1a1b23]/50 flex items-center gap-2 overflow-x-auto">
                <span className="text-[10px] text-slate-400 shrink-0 font-medium">Quick Starters:</span>
                {[
                  'Design user profile avatar upload & crop',
                  'Add JWT authentication with refresh token',
                  'Optimize metrics feed with virtual scrolling',
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => handleSendChatMessage(chip)}
                    disabled={isChatSending}
                    className="shrink-0 px-2.5 py-1 rounded-full border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#23242e] text-[11px] text-slate-700 dark:text-slate-300 hover:border-purple-400 dark:hover:border-purple-600 transition-colors disabled:opacity-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Input Box */}
              <div className="p-4 border-t border-slate-200 dark:border-[#262732] bg-white dark:bg-[#1a1b23] flex items-center gap-2">
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChatMessage();
                    }
                  }}
                  placeholder="Discuss architecture, endpoints, or features with your local AI (Enter to send)..."
                  rows={2}
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] resize-none"
                />
                <button
                  type="button"
                  onClick={() => handleSendChatMessage()}
                  disabled={isChatSending || !chatInput.trim()}
                  className="p-3 rounded-xl bg-gradient-to-r from-[#7b68ee] to-[#6366f1] text-white hover:from-[#6c5ce7] hover:to-[#4f46e5] disabled:opacity-40 transition-all shadow-md shadow-purple-500/20"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Sticky Bottom Actions */}
          <div className="p-4 border-t border-slate-200 dark:border-[#2d2d2d] bg-slate-50/80 dark:bg-[#1e1e1e]/80 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#303030] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2a2a2a] transition-all"
            >
              Cancel
            </button>

            {activeMode === 'chat' ? (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveMode('form')}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-[#353746] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#252632] text-xs font-semibold transition-all"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>
                    {title.trim().length > 0 ? `Review Spec (${title.slice(0, 20)}...)` : 'Go to Manual Form'}
                  </span>
                </button>

                {title.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleSubmit(true)}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white text-xs font-bold shadow-md shadow-purple-500/25 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <span>Dispatching...</span>
                    ) : (
                      <>
                        <span>Create & Fan-Out</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSubmit(false)}
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-purple-200 dark:border-purple-900/50 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-xs font-bold transition-all disabled:opacity-50"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Save State ({status === 'draft' ? 'ToDo' : status})</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSubmit(true)}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white text-xs font-bold shadow-md shadow-purple-500/25 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Dispatching...</span>
                  ) : (
                    <>
                      <span>Create & Fan-Out</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    );
}
