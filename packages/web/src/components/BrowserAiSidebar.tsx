import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Bot,
  User,
  Send,
  Loader2,
  Trash2,
  Copy,
  PlusCircle,
  FileText,
  Search,
  Code2,
  MessageSquare,
  ChevronDown,
  Check,
  Zap,
  Plus,
  Wand2,
  Cpu,
  Layers,
  Gauge,
  Clock,
  AtSign,
  Hash,
  FolderGit2,
  CheckSquare,
  Terminal,
  X,
  Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover.js';
import { MarkdownMessage } from './MarkdownMessage.js';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import {
  createAiChatSession,
  sendAiSessionMessage,
  updateAiChatSession,
  fetchAiChatSessions,
  fetchAiChatSession,
  deleteAiChatSession,
  fetchSettings,
  fetchProjects,
  fetchAssets,
  fetchRequirements,
} from '../lib/api.js';
import type {
  BrowserPageContent,
  AiChatSession,
  ReasoningEffort,
  Project,
  Requirement,
  SharedAsset,
  ChatAttachmentItem,
  AiChatToolUse,
} from '@sp-kickstack/shared';
import { isChatCommand, toolsUsedText } from '../lib/aiChatTools.js';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  attachments?: ChatAttachmentItem[];
  tools_used?: AiChatToolUse[];
}

interface BrowserAiSidebarProps {
  pageContent: BrowserPageContent | null;
  isLoadingPage: boolean;
  workspaceId: string;
  externalToolTrigger?: { id: string; timestamp: number } | null;
}

interface ProviderOption {
  id: string;
  name: string;
  desc: string;
  badge?: string;
}

const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'auto', name: 'Auto (Best Local Engine)', desc: 'Detects installed local CLI' },
  { id: 'claude-cli', name: 'Claude Code CLI', desc: 'Anthropic agentic CLI', badge: 'Fast' },
  { id: 'agy-cli', name: 'Antigravity CLI (Agy)', desc: 'Google DeepMind agentic CLI' },
  { id: 'codex-cli', name: 'Codex CLI', desc: 'OpenAI local developer CLI' },
  { id: 'ollama', name: 'Ollama (Local LLM)', desc: '100% offline local model inference' },
  { id: 'heuristic', name: 'Heuristic Architect', desc: 'Offline requirement generator' },
];

interface ModelOptionItem {
  id: string;
  name: string;
  desc?: string;
}

