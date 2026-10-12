import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  Bot,
  User,
  Send,
  Plus,
  Trash2,
  Search,
  FolderGit2,
  Terminal,
  Cpu,
  MessageSquare,
  Clock,
  ShieldCheck,
  Paperclip,
  FileText,
  FileCode,
  AtSign,
  X,
  ExternalLink,
  ChevronDown,
  Check,
  Hash,
  Edit2,
  PanelRight,
  Loader2,
  Layers,
  CheckSquare,
  Download,
  Reply,
  Copy,
  Info,
  EyeOff,
  Eye,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import {
  fetchAiChatSessions,
  createAiChatSession,
  fetchAiChatSession,
  updateAiChatSession,
  deleteAiChatSession,
  sendAiSessionMessage,
  createRequirementFromSession,
  fetchProjects,
  fetchSettings,
  fetchAssets,
  fetchRequirements,
} from '../lib/api.js';
import {
  AiChatSession,
  AiChatMessage,
  ReasoningEffort,
  ChatAttachmentItem,
  SharedAsset,
  Requirement,
  Project,
} from '@sp-kickstack/shared';
import { MarkdownMessage, renderInlineMarkdown } from '../components/MarkdownMessage.js';
import { RequirementDetailSheet } from '../components/RequirementDetailSheet.js';
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog.js';

interface ProviderOption {
  id: string;
  name: string;
  desc: string;
}

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

const EFFORT_OPTIONS: Array<{ id: ReasoningEffort; name: string; desc: string }> = [
  { id: 'low', name: 'Low', desc: 'Fast answers, minimal thinking' },
  { id: 'medium', name: 'Medium', desc: 'Balanced speed and depth' },
  { id: 'high', name: 'High', desc: 'Deep architectural reasoning' },
  { id: 'max', name: 'Max', desc: 'Maximum reasoning effort' },
];

