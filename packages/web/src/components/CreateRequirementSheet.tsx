import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProjects, createRequirement, startRequirementFanOut } from '../lib/api.js';
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
} from 'lucide-react';
import { Priority, RequirementStatus, AttachmentItem, BranchMergePolicy } from '@sp-kickstack/shared';
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

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  // Form Fields
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [userStory, setUserStory] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [status, setStatus] = useState<RequirementStatus>('draft');
  const [mergePolicy, setMergePolicy] = useState<'inherit' | BranchMergePolicy>('inherit');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [activeGoalTab, setActiveGoalTab] = useState<'write' | 'preview'>('write');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Synchronize workspace when opening or workspace changes
  useEffect(() => {
    if (activeWorkspaceId !== 'all') {
      setWorkspaceId(activeWorkspaceId);
    }
  }, [activeWorkspaceId, isOpen]);

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

  const handleSubmit = async (andStart: boolean) => {
    if (!title.trim() || !goal.trim()) {
      toast.error('Title and Goal are required');
      return;
    }
    const filteredCriteria = criteria.filter((c) => c.trim().length > 0);
    if (filteredCriteria.length === 0) {
      toast.error('At least one acceptance criterion is required');
      return;
    }
    if (selectedProjects.length === 0) {
      toast.error('Please select at least one affected project');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createRequirement({
        workspace_id: workspaceId,
        title,
        goal,
        user_story: userStory || undefined,
        priority,
        status: andStart ? 'ready' : status,
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
                    <option key={w.id} value={w.id} className="bg-white dark:bg-[#1e1f26] text-slate-800 dark:text-slate-100">
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Close Button */}
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#262733] transition-colors"
                title="Close (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Form Body (Scrollable) */}
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
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />
            </div>

            {/* Input State, Priority & Merge Policy Select Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* State Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  State
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as RequirementStatus)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] cursor-pointer"
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
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] cursor-pointer"
                >
                  <option value="urgent">🔴 Urgent</option>
                  <option value="high">🟠 High</option>
                  <option value="normal">🔵 Normal</option>
                  <option value="low">⚪ Low</option>
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
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs font-semibold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] cursor-pointer"
                >
                  <option value="inherit">⚙️ Workspace Default</option>
                  <option value="manual_review_merge">🛡️ Manual Review & Merge</option>
                  <option value="auto_merge_main">🚀 Automatic Merge to Main</option>
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
                  <span className="text-purple-600 dark:text-purple-400 font-bold">
                    {selectedProjects.length} selected
                  </span>
                </div>
              </div>

              {projects.length === 0 ? (
                <div className="p-3.5 rounded-lg border border-dashed border-slate-200 dark:border-[#2e303d] text-center text-xs text-slate-500">
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
                            : 'border-slate-200 dark:border-[#2a2b36] bg-slate-50/60 dark:bg-[#1a1b22] text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-[#353745]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-bold text-xs truncate flex items-center gap-1.5">
                            <span>{proj.name}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded font-mono font-medium bg-slate-200 dark:bg-[#252632] text-slate-600 dark:text-slate-400">
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
                  <span>Goal & Problem Context (Rich Text) *</span>
                </label>

                {/* Tabs: Write vs Preview */}
                <div className="flex items-center rounded-lg bg-slate-100 dark:bg-[#20212c] p-0.5 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setActiveGoalTab('write')}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                      activeGoalTab === 'write'
                        ? 'bg-white dark:bg-[#282937] text-slate-900 dark:text-white shadow-sm'
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
                        ? 'bg-white dark:bg-[#282937] text-slate-900 dark:text-white shadow-sm'
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
                <div className="flex flex-wrap items-center gap-1 p-1.5 rounded-t-lg border border-b-0 border-slate-200 dark:border-[#2a2b36] bg-slate-100/80 dark:bg-[#20212c]/80 text-slate-600 dark:text-slate-300">
                  <button
                    type="button"
                    onClick={() => applyFormatting('**', '**')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2b2c3a] transition-colors"
                    title="Bold (**text**)"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('*', '*')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2b2c3a] transition-colors"
                    title="Italic (*text*)"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('### ')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2b2c3a] transition-colors"
                    title="Heading (### Section)"
                  >
                    <Heading2 className="w-3.5 h-3.5" />
                  </button>

                  <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

                  <button
                    type="button"
                    onClick={() => applyFormatting('- ')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2b2c3a] transition-colors"
                    title="Bullet List (- item)"
                  >
                    <ListIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('1. ')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2b2c3a] transition-colors"
                    title="Numbered List (1. item)"
                  >
                    <ListOrdered className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('> ')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2b2c3a] transition-colors"
                    title="Quote (> blockquote)"
                  >
                    <Quote className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => applyFormatting('```ts\n', '\n```')}
                    className="p-1 rounded hover:bg-slate-200 dark:hover:bg-[#2b2c3a] transition-colors"
                    title="Code Block"
                  >
                    <Code className="w-3.5 h-3.5" />
                  </button>

                  <div className="h-3 w-[1px] bg-slate-300 dark:bg-slate-700 mx-1" />

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
                  placeholder="### Background & Problem&#10;Describe the business context and technical requirements here. Use Markdown for bold, headings, and code snippets."
                  className="w-full px-3.5 py-2.5 rounded-b-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs font-mono text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all leading-relaxed"
                />
              ) : (
                <div className="min-h-[100px] p-4 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#14151b] text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
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
                        className="flex items-center justify-between p-2 rounded-lg bg-slate-100 dark:bg-[#20212c] border border-slate-200 dark:border-[#2a2b38] text-xs"
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
                className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />
            </div>

            {/* Acceptance Criteria */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span>Acceptance Criteria *</span>
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
                      placeholder="e.g. GET /drivers/nearby returns list of lat/lng coordinates"
                      className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-[#2a2b36] bg-slate-50 dark:bg-[#1a1b22] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
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

          {/* Sticky Bottom Actions */}
          <div className="p-4 border-t border-slate-200 dark:border-[#262732] bg-slate-50/80 dark:bg-[#181920]/80 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#2e303d] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#20212a] transition-all"
            >
              Cancel
            </button>

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
          </div>
        </SheetContent>
      </Sheet>
    );
}