const MODEL_OPTIONS_MAP: Record<string, ModelOptionItem[]> = {
  'claude-cli': [
    { id: 'default', name: 'Default (recommended)', desc: 'Opus 5.5 · Best for everyday, complex tasks' },
    { id: 'opus', name: 'Opus', desc: 'Opus 5.5 · Best for everyday, complex tasks' },
    { id: 'fable', name: 'Fable', desc: 'Fable 5.1 · Most capable for hardest tasks' },
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

export function BrowserAiSidebar({
  pageContent,
  isLoadingPage,
  workspaceId,
  externalToolTrigger,
}: BrowserAiSidebarProps) {
  const queryClient = useQueryClient();
  const { openSheet } = useCreateRequirement();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Engine, Model, Effort matching AI Chat & Settings
  const [selectedEngine, setSelectedEngine] = useState<string>('auto');
  const [selectedModel, setSelectedModel] = useState<string>('default');
  const [selectedEffort, setSelectedEffort] = useState<ReasoningEffort>('medium');
  const [isEnginePopoverOpen, setIsEnginePopoverOpen] = useState(false);

  // Sessions
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSessionPopoverOpen, setIsSessionPopoverOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');

  // Mentions (@ assets) state
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  // Mentions (# projects/tickets and / commands) state
  const [showHashSlashMenu, setShowHashSlashMenu] = useState(false);
  const [hashSlashTrigger, setHashSlashTrigger] = useState<'#' | '/'>('#');
  const [hashSlashQuery, setHashSlashQuery] = useState('');
  const [hashSlashSelectedIndex, setHashSlashSelectedIndex] = useState(0);

  // File Attachments
  const [attachedFiles, setAttachedFiles] = useState<ChatAttachmentItem[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastLoadedUrlRef = useRef<string | null>(null);
  const lastTriggerRef = useRef<number>(0);

  // 1. Fetch Chat Sessions for this workspace
  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['ai-chat-sessions', workspaceId],
    queryFn: () => fetchAiChatSessions(workspaceId),
    staleTime: 5000,
  });

  // 2. Fetch App Settings to honor enabled engines & default provider/model/effort
  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    staleTime: 60000,
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

  // Synchronize local engine, model, and effort from settings when no session is active
  useEffect(() => {
    if (!sessionId && appSettings) {
      setSelectedEngine(configuredDefaultProvider);
      setSelectedModel(getModelForProvider(configuredDefaultProvider));
      setSelectedEffort(getEffortForProvider(configuredDefaultProvider));
    }
  }, [sessionId, configuredDefaultProvider, appSettings]);

  const enabledEngines = appSettings?.ai_cli?.enabledEngines;
  const availableProviders = useMemo(() => {
    return PROVIDER_OPTIONS.filter((p) => {
      if (p.id === 'auto') return true;
      if (!enabledEngines || enabledEngines.length === 0) return true;
      return enabledEngines.includes(p.id as any);
    });
  }, [enabledEngines]);

  // Current session object
  const currentSession = useMemo(() => {
    return sessions.find((s) => s.id === sessionId) || null;
  }, [sessions, sessionId]);

  // Filtered sessions for dropdown search
  const filteredSessions = useMemo(() => {
    if (!sessionSearch.trim()) return sessions;
    const q = sessionSearch.toLowerCase();
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, sessionSearch]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Welcome message when page loads and no session active
  useEffect(() => {
    if (pageContent && pageContent.title && messages.length === 0 && !sessionId) {
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: `👋 I have indexed **"${pageContent.title}"**.\n\nUse the **AI Web Tools** in the header or ask any question about the architecture, features, or code on this page.`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [pageContent, sessionId, messages.length]);

  // Notice when active page changes
  useEffect(() => {
    if (pageContent?.url && lastLoadedUrlRef.current && lastLoadedUrlRef.current !== pageContent.url) {
      setMessages((prev) => [
        ...prev,
        {
          id: `page-nav-${Date.now()}`,
          role: 'assistant',
          content: `🔄 **Active Page Updated**: Context is now grounded on **"${pageContent.title || pageContent.url}"**.\n\nAsk questions about this new page or use the tools in the header to inspect it.`,
          timestamp: new Date(),
        },
      ]);
    }
    if (pageContent?.url) {
      lastLoadedUrlRef.current = pageContent.url;
    }
  }, [pageContent?.url, pageContent?.title]);

  const getOrCreateSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const title = pageContent?.title ? `Browser: ${pageContent.title.slice(0, 36)}` : 'In-App Browser Chat';
    const session = await createAiChatSession({
      workspace_id: workspaceId || 'default',
      title,
      provider: selectedEngine as any,
      model: selectedModel !== 'default' ? selectedModel : undefined,
      effort: selectedEffort,
    });
    setSessionId(session.id);
    queryClient.setQueryData<AiChatSession[]>(['ai-chat-sessions', workspaceId], (old = []) => [
      session,
      ...old,
    ]);
    return session.id;
  };

  // 3. Fetch Workspace Projects for "#" mentions
  const { data: projects = [] } = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => fetchProjects(workspaceId),
    staleTime: 30000,
  });

  // 4. Fetch Shared Workspace Assets for "@" mentions
  const { data: assetsData } = useQuery({
    queryKey: ['assets', workspaceId],
    queryFn: () => fetchAssets(workspaceId),
    staleTime: 15000,
  });
  const sharedAssets = assetsData?.shared_assets || [];

  // 5. Fetch Workspace Requirements for "#" ticket mentions
  const { data: allRequirements = [] } = useQuery({
    queryKey: ['requirements', workspaceId],
    queryFn: () => fetchRequirements(workspaceId),
    staleTime: 15000,
  });

  // Mentions filtering
  const filteredAssets = useMemo(() => {
    if (!mentionQuery) return sharedAssets;
    const q = mentionQuery.toLowerCase();
    return sharedAssets.filter((a) => a.name.toLowerCase().includes(q));
  }, [sharedAssets, mentionQuery]);

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

  const filteredRequirements = useMemo(() => {
    if (hashSlashTrigger !== '#') return [];
    if (!hashSlashQuery) return allRequirements;
    const q = hashSlashQuery.toLowerCase();
    return allRequirements.filter(
      (r) => r.id.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)
    );
  }, [allRequirements, hashSlashQuery, hashSlashTrigger]);

  const availableCommands = useMemo(() => {
    if (hashSlashTrigger !== '/') return [];
    const commands = [
      {
        id: 'create',
        command: '/create',
        title: 'Extract Requirement Specification',
        description: 'Analyze page and extract actionable requirement ticket',
      },
      {
        id: 'summarize',
        command: '/summarize',
        title: 'Summarize Active Page',
        description: 'Summarize architecture, stack, and key takeaways',
      },
      {
        id: 'inspect',
        command: '/inspect',
        title: 'Inspect APIs & Code',
        description: 'Inspect endpoints, contracts, and code details',
      },
      {
        id: 'clear',
        command: '/clear',
        title: 'Clear Chat History',
        description: 'Reset conversation messages and start fresh',
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

    const atIndex = inputText.lastIndexOf('@');
    if (atIndex !== -1) {
      const beforeAt = inputText.slice(0, atIndex);
      const afterAt = inputText.slice(atIndex);
      const queryEnd = afterAt.indexOf(' ');
      const remainder = queryEnd !== -1 ? afterAt.slice(queryEnd) : '';
      setInputText(`${beforeAt}@${asset.name} ${remainder}`);
    } else {
      setInputText((prev) => (prev ? `${prev} @${asset.name} ` : `@${asset.name} `));
    }

    setShowMentionMenu(false);
    setMentionQuery('');
    toast.success(`Attached "${asset.name}" from Shared Workspace Assets`);
    textareaRef.current?.focus();
  };

  const selectProject = (proj: Project) => {
    const trig = hashSlashTrigger || '#';
    const trigIndex = inputText.lastIndexOf(trig);
    const mentionTag = `#${proj.name} `;

    if (trigIndex !== -1) {
      const before = inputText.slice(0, trigIndex);
      const after = inputText.slice(trigIndex);
      const queryEnd = after.indexOf(' ');
      const remainder = queryEnd !== -1 ? after.slice(queryEnd) : '';
      setInputText(`${before}${mentionTag}${remainder}`);
    } else {
      setInputText((prev) => (prev ? `${prev} ${mentionTag}` : mentionTag));
    }

    setShowHashSlashMenu(false);
    setHashSlashQuery('');
    toast.success(`Mentioned project #${proj.name}`);
    textareaRef.current?.focus();
  };

  const selectRequirementTicket = (req: Requirement) => {
    const trig = hashSlashTrigger || '#';
    const trigIndex = inputText.lastIndexOf(trig);
    const mentionTag = `#${req.id} `;

    if (trigIndex !== -1) {
      const before = inputText.slice(0, trigIndex);
      const after = inputText.slice(trigIndex);
      const queryEnd = after.indexOf(' ');
      const remainder = queryEnd !== -1 ? after.slice(queryEnd) : '';
      setInputText(`${before}${mentionTag}${remainder}`);
    } else {
      setInputText((prev) => (prev ? `${prev} ${mentionTag}` : mentionTag));
    }

    setShowHashSlashMenu(false);
    setHashSlashQuery('');
    toast.success(`Mentioned ticket #${req.id}: ${req.title}`);
    textareaRef.current?.focus();
  };

  const selectCommand = (cmd: { command: string }) => {
    const slashIndex = inputText.lastIndexOf('/');
    const commandTag = `${cmd.command} `;

    if (slashIndex !== -1) {
      const before = inputText.slice(0, slashIndex);
      const after = inputText.slice(slashIndex);
      const queryEnd = after.indexOf(' ');
      const remainder = queryEnd !== -1 ? after.slice(queryEnd) : '';
      setInputText(`${before}${commandTag}${remainder}`);
    } else {
      setInputText((prev) => (prev ? `${prev} ${commandTag}` : commandTag));
    }

    setShowHashSlashMenu(false);
    setHashSlashQuery('');
    textareaRef.current?.focus();
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

    // Navigate # or / menu
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

  const handleSendMessage = async (customPrompt?: string) => {
    const text = (customPrompt !== undefined ? customPrompt : inputText).trim();
    if (!text && attachedFiles.length === 0) return;
    if (isSending) return;

    // Check slash commands
    if (isChatCommand(text, 'create') || isChatCommand(text, 'extract')) {
      setInputText('');
      setAttachedFiles([]);
      setShowMentionMenu(false);
      setShowHashSlashMenu(false);
      handleExtractRequirementTool();
      return;
    }
    if (isChatCommand(text, 'summarize')) {
      setInputText('');
      setAttachedFiles([]);
      setShowMentionMenu(false);
      setShowHashSlashMenu(false);
      handleSummarizeTool();
      return;
    }
    if (isChatCommand(text, 'inspect')) {
      setInputText('');
      setAttachedFiles([]);
      setShowMentionMenu(false);
      setShowHashSlashMenu(false);
      handleInspectTool();
      return;
    }
    if (isChatCommand(text, 'clear')) {
      setMessages([]);
      setSessionId(null);
      setInputText('');
      setAttachedFiles([]);
      setShowMentionMenu(false);
      setShowHashSlashMenu(false);
      toast.success('Chat history cleared');
      return;
    }

    if (!customPrompt) {
      setInputText('');
    }

    const sendingFiles = [...attachedFiles];
    setAttachedFiles([]);
    setShowMentionMenu(false);
    setShowHashSlashMenu(false);

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text || '(Attached files)',
      timestamp: new Date(),
      attachments: sendingFiles.length > 0 ? sendingFiles : undefined,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);

    try {
      const activeSessionId = await getOrCreateSession();

      // Grounding context from current page
      let pageContext = '';
      if (pageContent) {
        pageContext = `\n\n[Active Webpage Context]\nURL: ${pageContent.url}\nTitle: ${pageContent.title}\n`;
        if (pageContent.headings?.length) {
          pageContext += `Headings: ${pageContent.headings.slice(0, 10).join(' | ')}\n`;
        }
        if (pageContent.textContent) {
          pageContext += `Content:\n${pageContent.textContent.slice(0, 8000)}\n`;
        }
      }

      const fullPrompt = `${text || '(Attached files)'}${pageContext ? `\n\n--- Page Grounding Context ---\n${pageContext}` : ''}`;

      const res = await sendAiSessionMessage(activeSessionId, {
        content: fullPrompt,
        attachments: sendingFiles.length > 0 ? sendingFiles : undefined,
        provider: selectedEngine !== 'auto' ? (selectedEngine as any) : undefined,
        model: selectedModel !== 'default' ? selectedModel : undefined,
        effort: selectedEffort,
      });

      const assistantMsg: Message = {
        id: `asst-${Date.now()}`,
        role: 'assistant',
        content:
          res.message?.content?.trim() ||
          'No response was returned by the AI assistant. Please check your AI engine settings in Workspace Settings.',
        timestamp: new Date(),
        tools_used: res.message?.tools_used,
      };

      setMessages((prev) => [...prev, assistantMsg]);
      refetchSessions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to get AI response');
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **Error**: ${err.message || 'Failed to process AI request. Please check engine settings.'}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  // Tool 1: Summarize Page
  const handleSummarizeTool = () => {
    const prompt = 'Please summarize this page thoroughly. Outline the core functionality, technical stack, architecture patterns, and main takeaways.';
    handleSendMessage(prompt);
  };

  // Tool 2: Extract Requirement
  const handleExtractRequirementTool = () => {
    const prompt = 'Analyze the specifications and capabilities described on this page. Extract an actionable development requirement candidate with: Title, Scope, Implementation Plan, and Acceptance Criteria.';
    handleSendMessage(prompt);
  };

  // Tool 3: Inspect & Explain
  const handleInspectTool = () => {
    const prompt = 'Inspect the technical details on this page. Explain key APIs, code snippets, data contracts, and any gotchas developers should know about.';
    handleSendMessage(prompt);
  };

  // Tool 4: Ask Page
  const handleAskPageTool = () => {
    setInputText('What are the key technical requirements described on this page?');
    textareaRef.current?.focus();
  };

  // External trigger listener (from BrowserNavBar or other triggers)
  useEffect(() => {
    if (externalToolTrigger && externalToolTrigger.timestamp > lastTriggerRef.current) {
      lastTriggerRef.current = externalToolTrigger.timestamp;
      if (externalToolTrigger.id === 'summarize') handleSummarizeTool();
      else if (externalToolTrigger.id === 'extract') handleExtractRequirementTool();
      else if (externalToolTrigger.id === 'inspect') handleInspectTool();
      else if (externalToolTrigger.id === 'ask') handleAskPageTool();
    }
  }, [externalToolTrigger]);

  // Switch to an existing chat session
  const handleSelectSession = async (sess: AiChatSession) => {
    try {
      setIsSessionPopoverOpen(false);
      setSessionId(sess.id);
      if (sess.provider) setSelectedEngine(sess.provider);
      setSelectedModel(sess.model || getModelForProvider(sess.provider || configuredDefaultProvider));
      setSelectedEffort(sess.effort || getEffortForProvider(sess.provider || configuredDefaultProvider));

      const fullSession = await fetchAiChatSession(sess.id);
      if (fullSession.messages && fullSession.messages.length > 0) {
        setMessages(
          fullSession.messages.map((m) => ({
            id: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content?.trim() || '*(No response recorded)*',
            timestamp: new Date(m.timestamp),
            attachments: m.attachments,
            tools_used: m.tools_used,
          }))
        );
      } else {
        setMessages([]);
      }
      toast.success(`Loaded "${sess.title}"`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load session');
    }
  };

  // Save active session ID for browser assistant
  useEffect(() => {
    if (sessionId) {
      try {
        localStorage.setItem(`sp_kickstack_browser_session_${workspaceId}`, sessionId);
      } catch {
        // ignore
      }
    }
  }, [sessionId, workspaceId]);

  // Restore previous active session for this workspace on first load
  const hasRestoredSessionRef = useRef(false);
  useEffect(() => {
    if (hasRestoredSessionRef.current || sessionId || sessions.length === 0) return;
    try {
      const savedId = localStorage.getItem(`sp_kickstack_browser_session_${workspaceId}`);
      if (savedId) {
        const matching = sessions.find((s) => s.id === savedId);
        if (matching) {
          hasRestoredSessionRef.current = true;
          handleSelectSession(matching);
        }
      }
    } catch {
      // ignore
    }
  }, [sessions, sessionId, workspaceId]);

  // Start a fresh chat session
  const handleNewChat = () => {
    setIsSessionPopoverOpen(false);
    setSessionId(null);
    try {
      localStorage.removeItem(`sp_kickstack_browser_session_${workspaceId}`);
    } catch {
      // ignore
    }
    setSelectedEngine(configuredDefaultProvider);
    setSelectedModel(getModelForProvider(configuredDefaultProvider));
    setSelectedEffort(getEffortForProvider(configuredDefaultProvider));
    setAttachedFiles([]);
    setShowMentionMenu(false);
    setShowHashSlashMenu(false);
    setMessages(
      pageContent?.title
        ? [
            {
              id: 'welcome',
              role: 'assistant',
              content: `👋 I have indexed **"${pageContent.title}"**.\n\nUse the **AI Web Tools** in the header or ask any question about the architecture, features, or code on this page.`,
              timestamp: new Date(),
            },
          ]
        : []
    );
    setInputText('');
    toast.info('Started new chat session');
  };

  // Delete chat session
  const handleDeleteSession = async (sId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteAiChatSession(sId);
      queryClient.setQueryData<AiChatSession[]>(['ai-chat-sessions', workspaceId], (old = []) =>
        old.filter((s) => s.id !== sId)
      );
      if (sessionId === sId) {
        try {
          localStorage.removeItem(`sp_kickstack_browser_session_${workspaceId}`);
        } catch {
          // ignore
        }
        handleNewChat();
      }
      toast.success('Session deleted');
    } catch {
      toast.error('Failed to delete session');
    }
  };

  // Engine changes
  const handleEngineChange = (newEngine: string) => {
    setSelectedEngine(newEngine);
    const defModel = getModelForProvider(newEngine);
    setSelectedModel(defModel);
    const defEffort = getEffortForProvider(newEngine);
    setSelectedEffort(defEffort);
    if (sessionId) {
      updateAiChatSession(sessionId, {
        provider: newEngine as any,
        model: defModel,
        effort: defEffort,
      }).catch(() => {});
      queryClient.setQueryData<AiChatSession[]>(['ai-chat-sessions', workspaceId], (old = []) =>
        old.map((s) => (s.id === sessionId ? { ...s, provider: newEngine as any, model: defModel, effort: defEffort } : s))
      );
    }
    toast.success(`Engine switched to ${newEngine}`);
  };

  // Model changes
  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    if (sessionId) {
      updateAiChatSession(sessionId, {
        model: newModel,
      }).catch(() => {});
      queryClient.setQueryData<AiChatSession[]>(['ai-chat-sessions', workspaceId], (old = []) =>
        old.map((s) => (s.id === sessionId ? { ...s, model: newModel } : s))
      );
    }
  };

  // Effort changes
  const handleEffortChange = (newEffort: ReasoningEffort) => {
    setSelectedEffort(newEffort);
    if (sessionId) {
      updateAiChatSession(sessionId, {
        effort: newEffort,
      }).catch(() => {});
      queryClient.setQueryData<AiChatSession[]>(['ai-chat-sessions', workspaceId], (old = []) =>
        old.map((s) => (s.id === sessionId ? { ...s, effort: newEffort } : s))
      );
    }
  };

  const handleCopyRequirement = (content: string) => {
    const specBlockMatch = content.match(/```json:spec\s*([\s\S]*?)\s*```/);
    if (specBlockMatch) {
      try {
        const parsed = JSON.parse(specBlockMatch[1]);
        const formatted = `# ${parsed.title || 'Extracted Feature'}

## Goal
${parsed.goal || ''}

## User Story
${parsed.user_story || ''}

## Acceptance Criteria
${(parsed.acceptance_criteria || []).map((c: string) => `- [ ] ${c}`).join('\n')}

${parsed.api_hints ? `## API Hints\n\`${parsed.api_hints}\`\n` : ''}`;
        navigator.clipboard.writeText(formatted);
        toast.success(`Copied "${parsed.title || 'Requirement'}" to clipboard! Opening Requirement Sheet...`);
        openSheet();
        return;
      } catch {}
    }
    navigator.clipboard.writeText(content);
    toast.success('Extracted content copied to clipboard! Opening Requirement Sheet...');
    openSheet();
  };

  const currentProviderObj =
    PROVIDER_OPTIONS.find((p) => p.id === selectedEngine) || PROVIDER_OPTIONS[0];
  const availableModels = MODEL_OPTIONS_MAP[selectedEngine] || [{ id: 'default', name: 'Default Model' }];
  const currentModelObj =
    availableModels.find((m) => m.id === selectedModel) || availableModels[0];

  return (
    <div className="flex flex-col h-full bg-[#fbfcfd] dark:bg-[#161720] border-l border-slate-200 dark:border-[#2d2f3d]">
      {/* 1. TOP HEADER: Session Selector (Left) & Engine / Model Config (Right) */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1b1c26] gap-2">
        {/* Session Selector Popover */}
        <Popover open={isSessionPopoverOpen} onOpenChange={setIsSessionPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#14151e] hover:bg-slate-100 dark:hover:bg-[#20212d] text-slate-800 dark:text-slate-100 transition-colors shadow-2xs max-w-[190px]"
              title="Select Chat Session"
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="truncate">
                {currentSession ? currentSession.title : 'New Browser Chat'}
              </span>
              <ChevronDown className="w-3 h-3 text-slate-400 shrink-0 ml-0.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-2 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Chat Sessions ({sessions.length})
              </span>
              <button
                type="button"
                onClick={handleNewChat}
                className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                New Chat
              </button>
            </div>

            {/* Session Search */}
            {sessions.length > 2 && (
              <div className="relative">
                <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                  placeholder="Filter sessions..."
                  className="w-full pl-7 pr-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#14151e] text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            )}

            {/* Sessions List */}
            <div className="max-h-60 overflow-y-auto space-y-1 pr-0.5">
              {filteredSessions.length === 0 ? (
                <div className="text-center py-4 text-xs text-slate-400">No chat sessions found.</div>
              ) : (
                filteredSessions.map((s) => {
                  const isSelected = s.id === sessionId;
                  return (
                    <div
                      key={s.id}
                      onClick={() => handleSelectSession(s)}
                      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-medium'
                          : 'hover:bg-slate-100 dark:hover:bg-[#20212d] text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{s.title}</span>
                          {s.provider && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-slate-200 dark:bg-[#2d2f3d] text-slate-600 dark:text-slate-300 font-mono">
                              {s.provider.replace('-cli', '')}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{new Date(s.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(s.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-400 hover:text-red-500 transition-all"
                          title="Delete Session"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Engine / Model / Effort Config Popover */}
        <Popover open={isEnginePopoverOpen} onOpenChange={setIsEnginePopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#14151e] hover:bg-slate-100 dark:hover:bg-[#20212d] text-slate-800 dark:text-slate-200 transition-colors shadow-2xs truncate"
              title="AI Engine & Model Configuration"
            >
              <Zap className="w-3 h-3 text-indigo-500 shrink-0" />
              <span className="truncate max-w-[110px]">
                {currentProviderObj.name.split(' ')[0]} · {currentModelObj.name.split(' ')[0]}
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
                {availableProviders.map((opt) => {
                  const isSelected = selectedEngine === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleEngineChange(opt.id)}
                      className={`w-full flex items-start justify-between p-1.5 rounded-lg text-left text-xs transition-colors ${
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
                Model Preset ({selectedEngine})
              </div>
              <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5">
                {availableModels.map((m) => {
                  const isSelected = selectedModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleModelChange(m.id)}
                      className={`w-full flex items-start justify-between p-1.5 rounded-lg text-left text-xs transition-colors ${
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
                      onClick={() => handleEffortChange(eff.id)}
                      className={`py-1 text-center rounded-md text-[11px] font-medium transition-colors ${
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

      {/* 2. HEADER ACTION ROW: AI Web Tools (Moved to Header, compact & clean) */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-200 dark:border-[#2d2f3d] bg-slate-50/80 dark:bg-[#181923] overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 shrink-0 mr-1">
          <Wand2 className="w-3 h-3 text-indigo-500" />
          Tools
        </div>

        <button
          type="button"
          onClick={handleSummarizeTool}
          disabled={isSending || isLoadingPage}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1e1f2b] text-slate-700 dark:text-slate-200 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all text-xs font-medium shrink-0 disabled:opacity-50 shadow-2xs"
          title="Summarize page architecture, technical stack and key takeaways"
        >
          <Search className="w-3 h-3 text-blue-500 shrink-0" />
          <span>Summarize</span>
        </button>

        <button
          type="button"
          onClick={handleExtractRequirementTool}
          disabled={isSending || isLoadingPage}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1e1f2b] text-slate-700 dark:text-slate-200 hover:border-purple-400 hover:text-purple-600 dark:hover:text-purple-400 transition-all text-xs font-medium shrink-0 disabled:opacity-50 shadow-2xs"
          title="Extract actionable development requirement specification"
        >
          <FileText className="w-3 h-3 text-purple-500 shrink-0" />
          <span>Extract Spec</span>
        </button>

        <button
          type="button"
          onClick={handleInspectTool}
          disabled={isSending || isLoadingPage}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1e1f2b] text-slate-700 dark:text-slate-200 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all text-xs font-medium shrink-0 disabled:opacity-50 shadow-2xs"
          title="Inspect APIs, contracts, code snippets and technical details"
        >
          <Code2 className="w-3 h-3 text-emerald-500 shrink-0" />
          <span>Inspect APIs</span>
        </button>

        <button
          type="button"
          onClick={handleAskPageTool}
          disabled={isSending || isLoadingPage}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1e1f2b] text-slate-700 dark:text-slate-200 hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400 transition-all text-xs font-medium shrink-0 disabled:opacity-50 shadow-2xs"
          title="Freeform prompt focused on active page"
        >
          <MessageSquare className="w-3 h-3 text-amber-500 shrink-0" />
          <span>Ask Page</span>
        </button>
      </div>

      {/* 3. MESSAGES SCROLL AREA: 100% full height dedicated to conversation */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {messages.map((msg) => (
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
              {msg.role === 'assistant' && toolsUsedText(msg.tools_used) && (
                <div className="mt-1.5 text-[10px] text-slate-500 dark:text-slate-400">🔧 Tools used: {toolsUsedText(msg.tools_used)}</div>
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
                    className="flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </button>

                  <button
                    type="button"
                    onClick={() => handleCopyRequirement(msg.content)}
                    className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-medium transition-colors"
                  >
                    <PlusCircle className="w-3 h-3" />
                    Create Requirement
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {isSending && (
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

        <div ref={messagesEndRef} />
      </div>

      {/* 4. ATTACHED FILES PREVIEW TRAY */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-[#161722] border-t border-slate-200 dark:border-[#2d2f3d]">
          {attachedFiles.map((att, idx) => {
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
                  onClick={() => removeAttachedFile(idx)}
                  className="p-0.5 rounded hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-600 dark:text-purple-300"
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
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectMentionAsset(asset);
                    }}
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
                {filteredProjects.length} proj{hashSlashTrigger === '#' ? ` · ${filteredRequirements.length} tickets` : ''}
              </span>
            </div>

            {activeMenuItems.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-400">
                {hashSlashQuery
                  ? `No matching items for "${hashSlashQuery}"`
                  : 'No items found'}
              </div>
            ) : (
              <div className="space-y-1">
                {/* Projects Section */}
                {filteredProjects.length > 0 && (
                  <div>
                    <div className="px-2 py-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <FolderGit2 className="w-2.5 h-2.5 text-purple-500" />
                      Projects
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
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectProject(proj);
                          }}
                          onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-xs transition-colors ${
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
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectRequirementTicket(req);
                          }}
                          onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-xs transition-colors ${
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
                {hashSlashTrigger === '/' && availableCommands.length > 0 && (
                  <div className="pt-1 border-t border-slate-100 dark:border-[#2a2b38]/60">
                    <div className="px-2 py-0.5 text-[9px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <Terminal className="w-2.5 h-2.5 text-purple-500" />
                      Commands
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
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectCommand(cmd);
                          }}
                          onMouseEnter={() => setHashSlashSelectedIndex(itemIdx)}
                          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-left text-xs transition-colors ${
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
            ref={textareaRef}
            rows={2}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type @ for assets, # for projects/tickets, / for commands..."
            disabled={isSending}
            className="w-full resize-none p-2.5 pr-16 text-xs rounded-xl bg-slate-50 dark:bg-[#14151e] border border-slate-200 dark:border-[#2d2f3d] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition-all"
          />

          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            onChange={handleFileUpload}
          />

          <div className="absolute right-2 bottom-2.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#222432] transition-colors"
              title="Attach File"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => handleSendMessage()}
              disabled={(!inputText.trim() && attachedFiles.length === 0) || isSending}
              className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 transition-colors shadow-2xs"
              title="Send Message"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400 dark:text-slate-500">
          <span>Enter to send · Shift+Enter for newline</span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setSessionId(null);
                setAttachedFiles([]);
                toast.success('Chat history cleared');
              }}
              className="flex items-center gap-1 hover:text-red-500 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear Chat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
