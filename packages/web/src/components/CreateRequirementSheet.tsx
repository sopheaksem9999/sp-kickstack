import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchProjects,
  fetchSprints,
  createRequirement,
  updateRequirement,
  startRequirementFanOut,
  fetchAiProviders,
  draftRequirementAi,
  fetchSettings,
  sendAiChatMessage,
  fetchAssets,
  fetchRequirements,
} from '../lib/api.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import { toast } from 'sonner';
import {
  X,
  Plus,
  Trash2,
  BookOpen,
  Sparkles,
  FolderGit2,
  GitBranch,
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
  Wand2,
  AlertTriangle,
  Building2,
  Lock,
  Check,
  ChevronDown,
  AtSign,
  Hash,
  CheckSquare,
  Terminal,
  Loader2,
  Search,
  Code2,
  MessageSquare,
  Copy,
  PlusCircle,
  Zap,
  Gauge,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog.js';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from './ui/popover.js';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs.js';
import { RadixSelect } from './ui/select.js';
import {
  Priority,
  RequirementStatus,
  AttachmentItem,
  BranchMergePolicy,
  AiChatMessage,
  DraftRequirementResult,
  formatRequirementTitle,
  ChatAttachmentItem,
  SharedAsset,
  Requirement,
  Project,
  ReasoningEffort,
  parseRequirementMarkdown,
} from '@sp-kickstack/shared';
import { MarkdownMessage } from './MarkdownMessage.js';

import { fetchBranches } from '../lib/runSettingsApi.js';
import { BranchPicker } from './BranchPicker.js';
import { baseBranchLabel, createTargetBranch } from '../lib/runSettings.js';
import { Sheet, SheetContent } from './ui/sheet.js';

interface ProviderOption {
  id: string;
  name: string;
  desc: string;
  badge?: string;
}

const EFFORT_OPTIONS: { id: ReasoningEffort; name: string; desc: string }[] = [
  { id: 'low', name: 'Low', desc: 'Fastest generation, concise responses' },
  { id: 'medium', name: 'Med', desc: 'Balanced reasoning and speed (default)' },
  { id: 'high', name: 'High', desc: 'Deeper architectural reasoning' },
  { id: 'max', name: 'Max', desc: 'Exhaustive verification and edge cases' },
];

const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'auto', name: 'Auto (Best Local Engine)', desc: 'Detects installed local CLI' },
  { id: 'claude-cli', name: 'Claude Code CLI', desc: 'Anthropic agentic CLI' },
  { id: 'agy-cli', name: 'Antigravity CLI (Agy)', desc: 'Google DeepMind agentic CLI' },
  { id: 'codex-cli', name: 'Codex CLI', desc: 'OpenAI local developer CLI' },
  { id: 'ollama', name: 'Ollama (Local LLM)', desc: '100% offline local model inference' },
  { id: 'heuristic', name: 'Heuristic Architect', desc: 'Offline requirement generator' },
];

interface ModelOptionItem {
  id: string;
  name: string;
  desc?: string;
  isConfigured?: boolean;
}

