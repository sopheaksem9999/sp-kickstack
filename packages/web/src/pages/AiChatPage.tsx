import React, { useState, useEffect, useRef, useMemo } from 'react';
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

const MODEL_OPTIONS_MAP: Record<string, Array<{ id: string; name: string }>> = {
  'claude-cli': [
    { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Hybrid)' },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus', name: 'Claude 3 Opus' },
  ],
  'agy-cli': [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Deep)' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  ],
  'codex-cli': [
    { id: 'default', name: 'Default Codex Model' },
    { id: 'o3-mini', name: 'o3-mini (High reasoning)' },
    { id: 'gpt-4o', name: 'GPT-4o (Omni)' },
  ],
  'ollama': [
    { id: 'default', name: 'Default Local Model' },
    { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder 14B' },
    { id: 'deepseek-r1:14b', name: 'DeepSeek R1 14B' },
    { id: 'llama3.3:70b', name: 'Llama 3.3 70B' },
  ],
  'auto': [{ id: 'default', name: 'Auto Default' }],
  'heuristic': [{ id: 'default', name: 'Built-in Spec Engine' }],
};

const EFFORT_OPTIONS: Array<{ id: ReasoningEffort; name: string; desc: string }> = [
  { id: 'low', name: 'Low', desc: 'Fast answers, minimal thinking' },
  { id: 'medium', name: 'Medium', desc: 'Balanced speed and depth' },
  { id: 'high', name: 'High', desc: 'Deep architectural reasoning' },
  { id: 'max', name: 'Max', desc: 'Maximum reasoning effort' },
];