export function AiChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSessionParam = searchParams.get('tab') || searchParams.get('session');
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(urlSessionParam || null);
  const [sessionSearch, setSessionSearch] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachmentItem[]>([]);

  const handleSelectSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', sessionId);
        next.set('session', sessionId);
        return next;
      },
      { replace: false }
    );
  };

  // Mentions (@ assets) state
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  // Mention Projects & Tickets/Commands (# and / triggers) state
  const [showHashSlashMenu, setShowHashSlashMenu] = useState(false);
  const [hashSlashTrigger, setHashSlashTrigger] = useState<'#' | '/'>('#');
  const [hashSlashQuery, setHashSlashQuery] = useState('');
  const [hashSlashSelectedIndex, setHashSlashSelectedIndex] = useState(0);

  // Inline title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleText, setEditingTitleText] = useState('');

  // Right sidebar inspector drawer (tickets created + attachments)
  const [showInspector, setShowInspector] = useState(false);
  const [showQuickStarters, setShowQuickStarters] = useState(true);
  const [sessionToDelete, setSessionToDelete] = useState<AiChatSession | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<AiChatMessage | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [isSynthesizingTicket, setIsSynthesizingTicket] = useState(false);

  // Radix popovers open states
  const [isEngineOpen, setIsEngineOpen] = useState(false);
  const [isModelOpen, setIsModelOpen] = useState(false);
  const [isEffortOpen, setIsEffortOpen] = useState(false);

  // Multi-chat parallel in-progress state: session ID -> boolean
  const [inProgressSessions, setInProgressSessions] = useState<Record<string, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // 1. Fetch settings
  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 30000,
  });

  const configuredDefaultProvider = appSettings?.ai_cli?.defaultProvider || 'auto';

  const getModelForProvider = (provider: string): string => {
    if (provider === 'claude-cli') return appSettings?.ai_cli?.claude?.model || 'sonnet';
    if (provider === 'agy-cli') return appSettings?.ai_cli?.agy?.model || 'gemini-3.8-flash';
    if (provider === 'codex-cli') return appSettings?.ai_cli?.codex?.model || 'default';
    if (provider === 'ollama') return appSettings?.ai_cli?.ollama?.model || 'default';
    return 'default';
  };

  const getEffortForProvider = (provider: string): ReasoningEffort => {
    if (provider === 'claude-cli') return appSettings?.ai_cli?.claude?.effort || 'medium';
    if (provider === 'agy-cli') return appSettings?.ai_cli?.agy?.effort || 'medium';
    if (provider === 'codex-cli') return appSettings?.ai_cli?.codex?.effort || 'medium';
    return 'medium';
  };

  const [selectedProvider, setSelectedProvider] = useState<string>('auto');
  const [selectedModel, setSelectedModel] = useState<string>('default');
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort>('medium');

  // 2. Fetch Projects for the workspace
  const { data: projects = [] } = useQuery({
    queryKey: ['projects', activeWorkspaceId],
    queryFn: () => fetchProjects(activeWorkspaceId),
    staleTime: 30000,
  });

  // 3. Fetch Shared Workspace Assets
  const { data: assetsData } = useQuery({
    queryKey: ['assets', activeWorkspaceId],
    queryFn: () => fetchAssets(activeWorkspaceId),
    staleTime: 15000,
  });
  const sharedAssets = assetsData?.shared_assets || [];

  const filteredAssets = sharedAssets.filter((a) =>
    mentionQuery ? a.name.toLowerCase().includes(mentionQuery.toLowerCase()) : true
  );

  // 4. Fetch Workspace Requirements for "#" ticket mentions
  const { data: allRequirements = [] } = useQuery({
    queryKey: ['requirements', activeWorkspaceId],
    queryFn: () => fetchRequirements(activeWorkspaceId),
    staleTime: 15000,
  });

  // Filtered projects for mention menu (# or /)
  const filteredProjects = useMemo(() => {
    if (!hashSlashQuery) return projects;
    const q = hashSlashQuery.toLowerCase();
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.kind.toLowerCase().includes(q) ||
        (p.repo_path && p.repo_path.toLowerCase().includes(q))
    );
  }, [projects, hashSlashQuery]);

  // Filtered requirements when triggered by #
  const filteredRequirements = useMemo(() => {
    if (hashSlashTrigger !== '#') return [];
    if (!hashSlashQuery) return allRequirements;
    const q = hashSlashQuery.toLowerCase();
    return allRequirements.filter(
      (r) => r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)
    );
  }, [allRequirements, hashSlashQuery, hashSlashTrigger]);

  // Available slash commands when triggered by /
  const availableCommands = useMemo(() => {
    if (hashSlashTrigger !== '/') return [];
    const commands = [
      {
        id: 'create',
        command: '/create',
        title: 'Synthesize & Create Requirements',
        description: 'Auto-partition tasks from chat spec into workspace tickets',
      },
    ];
    if (!hashSlashQuery) return commands;
    const q = hashSlashQuery.toLowerCase();
    return commands.filter(
      (c) =>
        c.command.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [hashSlashTrigger, hashSlashQuery]);

  // Unified items list for keyboard navigation
  const activeMenuItems = useMemo<
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

    // Projects first
    for (const proj of filteredProjects) {
      items.push({
        key: `proj-${proj.name}`,
        type: 'project',
        project: proj,
      });
    }

    // Requirements if triggered by #
    if (hashSlashTrigger === '#') {
      for (const req of filteredRequirements) {
        items.push({
          key: `ticket-${req.id}`,
          type: 'ticket',
          ticket: req,
        });
      }
    }

    // Commands if triggered by /
    if (hashSlashTrigger === '/') {
      for (const cmd of availableCommands) {
        items.push({
          key: `cmd-${cmd.id}`,
          type: 'command',
          command: cmd,
        });
      }
    }

    return items;
  }, [filteredProjects, filteredRequirements, availableCommands, hashSlashTrigger]);

  // 5. Fetch all chat sessions for active workspace
  const {
    data: sessions = [],
    isLoading: isLoadingSessions,
  } = useQuery({
    queryKey: ['ai-chat-sessions', activeWorkspaceId],
    queryFn: () => fetchAiChatSessions(activeWorkspaceId),
  });

  // Automatically select the session from URL or first session, and sync with URL
  useEffect(() => {
    const sessionFromUrl = searchParams.get('tab') || searchParams.get('session');
    if (sessions.length > 0) {
      if (sessionFromUrl && sessions.some((s) => s.id === sessionFromUrl)) {
        if (sessionFromUrl !== activeSessionId) {
          setActiveSessionId(sessionFromUrl);
        }
      } else if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
        const defaultId = sessions[0].id;
        setActiveSessionId(defaultId);
        if (!sessionFromUrl) {
          setSearchParams(
            (prev) => {
              const next = new URLSearchParams(prev);
              next.set('tab', defaultId);
              next.set('session', defaultId);
              return next;
            },
            { replace: true }
          );
        }
      }
    }
  }, [sessions, activeSessionId, searchParams, setSearchParams]);


  // 6. Fetch the active session with full message transcript
  const {
    data: activeSession,
    isLoading: isLoadingActiveSession,
  } = useQuery({
    queryKey: ['ai-chat-session', activeSessionId],
    queryFn: () => (activeSessionId ? fetchAiChatSession(activeSessionId) : null),
    enabled: Boolean(activeSessionId),
  });

  // 7. Fetch tickets created from the active session
  const { data: sessionTickets = [] } = useQuery({
    queryKey: ['requirements', activeWorkspaceId, activeSessionId],
    queryFn: () => (activeSessionId ? fetchRequirements(activeWorkspaceId, activeSessionId) : []),
    enabled: Boolean(activeSessionId),
  });

  // Synchronize local provider, model, and effort whenever activeSession changes
  useEffect(() => {
    if (activeSession) {
      const p = activeSession.provider || configuredDefaultProvider;
      setSelectedProvider(p);
      setSelectedModel(activeSession.model || getModelForProvider(p));
      setSelectedEffort(activeSession.effort || getEffortForProvider(p));
      setEditingTitleText(activeSession.title);
      setIsEditingTitle(false);
    } else if (!activeSessionId && appSettings) {
      setSelectedProvider(configuredDefaultProvider);
      setSelectedModel(getModelForProvider(configuredDefaultProvider));
      setSelectedEffort(getEffortForProvider(configuredDefaultProvider));
    }
  }, [activeSession?.id, activeSession?.provider, activeSession?.model, activeSession?.effort, configuredDefaultProvider]);

  // Collect all attachments in the active conversation thread
  const allSessionAttachments = useMemo(() => {
    const list: ChatAttachmentItem[] = [];
    activeSession?.messages?.forEach((m) => {
      if (m.attachments && m.attachments.length > 0) {
        list.push(...m.attachments);
      }
    });
    return list;
  }, [activeSession?.messages]);

  // Find the latest proposed spec in the conversation
  const latestSpec = [...(activeSession?.messages || [])]
    .reverse()
    .find((m) => m.suggested_spec)?.suggested_spec;

  // Auto-scroll chat to bottom
  const isActiveSessionRunning = Boolean(activeSessionId && inProgressSessions[activeSessionId]);
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [activeSession?.messages, isActiveSessionRunning]);

  // Create session mutation seeded with settings default engine and effort
  const createSessionMutation = useMutation({
    mutationFn: async (title?: string) => {
      const initialProvider = configuredDefaultProvider;
      const initialModel = getModelForProvider(initialProvider);
      const initialEffort = getEffortForProvider(initialProvider);
      return createAiChatSession({
        workspace_id: activeWorkspaceId,
        title: title || 'New Architecture Discussion',
        provider: initialProvider as any,
        model: initialModel,
        effort: initialEffort,
      });
    },
    onSuccess: (newSession) => {
      queryClient.setQueryData<AiChatSession[]>(
        ['ai-chat-sessions', activeWorkspaceId],
        (old = []) => [newSession, ...old]
      );
      handleSelectSession(newSession.id);
      setSelectedProvider(newSession.provider || configuredDefaultProvider);
      setSelectedModel(newSession.model || getModelForProvider(newSession.provider || configuredDefaultProvider));
      setSelectedEffort(newSession.effort || getEffortForProvider(newSession.provider || configuredDefaultProvider));
      toast.success('New chat session started with settings default engine');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create chat session');
    },
  });

  // Update session settings mutation
  const updateSessionMutation = useMutation({
    mutationFn: async (patch: { provider?: any; model?: string; effort?: ReasoningEffort; title?: string }) => {
      if (!activeSessionId) return null;
      return updateAiChatSession(activeSessionId, patch);
    },
    onSuccess: (updated) => {
      if (!updated) return;
      queryClient.setQueryData<AiChatSession>(
        ['ai-chat-session', updated.id],
        (old) => (old ? { ...old, provider: updated.provider, model: updated.model, effort: updated.effort, title: updated.title } : updated)
      );
      queryClient.setQueryData<AiChatSession[]>(
        ['ai-chat-sessions', activeWorkspaceId],
        (old = []) => old.map((s) => (s.id === updated.id ? { ...s, provider: updated.provider, model: updated.model, effort: updated.effort, title: updated.title } : s))
      );
      setIsEditingTitle(false);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to update chat session');
    },
  });

  const handleProviderChange = (newProvider: string) => {
    setSelectedProvider(newProvider);
    const newModel = getModelForProvider(newProvider);
    setSelectedModel(newModel);
    if (activeSessionId) {
      updateSessionMutation.mutate({ provider: newProvider as any, model: newModel });
    }
  };

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    if (activeSessionId) {
      updateSessionMutation.mutate({ model: newModel });
    }
  };

  const handleEffortChange = (newEffort: ReasoningEffort) => {
    setSelectedEffort(newEffort);
    if (activeSessionId) {
      updateSessionMutation.mutate({ effort: newEffort });
    }
  };

  const handleSaveTitle = () => {
    const trimmed = editingTitleText.trim();
    if (trimmed && trimmed !== activeSession?.title) {
      updateSessionMutation.mutate({ title: trimmed });
    } else {
      setIsEditingTitle(false);
    }
  };

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      return deleteAiChatSession(sessionId);
    },
    onSuccess: (_data, deletedId) => {
      queryClient.setQueryData<AiChatSession[]>(
        ['ai-chat-sessions', activeWorkspaceId],
        (old = []) => old.filter((s) => s.id !== deletedId)
      );
      if (activeSessionId === deletedId) {
        const remaining = sessions.filter((s) => s.id !== deletedId);
        const nextId = remaining.length > 0 ? remaining[0].id : null;
        setActiveSessionId(nextId);
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            if (nextId) {
              next.set('tab', nextId);
              next.set('session', nextId);
            } else {
              next.delete('tab');
              next.delete('session');
            }
            return next;
          },
          { replace: true }
        );
      }

      toast.success('Chat session deleted');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to delete chat session');
    },
  });

  // Request AI to synthesize full conversation context and create requirement ticket
  const handleSynthesizeRequirement = async (extraInstructions?: string) => {
    if (!activeSessionId) {
      toast.error('No active chat session to create requirement from.');
      return;
    }

    if (inProgressSessions[activeSessionId] || isSynthesizingTicket) {
      toast.warning('AI is already processing a response for this session.');
      return;
    }

    setIsSynthesizingTicket(true);
    setInProgressSessions((prev) => ({ ...prev, [activeSessionId]: true }));
    const loadingToastId = toast.loading('Synthesizing full discussion context with AI into requirement ticket...');

    try {
      const result = await createRequirementFromSession(activeSessionId, extraInstructions);
      queryClient.setQueryData(['ai-chat-session', activeSessionId], result.session);
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions', activeWorkspaceId] });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });

      toast.dismiss(loadingToastId);
      toast.success(
        `🎯 Ticket #${result.requirement.id} "${result.requirement.title}" created with full context!`,
        {
          action: {
            label: 'Open Info',
            onClick: () => setSelectedTicketId(result.requirement.id),
          },
        }
      );
      // Auto-open inspector to display the newly created ticket
      setShowInspector(true);
    } catch (err: any) {
      toast.dismiss(loadingToastId);
      toast.error(err.message || 'Failed to synthesize requirement from chat discussion');
    } finally {
      setIsSynthesizingTicket(false);
      setInProgressSessions((prev) => ({ ...prev, [activeSessionId]: false }));
    }
  };

  // File attachment handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
        setAttachedFiles((prev) => [...prev, newItem]);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Clipboard Paste Support (Images & Files)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
            setAttachedFiles((prev) => [...prev, newItem]);
            toast.success(`Pasted image from clipboard (${Math.round(file.size / 1024)} KB)`);
          };
          reader.readAsDataURL(file);
        }
      }
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const selectMentionAsset = (asset: SharedAsset) => {
    const alreadyAttached = attachedFiles.some(
      (f) => (f.asset_id && f.asset_id === asset.id) || f.name === asset.name
    );
    if (!alreadyAttached) {
      setAttachedFiles((prev) => [
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
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const selectProject = (proj: Project) => {
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
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const selectRequirementTicket = (req: Requirement) => {
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
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const selectCommand = (cmd: { command: string }) => {
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
    if (textareaRef.current) {
      textareaRef.current.focus();
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

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Navigate @ asset menu
    if (showMentionMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredAssets.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionSelectedIndex((prev) => (prev - 1 + filteredAssets.length) % Math.max(1, filteredAssets.length));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredAssets.length > 0) {
          e.preventDefault();
          selectMentionAsset(filteredAssets[mentionSelectedIndex]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionMenu(false);
        return;
      }
    }

    // Navigate # or / (projects, tickets, commands) menu
    if (showHashSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHashSlashSelectedIndex((prev) => (prev + 1) % Math.max(1, activeMenuItems.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHashSlashSelectedIndex(
          (prev) => (prev - 1 + activeMenuItems.length) % Math.max(1, activeMenuItems.length)
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (activeMenuItems.length > 0) {
          e.preventDefault();
          const item = activeMenuItems[hashSlashSelectedIndex];
          if (item) {
            if (item.type === 'project' && item.project) {
              selectProject(item.project);
              return;
            }
            if (item.type === 'ticket' && item.ticket) {
              selectRequirementTicket(item.ticket);
              return;
            }
            if (item.type === 'command' && item.command) {
              selectCommand(item.command);
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
      handleSendMessage();
    }
  };

  // Send message handler (supports /create command, attachments, and parallel multi-chat)
  const handleSendMessage = async (textToSend?: string) => {
    const rawContent = (textToSend || chatInput).trim();
    if (!rawContent && attachedFiles.length === 0) return;

    let targetSessionId = activeSessionId;

    // Check for slash command /create
    if (
      rawContent.toLowerCase().startsWith('/create') ||
      rawContent.toLowerCase() === 'create requirement' ||
      rawContent.toLowerCase() === 'dispatch requirement'
    ) {
      setChatInput('');
      const extraInstructions = rawContent.toLowerCase().startsWith('/create')
        ? rawContent.slice(7).trim()
        : undefined;
      await handleSynthesizeRequirement(extraInstructions || undefined);
      return;
    }

    // If no active session, create one seeded from settings
    if (!targetSessionId) {
      try {
        const titleSeed = rawContent || attachedFiles[0]?.name || 'Architecture Discussion';
        const newSession = await createSessionMutation.mutateAsync(
          titleSeed.length > 35 ? titleSeed.slice(0, 32) + '...' : titleSeed
        );
        targetSessionId = newSession.id;
      } catch {
        return;
      }
    }

    if (inProgressSessions[targetSessionId]) {
      toast.warning('This chat session is already waiting for an AI response.');
      return;
    }

    const sendingFiles = [...attachedFiles];
    const sendingProvider = selectedProvider !== 'auto' ? selectedProvider : undefined;
    const sendingModel = selectedModel !== 'default' ? selectedModel : undefined;
    const sendingEffort = selectedEffort;

    // Build final content with reply quote if replying to a message
    let contentToSend = rawContent;
    if (replyingToMessage) {
      const quoteSnippet = replyingToMessage.content.replace(/\n+/g, ' ').trim().slice(0, 160);
      const speaker = replyingToMessage.role === 'assistant' ? 'AI Architect' : 'User';
      contentToSend = `> Replying to ${speaker}: "${quoteSnippet}..."\n\n${rawContent || '(Attached files)'}`;
      setReplyingToMessage(null);
    }

    setChatInput('');
    setAttachedFiles([]);
    setShowMentionMenu(false);
    setShowHashSlashMenu(false);

    // Set parallel in-progress indicator for this specific session
    setInProgressSessions((prev) => ({ ...prev, [targetSessionId]: true }));

    try {
      const response = await sendAiSessionMessage(targetSessionId, {
        content: contentToSend || '(Attached files)',
        attachments: sendingFiles.length > 0 ? sendingFiles : undefined,
        provider: sendingProvider as any,
        model: sendingModel,
        effort: sendingEffort,
      });

      // Update session in query cache
      queryClient.setQueryData(['ai-chat-session', targetSessionId], response.session);
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions', activeWorkspaceId] });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
      queryClient.invalidateQueries({ queryKey: ['session-requirements', targetSessionId] });

      if (response.suggested_spec) {
        toast.success('🎯 Architectural spec formulated! You can say "create ticket" or type /create.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send message to local AI');
      if (activeSessionId === targetSessionId) {
        setAttachedFiles(sendingFiles);
      }
    } finally {
      setInProgressSessions((prev) => ({ ...prev, [targetSessionId]: false }));
    }
  };

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(sessionSearch.toLowerCase())
  );

  const availableModels = useMemo(() => {
    const providerList = [...(MODEL_OPTIONS_MAP[selectedProvider] || [{ id: 'default', name: 'Default Model' }])];
    const configuredModel = getModelForProvider(selectedProvider);

    // Map through list and mark configured model
    const list = providerList.map((m) => {
      if (m.id === configuredModel) {
        return {
          ...m,
          isConfigured: true,
        };
      }
      return m;
    });

    // If configured model is custom or not in the preset list, add it at the top
    if (configuredModel && configuredModel !== 'default' && !list.some((m) => m.id === configuredModel)) {
      list.unshift({
        id: configuredModel,
        name: configuredModel,
        desc: 'Configured in Settings > AI CLI',
        isConfigured: true,
      });
    }

    return list;
  }, [selectedProvider, appSettings]);

  const currentProviderName = PROVIDER_OPTIONS.find((p) => p.id === selectedProvider)?.name || selectedProvider;
  const currentModelName = useMemo(() => {
    const found = availableModels.find((m) => m.id === selectedModel);
    if (found) {
      return found.name;
    }
    return selectedModel;
  }, [availableModels, selectedModel]);

  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-slate-50 dark:bg-[#14151a]">
      {/* LEFT: Multi-Chat Session Sidebar */}
      <aside className="w-72 border-r border-slate-200 dark:border-[#23242e] bg-white dark:bg-[#1a1b24] flex flex-col shrink-0">
        {/* Sidebar Header & + New Chat */}
        <div className="p-3 border-b border-slate-200 dark:border-[#23242e] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800 dark:text-slate-100">
              <MessageSquare className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span>Architect Threads</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 font-mono font-semibold">
              {sessions.length} chats
            </span>
          </div>

          <button
            type="button"
            onClick={() => createSessionMutation.mutate()}
            disabled={createSessionMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gradient-to-r from-[#7b68ee] to-[#6366f1] hover:from-[#6c5ce7] hover:to-[#4f46e5] text-white font-semibold text-xs shadow-sm transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>+ New Chat Session</span>
          </button>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="Search chat history..."
              className="w-full pl-8 pr-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#20212b] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* Sessions List with Multi-Chat In-Progress Indicators */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingSessions && sessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">Loading sessions...</div>
          ) : filteredSessions.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 space-y-2">
              <Bot className="w-6 h-6 mx-auto text-slate-300 dark:text-slate-600" />
              <p>No chat sessions found.</p>
              <button
                type="button"
                onClick={() => createSessionMutation.mutate()}
                className="text-purple-600 dark:text-purple-400 underline font-medium text-xs"
              >
                Start your first chat
              </button>
            </div>
          ) : (
            filteredSessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const isSessionRunning = Boolean(inProgressSessions[s.id]);
              const formattedDate = new Date(s.updated_at || s.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={s.id}
                  onClick={() => handleSelectSession(s.id)}
                  className={`group relative flex items-start justify-between p-2.5 rounded-xl cursor-pointer transition-all ${
                    isActive
                      ? 'bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 shadow-sm'
                      : 'hover:bg-slate-100 dark:hover:bg-[#22232e] border border-transparent'
                  }`}
                >
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`text-xs font-semibold truncate ${
                          isActive
                            ? 'text-purple-900 dark:text-purple-200'
                            : 'text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        {s.title}
                      </div>
                      {isSessionRunning && (
                        <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-purple-100 dark:bg-purple-900/60 text-[9px] font-semibold text-purple-600 dark:text-purple-300 animate-pulse">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          <span>running</span>
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400">
                      <Clock className="w-2.5 h-2.5 shrink-0" />
                      <span>{formattedDate}</span>
                      <span>·</span>
                      <span className="font-mono text-purple-600 dark:text-purple-400 font-semibold">{s.provider}</span>
                      {s.model && (
                        <>
                          <span>·</span>
                          <span className="font-mono text-[9px] truncate max-w-[70px]">{s.model}</span>
                        </>
                      )}
                      {s.effort && (
                        <>
                          <span>·</span>
                          <span className="text-slate-500 capitalize">{s.effort}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSessionToDelete(s);
                    }}
                    title="Delete session"
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar Footer: Session Continuity Notice */}
        <div className="p-3 border-t border-slate-200 dark:border-[#23242e] bg-slate-50/50 dark:bg-[#161720]/50 text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>Local execution maintains conversation memory across turns.</span>
        </div>
      </aside>

      {/* CENTER: Main Chat Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#1a1b24]">
        {/* Top Header Bar with Radix UI Popover Selectors & Editable Title */}
        <header className="px-5 py-3 border-b border-slate-200 dark:border-[#23242e] bg-white dark:bg-[#1e1f2b] flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#7b68ee] to-[#ec4899] flex items-center justify-center text-white shadow-md shadow-purple-500/20 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {isEditingTitle ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={editingTitleText}
                      onChange={(e) => setEditingTitleText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTitle();
                        if (e.key === 'Escape') setIsEditingTitle(false);
                      }}
                      onBlur={handleSaveTitle}
                      autoFocus
                      className="px-2 py-0.5 rounded-md border border-purple-400 bg-white dark:bg-[#20212b] text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                    <button
                      type="button"
                      onClick={handleSaveTitle}
                      className="text-[10px] px-2 py-0.5 rounded bg-purple-600 text-white font-medium hover:bg-purple-700"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingTitle(true);
                      setEditingTitleText(activeSession?.title || '');
                    }}
                    title="Click to edit session title"
                    className="group flex items-center gap-1.5 text-left text-sm font-bold text-slate-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 transition-colors truncate"
                  >
                    <span className="truncate">{activeSession?.title || 'Cross-Repo Requirement Co-Architect'}</span>
                    <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-70 text-slate-400 shrink-0" />
                  </button>
                )}

                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1 shrink-0">
                  <Terminal className="w-2.5 h-2.5" />
                  <span>0 API Keys · Local PC AI</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Workspace: <span className="font-semibold text-slate-700 dark:text-slate-300">{activeWorkspace?.name || activeWorkspaceId}</span> · Base branch: <span className="font-mono text-slate-600 dark:text-slate-400">{appSettings?.branch_merge?.default_base_branch || 'develop'}</span>
              </p>
            </div>
          </div>

          {/* Radix UI Controls for Engine, Model, Effort & Inspector Toggle */}
          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap w-full lg:w-auto flex-1 justify-between lg:justify-end">
            <div className="flex items-center gap-2 flex-wrap">
              {(latestSpec || (activeSession?.messages && activeSession.messages.length > 1)) && (
                <button
                  type="button"
                  onClick={() => handleSynthesizeRequirement()}
                  disabled={isActiveSessionRunning || isSynthesizingTicket}
                  className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl bg-gradient-to-r from-[#7b68ee] to-[#6366f1] hover:from-[#6c5ce7] hover:to-[#4f46e5] text-white font-bold text-xs shadow-sm transition-all active:scale-95 disabled:opacity-50"
                  title="Synthesize full discussion context into a requirement ticket"
                >
                  {isSynthesizingTicket ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>{isSynthesizingTicket ? 'Synthesizing...' : 'Create Requirement (/create)'}</span>
                  {latestSpec?.affected_projects && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20 font-mono">
                      {latestSpec.affected_projects.length} repos
                    </span>
                  )}
                </button>
              )}

              {/* 1. Radix Popover: Engine / Provider */}
              <Popover open={isEngineOpen} onOpenChange={setIsEngineOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#20212b] hover:bg-slate-100 dark:hover:bg-[#262836] text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all shadow-2xs"
                  >
                    <Cpu className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                    <span className="truncate max-w-[130px]">{currentProviderName}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-2 space-y-1">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Select AI Engine
                  </div>
                  {PROVIDER_OPTIONS.filter((p) => {
                    if (p.id === 'auto') return true;
                    const enabledList = appSettings?.ai_cli?.enabledEngines;
                    if (!enabledList || enabledList.length === 0) return true;
                    return enabledList.includes(p.id as any);
                  }).map((p) => {
                    const isSelected = selectedProvider === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          handleProviderChange(p.id);
                          setIsEngineOpen(false);
                        }}
                        className={`w-full flex items-start justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 font-semibold'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#252736]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate">{p.name}</div>
                          <div className="text-[10px] text-slate-400 font-normal">{p.desc}</div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>

              {/* 2. Radix Popover: Model */}
              <Popover open={isModelOpen} onOpenChange={setIsModelOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#20212b] hover:bg-slate-100 dark:hover:bg-[#262836] text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all shadow-2xs"
                  >
                    <Layers className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                    <span className="truncate max-w-[120px] font-mono text-[11px]">{currentModelName}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-2 space-y-1 max-h-[380px] overflow-y-auto">
                  <div className="flex items-center justify-between px-2 py-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Select Model ({selectedProvider})
                    </span>
                    <span className="text-[10px] text-purple-500 dark:text-purple-400 font-medium">
                      Settings Sync
                    </span>
                  </div>
                  {availableModels.map((m) => {
                    const isSelected = selectedModel === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          handleModelChange(m.id);
                          setIsModelOpen(false);
                        }}
                        className={`w-full flex items-start justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 font-semibold ring-1 ring-purple-500/40'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#252736]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-xs">{m.name}</span>
                            {m.isConfigured && (
                              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/30 font-medium">
                                Settings Default
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">{m.id}</div>
                          {m.desc && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-tight">
                              {m.desc}
                            </div>
                          )}
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>

              {/* 3. Radix Popover: Effort */}
              <Popover open={isEffortOpen} onOpenChange={setIsEffortOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#20212b] hover:bg-slate-100 dark:hover:bg-[#262836] text-xs font-semibold text-slate-800 dark:text-slate-200 transition-all shadow-2xs"
                  >
                    <span className="text-slate-400 font-normal">Effort:</span>
                    <span className="capitalize text-purple-600 dark:text-purple-400">{selectedEffort}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-2 space-y-1">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Reasoning Effort
                  </div>
                  {EFFORT_OPTIONS.map((eff) => {
                    const isSelected = selectedEffort === eff.id;
                    return (
                      <button
                        key={eff.id}
                        type="button"
                        onClick={() => {
                          handleEffortChange(eff.id);
                          setIsEffortOpen(false);
                        }}
                        className={`w-full flex items-start justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 font-semibold'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#252736]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="capitalize">{eff.name}</div>
                          <div className="text-[10px] text-slate-400 font-normal">{eff.desc}</div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            </div>

            {/* Right Slot: Subtle Divider & Inspector Button (Always aligned to far right) */}
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <div className="h-5 w-px bg-slate-200 dark:bg-[#2d2f3d] mx-0.5 shrink-0" />
              <button
                type="button"
                onClick={() => setShowInspector((prev) => !prev)}
                className={`relative p-2 rounded-xl border transition-all flex items-center justify-center shrink-0 shadow-2xs ${
                  showInspector
                    ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300 ring-2 ring-purple-500/20'
                    : 'border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#20212b] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                }`}
                title={showInspector ? 'Hide Session Inspector' : 'Show Session Inspector (Repos, Session ID, Tickets, Files)'}
                aria-label="Toggle Session Inspector"
              >
                <PanelRight className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                {(sessionTickets.length > 0 || allSessionAttachments.length > 0 || projects.length > 0) && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-purple-500 ring-2 ring-white dark:ring-[#20212b]" />
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Chat Messages Stream */}
        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#f8f9fc] dark:bg-[#14151e]"
        >
          {isLoadingActiveSession && !activeSession ? (
            <div className="flex items-center justify-center h-48 text-xs text-slate-400">
              Loading chat transcript...
            </div>
          ) : activeSession?.messages && activeSession.messages.length > 0 ? (
            activeSession.messages.map((msg) => {
              const isReplyQuote = msg.content.startsWith('> Replying to ');
              let quoteText = '';
              let actualContent = msg.content;
              if (isReplyQuote) {
                const doubleBreak = msg.content.indexOf('\n\n');
                if (doubleBreak !== -1) {
                  quoteText = msg.content.slice(0, doubleBreak).replace(/^>\s*/, '');
                  actualContent = msg.content.slice(doubleBreak + 2);
                }
              }

              return (
                <div
                  key={msg.id}
                  className={`group/msg relative flex gap-3 text-xs ${
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#7b68ee] to-[#6366f1] flex items-center justify-center text-white shrink-0 mt-0.5 shadow-sm">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div className="relative max-w-[78%]">
                    {/* Floating Quick Action Bar (Reply & Copy) on hover */}
                    <div
                      className={`absolute -top-3.5 ${
                        msg.role === 'user' ? 'left-2' : 'right-2'
                      } opacity-0 group-hover/msg:opacity-100 transition-opacity z-10 flex items-center gap-0.5 px-1 py-0.5 rounded-lg bg-white dark:bg-[#20212e] border border-slate-200 dark:border-[#333547] shadow-sm`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setReplyingToMessage(msg);
                          textareaRef.current?.focus();
                        }}
                        className="flex items-center gap-1 px-1.5 py-0.5 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-slate-100 dark:hover:bg-[#2b2d3e] text-slate-500 dark:text-slate-400 rounded transition-colors text-[10px] font-medium"
                        title="Reply to this message"
                      >
                        <Reply className="w-3 h-3 text-purple-500" />
                        <span>Reply</span>
                      </button>
                      <div className="h-2.5 w-px bg-slate-200 dark:bg-[#333547] my-auto" />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content);
                          toast.success('Message copied to clipboard');
                        }}
                        className="p-1 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-slate-100 dark:hover:bg-[#2b2d3e] text-slate-500 dark:text-slate-400 rounded transition-colors"
                        title="Copy message text"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>

                    <div
                      className={`rounded-2xl p-4 shadow-xs ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-r from-[#7b68ee] to-[#6366f1] text-white rounded-tr-xs'
                          : 'bg-white dark:bg-[#1e1f2b] text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-[#2d2f3d] rounded-tl-xs'
                      }`}
                    >
                      {/* Replying quote badge if present */}
                      {quoteText && (
                        <div
                          className={`mb-2.5 px-2.5 py-1.5 rounded-lg border text-[11px] leading-snug ${
                            msg.role === 'user'
                              ? 'bg-black/20 border-white/20 text-white/90'
                              : 'bg-purple-50/70 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/40 text-purple-900 dark:text-purple-300'
                          }`}
                        >
                          <div className="flex items-center gap-1 font-semibold text-[10px] uppercase tracking-wider opacity-80 mb-0.5">
                            <Reply className="w-3 h-3" />
                            <span>Replying to context</span>
                          </div>
                          <div className="italic line-clamp-2">
                            {quoteText}
                          </div>
                        </div>
                      )}

                      {msg.role === 'user' ? (
                        <div className="whitespace-pre-wrap font-sans text-xs leading-relaxed">
                          {renderInlineMarkdown(actualContent, (reqId) => setSelectedTicketId(reqId))}
                        </div>
                      ) : (
                        <div className="font-sans text-xs">
                          <MarkdownMessage
                            content={actualContent}
                            onSelectRequirement={(reqId) => setSelectedTicketId(reqId)}
                          />

                          {msg.suggested_spec && (
                            <div className="mt-2.5 flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-purple-200 dark:border-purple-800/50 bg-purple-50/80 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 font-semibold text-[11px]">
                              <div className="flex items-center gap-1.5">
                                <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                                <span>
                                  Architectural spec formulated ({msg.suggested_spec.affected_projects?.length || 1} repos)
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSynthesizeRequirement()}
                                disabled={isSynthesizingTicket}
                                className="px-2.5 py-1 rounded-md bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                              >
                                {isSynthesizingTicket ? 'Synthesizing...' : 'Create Ticket (/create)'}
                              </button>
                            </div>
                          )}

                          {/* Interactive Open Info buttons for any requirements mentioned in chat */}
                          {(() => {
                            const matches = Array.from(msg.content.matchAll(/#?(REQ-\d+)/gi)).map(m => m[1].toUpperCase());
                            const uniqueReqs = Array.from(new Set(matches));
                            if (uniqueReqs.length === 0) return null;
                            return (
                              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                {uniqueReqs.map((reqId) => (
                                  <button
                                    key={reqId}
                                    type="button"
                                    onClick={() => setSelectedTicketId(reqId)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/80 dark:hover:bg-purple-900/60 border border-purple-200 dark:border-purple-800/60 text-purple-800 dark:text-purple-300 font-bold text-[11px] transition-colors shadow-2xs cursor-pointer"
                                  >
                                    <Info className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                    <span>Open Form (#{reqId})</span>
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Render message attachments */}
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div
                          className={`mt-2.5 pt-2 border-t ${
                            msg.role === 'user'
                              ? 'border-white/20'
                              : 'border-slate-200 dark:border-[#2d2f3d]'
                          } flex flex-wrap gap-1.5`}
                        >
                          {msg.attachments.map((att, idx) => {
                            const isImg =
                              att.type?.startsWith('image/') ||
                              att.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
                            return (
                              <div
                                key={att.id || idx}
                                className={`flex items-center gap-2 p-1.5 px-2.5 rounded-lg border text-[11px] ${
                                  msg.role === 'user'
                                    ? 'bg-white/15 border-white/25 text-white'
                                    : 'bg-slate-50 dark:bg-[#181922] border-slate-200 dark:border-[#2d2f3d] text-slate-800 dark:text-slate-200'
                                }`}
                              >
                                {isImg && att.data_url ? (
                                  <img
                                    src={att.data_url}
                                    alt={att.name}
                                    className="w-6 h-6 object-cover rounded shadow-2xs"
                                  />
                                ) : att.name.match(/\.(ts|tsx|js|jsx|json|sql|html|css|py|rs|go)$/i) ? (
                                  <FileCode className="w-4 h-4 text-purple-400 shrink-0" />
                                ) : (
                                  <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                                )}
                                <div className="flex flex-col min-w-0">
                                  <span
                                    className="font-medium truncate max-w-[140px]"
                                    title={att.name}
                                  >
                                    {att.name}
                                  </span>
                                  <span className="text-[9px] opacity-75">
                                    {att.size
                                      ? `${Math.round(att.size / 1024)} KB`
                                      : att.asset_id
                                      ? 'Shared Asset'
                                      : 'Attached'}
                                  </span>
                                </div>
                                {att.data_url && (
                                  <a
                                    href={att.data_url}
                                    download={att.name}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="p-1 hover:opacity-100 opacity-70 transition-opacity"
                                    title="Download / Open file"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-xl bg-slate-200 dark:bg-[#2d2f3d] flex items-center justify-center text-slate-700 dark:text-slate-200 shrink-0 mt-0.5">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center text-slate-400 space-y-3">
              <Bot className="w-10 h-10 text-purple-400/80" />
              <p className="text-xs">
                No messages in this chat yet. Type below to brainstorm, design endpoints, or formulate feature requirements!
              </p>
            </div>
          )}

          {/* Active Chat In-Progress Indicator (Persistent across tab switches) */}
          {isActiveSessionRunning && (
            <div className="flex gap-3 text-xs justify-start items-center text-slate-500 dark:text-slate-400 italic">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#7b68ee] to-[#6366f1] flex items-center justify-center text-white shrink-0 animate-pulse shadow-sm">
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-2 p-3 rounded-2xl bg-white dark:bg-[#1e1f2b] border border-purple-200 dark:border-purple-800/40 shadow-xs">
                <Loader2 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 animate-spin" />
                <span>
                  Local AI ({selectedProvider}) is formulating response in session {activeSessionId?.slice(0, 8)}...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Quick Starters Bar (Collapsible with hide icon) */}
        {showQuickStarters ? (
          <div className="px-5 py-1.5 border-t border-slate-200 dark:border-[#23242e] bg-white/70 dark:bg-[#1a1b24]/70 flex items-center justify-between gap-2 overflow-x-auto">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 min-w-0">
              <span className="text-[10px] text-slate-400 shrink-0 font-semibold flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-500" />
                Quick Starters:
              </span>
              {latestSpec && (
                <button
                  type="button"
                  onClick={() => handleSendMessage('/create')}
                  disabled={isActiveSessionRunning}
                  className="shrink-0 px-3 py-1 rounded-full border border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold text-[11px] hover:bg-purple-100 transition-colors shadow-2xs flex items-center gap-1"
                >
                  <span>⚡ /create (Dispatch Requirement)</span>
                </button>
              )}
              {[
                'Design user profile avatar upload & crop',
                'Add JWT authentication with refresh token',
                'Optimize multi-repo database schema',
                'Contract-isolated payments webhook',
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleSendMessage(chip)}
                  disabled={isActiveSessionRunning}
                  className="shrink-0 px-3 py-1 rounded-full border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#23242e] text-[11px] text-slate-700 dark:text-slate-300 hover:border-purple-400 dark:hover:border-purple-600 transition-colors disabled:opacity-50"
                >
                  {chip}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowQuickStarters(false)}
              title="Hide Quick Starters"
              aria-label="Hide Quick Starters"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#252736] transition-colors shrink-0"
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="px-5 py-0.5 flex justify-end bg-transparent">
            <button
              type="button"
              onClick={() => setShowQuickStarters(true)}
              title="Show Quick Starters"
              className="text-[10px] text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 flex items-center gap-1 transition-colors py-0.5 px-2 rounded hover:bg-slate-100 dark:hover:bg-[#20212d]"
            >
              <Sparkles className="w-2.5 h-2.5 text-purple-500" />
              <span>Show Quick Starters</span>
              <Eye className="w-3 h-3 text-slate-400" />
            </button>
          </div>
        )}

        {/* Replying to Preview Banner */}
        {replyingToMessage && (
          <div className="flex items-center justify-between px-4 py-2 bg-purple-50/90 dark:bg-purple-950/40 border-t border-purple-200 dark:border-purple-800/60 text-xs shadow-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-1 rounded-md bg-purple-100 dark:bg-purple-900/60 text-purple-600 dark:text-purple-300 shrink-0">
                <Reply className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-purple-800 dark:text-purple-300 shrink-0">
                  Replying to {replyingToMessage.role === 'assistant' ? 'AI Architect' : 'You'}:
                </span>
                <span className="text-slate-600 dark:text-slate-400 truncate italic max-w-md">
                  "{replyingToMessage.content.replace(/\n+/g, ' ').slice(0, 120)}..."
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingToMessage(null)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-purple-100 dark:hover:bg-purple-900/60 transition-colors"
              title="Cancel reply"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Attached Files Preview Tray */}
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 py-2 bg-slate-100/70 dark:bg-[#181924] border-t border-slate-200 dark:border-[#23242e]">
            {attachedFiles.map((att, idx) => {
              const isImg =
                att.type?.startsWith('image/') ||
                att.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
              return (
                <div
                  key={att.id || idx}
                  className="flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg border border-purple-200 dark:border-purple-800/50 bg-white dark:bg-[#1f202b] text-purple-900 dark:text-purple-200 text-xs shadow-xs"
                >
                  {isImg && att.data_url ? (
                    <img
                      src={att.data_url}
                      alt={att.name}
                      className="w-5 h-5 object-cover rounded shrink-0"
                    />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                  )}
                  <span
                    className="font-medium truncate max-w-[160px] text-[11px]"
                    title={att.name}
                  >
                    {att.name}
                  </span>
                  <span className="text-[10px] text-purple-600 dark:text-purple-400 opacity-80">
                    {att.size ? `${Math.round(att.size / 1024)} KB` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(idx)}
                    className="p-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-600 dark:text-purple-300"
                    title="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom Input Area with Mentions, Tickets Autocomplete & Paste Support */}
        <div className="relative p-3 border-t border-slate-200 dark:border-[#23242e] bg-white dark:bg-[#1e1f2b] flex items-end gap-2">
          {/* Floating Mention Autocomplete Popup (@ Shared Assets) */}
          {showMentionMenu && (
            <div className="absolute bottom-full left-4 mb-2 w-80 max-h-60 overflow-y-auto rounded-xl border border-purple-200 dark:border-purple-800/60 bg-white dark:bg-[#1f202b] shadow-xl z-50 p-1.5">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between border-b border-slate-100 dark:border-[#2a2b38] mb-1">
                <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400 font-bold">
                  <AtSign className="w-3 h-3" />
                  Shared Workspace Assets
                </span>
                <span className="text-[9px] text-purple-500 font-mono">
                  {filteredAssets.length} found
                </span>
              </div>
              {filteredAssets.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  {sharedAssets.length === 0
                    ? 'No files in Shared Workspace Assets yet'
                    : 'No matching files'}
                </div>
              ) : (
                filteredAssets.map((asset, idx) => {
                  const isSelected = idx === mentionSelectedIndex;
                  const isImg =
                    asset.type?.startsWith('image/') ||
                    asset.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => selectMentionAsset(asset)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                      }`}
                    >
                      {isImg && asset.data_url ? (
                        <img
                          src={asset.data_url}
                          alt={asset.name}
                          className="w-5 h-5 object-cover rounded shrink-0"
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-purple-500 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate">{asset.name}</div>
                        <div className="text-[10px] text-slate-400 truncate">
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
            <div className="absolute bottom-full left-12 mb-2 w-96 max-h-72 overflow-y-auto rounded-xl border border-purple-200 dark:border-purple-800/60 bg-white dark:bg-[#1f202b] shadow-2xl z-50 p-1.5 scrollbar-thin">
              {/* Header */}
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
                  {filteredProjects.length} projects
                  {hashSlashTrigger === '#' ? ` · ${filteredRequirements.length} tickets` : ''}
                </span>
              </div>

              {activeMenuItems.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  {hashSlashQuery
                    ? `No matching projects or ${hashSlashTrigger === '#' ? 'tickets' : 'commands'} for "${hashSlashQuery}"`
                    : 'No projects found in this workspace'}
                </div>
              ) : (
                <div className="space-y-1">
                  {/* Projects Section */}
                  {filteredProjects.length > 0 && (
                    <div>
                      <div className="px-2 py-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <FolderGit2 className="w-2.5 h-2.5 text-purple-500" />
                        Workspace Projects
                      </div>
                      {filteredProjects.map((proj) => {
                        const itemIdx = activeMenuItems.findIndex(
                          (it) => it.type === 'project' && it.project?.name === proj.name
                        );
                        const isSelected = itemIdx === hashSlashSelectedIndex;
                        return (
                          <button
                            key={`proj-${proj.name}`}
                            type="button"
                            onClick={() => selectProject(proj)}
                            onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                              isSelected
                                ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 ring-1 ring-purple-400/40'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                            }`}
                          >
                            <FolderGit2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono text-[10px] font-bold shrink-0">
                              #{proj.name}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold truncate flex items-center gap-1.5">
                                <span>{proj.name}</span>
                                <span className="px-1 py-0.2 rounded text-[9px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                                  {proj.kind}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 truncate font-mono">
                                {proj.repo_path || proj.base_branch || 'Workspace Repo'}
                              </div>
                            </div>
                            <span className="text-[9px] text-purple-500/80 dark:text-purple-400/80 font-mono shrink-0">
                              mention
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Requirements / Tickets Section (when triggered by #) */}
                  {hashSlashTrigger === '#' && filteredRequirements.length > 0 && (
                    <div className="pt-1 border-t border-slate-100 dark:border-[#2a2b38]/60">
                      <div className="px-2 py-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <CheckSquare className="w-2.5 h-2.5 text-purple-500" />
                        Workspace Tickets
                      </div>
                      {filteredRequirements.map((req) => {
                        const itemIdx = activeMenuItems.findIndex(
                          (it) => it.type === 'ticket' && it.ticket?.id === req.id
                        );
                        const isSelected = itemIdx === hashSlashSelectedIndex;
                        return (
                          <button
                            key={`ticket-${req.id}`}
                            type="button"
                            onClick={() => selectRequirementTicket(req)}
                            onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                              isSelected
                                ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 ring-1 ring-purple-400/40'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                            }`}
                          >
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono text-[10px] font-bold shrink-0">
                              #{req.id}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold truncate">{req.title}</div>
                              <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                                <span className="capitalize">{req.status}</span>
                                <span>·</span>
                                <span className="capitalize">{req.priority}</span>
                              </div>
                            </div>
                            <span className="text-[9px] text-purple-500/80 dark:text-purple-400/80 font-mono shrink-0">
                              link
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Commands Section (when triggered by /) */}
                  {hashSlashTrigger === '/' && availableCommands.length > 0 && (
                    <div className="pt-1 border-t border-slate-100 dark:border-[#2a2b38]/60">
                      <div className="px-2 py-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                        <Terminal className="w-2.5 h-2.5 text-purple-500" />
                        Chat Commands
                      </div>
                      {availableCommands.map((cmd) => {
                        const itemIdx = activeMenuItems.findIndex(
                          (it) => it.type === 'command' && it.command?.id === cmd.id
                        );
                        const isSelected = itemIdx === hashSlashSelectedIndex;
                        return (
                          <button
                            key={`cmd-${cmd.id}`}
                            type="button"
                            onClick={() => selectCommand(cmd)}
                            onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                              isSelected
                                ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 ring-1 ring-purple-400/40'
                                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937]'
                            }`}
                          >
                            <Terminal className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono text-[10px] font-bold shrink-0">
                              {cmd.command}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold truncate">{cmd.title}</div>
                              <div className="text-[10px] text-slate-400 truncate">
                                {cmd.description}
                              </div>
                            </div>
                            <span className="text-[9px] text-purple-500/80 dark:text-purple-400/80 font-mono shrink-0">
                              command
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            multiple
            className="hidden"
          />

          {/* Paperclip upload button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach local file (Image, Spec, Code)"
            className="p-2.5 rounded-xl border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-300 dark:hover:border-purple-700 transition-colors shrink-0"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* @ Shortcut button for Shared Assets */}
          <button
            type="button"
            onClick={() => {
              setShowMentionMenu((prev) => !prev);
              setShowHashSlashMenu(false);
              setMentionQuery('');
              setMentionSelectedIndex(0);
            }}
            title="Shortcut @: Mention / select from Shared Workspace Assets"
            className={`p-2.5 rounded-xl border transition-colors shrink-0 ${
              showMentionMenu
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400'
                : 'border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-300 dark:hover:border-purple-700'
            }`}
          >
            <AtSign className="w-4 h-4" />
          </button>

          {/* # Shortcut button for Projects & Tickets */}
          <button
            type="button"
            onClick={() => {
              if (showHashSlashMenu && hashSlashTrigger === '#') {
                setShowHashSlashMenu(false);
              } else {
                setShowHashSlashMenu(true);
                setHashSlashTrigger('#');
                setHashSlashQuery('');
                setHashSlashSelectedIndex(0);
                setShowMentionMenu(false);
              }
            }}
            title="Shortcut #: Mention workspace project or ticket (e.g. #backend, #REQ-001)"
            className={`p-2.5 rounded-xl border transition-colors shrink-0 ${
              showHashSlashMenu && hashSlashTrigger === '#'
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400'
                : 'border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-300 dark:hover:border-purple-700'
            }`}
          >
            <Hash className="w-4 h-4" />
          </button>

          {/* / Shortcut button for Projects & Commands */}
          <button
            type="button"
            onClick={() => {
              if (showHashSlashMenu && hashSlashTrigger === '/') {
                setShowHashSlashMenu(false);
              } else {
                setShowHashSlashMenu(true);
                setHashSlashTrigger('/');
                setHashSlashQuery('');
                setHashSlashSelectedIndex(0);
                setShowMentionMenu(false);
              }
            }}
            title="Shortcut /: Mention workspace project or command (e.g. #backend, /create)"
            className={`p-2.5 rounded-xl border transition-colors shrink-0 flex items-center justify-center min-w-9 ${
              showHashSlashMenu && hashSlashTrigger === '/'
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400'
                : 'border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-300 dark:hover:border-purple-700'
            }`}
          >
            <span className="font-mono text-xs font-bold leading-none">/</span>
          </button>

          <textarea
            ref={textareaRef}
            value={chatInput}
            onChange={handleChatInputChange}
            onKeyDown={handleInputKeyDown}
            onPaste={handlePaste}
            placeholder="Discuss architecture... Type # or / for projects & tickets, @ for assets (Enter to send)"
            rows={2}
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7b68ee] resize-none"
          />

          <button
            type="button"
            onClick={() => handleSendMessage()}
            disabled={isActiveSessionRunning || (!chatInput.trim() && attachedFiles.length === 0)}
            className="p-3.5 rounded-xl bg-gradient-to-r from-[#7b68ee] to-[#6366f1] text-white hover:from-[#6c5ce7] hover:to-[#4f46e5] disabled:opacity-40 transition-all shadow-md shadow-purple-500/20 active:scale-95 shrink-0"
          >
            {isActiveSessionRunning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </main>

      {/* RIGHT: Collapsible Session Inspector Sidebar */}
      {showInspector && (
        <aside className="w-80 border-l border-slate-200 dark:border-[#23242e] bg-white dark:bg-[#1a1b24] flex flex-col shrink-0 overflow-hidden animate-in slide-in-from-right duration-200">
          {/* Inspector Header */}
          <div className="p-3.5 border-b border-slate-200 dark:border-[#23242e] flex items-center justify-between bg-slate-50/50 dark:bg-[#1d1e28]">
            <div className="flex items-center gap-2">
              <PanelRight className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span className="font-bold text-xs text-slate-900 dark:text-slate-100">Session Inspector</span>
            </div>
            <button
              type="button"
              onClick={() => setShowInspector(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#262836]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Section 1: Session Details */}
            <div className="p-3 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50/50 dark:bg-[#1f202b] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Terminal className="w-3 h-3 text-purple-500" />
                  Session ID
                </span>
                {activeSessionId && (
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(activeSessionId);
                      toast.success('Session ID copied to clipboard');
                    }}
                    className="flex items-center gap-1 text-[10px] text-purple-600 dark:text-purple-400 hover:underline cursor-pointer font-medium"
                    title="Copy full Session ID"
                  >
                    <Copy className="w-2.5 h-2.5" />
                    <span>Copy</span>
                  </button>
                )}
              </div>
              <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all bg-white dark:bg-[#171822] p-2 rounded-lg border border-slate-200/80 dark:border-[#282a38] select-all">
                {activeSessionId || 'No active session'}
              </div>
            </div>

            {/* Section 2: Connected Hub Repos */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <FolderGit2 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>Connected Hub Repos</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 font-semibold font-mono">
                  {projects.length}
                </span>
              </div>

              {projects.length === 0 ? (
                <div className="p-3.5 rounded-xl border border-dashed border-slate-200 dark:border-[#2d2f3d] text-center text-xs text-slate-400">
                  No repos registered in this workspace yet.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {projects.map((p) => (
                    <div
                      key={p.name}
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50/50 dark:bg-[#1f202b] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-purple-700 dark:text-purple-300">
                            #{p.name}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-medium uppercase tracking-wider bg-slate-200 dark:bg-[#2e303f] text-slate-600 dark:text-slate-400">
                            {p.kind}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5" title={p.repo_path}>
                          {p.repo_path || p.base_branch || 'Repo'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setChatInput((prev) => (prev ? `${prev} #${p.name} ` : `#${p.name} `));
                          if (textareaRef.current) textareaRef.current.focus();
                        }}
                        className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:underline shrink-0 cursor-pointer"
                        title={`Mention #${p.name} in prompt`}
                      >
                        Mention
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 3: Tickets Created from this Chat */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <CheckSquare className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>Tickets Created</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 font-semibold font-mono">
                  {sessionTickets.length}
                </span>
              </div>

              {sessionTickets.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-[#2d2f3d] text-center text-xs text-slate-400 space-y-1">
                  <p>No tickets created from this conversation yet.</p>
                  <p className="text-[10px] text-slate-500">
                    Formulate specs in chat and click "Create Requirement" or type <code className="font-mono bg-slate-100 dark:bg-[#252736] px-1 py-0.2 rounded">/create</code>.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sessionTickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50/50 dark:bg-[#1f202b] space-y-2 hover:border-purple-300 dark:hover:border-purple-700 transition-colors group/card"
                    >
                      <div className="flex items-center justify-between">
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 font-mono text-[10px] font-bold">
                          #{ticket.id}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase tracking-wider bg-slate-200 dark:bg-[#2e303f] text-slate-700 dark:text-slate-300">
                          {ticket.status}
                        </span>
                      </div>
                      <div
                        onClick={() => setSelectedTicketId(ticket.id)}
                        className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-2 hover:text-purple-600 dark:hover:text-purple-400 cursor-pointer transition-colors"
                        title="Click to open ticket info"
                      >
                        {ticket.title}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1.5 border-t border-slate-100 dark:border-[#2a2c3a]">
                        <button
                          type="button"
                          onClick={() => setSelectedTicketId(ticket.id)}
                          className="flex items-center gap-1 font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-500 hover:underline cursor-pointer"
                          title="Open ticket details and info sheet"
                        >
                          <Info className="w-3 h-3" />
                          <span>Open Info</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setChatInput((prev) => (prev ? `${prev} #${ticket.id} ` : `#${ticket.id} `));
                            if (textareaRef.current) textareaRef.current.focus();
                          }}
                          className="text-slate-500 dark:text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 hover:underline cursor-pointer"
                          title="Reference in chat input"
                        >
                          Reference #
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 4: Attachments in this Conversation */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Paperclip className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>Attachments</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/60 px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                    title="Upload image, spec, or code file"
                  >
                    <Upload className="w-3 h-3" />
                    <span>Upload</span>
                  </button>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#262836] text-slate-600 dark:text-slate-300 font-semibold font-mono">
                    {allSessionAttachments.length + attachedFiles.length}
                  </span>
                </div>
              </div>

              {/* Upload Dropzone / Button Card */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2.5 px-3 rounded-xl border border-dashed border-purple-300 dark:border-purple-800/80 hover:border-purple-500 bg-purple-50/40 dark:bg-purple-950/20 hover:bg-purple-50/80 dark:hover:bg-purple-950/40 transition-colors flex items-center justify-center gap-2 text-xs font-semibold text-purple-700 dark:text-purple-300 cursor-pointer group"
              >
                <Upload className="w-3.5 h-3.5 group-hover:-translate-y-0.5 transition-transform" />
                <span>Upload File or Spec</span>
              </button>

              {/* Staged / Pending Attachments in current prompt */}
              {attachedFiles.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between text-[10px] font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                    <span>Ready to Send ({attachedFiles.length})</span>
                    <span className="text-[9px] text-slate-400 font-normal">In chat prompt</span>
                  </div>
                  {attachedFiles.map((att, idx) => {
                    const isImg =
                      att.type?.startsWith('image/') ||
                      att.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
                    return (
                      <div
                        key={att.id || idx}
                        className="flex items-center gap-2 p-2 rounded-xl border border-purple-200 dark:border-purple-800/60 bg-purple-50/60 dark:bg-purple-950/40"
                      >
                        {isImg && att.data_url ? (
                          <img
                            src={att.data_url}
                            alt={att.name}
                            className="w-7 h-7 object-cover rounded-lg shrink-0 shadow-2xs"
                          />
                        ) : att.name.match(/\.(ts|tsx|js|jsx|json|sql|html|css|py|rs|go)$/i) ? (
                          <FileCode className="w-4 h-4 text-purple-500 shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-purple-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div
                            className="text-xs font-medium truncate text-purple-950 dark:text-purple-200"
                            title={att.name}
                          >
                            {att.name}
                          </div>
                          <div className="text-[10px] text-purple-600/70 dark:text-purple-400/70">
                            {att.size ? `${Math.round(att.size / 1024)} KB` : 'Attached'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachedFile(idx)}
                          className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
                          title="Remove attached file"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Historic Conversation Attachments */}
              {allSessionAttachments.length > 0 ? (
                <div className="space-y-2 pt-1">
                  {attachedFiles.length > 0 && (
                    <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Conversation Thread ({allSessionAttachments.length})
                    </div>
                  )}
                  {allSessionAttachments.map((att, idx) => {
                    const isImg =
                      att.type?.startsWith('image/') ||
                      att.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i);
                    return (
                      <div
                        key={att.id || idx}
                        className="flex items-center gap-2 p-2 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50/50 dark:bg-[#1f202b]"
                      >
                        {isImg && att.data_url ? (
                          <img
                            src={att.data_url}
                            alt={att.name}
                            className="w-8 h-8 object-cover rounded-lg shrink-0 shadow-2xs"
                          />
                        ) : att.name.match(/\.(ts|tsx|js|jsx|json|sql|html|css|py|rs|go)$/i) ? (
                          <FileCode className="w-5 h-5 text-purple-400 shrink-0" />
                        ) : (
                          <FileText className="w-5 h-5 text-purple-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate text-slate-800 dark:text-slate-200" title={att.name}>
                            {att.name}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {att.size ? `${Math.round(att.size / 1024)} KB` : 'Attached file'}
                          </div>
                        </div>
                        {att.data_url && (
                          <a
                            href={att.data_url}
                            download={att.name}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 rounded-md text-slate-400 hover:text-purple-600 hover:bg-slate-100 dark:hover:bg-[#282a38]"
                            title="Download attachment"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : attachedFiles.length === 0 ? (
                <div className="p-3.5 rounded-xl border border-dashed border-slate-200 dark:border-[#2d2f3d] text-center text-xs text-slate-400">
                  No files or images attached in this conversation yet.
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      )}

      {/* Radix UI Delete Session Confirmation Dialog */}
      <Dialog open={Boolean(sessionToDelete)} onOpenChange={(open) => !open && setSessionToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-900/40 flex items-center justify-center text-red-600 dark:text-red-400 mb-2">
              <Trash2 className="w-5 h-5" />
            </div>
            <DialogTitle>Delete Chat Session?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong className="text-slate-800 dark:text-slate-200">"{sessionToDelete?.title}"</strong>?
              This conversation thread and all its messages will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 pt-3">
            <button
              type="button"
              onClick={() => setSessionToDelete(null)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#20212b] text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#282937] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleteSessionMutation.isPending}
              onClick={async () => {
                if (sessionToDelete) {
                  await deleteSessionMutation.mutateAsync(sessionToDelete.id);
                  setSessionToDelete(null);
                }
              }}
              className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white text-xs font-semibold shadow-sm transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {deleteSessionMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>Delete Thread</span>
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Requirement Detail Sheet drawer for viewing full ticket info */}
      <RequirementDetailSheet
        requirementId={selectedTicketId}
        isOpen={Boolean(selectedTicketId)}
        onClose={() => setSelectedTicketId(null)}
      />
    </div>
  );
}