const MODEL_OPTIONS_MAP: Record<string, ModelOptionItem[]> = {
  'claude-cli': [
    { id: 'default', name: 'Default (recommended)', desc: 'Opus 5.5 · Best for everyday, complex tasks' },
    { id: 'opus', name: 'Opus', desc: 'Opus 5.5 · Best for everyday, complex tasks' },
    { id: 'fable', name: 'Fable', desc: 'Fable 5.1 · Most capable for hardest and longest-running tasks' },
    { id: 'sonnet', name: 'Sonnet', desc: 'Sonnet 5.5 · Efficient for routine and complex tasks' },
    { id: 'haiku', name: 'Haiku', desc: 'Haiku 5.5 · Fastest for quick answers' },
    { id: 'sonnet-5', name: 'Sonnet 5', desc: 'Sonnet 5 preset' },
  ],
  'agy-cli': [
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', desc: 'Ultra-fast low-latency Google DeepMind model' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Deep)', desc: 'Advanced code reasoning and large context' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Fast multimodal reasoning' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', desc: 'Reliable general performance' },
    { id: 'default', name: 'Default Model', desc: 'Preset from local Antigravity CLI' },
  ],
  'codex-cli': [
    { id: 'default', name: 'Default Codex Model', desc: 'OpenAI developer CLI default' },
    { id: 'o3-mini', name: 'o3-mini (High reasoning)', desc: 'Fast STEM and complex coding model' },
    { id: 'gpt-4o', name: 'GPT-4o (Omni)', desc: 'High-capability flagship model' },
  ],
  'ollama': [
    { id: 'default', name: 'Default Local Model', desc: 'Default configured model on port 11434' },
    { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B', desc: 'Offline code specialized LLM' },
    { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B', desc: 'Offline distilled reasoning model' },
    { id: 'llama3.3:70b', name: 'Llama 3.3 70B', desc: 'High parameter local open weights model' },
  ],
  'auto': [{ id: 'default', name: 'Auto Default', desc: 'Inherits selected engine preset' }],
  'heuristic': [{ id: 'default', name: 'Built-in Spec Engine', desc: 'Local rule-based generator' }],
};

const CHAT_COMMANDS = [
  { id: 'create', command: '/create', title: 'Synthesize & Create Requirement', description: 'Formulates a complete requirement ticket from this chat' },
  { id: 'clear', command: '/clear', title: 'Clear Chat Messages', description: 'Clears message history in the current session' },
  { id: 'help', command: '/help', title: 'Architect Guidance & Syntax', description: 'Shows supported syntax, shortcuts and agent commands' },
];


export function CreateRequirementSheet() {
  const { isOpen, closeSheet, editingRequirement } = useCreateRequirement();
  const isEditMode = Boolean(editingRequirement);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeWorkspaceId, workspaces, wsPath } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Requirement is locked to current active workspace by default and cannot be changed
  const workspaceId = editingRequirement?.workspace_id || activeWorkspaceId || 'default';

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
  /** '' = each repository's base branch. */
  const [targetBranch, setTargetBranchState] = useState('');
  const targetBranchRef = useRef('');
  const setTargetBranch = (val: string) => {
    targetBranchRef.current = val;
    setTargetBranchState(val);
  };
  const { data: branches = [] } = useQuery({
    queryKey: ['branches', [...selectedProjects].sort().join(',')],
    queryFn: () => fetchBranches(selectedProjects),
    enabled: isOpen && selectedProjects.length > 0,
  });
  // Each new requirement starts with Settings → Git & Branch Rules → Default target branch.
  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings, enabled: isOpen });
  const defaultTargetBranch = settingsData?.branch_merge.default_target_branch ?? '';

  const lastInitializedIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      lastInitializedIdRef.current = null;
      return;
    }

    const currentReqId = editingRequirement ? editingRequirement.id : 'NEW';
    if (wasOpenRef.current && lastInitializedIdRef.current === currentReqId) {
      return;
    }

    wasOpenRef.current = true;
    lastInitializedIdRef.current = currentReqId;

    if (editingRequirement) {
      setTitle(editingRequirement.title || '');
      setPriority(editingRequirement.priority || 'normal');
      setStatus(editingRequirement.status || 'draft');
      setSprintId(editingRequirement.sprint_id ?? null);
      setMergePolicy(editingRequirement.merge_policy || 'inherit');
      setSelectedProjects(editingRequirement.affected_projects || []);
      setTargetBranch(editingRequirement.target_branch || '');
      setAttachments(editingRequirement.attachments || []);

      const parsed = parseRequirementMarkdown(editingRequirement.body_md || '');
      setGoal(parsed.goal || '');
      setUserStory(parsed.userStory || '');
      setCriteria(parsed.acceptanceCriteria.length > 0 ? parsed.acceptanceCriteria : ['']);
      setActiveGoalTab('write');
      setActiveMode('form');
    } else {
      setTitle('');
      setGoal('');
      setUserStory('');
      setPriority('normal');
      setStatus('draft');
      setSprintId(null);
      setMergePolicy('inherit');
      setSelectedProjects([]);
      setTargetBranch(defaultTargetBranch);
      setCriteria(['']);
      setAttachments([]);
      setActiveGoalTab('write');
      setActiveMode('form');
    }
  }, [isOpen, editingRequirement]);
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [activeGoalTab, setActiveGoalTab] = useState<'write' | 'preview'>('write');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [showAiBar, setShowAiBar] = useState(false);
  const [selectedAiProvider, setSelectedAiProvider] = useState<string>('auto');
  const [selectedAiModel, setSelectedAiModel] = useState<string>('default');
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort>('medium');
  const [isEngineOpen, setIsEngineOpen] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [projectsPopoverOpen, setProjectsPopoverOpen] = useState(false);

  const { data: aiProviders } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: fetchAiProviders,
    staleTime: 30000,
  });

  // Option 2: AI Co-Architect Chat Mode
  const [activeMode, setActiveMode] = useState<'form' | 'chat'>('form');
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [chatAttachedFiles, setChatAttachedFiles] = useState<ChatAttachmentItem[]>([]);
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [showHashSlashMenu, setShowHashSlashMenu] = useState(false);
  const [hashSlashTrigger, setHashSlashTrigger] = useState<'#' | '/'>('#');
  const [hashSlashQuery, setHashSlashQuery] = useState('');
  const [hashSlashSelectedIndex, setHashSlashSelectedIndex] = useState(0);

  // Helper to determine model for provider based on Settings > AI CLI
  const getModelForProvider = (provider: string): string => {
    if (provider === 'claude-cli') return settingsData?.ai_cli?.claude?.model || 'sonnet';
    if (provider === 'agy-cli') return settingsData?.ai_cli?.agy?.model || 'gemini-3.8-flash';
    if (provider === 'codex-cli') return settingsData?.ai_cli?.codex?.model || 'default';
    if (provider === 'ollama') return settingsData?.ai_cli?.ollama?.model || 'default';
    return 'default';
  };

  const getEffortForProvider = (provider: string): ReasoningEffort => {
    if (provider === 'claude-cli') return settingsData?.ai_cli?.claude?.effort || 'medium';
    if (provider === 'agy-cli') return settingsData?.ai_cli?.agy?.effort || 'medium';
    if (provider === 'codex-cli') return settingsData?.ai_cli?.codex?.effort || 'medium';
    return 'medium';
  };

  // Auto-sync default engine, model, and effort from settings on sheet open
  useEffect(() => {
    if (isOpen && settingsData?.ai_cli) {
      const defaultProvider = settingsData.ai_cli.defaultProvider || 'auto';
      setSelectedAiProvider(defaultProvider);
      setSelectedAiModel(getModelForProvider(defaultProvider));
      setSelectedEffort(getEffortForProvider(defaultProvider));
    }
  }, [isOpen, settingsData]);

  const handleAiProviderChange = (newProvider: string) => {
    setSelectedAiProvider(newProvider);
    setSelectedAiModel(getModelForProvider(newProvider));
    setSelectedEffort(getEffortForProvider(newProvider));
  };

  const handleSummarizeTool = () => {
    handleSendChatMessage(`Summarize the architectural scope, connected hub repositories (${projects.map(p => p.name).join(', ') || 'backend, frontend'}), and key technical takeaways.`);
  };

  const handleExtractSpecTool = () => {
    handleSendChatMessage('/create Extract and formulate an actionable multi-repo development specification with clear acceptance criteria.');
  };

  const handleInspectTool = () => {
    handleSendChatMessage(`Inspect the API contracts, shared models in @sp-kickstack/shared, and integration patterns for ${projects.map(p => p.name).join(', ') || 'backend, frontend'}.`);
  };

  const handleAskSpecTool = () => {
    setChatInput('What are the recommended endpoints and contract changes for this requirement?');
    if (chatTextareaRef.current) {
      chatTextareaRef.current.focus();
    }
  };

  const availableAiModels = useMemo(() => {
    const providerList = [...(MODEL_OPTIONS_MAP[selectedAiProvider] || [{ id: 'default', name: 'Default Model' }])];
    const configuredModel = getModelForProvider(selectedAiProvider);

    const list = providerList.map((m) => {
      if (m.id === configuredModel) {
        return {
          ...m,
          isConfigured: true,
        };
      }
      return m;
    });

    if (configuredModel && configuredModel !== 'default' && !list.some((m) => m.id === configuredModel)) {
      list.unshift({
        id: configuredModel,
        name: configuredModel,
        desc: 'Configured in Settings > AI CLI',
        isConfigured: true,
      });
    }

    return list;
  }, [selectedAiProvider, settingsData]);

  const currentAiProviderName = PROVIDER_OPTIONS.find((p) => p.id === selectedAiProvider)?.name || selectedAiProvider;
  const currentAiModelName = useMemo(() => {
    const found = availableAiModels.find((m) => m.id === selectedAiModel);
    if (found) return found.name;
    return selectedAiModel;
  }, [availableAiModels, selectedAiModel]);

  // Queries for mentions in Option 2
  const { data: assetsData } = useQuery({
    queryKey: ['assets', workspaceId],
    queryFn: () => fetchAssets(workspaceId),
    enabled: isOpen && activeMode === 'chat',
    staleTime: 15000,
  });
  const sharedAssets = assetsData?.shared_assets || [];

  const filteredMentionAssets = useMemo(() => {
    return sharedAssets.filter((a) =>
      mentionQuery ? a.name.toLowerCase().includes(mentionQuery.toLowerCase()) : true
    );
  }, [sharedAssets, mentionQuery]);

  const { data: allRequirements = [] } = useQuery({
    queryKey: ['requirements', workspaceId],
    queryFn: () => fetchRequirements(workspaceId),
    enabled: isOpen && activeMode === 'chat',
    staleTime: 15000,
  });

  const filteredMentionProjects = useMemo(() => {
    if (!hashSlashQuery) return projects;
    const q = hashSlashQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q) ||
        (p.repo_path && p.repo_path.toLowerCase().includes(q))
    );
  }, [projects, hashSlashQuery]);

  const filteredMentionRequirements = useMemo(() => {
    if (hashSlashTrigger !== '#') return [];
    if (!hashSlashQuery) return allRequirements;
    const q = hashSlashQuery.toLowerCase();
    return allRequirements.filter(
      (r) => r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)
    );
  }, [allRequirements, hashSlashQuery, hashSlashTrigger]);

  const availableMentionCommands = useMemo(() => {
    if (hashSlashTrigger !== '/') return [];
    if (!hashSlashQuery) return CHAT_COMMANDS;
    const q = hashSlashQuery.toLowerCase();
    return CHAT_COMMANDS.filter(
      (c) =>
        c.command.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [hashSlashTrigger, hashSlashQuery]);

  const activeMentionMenuItems = useMemo<
    Array<{
      key: string;
      type: 'project' | 'ticket' | 'command';
      project?: Project;
      ticket?: Requirement;
      command?: { id: string; command: string; title: string; description: string };
    }>
  >(() => {
    const items: Array<{
      key: string;
      type: 'project' | 'ticket' | 'command';
      project?: Project;
      ticket?: Requirement;
      command?: { id: string; command: string; title: string; description: string };
    }> = [];

    for (const proj of filteredMentionProjects) {
      items.push({
        key: `proj-${proj.name}`,
        type: 'project',
        project: proj,
      });
    }

    if (hashSlashTrigger === '#') {
      for (const req of filteredMentionRequirements) {
        items.push({
          key: `ticket-${req.id}`,
          type: 'ticket',
          ticket: req,
        });
      }
    }

    if (hashSlashTrigger === '/') {
      for (const cmd of availableMentionCommands) {
        items.push({
          key: `cmd-${cmd.id}`,
          type: 'command',
          command: cmd,
        });
      }
    }

    return items;
  }, [filteredMentionProjects, filteredMentionRequirements, availableMentionCommands, hashSlashTrigger]);

  // File attachments and paste handlers for Option 2
  const handleChatFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const newItem: ChatAttachmentItem = {
          id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          data_url: dataUrl,
        };
        setChatAttachedFiles((prev) => [...prev, newItem]);
      };
      reader.readAsDataURL(file);
    });
    if (chatFileInputRef.current) chatFileInputRef.current.value = '';
  };

  const handleChatPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const newItem: ChatAttachmentItem = {
              id: `att_paste_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
              name: file.name && file.name !== 'image.png' ? file.name : `clipboard-image-${Date.now().toString().slice(-4)}.png`,
              type: file.type || 'image/png',
              size: file.size,
              data_url: dataUrl,
            };
            setChatAttachedFiles((prev) => [...prev, newItem]);
            toast.success(`Pasted image from clipboard (${Math.round(file.size / 1024)} KB)`);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const removeChatAttachedFile = (index: number) => {
    setChatAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const selectMentionAsset = (asset: SharedAsset) => {
    const alreadyAttached = chatAttachedFiles.some(
      (f) => (f.asset_id && f.asset_id === asset.id) || f.name === asset.name
    );
    if (!alreadyAttached) {
      setChatAttachedFiles((prev) => [
        ...prev,
        {
          id: `att_asset_${asset.id}`,
          name: asset.name,
          type: asset.type || 'application/octet-stream',
          size: asset.size || 0,
          data_url: asset.data_url,
          asset_id: asset.id,
        },
      ]);
    }

    const atIndex = chatInput.lastIndexOf('@');
    if (atIndex !== -1) {
      const beforeAt = chatInput.slice(0, atIndex);
      const afterAt = chatInput.slice(atIndex);
      const queryEnd = afterAt.indexOf(' ');
      const remainder = queryEnd !== -1 ? afterAt.slice(queryEnd) : '';
      setChatInput(`${beforeAt}@${asset.name} ${remainder}`);
    } else {
      setChatInput((prev) => (prev ? `${prev} @${asset.name} ` : `@${asset.name} `));
    }

    setShowMentionMenu(false);
    setMentionQuery('');
    toast.success(`Attached "${asset.name}" from Shared Workspace Assets`);
    if (chatTextareaRef.current) {
      chatTextareaRef.current.focus();
    }
  };

  const selectMentionProject = (proj: Project) => {
    const trig = hashSlashTrigger || '#';
    const trigIndex = chatInput.lastIndexOf(trig);
    const mentionTag = `#${proj.name} `;

    if (trigIndex !== -1) {
      const before = chatInput.slice(0, trigIndex);
      const after = chatInput.slice(trigIndex);
      const queryEnd = after.indexOf(' ');
      const remainder = queryEnd !== -1 ? after.slice(queryEnd) : '';
      setChatInput(`${before}${mentionTag}${remainder}`);
    } else {
      setChatInput((prev) => (prev ? `${prev} ${mentionTag}` : mentionTag));
    }

    setShowHashSlashMenu(false);
    setHashSlashQuery('');
    toast.success(`Mentioned project #${proj.name}`);
    if (chatTextareaRef.current) {
      chatTextareaRef.current.focus();
    }
  };

  const selectMentionTicket = (req: Requirement) => {
    const trig = hashSlashTrigger || '#';
    const trigIndex = chatInput.lastIndexOf(trig);
    const mentionTag = `#${req.id} `;

    if (trigIndex !== -1) {
      const before = chatInput.slice(0, trigIndex);
      const after = chatInput.slice(trigIndex);
      const queryEnd = after.indexOf(' ');
      const remainder = queryEnd !== -1 ? after.slice(queryEnd) : '';
      setChatInput(`${before}${mentionTag}${remainder}`);
    } else {
      setChatInput((prev) => (prev ? `${prev} ${mentionTag}` : mentionTag));
    }

    setShowHashSlashMenu(false);
    setHashSlashQuery('');
    toast.success(`Mentioned ticket #${req.id}: ${req.title}`);
    if (chatTextareaRef.current) {
      chatTextareaRef.current.focus();
    }
  };

  const selectMentionCommand = (cmd: { command: string }) => {
    const slashIndex = chatInput.lastIndexOf('/');
    const commandTag = `${cmd.command} `;

    if (slashIndex !== -1) {
      const before = chatInput.slice(0, slashIndex);
      const after = chatInput.slice(slashIndex);
      const queryEnd = after.indexOf(' ');
      const remainder = queryEnd !== -1 ? after.slice(queryEnd) : '';
      setChatInput(`${before}${commandTag}${remainder}`);
    } else {
      setChatInput((prev) => (prev ? `${prev} ${commandTag}` : commandTag));
    }

    setShowHashSlashMenu(false);
    setHashSlashQuery('');
    if (chatTextareaRef.current) {
      chatTextareaRef.current.focus();
    }
  };

  const handleChatInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setChatInput(val);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);

    // 1. Check for @ mention (shared workspace assets)
    const lastAt = textBeforeCursor.lastIndexOf('@');
    if (lastAt !== -1) {
      const charBeforeAt = lastAt > 0 ? textBeforeCursor[lastAt - 1] : ' ';
      if (charBeforeAt === ' ' || charBeforeAt === '\n' || lastAt === 0) {
        const query = textBeforeCursor.slice(lastAt + 1);
        if (!/\s/.test(query)) {
          setShowMentionMenu(true);
          setMentionQuery(query);
          setMentionSelectedIndex(0);
          setShowHashSlashMenu(false);
          return;
        }
      }
    }
    setShowMentionMenu(false);
    setMentionQuery('');

    // 2. Check for # or / (project / ticket / command mentions)
    const lastHash = textBeforeCursor.lastIndexOf('#');
    const lastSlash = textBeforeCursor.lastIndexOf('/');
    const lastTrigger = Math.max(lastHash, lastSlash);

    if (lastTrigger !== -1) {
      const triggerChar = textBeforeCursor[lastTrigger] as '#' | '/';
      const charBefore = lastTrigger > 0 ? textBeforeCursor[lastTrigger - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || lastTrigger === 0) {
        const query = textBeforeCursor.slice(lastTrigger + 1);
        if (!/\s/.test(query)) {
          setShowHashSlashMenu(true);
          setHashSlashTrigger(triggerChar);
          setHashSlashQuery(query);
          setHashSlashSelectedIndex(0);
          setShowMentionMenu(false);
          return;
        }
      }
    }
    setShowHashSlashMenu(false);
    setHashSlashQuery('');
  };

  const handleChatInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Navigate @ asset menu
    if (showMentionMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredMentionAssets.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIndex((prev) => (prev - 1 + filteredMentionAssets.length) % Math.max(1, filteredMentionAssets.length));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredMentionAssets.length > 0) {
          e.preventDefault();
          selectMentionAsset(filteredMentionAssets[mentionSelectedIndex]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionMenu(false);
        return;
      }
    }

    // Navigate # or / menu
    if (showHashSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHashSlashSelectedIndex((prev) => (prev + 1) % Math.max(1, activeMentionMenuItems.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHashSlashSelectedIndex(
          (prev) => (prev - 1 + activeMentionMenuItems.length) % Math.max(1, activeMentionMenuItems.length)
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (activeMentionMenuItems.length > 0) {
          e.preventDefault();
          const item = activeMentionMenuItems[hashSlashSelectedIndex];
          if (item) {
            if (item.type === 'project' && item.project) {
              selectMentionProject(item.project);
              return;
            }
            if (item.type === 'ticket' && item.ticket) {
              selectMentionTicket(item.ticket);
              return;
            }
            if (item.type === 'command' && item.command) {
              selectMentionCommand(item.command);
              return;
            }
          }
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowHashSlashMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChatMessage();
    }
  };



  // Auto-select all projects in workspace by default, or prune invalid projects when workspace changes
  useEffect(() => {
    if (projects.length > 0) {
      setSelectedProjects((prev) => {
        const valid = prev.filter((name) => projects.some((p) => p.name === name));
        return valid.length > 0 ? valid : projects.map((p) => p.name);
      });
    } else {
      setSelectedProjects([]);
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
    setTargetBranch('');
    setSelectedProjects([]);
    setCriteria(['']);
    setAttachments([]);
    setActiveGoalTab('write');
    setProjectsPopoverOpen(false);
  };

  const handleClose = () => {
    resetForm();
    closeSheet();
  };

  const triggerCancel = () => {
    if (title.trim() || goal.trim() || aiPrompt.trim() || attachments.length > 0) {
      setShowCancelConfirm(true);
    } else {
      handleClose();
    }
  };

  const handleAiDraft = async () => {
    if (!aiPrompt.trim()) {
      toast.error('Please enter a brief feature idea or prompt');
      return;
    }
    setIsAiDrafting(true);
    try {
      const data = await draftRequirementAi({
        prompt: aiPrompt,
        workspace_id: workspaceId,
        provider: selectedAiProvider !== 'auto' ? selectedAiProvider : undefined,
      });
      if (data.title) setTitle(formatRequirementTitle(data.title, data.goal || aiPrompt));

      if (data.goal) setGoal(data.goal);
      if (data.user_story) setUserStory(data.user_story);
      if (Array.isArray(data.acceptance_criteria) && data.acceptance_criteria.length > 0) {
        setCriteria(data.acceptance_criteria);
      }
      if (Array.isArray(data.affected_projects) && data.affected_projects.length > 0) {
        const valid = data.affected_projects.filter((p: string) => projects.some((proj) => proj.name === p));
        setSelectedProjects(valid.length > 0 ? valid : projects.map((p) => p.name));
      }
      toast.success(`Generated by ${data.provider_used || 'AI Drafter'}!`);
      setShowAiBar(false);
    } catch (err: any) {
      toast.error(err.message || 'AI drafting error');
    } finally {
      setIsAiDrafting(false);
    }
  };

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
    const rawContent = (textToSend || chatInput).trim();
    if (!rawContent && chatAttachedFiles.length === 0) return;
    if (isChatSending) return;

    // Check for /create command
    if (
      rawContent.toLowerCase().startsWith('/create') ||
      rawContent.toLowerCase() === 'create requirement' ||
      rawContent.toLowerCase() === 'dispatch requirement'
    ) {
      setChatInput('');
      const lastSpec = [...chatMessages].reverse().find((m) => m.suggested_spec)?.suggested_spec;
      if (lastSpec) {
        applySpecToForm(lastSpec);
        return;
      } else {
        toast.info('No architectural spec formulated yet. Ask local AI to design architecture first.');
      }
    }

    if (rawContent.toLowerCase() === '/clear') {
      setChatMessages([]);
      setChatInput('');
      toast.success('Chat messages cleared');
      return;
    }

    if (rawContent.toLowerCase() === '/help') {
      setChatInput('');
      setChatMessages((prev) => [
        ...prev,
        {
          id: `help-${Date.now()}`,
          role: 'assistant',
          content: `💡 **Option 2 Architect Guidance & Shortcuts:**\n- **@**: Mention and attach files from Shared Workspace Assets\n- **#**: Mention connected hub repositories or tickets\n- **/**: Access chat commands (/create, /clear, /help)\n- **📎**: Attach local images, specs, or code files\n- **Clipboard Paste**: Paste screenshots directly with Ctrl+V / Cmd+V\n- Click **"Transfer to Requirement Form"** on any formulated spec to populate the requirement form!`,
          timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }

    const sendingFiles = [...chatAttachedFiles];
    const userMsg: AiChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: rawContent || '(Attached files)',
      timestamp: new Date().toISOString(),
      attachments: sendingFiles.length > 0 ? sendingFiles : undefined,
    };

    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory);
    setChatInput('');
    setChatAttachedFiles([]);
    setShowMentionMenu(false);
    setShowHashSlashMenu(false);
    setIsChatSending(true);

    try {
      const res = await sendAiChatMessage({
        messages: newHistory,
        workspace_id: workspaceId,
        provider: selectedAiProvider !== 'auto' ? (selectedAiProvider as any) : undefined,
        model: selectedAiModel !== 'default' ? selectedAiModel : undefined,
        effort: selectedEffort,
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
    if (spec.title) setTitle(formatRequirementTitle(spec.title, spec.goal || spec.notes));
    if (spec.goal) setGoal(spec.goal);

    if (spec.user_story) setUserStory(spec.user_story);
    if (Array.isArray(spec.acceptance_criteria) && spec.acceptance_criteria.length > 0) {
      setCriteria(spec.acceptance_criteria);
    }
    if (Array.isArray(spec.affected_projects) && spec.affected_projects.length > 0) {
      const valid = spec.affected_projects.filter((p: string) => projects.some((proj) => proj.name === p));
      setSelectedProjects(valid.length > 0 ? valid : projects.map((p) => p.name));
    }
    setActiveMode('form');
    toast.success('✨ Transferred AI Architect spec to requirement form! Review and click Create & Dispatch.');
  };

  const handleCreateRequirementFromMessage = (msg: AiChatMessage) => {
    if (msg.suggested_spec) {
      applySpecToForm(msg.suggested_spec);
      return;
    }
    const lines = msg.content.split('\n').filter((l) => l.trim().length > 0);
    const firstLine = lines[0]?.replace(/^[#*\s]+/, '').replace(/^Technical Inspection & APIs:\s*/i, '').trim() || 'New AI Requirement';
    setTitle(formatRequirementTitle(firstLine, msg.content));
    setGoal(msg.content);
    setActiveMode('form');
    toast.success('✨ Transferred to Requirement Form! Review and dispatch.');
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
      if (isEditMode && editingRequirement) {
        const updated = await updateRequirement(editingRequirement.id, {
          title: trimmedTitle,
          goal: effectiveGoal,
          user_story: userStory || undefined,
          priority,
          status: andStart ? 'ready' : status,
          sprint_id: sprintId,
          merge_policy: mergePolicy !== 'inherit' ? mergePolicy : null,
          target_branch: createTargetBranch(targetBranchRef.current, Boolean(settingsData)),
          affected_projects: selectedProjects,
          acceptance_criteria: filteredCriteria,
          attachments,
        });

        queryClient.invalidateQueries({ queryKey: ['requirement', editingRequirement.id] });
        queryClient.invalidateQueries({ queryKey: ['requirements'] });
        handleClose();

        toast.success(`Updated ${updated.id}: ${updated.title}`, {
          action: {
            label: 'View Spec',
            onClick: () => navigate(wsPath(`/requirements/${updated.id}`)),
          },
        });

        if (andStart) {
          await startRequirementFanOut(updated.id);
          queryClient.invalidateQueries({ queryKey: ['requirements'] });
          toast.success(`Fanned out to ${selectedProjects.join(', ')}`);
          navigate(wsPath(`/requirements/${updated.id}`));
        }
        return;
      }

      const created = await createRequirement({
        workspace_id: workspaceId,
        title: trimmedTitle,
        goal: effectiveGoal,
        user_story: userStory || undefined,
        priority,
        status: andStart ? 'ready' : status,
        sprint_id: sprintId || undefined,
        merge_policy: mergePolicy !== 'inherit' ? mergePolicy : undefined,
        target_branch: createTargetBranch(targetBranchRef.current, Boolean(settingsData)),
        affected_projects: selectedProjects,
        acceptance_criteria: filteredCriteria,
        attachments,
      });

      queryClient.invalidateQueries({ queryKey: ['requirements'] });
      handleClose();

      toast.success(`Created ${created.id}: ${created.title}`, {
        action: {
          label: 'View Spec',
          onClick: () => navigate(wsPath(`/requirements/${created.id}`)),
        },
      });

      if (andStart) {
        await startRequirementFanOut(created.id);
        queryClient.invalidateQueries({ queryKey: ['requirements'] });
        toast.success(`Fanned out to ${selectedProjects.join(', ')}`);
        navigate(wsPath(`/requirements/${created.id}`));
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create requirement');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) triggerCancel(); }}>
      <SheetContent side="right" className="p-0 overflow-hidden sm:max-w-2xl flex flex-col w-screen">
        {/* Header */}
        <div className="px-6 py-2 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/70 dark:bg-[#1a1b23]/70">
          <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#7b68ee] to-[#ec4899] flex items-center justify-center font-black text-white text-sm shadow-md shadow-purple-500/20">
                ⚡
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                    {isEditMode ? 'Edit Requirement' : 'New Cross-Repo Requirement'}
                  </h2>
                  {isEditMode && editingRequirement && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 font-bold border border-purple-200 dark:border-purple-800/60">
                      {editingRequirement.id}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isEditMode ? 'Update specification, repositories, target branch & attachments' : 'Slide-over specification sheet & attachments'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Workspace Badge (Locked to active space by default, cannot change) */}
              <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-200/80 dark:bg-[#23242e] border border-slate-300 dark:border-[#2d2f3d] text-xs font-semibold text-slate-800 dark:text-slate-200 select-none shadow-2xs"
                title={`Created in active workspace: ${currentWorkspace?.name || workspaceId} (cannot be changed)`}
              >
                <Building2 className="w-3.5 h-3.5 text-[#7b68ee] shrink-0" />
                <span className="truncate max-w-[150px]">
                  {currentWorkspace?.name || workspaceId}
                </span>
                <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  Locked
                </span>
              </div>

              {/* Close / Cancel Button */}
              <button
                type="button"
                onClick={triggerCancel}
                className="px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#2a2a2a] rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                title="Cancel & close (Esc)"
              >
                <X className="w-4 h-4" />
                <span>Cancel</span>
              </button>
            </div>
          </div>

          {/* Mode Selector: Specification Form vs. Discuss with Local AI (Option 2) */}
          <div className="px-6 pt-2 pb-0 flex items-center justify-between gap-3">
            <Tabs
              value={activeMode}
              onValueChange={(val) => setActiveMode(val as 'form' | 'chat')}
              className="flex-1 max-w-sm"
            >
              <TabsList className="bg-slate-100 dark:bg-[#1f2028] border border-slate-200 dark:border-[#2d2f3d] p-1 rounded-xl w-full flex items-center gap-1 shadow-inner">
                <TabsTrigger
                  value="form"
                  className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer data-[state=active]:bg-white dark:data-[state=active]:bg-[#2a2c38] data-[state=active]:text-[#7b68ee] dark:data-[state=active]:text-purple-300 data-[state=active]:shadow-sm data-[state=active]:font-bold border border-transparent data-[state=active]:border-slate-200/80 dark:data-[state=active]:border-purple-500/20"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Specification Form</span>
                  {title.trim().length > 0 && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#2a2c38]" title="Draft in progress" />
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="chat"
                  className="flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-300 transition-all cursor-pointer data-[state=active]:bg-white dark:data-[state=active]:bg-[#2a2c38] data-[state=active]:text-[#7b68ee] dark:data-[state=active]:text-purple-300 data-[state=active]:shadow-sm data-[state=active]:font-bold border border-transparent data-[state=active]:border-slate-200/80 dark:data-[state=active]:border-purple-500/20"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-500 dark:text-purple-400" />
                  <span>Discuss with Local AI</span>
                  <span className="text-[9px] uppercase tracking-wider font-mono px-1.5 py-0.2 rounded font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300">
                    Option 2
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {activeMode === 'form' ? (
            <div className="flex-1 overflow-y-auto px-6 py-2.5 space-y-3">
            {/* Shared Workspace Rules & Architecture Context Notification */}
            {currentWorkspace && (currentWorkspace.rules || currentWorkspace.context) && (
              <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 flex items-start gap-2.5 text-xs">
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
            <div className="rounded-xl border border-purple-200 dark:border-purple-900/50 bg-gradient-to-r from-purple-50/70 via-indigo-50/40 to-pink-50/50 dark:from-purple-950/30 dark:via-indigo-950/20 dark:to-pink-950/20 px-3 py-2 space-y-2 transition-all">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-purple-800 dark:text-purple-300">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>Draft with AI Assistant</span>
                  <span className="text-[10px] font-semibold px-2 py-0.2 rounded-full bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300">
                    Claude · Codex · AGY · Ollama
                  </span>
                </div>
                {!showAiBar && (
                  <button
                    type="button"
                    onClick={() => setShowAiBar(true)}
                    className="text-xs font-semibold text-purple-700 dark:text-purple-300 hover:text-purple-900 dark:hover:text-purple-100 flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>Use Prompt</span> <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>

              {showAiBar && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 shrink-0">Engine:</span>
                      <RadixSelect
                        value={selectedAiProvider}
                        onChange={setSelectedAiProvider}
                        options={[
                          { value: 'auto', label: '⚡ Auto (Local Claude / AGY CLI — No API Key)' },
                          ...(aiProviders?.map((p) => ({
                            value: p.id,
                            label: `${p.name} ${!p.available ? '(Offline)' : '✓'}`,
                            disabled: !p.available,
                          })) || []),
                        ]}
                        className="bg-purple-100/70 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200 text-[11px] py-1 px-2 h-7"
                      />
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
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>Requirement Title *</span>
                <span className="text-[10px] font-normal text-slate-400">[Module] &lt;Action Verb&gt; &lt;Feature Scope&gt;</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. [Realtime] Track Nearby Drivers on Live Map"
                autoFocus
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-sm font-semibold text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />

            </div>

            {/* Input State, Priority, Sprint & Merge Policy Select Controls (2 columns per row) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* State Select */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  State
                </label>
                <RadixSelect<RequirementStatus>
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: 'draft', label: 'ToDo (Backlog)', icon: <span>📋</span> },
                    { value: 'in_progress', label: 'In-Progress', icon: <span>⚡</span> },
                    { value: 'qa', label: 'QA / Testing', icon: <span>🧪</span> },
                    { value: 'done', label: 'Done / Complete', icon: <span>✅</span> },
                  ]}
                />
              </div>

              {/* Priority Select */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Priority
                </label>
                <RadixSelect<Priority>
                  value={priority}
                  onChange={setPriority}
                  options={[
                    { value: 'urgent', label: 'Urgent', icon: <span>🔴</span> },
                    { value: 'high', label: 'High', icon: <span>🟠</span> },
                    { value: 'normal', label: 'Normal', icon: <span>🔵</span> },
                    { value: 'low', label: 'Low', icon: <span>⚪</span> },
                  ]}
                />
              </div>

              {/* Sprint Select */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Sprint
                </label>
                <RadixSelect<string>
                  value={sprintId || ''}
                  onChange={(val) => setSprintId(val ? val : null)}
                  options={[
                    { value: '', label: 'Product Backlog', icon: <span>📋</span> },
                    ...sprints.map((s) => ({
                      value: s.id,
                      label: s.name,
                      icon: <span>{s.status === 'active' ? '🏃' : s.status === 'completed' ? '🏁' : '⏳'}</span>,
                      badge: (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 dark:bg-[#333] text-slate-600 dark:text-slate-400 font-semibold">
                          {s.status}
                        </span>
                      ),
                    })),
                  ]}
                />
              </div>

              {/* Merge Policy Select */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Merge into Main
                </label>
                <RadixSelect<'inherit' | BranchMergePolicy>
                  value={mergePolicy}
                  onChange={setMergePolicy}
                  options={[
                    { value: 'inherit', label: 'Workspace Default', icon: <span>⚙️</span> },
                    { value: 'manual_review_merge', label: 'Review first', icon: <span>🛡️</span> },
                    { value: 'auto_merge', label: 'Auto-merge (no review)', icon: <span>🚀</span> },
                  ]}
                />
              </div>
            </div>

            {/* Affected Repositories / Engines */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <FolderGit2 className="w-3.5 h-3.5" />
                  <span>Affected Repositories / Engines *</span>
                </label>
                <div className="flex items-center gap-2 text-[11px]">
                  {projects.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSelectedProjects(projects.map((p) => p.name))}
                        className="text-purple-600 dark:text-purple-400 font-semibold hover:underline cursor-pointer"
                      >
                        Select All
                      </button>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <button
                        type="button"
                        onClick={() => setSelectedProjects([])}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:underline cursor-pointer"
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
                <div className="p-3 rounded-lg border border-dashed border-slate-200 dark:border-[#303030] text-center text-xs text-slate-500">
                  No projects registered in this workspace yet. Add projects in the Projects tab.
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Popover open={projectsPopoverOpen} onOpenChange={setProjectsPopoverOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={clsx(
                          'w-full h-9 flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#7b68ee]',
                          selectedProjects.length === 0
                            ? 'border-rose-300 dark:border-rose-700/60 bg-rose-50/40 dark:bg-rose-950/20'
                            : 'border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] hover:border-slate-300 dark:hover:border-[#3a3a3a]'
                        )}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FolderGit2 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                          <span className="truncate">
                            {selectedProjects.length === 0
                              ? 'Select affected repositories / engines...'
                              : selectedProjects.length === projects.length
                              ? `All repositories selected (${projects.length})`
                              : `${selectedProjects.length} of ${projects.length} selected (${selectedProjects.join(', ')})`}
                          </span>
                        </div>
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      sideOffset={4}
                      className="w-[var(--radix-popover-trigger-width)] min-w-[340px] max-w-[600px] p-2 bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#303030] shadow-xl rounded-xl z-50 space-y-1.5"
                    >
                      <div className="px-2 py-1.5 border-b border-slate-100 dark:border-[#2d2d2d] flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">Select Options</span>
                        <div className="flex items-center gap-2 text-[11px]">
                          <button
                            type="button"
                            onClick={() => setSelectedProjects(projects.map((p) => p.name))}
                            className="text-purple-600 dark:text-purple-400 font-semibold hover:underline cursor-pointer"
                          >
                            Select All
                          </button>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() => setSelectedProjects([])}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:underline cursor-pointer"
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      <div className="max-h-60 overflow-y-auto space-y-1 py-1">
                        {projects.map((proj) => {
                          const isSelected = selectedProjects.includes(proj.name);
                          return (
                            <button
                              key={proj.name}
                              type="button"
                              onClick={() => toggleProject(proj.name)}
                              className={clsx(
                                'w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors cursor-pointer',
                                isSelected
                                  ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 font-semibold'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2c2c2c]'
                              )}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                <div
                                  className={clsx(
                                    'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                    isSelected
                                      ? 'bg-[#7b68ee] border-[#7b68ee] text-white'
                                      : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-[#1e1e1e]'
                                  )}
                                >
                                  {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                </div>
                                <div className="truncate">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="truncate">{proj.name}</span>
                                    <span className="text-[9px] px-1 py-0.2 rounded font-mono font-medium bg-slate-200 dark:bg-[#333333] text-slate-600 dark:text-slate-400 shrink-0">
                                      {proj.engine_type}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5 font-normal">
                                    {proj.repo_path} · <span className="font-semibold text-purple-600 dark:text-purple-400">{proj.base_branch || 'develop'}</span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </PopoverContent>
                  </Popover>

                  {/* Selected Repositories Badges/Chips */}
                  {selectedProjects.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {selectedProjects.map((pName) => {
                        const proj = projects.find((p) => p.name === pName);
                        return (
                          <span
                            key={pName}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 transition-all shadow-2xs"
                          >
                            <FolderGit2 className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />
                            <span className="font-semibold">{pName}</span>
                            {proj?.engine_type && (
                              <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-300">
                                {proj.engine_type}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleProject(pName);
                              }}
                              className="text-purple-400 hover:text-purple-700 dark:hover:text-purple-200 ml-0.5 p-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors cursor-pointer"
                              title={`Remove ${pName}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Target Branch */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5" />
                <span>Target Branch</span>
              </label>
              <BranchPicker
                value={targetBranch}
                onChange={setTargetBranch}
                entries={branches}
                chosenProjects={selectedProjects}
                baseLabel={baseBranchLabel(projects, selectedProjects, settingsData?.branch_merge.default_base_branch || 'develop')}
                disabled={selectedProjects.length === 0}
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Tasks start from it and are merged into it, for example <span className="font-mono">release/1.3</span>. It starts with
                Settings → Default target branch; a new name is created from each repository's base branch at fan-out. Empty = each
                repository's base branch.
              </p>
            </div>

            {/* Goal & Problem Context (Rich Text Editor + Attachments) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Edit3 className="w-3.5 h-3.5 text-purple-500" />
                  <span>Goal & Problem Context (Rich Text)</span>
                  <span className="text-[10px] normal-case font-normal text-slate-400 dark:text-slate-500">
                    (optional · defaults to Title)
                  </span>
                </label>

                {/* Tabs: Write vs Preview */}
                <Tabs value={activeGoalTab} onValueChange={(val) => setActiveGoalTab(val as 'write' | 'preview')}>
                  <TabsList className="bg-slate-100 dark:bg-[#242424] p-0.5 rounded-lg border border-slate-200 dark:border-[#303030]">
                    <TabsTrigger
                      value="write"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold data-[state=active]:bg-white dark:data-[state=active]:bg-[#2e2e2e] data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm"
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Write</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="preview"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold data-[state=active]:bg-white dark:data-[state=active]:bg-[#2e2e2e] data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Preview</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
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
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between">
                <span>User Story (Optional)</span>
                <span className="text-[10px] font-normal text-slate-400">As a... I want... So that...</span>
              </label>
              <input
                type="text"
                value={userStory}
                onChange={(e) => setUserStory(e.target.value)}
                placeholder="As a rider, I want to see real-time drivers so I can book immediately."
                className="w-full px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
              />
            </div>

            {/* Acceptance Criteria */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
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

              <div className="space-y-1.5">
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
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] focus:border-transparent transition-all"
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
              {/* 1. TOP HEADER: Connected Repos Pill + Engine/Model/Effort Pill */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1b1c26] gap-2">
                {/* Left Pill: Connected Hub Repos Popover */}
                <Popover open={projectsPopoverOpen} onOpenChange={setProjectsPopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#14151e] hover:bg-slate-100 dark:hover:bg-[#20212d] text-slate-800 dark:text-slate-100 transition-colors shadow-2xs max-w-[210px] cursor-pointer"
                      title="Connected Repositories"
                    >
                      <FolderGit2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span className="truncate">
                        {projects.length > 0 ? `Repos: ${projects.map((p) => p.name).join(', ')}` : 'Workspace Repos'}
                      </span>
                      <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 ml-0.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-2 space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Connected Hub Repos ({projects.length})
                      </span>
                    </div>
                    <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5">
                      {projects.length === 0 ? (
                        <div className="text-center py-4 text-xs text-slate-400">No repos registered.</div>
                      ) : (
                        projects.map((p) => (
                          <div
                            key={p.name}
                            className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-[#20212d] text-slate-700 dark:text-slate-200"
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-2">
                              <FolderGit2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                              <span className="font-semibold truncate text-[11px]">{p.name}</span>
                              <span className="text-[9px] px-1 py-0.2 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono uppercase font-bold">
                                {p.kind}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">
                              {p.base_branch || 'develop'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </PopoverContent>
                </Popover>

                {/* Right Pill: Engine / Model / Effort Config Popover */}
                <Popover open={isEngineOpen} onOpenChange={setIsEngineOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#14151e] hover:bg-slate-100 dark:hover:bg-[#20212d] text-slate-800 dark:text-slate-200 transition-colors shadow-2xs truncate cursor-pointer"
                      title="AI Engine & Model Configuration"
                    >
                      <Zap className="w-3 h-3 text-indigo-500 shrink-0" />
                      <span className="truncate max-w-[120px]">
                        {currentAiProviderName.split(' ')[0]} · {currentAiModelName.split(' ')[0]}
                      </span>
                      <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-76 p-2.5 space-y-3">
                    {/* Section 1: AI Engine */}
                    <div>
                      <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">
                        <Cpu className="w-3 h-3 text-purple-500" />
                        AI Engine
                      </div>
                      <div className="space-y-0.5">
                        {PROVIDER_OPTIONS.filter((p) => {
                          if (p.id === 'auto') return true;
                          const enabledList = settingsData?.ai_cli?.enabledEngines;
                          if (!enabledList || enabledList.length === 0) return true;
                          return enabledList.includes(p.id as any);
                        }).map((opt) => {
                          const isSelected = selectedAiProvider === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => handleAiProviderChange(opt.id)}
                              className={`w-full flex items-start justify-between p-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-900 dark:text-purple-200 font-medium'
                                  : 'hover:bg-slate-100 dark:hover:bg-[#20212d] text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <div className="min-w-0 pr-1">
                                <div className="flex items-center gap-1">
                                  <span className="truncate">{opt.name}</span>
                                  {opt.badge && (
                                    <span className="px-1 py-0.2 text-[8px] font-mono rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300">
                                      {opt.badge}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-400 font-normal">{opt.desc}</div>
                              </div>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Section 2: Model Preset */}
                    <div className="border-t border-slate-100 dark:border-[#2d2f3d] pt-2">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">
                        <Layers className="w-3 h-3 text-indigo-500" />
                        Model Preset ({selectedAiProvider})
                      </div>
                      <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5">
                        {availableAiModels.map((m) => {
                          const isSelected = selectedAiModel === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setSelectedAiModel(m.id)}
                              className={`w-full flex items-start justify-between p-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-900 dark:text-indigo-200 font-medium'
                                  : 'hover:bg-slate-100 dark:hover:bg-[#20212d] text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              <div className="min-w-0 pr-1">
                                <div className="font-mono text-[11px] truncate">{m.name}</div>
                                {m.desc && <div className="text-[9px] text-slate-400 leading-tight">{m.desc}</div>}
                              </div>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Section 3: Reasoning Effort */}
                    <div className="border-t border-slate-100 dark:border-[#2d2f3d] pt-2">
                      <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 px-1">
                        <Gauge className="w-3 h-3 text-emerald-500" />
                        Reasoning Effort
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {EFFORT_OPTIONS.map((eff) => {
                          const isSelected = selectedEffort === eff.id;
                          return (
                            <button
                              key={eff.id}
                              type="button"
                              onClick={() => setSelectedEffort(eff.id)}
                              className={`py-1 text-center rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-2xs'
                                  : 'bg-slate-100 dark:bg-[#20212d] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#282a39]'
                              }`}
                              title={eff.desc}
                            >
                              {eff.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* 2. HEADER ACTION ROW: AI Tools */}
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-200 dark:border-[#2d2f3d] bg-slate-50/80 dark:bg-[#181923] overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 shrink-0 mr-1">
                  <Wand2 className="w-3 h-3 text-indigo-500" />
                  Tools
                </div>

                <button
                  type="button"
                  onClick={handleSummarizeTool}
                  disabled={isChatSending}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1e1f2b] text-slate-700 dark:text-slate-200 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all text-xs font-medium shrink-0 disabled:opacity-50 shadow-2xs cursor-pointer"
                  title="Summarize page architecture, technical stack and key takeaways"
                >
                  <Search className="w-3 h-3 text-blue-500 shrink-0" />
                  <span>Summarize</span>
                </button>

                <button
                  type="button"
                  onClick={handleExtractSpecTool}
                  disabled={isChatSending}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1e1f2b] text-slate-700 dark:text-slate-200 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-400 transition-all text-xs font-medium shrink-0 disabled:opacity-50 shadow-2xs cursor-pointer"
                  title="Extract actionable development requirement specification"
                >
                  <FileText className="w-3 h-3 text-purple-500 shrink-0" />
                  <span>Extract Spec</span>
                </button>

                <button
                  type="button"
                  onClick={handleInspectTool}
                  disabled={isChatSending}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1e1f2b] text-slate-700 dark:text-slate-200 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all text-xs font-medium shrink-0 disabled:opacity-50 shadow-2xs cursor-pointer"
                  title="Inspect APIs, contracts, code snippets and technical details"
                >
                  <Code2 className="w-3 h-3 text-emerald-500 shrink-0" />
                  <span>Inspect APIs</span>
                </button>

                <button
                  type="button"
                  onClick={handleAskSpecTool}
                  disabled={isChatSending}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1e1f2b] text-slate-700 dark:text-slate-200 hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400 transition-all text-xs font-medium shrink-0 disabled:opacity-50 shadow-2xs cursor-pointer"
                  title="Ask Architect questions"
                >
                  <MessageSquare className="w-3 h-3 text-amber-500 shrink-0" />
                  <span>Ask Architect</span>
                </button>
              </div>

              {/* 3. MESSAGES SCROLL AREA */}
              <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      {msg.role === 'user' ? (
                        <>
                          <span className="text-[10px] text-slate-400 font-medium">You</span>
                          <div className="p-1 rounded-full bg-slate-200 dark:bg-[#2d2f3d] text-slate-600 dark:text-slate-300">
                            <User className="w-2.5 h-2.5" />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="p-1 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                            <Bot className="w-2.5 h-2.5" />
                          </div>
                          <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                            AI Assistant
                          </span>
                        </>
                      )}
                    </div>

                    <div
                      className={`max-w-[94%] rounded-2xl p-3 text-xs shadow-xs ${
                        msg.role === 'user'
                          ? 'bg-indigo-600 text-white rounded-tr-xs'
                          : 'bg-white dark:bg-[#1c1d29] border border-slate-200 dark:border-[#2d2f3d] text-slate-800 dark:text-slate-100 rounded-tl-xs'
                      }`}
                    >
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {msg.attachments.map((att, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/20 text-white text-[10px] font-mono"
                            >
                              <FileText className="w-2.5 h-2.5" />
                              <span className="truncate max-w-[120px]">{att.name}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <MarkdownMessage content={msg.content?.trim() || '*(No response recorded)*'} />

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
                            className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#6366f1] hover:from-[#6c5ce7] hover:to-[#4f46e5] text-white font-bold text-xs shadow transition-all active:scale-[0.98] cursor-pointer"
                          >
                            <Wand2 className="w-3.5 h-3.5" />
                            <span>Transfer to Requirement Form</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Action buttons on Assistant responses */}
                      {msg.role === 'assistant' && msg.id !== 'welcome' && (
                        <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-[#2d2f3d] flex items-center justify-between text-[11px]">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(msg.content);
                              toast.success('Copied to clipboard');
                            }}
                            className="flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                            Copy
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCreateRequirementFromMessage(msg)}
                            className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-medium transition-colors cursor-pointer"
                          >
                            <PlusCircle className="w-3 h-3" />
                            Create Requirement
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isChatSending && (
                  <div className="flex flex-col items-start">
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <div className="p-1 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 animate-pulse">
                        <Bot className="w-2.5 h-2.5" />
                      </div>
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">
                        AI is thinking...
                      </span>
                    </div>
                    <div className="p-3 rounded-2xl rounded-tl-xs bg-white dark:bg-[#1c1d29] border border-slate-200 dark:border-[#2d2f3d] flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Generating response...
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. ATTACHED FILES PREVIEW TRAY */}
              {chatAttachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-[#161722] border-t border-slate-200 dark:border-[#2d2f3d]">
                  {chatAttachedFiles.map((att, idx) => {
                    const isImg =
                      att.type?.startsWith('image/') ||
                      att.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
                    return (
                      <div
                        key={att.id || idx}
                        className="flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-lg border border-purple-200 dark:border-purple-800/50 bg-white dark:bg-[#1e1f2b] text-purple-900 dark:text-purple-200 text-xs shadow-2xs"
                      >
                        {isImg && att.data_url ? (
                          <img
                            src={att.data_url}
                            alt={att.name}
                            className="w-4 h-4 object-cover rounded shrink-0"
                          />
                        ) : (
                          <FileText className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />
                        )}
                        <span className="font-medium truncate max-w-[130px] text-[10px]" title={att.name}>
                          {att.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeChatAttachedFile(idx)}
                          className="p-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-600 dark:text-purple-300 cursor-pointer"
                          title="Remove attachment"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 5. MESSAGE INPUT BOX */}
              <div className="relative p-2.5 border-t border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1b1c26]">
                {/* Floating Mention Autocomplete Popup (@ Shared Assets) */}
                {showMentionMenu && (
                  <div className="absolute bottom-full left-2 right-2 mb-1.5 max-h-56 overflow-y-auto rounded-xl border border-purple-200 dark:border-purple-800/60 bg-white dark:bg-[#1f202b] shadow-xl z-50 p-1.5">
                    <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between border-b border-slate-100 dark:border-[#2a2b38] mb-1">
                      <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400 font-bold">
                        <AtSign className="w-3 h-3" />
                        Shared Workspace Assets
                      </span>
                      <span className="text-[9px] text-purple-500 font-mono">
                        {filteredMentionAssets.length} found
                      </span>
                    </div>
                    {filteredMentionAssets.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-400">
                        {sharedAssets.length === 0
                          ? 'No files in Shared Workspace Assets yet'
                          : 'No matching files'}
                      </div>
                    ) : (
                      filteredMentionAssets.map((asset, idx) => {
                        const isSelected = idx === mentionSelectedIndex;
                        const isImg =
                          asset.type?.startsWith('image/') ||
                          asset.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectMentionAsset(asset);
                            }}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                            }`}
                          >
                            {isImg && asset.data_url ? (
                              <img
                                src={asset.data_url}
                                alt={asset.name}
                                className="w-4 h-4 object-cover rounded shrink-0"
                              />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold truncate text-[11px]">{asset.name}</div>
                              <div className="text-[9px] text-slate-400 truncate">
                                {asset.size ? `${Math.round(asset.size / 1024)} KB · ` : ''}
                                {asset.notes || 'Shared Asset'}
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Floating Autocomplete Popup (# or / for Projects, Tickets, Commands) */}
                {showHashSlashMenu && (
                  <div className="absolute bottom-full left-2 right-2 mb-1.5 max-h-60 overflow-y-auto rounded-xl border border-purple-200 dark:border-purple-800/60 bg-white dark:bg-[#1f202b] shadow-2xl z-50 p-1.5 scrollbar-thin">
                    <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between border-b border-slate-100 dark:border-[#2a2b38] mb-1">
                      <span className="flex items-center gap-1.5 text-purple-600 dark:text-purple-400 font-bold">
                        {hashSlashTrigger === '#' ? (
                          <Hash className="w-3 h-3" />
                        ) : (
                          <span className="font-mono text-xs font-black">/</span>
                        )}
                        {hashSlashTrigger === '#' ? 'Mention Projects & Tickets' : 'Mention Projects & Commands'}
                      </span>
                      <span className="text-[9px] text-purple-500 font-mono">
                        {filteredMentionProjects.length} proj{hashSlashTrigger === '#' ? ` · ${filteredMentionRequirements.length} tickets` : ''}
                      </span>
                    </div>

                    {activeMentionMenuItems.length === 0 ? (
                      <div className="p-3 text-center text-xs text-slate-400">
                        {hashSlashQuery
                          ? `No matching items for "${hashSlashQuery}"`
                          : 'No items found'}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {/* Projects Section */}
                        {filteredMentionProjects.length > 0 && (
                          <div>
                            <div className="px-2 py-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              <FolderGit2 className="w-2.5 h-2.5 text-purple-500" />
                              Projects
                            </div>
                            {filteredMentionProjects.map((proj) => {
                              const itemIdx = activeMentionMenuItems.findIndex(
                                (it) => it.type === 'project' && it.project?.name === proj.name
                              );
                              const isSelected = itemIdx === hashSlashSelectedIndex;
                              return (
                                <button
                                  key={`proj-${proj.name}`}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    selectMentionProject(proj);
                                  }}
                                  onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 ring-1 ring-purple-400/40'
                                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                                  }`}
                                >
                                  <FolderGit2 className="w-3 h-3 text-purple-500 shrink-0" />
                                  <span className="px-1 py-0.2 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono text-[9px] font-bold shrink-0">
                                    #{proj.name}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <span className="font-semibold truncate text-[11px] block">{proj.name}</span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Requirements / Tickets Section (when triggered by #) */}
                        {hashSlashTrigger === '#' && filteredMentionRequirements.length > 0 && (
                          <div className="pt-1 border-t border-slate-100 dark:border-[#2a2b38]/60">
                            <div className="px-2 py-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              <CheckSquare className="w-2.5 h-2.5 text-purple-500" />
                              Workspace Tickets
                            </div>
                            {filteredMentionRequirements.map((req) => {
                              const itemIdx = activeMentionMenuItems.findIndex(
                                (it) => it.type === 'ticket' && it.ticket?.id === req.id
                              );
                              const isSelected = itemIdx === hashSlashSelectedIndex;
                              return (
                                <button
                                  key={`ticket-${req.id}`}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    selectMentionTicket(req);
                                  }}
                                  onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 ring-1 ring-purple-400/40'
                                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                                  }`}
                                >
                                  <span className="px-1 py-0.2 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono text-[9px] font-bold shrink-0">
                                    #{req.id}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold truncate text-[11px]">{req.title}</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Commands Section (when triggered by /) */}
                        {hashSlashTrigger === '/' && availableMentionCommands.length > 0 && (
                          <div className="pt-1 border-t border-slate-100 dark:border-[#2a2b38]/60">
                            <div className="px-2 py-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                              <Terminal className="w-2.5 h-2.5 text-purple-500" />
                              Commands
                            </div>
                            {availableMentionCommands.map((cmd) => {
                              const itemIdx = activeMentionMenuItems.findIndex(
                                (it) => it.type === 'command' && it.command?.id === cmd.id
                              );
                              const isSelected = itemIdx === hashSlashSelectedIndex;
                              return (
                                <button
                                  key={`cmd-${cmd.id}`}
                                  type="button"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    selectMentionCommand(cmd);
                                  }}
                                  onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                                  className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                                    isSelected
                                      ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 ring-1 ring-purple-400/40'
                                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                                  }`}
                                >
                                  <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono text-[10px] font-bold shrink-0">
                                    {cmd.command}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <div className="font-semibold truncate text-[11px]">{cmd.title}</div>
                                    <div className="text-[9px] text-slate-400 truncate">{cmd.description}</div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="relative">
                  <textarea
                    ref={chatTextareaRef}
                    rows={2}
                    value={chatInput}
                    onChange={handleChatInputChange}
                    onKeyDown={handleChatInputKeyDown}
                    onPaste={handleChatPaste}
                    placeholder="Type @ for assets, # for projects/tickets, / for commands..."
                    disabled={isChatSending}
                    className="w-full resize-none p-2.5 pr-16 text-xs rounded-xl bg-slate-50 dark:bg-[#14151e] border border-slate-200 dark:border-[#2d2f3d] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition-all"
                  />

                  <input
                    type="file"
                    ref={chatFileInputRef}
                    className="hidden"
                    multiple
                    onChange={handleChatFileUpload}
                  />

                  <div className="absolute right-2 bottom-2.5 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => chatFileInputRef.current?.click()}
                      disabled={isChatSending}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#222432] transition-colors cursor-pointer"
                      title="Attach File"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSendChatMessage()}
                      disabled={(!chatInput.trim() && chatAttachedFiles.length === 0) || isChatSending}
                      className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 transition-colors shadow-2xs cursor-pointer"
                      title="Send Message"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                  <span>Enter to send · Shift+Enter for newline</span>
                  {chatMessages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setChatMessages([]);
                        setChatAttachedFiles([]);
                        toast.success('Chat history cleared');
                      }}
                      className="flex items-center gap-1 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear Chat
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Sticky Bottom Actions */}
          <div className="px-6 py-3 border-t border-slate-200 dark:border-[#2d2d2d] bg-slate-50/80 dark:bg-[#1e1e1e]/80 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={triggerCancel}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-[#303030] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#2a2a2a] transition-all cursor-pointer"
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
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-purple-200 dark:border-purple-900/50 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{isEditMode ? 'Save Changes' : `Save State (${status === 'draft' ? 'ToDo' : status})`}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSubmit(true)}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-[#7b68ee] to-[#ec4899] hover:from-[#6c5ce7] hover:to-[#db2777] text-white text-xs font-bold shadow-md shadow-purple-500/25 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <span>Dispatching...</span>
                  ) : (
                    <>
                      <span>{isEditMode ? 'Save & Fan-Out' : 'Create & Fan-Out'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            )}

          </div>
        </SheetContent>

        {/* Radix UI Cancel Confirmation Dialog */}
        <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-2">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <DialogTitle>{isEditMode ? 'Discard Changes?' : 'Discard Requirement Draft?'}</DialogTitle>
              <DialogDescription>
                {isEditMode
                  ? 'You have unsaved changes to this requirement. Are you sure you want to discard your edits and close the sheet?'
                  : 'You have unsaved changes in this requirement form. Are you sure you want to discard your draft and close the sheet?'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-2 pt-3">
              <button
                type="button"
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#20212b] text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937] transition-colors cursor-pointer"
              >
                Continue Editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCancelConfirm(false);
                  handleClose();
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                Discard &amp; Close
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Sheet>
    );
}

export const RequirementFormSheet = CreateRequirementSheet;