export function AiChatPage() {
  const { activeWorkspaceId, activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionSearch, setSessionSearch] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachmentItem[]>([]);

  // Mentions (@ assets) state
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  // Tickets (# requirements) state
  const [showTicketMenu, setShowTicketMenu] = useState(false);
  const [ticketQuery, setTicketQuery] = useState('');
  const [ticketSelectedIndex, setTicketSelectedIndex] = useState(0);

  // Inline title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleText, setEditingTitleText] = useState('');

  // Right sidebar inspector drawer (tickets created + attachments)
  const [showInspector, setShowInspector] = useState(false);
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
    if (provider === 'claude-cli') return appSettings?.ai_cli?.claude?.model || 'claude-3-7-sonnet';
    if (provider === 'agy-cli') return appSettings?.ai_cli?.agy?.model || 'gemini-2.5-pro';
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

  const filteredRequirements = allRequirements.filter((r) => {
    if (!ticketQuery) return true;
    const q = ticketQuery.toLowerCase();
    return r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q);
  });

  // 5. Fetch all chat sessions for active workspace
  const {
    data: sessions = [],
    isLoading: isLoadingSessions,
  } = useQuery({
    queryKey: ['ai-chat-sessions', activeWorkspaceId],
    queryFn: () => fetchAiChatSessions(activeWorkspaceId),
  });

  // Automatically select the first session or create one if none exist
  useEffect(() => {
    if (sessions.length > 0) {
      if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
        setActiveSessionId(sessions[0].id);
      }
    }
  }, [sessions, activeSessionId]);

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
      setActiveSessionId(newSession.id);
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
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
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

  const selectRequirementTicket = (req: Requirement) => {
    const hashIndex = chatInput.lastIndexOf('#');
    if (hashIndex !== -1) {
      const beforeHash = chatInput.slice(0, hashIndex);
      const afterHash = chatInput.slice(hashIndex);
      const queryEnd = afterHash.indexOf(' ');
      const remainder = queryEnd !== -1 ? afterHash.slice(queryEnd) : '';
      setChatInput(`${beforeHash}#${req.id} ${remainder}`);
    } else {
      setChatInput((prev) => (prev ? `${prev} #${req.id} ` : `#${req.id} `));
    }

    setShowTicketMenu(false);
    setTicketQuery('');
    toast.success(`Mentioned ticket #${req.id}: ${req.title}`);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleChatInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setChatInput(val);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursor);

    // 1. Check for @ mention
    const lastAt = textBeforeCursor.lastIndexOf('@');
    if (lastAt !== -1) {
      const charBeforeAt = lastAt > 0 ? textBeforeCursor[lastAt - 1] : ' ';
      if (charBeforeAt === ' ' || charBeforeAt === '\n' || lastAt === 0) {
        const query = textBeforeCursor.slice(lastAt + 1);
        if (!/\s/.test(query)) {
          setShowMentionMenu(true);
          setMentionQuery(query);
          setMentionSelectedIndex(0);
          setShowTicketMenu(false);
          return;
        }
      }
    }
    setShowMentionMenu(false);
    setMentionQuery('');

    // 2. Check for # ticket reference
    const lastHash = textBeforeCursor.lastIndexOf('#');
    if (lastHash !== -1) {
      const charBeforeHash = lastHash > 0 ? textBeforeCursor[lastHash - 1] : ' ';
      if (charBeforeHash === ' ' || charBeforeHash === '\n' || lastHash === 0) {
        const query = textBeforeCursor.slice(lastHash + 1);
        if (!/\s/.test(query)) {
          setShowTicketMenu(true);
          setTicketQuery(query);
          setTicketSelectedIndex(0);
          setShowMentionMenu(false);
          return;
        }
      }
    }
    setShowTicketMenu(false);
    setTicketQuery('');
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

    // Navigate # ticket menu
    if (showTicketMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setTicketSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredRequirements.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setTicketSelectedIndex((prev) => (prev - 1 + filteredRequirements.length) % Math.max(1, filteredRequirements.length));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredRequirements.length > 0) {
          e.preventDefault();
          selectRequirementTicket(filteredRequirements[ticketSelectedIndex]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowTicketMenu(false);
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
    setShowTicketMenu(false);

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

      if (response.suggested_spec) {
        toast.success('🎯 Architectural spec formulated! Type /create or click the header button to dispatch.');
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

  const availableModels = MODEL_OPTIONS_MAP[selectedProvider] || [{ id: 'default', name: 'Default Model' }];
  const currentProviderName = PROVIDER_OPTIONS.find((p) => p.id === selectedProvider)?.name || selectedProvider;
  const currentModelName = availableModels.find((m) => m.id === selectedModel)?.name || selectedModel;

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
                  onClick={() => setActiveSessionId(s.id)}
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
                  {PROVIDER_OPTIONS.map((p) => {
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
                <PopoverContent align="end" className="w-64 p-2 space-y-1">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Select Model ({selectedProvider})
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
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200 font-semibold'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#252736]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="truncate font-mono text-xs">{m.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{m.id}</div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />}
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
                title="Toggle Chat Inspector (Tickets Created & Attachments)"
                aria-label="Toggle Chat Inspector"
              >
                <PanelRight className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                {(sessionTickets.length > 0 || allSessionAttachments.length > 0) && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-purple-500 ring-2 ring-white dark:ring-[#20212b]" />
                )}
              </button>
            </div>
          </div>
        </header>

        {/* Connected Hub Repos Banner */}
        <div className="px-5 py-2 border-b border-slate-200 dark:border-[#23242e] bg-slate-50/70 dark:bg-[#171822]/70 flex items-center justify-between text-xs overflow-x-auto gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <FolderGit2 className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
              Connected Hub Repos:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {projects.length > 0 ? (
                projects.map((p) => (
                  <span
                    key={p.name}
                    className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800/40 text-purple-800 dark:text-purple-300 font-mono text-[10px] font-semibold"
                  >
                    {p.name}
                  </span>
                ))
              ) : (
                <span className="text-[10px] text-slate-400 italic">No repos registered yet</span>
              )}
            </div>
          </div>

          <div className="text-[10px] text-slate-400 shrink-0 font-medium">
            Session ID: <span className="font-mono text-purple-600 dark:text-purple-400">{activeSessionId?.slice(0, 14) || 'none'}...</span>
          </div>
        </div>

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
                          {renderInlineMarkdown(actualContent)}
                        </div>
                      ) : (
                        <div className="font-sans text-xs">
                          <MarkdownMessage content={actualContent} />

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

                          {/* Interactive Open Info button for created tickets mentioned in chat */}
                          {msg.content.includes('#REQ-') && (
                            <div className="mt-2.5 flex items-center gap-2">
                              {(() => {
                                const match = msg.content.match(/#(REQ-\d+)/i);
                                const reqId = match ? match[1].toUpperCase() : null;
                                if (!reqId) return null;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedTicketId(reqId)}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-100 dark:bg-purple-950/80 border border-purple-200 dark:border-purple-800/60 text-purple-800 dark:text-purple-300 font-bold text-[11px] hover:bg-purple-200 dark:hover:bg-purple-900/60 transition-colors shadow-2xs cursor-pointer"
                                  >
                                    <Info className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                                    <span>Open Ticket Info (#{reqId})</span>
                                  </button>
                                );
                              })()}
                            </div>
                          )}
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

        {/* Quick Starters Bar */}
        <div className="px-5 py-2 border-t border-slate-200 dark:border-[#23242e] bg-white/70 dark:bg-[#1a1b24]/70 flex items-center gap-2 overflow-x-auto">
          <span className="text-[10px] text-slate-400 shrink-0 font-semibold">Quick Starters:</span>
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

          {/* Floating Ticket Autocomplete Popup (# Requirements) */}
          {showTicketMenu && (
            <div className="absolute bottom-full left-12 mb-2 w-88 max-h-60 overflow-y-auto rounded-xl border border-purple-200 dark:border-purple-800/60 bg-white dark:bg-[#1f202b] shadow-xl z-50 p-1.5">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between border-b border-slate-100 dark:border-[#2a2b38] mb-1">
                <span className="flex items-center gap-1 text-purple-600 dark:text-purple-400 font-bold">
                  <Hash className="w-3 h-3" />
                  Workspace Requirements / Tickets
                </span>
                <span className="text-[9px] text-purple-500 font-mono">
                  {filteredRequirements.length} tickets
                </span>
              </div>
              {filteredRequirements.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  {allRequirements.length === 0
                    ? 'No requirements created yet in this workspace'
                    : 'No matching tickets'}
                </div>
              ) : (
                filteredRequirements.map((req, idx) => {
                  const isSelected = idx === ticketSelectedIndex;
                  return (
                    <button
                      key={req.id}
                      type="button"
                      onClick={() => selectRequirementTicket(req)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors ${
                        isSelected
                          ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-900 dark:text-purple-200'
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
                    </button>
                  );
                })
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
              setShowTicketMenu(false);
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

          {/* # Shortcut button for Requirements / Tickets */}
          <button
            type="button"
            onClick={() => {
              setShowTicketMenu((prev) => !prev);
              setShowMentionMenu(false);
              setTicketQuery('');
              setTicketSelectedIndex(0);
            }}
            title="Shortcut #: Mention / link workspace ticket (e.g. #REQ-001)"
            className={`p-2.5 rounded-xl border transition-colors shrink-0 ${
              showTicketMenu
                ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400'
                : 'border-slate-200 dark:border-[#303030] bg-slate-50 dark:bg-[#242424] text-slate-500 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-300 dark:hover:border-purple-700'
            }`}
          >
            <Hash className="w-4 h-4" />
          </button>

          <textarea
            ref={textareaRef}
            value={chatInput}
            onChange={handleChatInputChange}
            onKeyDown={handleInputKeyDown}
            onPaste={handlePaste}
            placeholder="Discuss architecture... Type # for tickets, @ for assets, paste images from clipboard (Enter to send)"
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
            {/* Section 1: Tickets Created from this Chat */}
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

            {/* Section 2: Attachments in this Conversation */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                  <Paperclip className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>Attachments</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#262836] text-slate-600 dark:text-slate-300 font-semibold font-mono">
                  {allSessionAttachments.length}
                </span>
              </div>

              {allSessionAttachments.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-slate-200 dark:border-[#2d2f3d] text-center text-xs text-slate-400">
                  No files or images attached in this conversation.
                </div>
              ) : (
                <div className="space-y-2">
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
              )}
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
