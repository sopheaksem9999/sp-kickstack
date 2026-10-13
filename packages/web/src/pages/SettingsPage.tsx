import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../lib/ThemeContext.js';
import { useAppTabs } from '../lib/TabContext.js';
import {
  fetchSettings,
  updateBranchMergeSettings,
  updateAiCliSettings,
  fetchIdeSettings,
  updateIdeSettings,
  fetchIdeStatus,
  startIdeServer,
  stopIdeServer,
  fetchAiProviders,
  fetchDetectedIdes,
} from '../lib/api.js';
import { toast } from 'sonner';
import {
  Sun,
  Moon,
  Shield,
  Monitor,
  CheckCircle2,
  GitBranch,
  GitMerge,
  Save,
  Check,
  Bot,
  Sparkles,
  Terminal,
  Cpu,
  Edit3,
  ListFilter,
  Gauge,
  ChevronRight,
  Info,
  AlertTriangle,
  Code2,
  Power,
  ExternalLink,
  Bell,
  RefreshCw,
  Activity,
  Layers,
} from 'lucide-react';
import { NotificationSettingsSection } from '../components/NotificationSettingsSection.js';
import { branchPatternExamples } from '../lib/runSettings.js';
import { LocalEngineSettingsSection } from '../components/LocalEngineSettingsSection.js';
import { BranchMergePolicy, ReasoningEffort, EngineId } from '@sp-kickstack/shared';

export interface ModelPreset {
  id: string;
  name: string;
  provider: string;
  description: string;
  badge?: string;
  isLatest?: boolean;
}

export const CLAUDE_PRESETS: ModelPreset[] = [
  {
    id: 'default',
    name: 'Default (recommended)',
    provider: 'Claude Code (v5+)',
    description: 'Opus 5.5 · Best for everyday, complex tasks',
    badge: 'Opus 5.5',
    isLatest: true,
  },
  {
    id: 'opus',
    name: 'Opus (Opus 5.5)',
    provider: 'Claude Code (v5+)',
    description: 'Opus 5.5 · Best for everyday, complex tasks',
    badge: 'Opus 5.5',
    isLatest: true,
  },
  {
    id: 'fable',
    name: 'Fable (Fable 5.1)',
    provider: 'Claude Code (v5+)',
    description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
    badge: 'Fable 5.1',
    isLatest: true,
  },
  {
    id: 'sonnet',
    name: 'Sonnet (Sonnet 5.5)',
    provider: 'Claude Code (v5+)',
    description: 'Sonnet 5.5 · Efficient for routine tasks',
    badge: 'Sonnet 5.5',
    isLatest: true,
  },
  {
    id: 'haiku',
    name: 'Haiku (Haiku 5.5)',
    provider: 'Claude Code (v5+)',
    description: 'Haiku 5.5 · Fastest for quick answers',
    badge: 'Haiku 5.5',
    isLatest: true,
  },
  {
    id: 'sonnet-5',
    name: 'Sonnet 5',
    provider: 'Claude Code (v5+)',
    description: 'Sonnet 5 baseline',
    badge: 'Sonnet 5',
  },
];

export const AGY_PRESETS: ModelPreset[] = [
  // Antigravity Native / Gemini (Version 3+)
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    provider: 'Google Gemini (v3+)',
    description: 'Medium reasoning · Latest fast multimodal model',
    badge: 'v3.8 Flash',
    isLatest: true,
  },
  {
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    provider: 'Google Gemini (v3+)',
    description: 'Medium reasoning · Leaving soon',
    badge: 'Leaving Soon',
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    provider: 'Google Gemini (v3+)',
    description: 'Medium reasoning · Leaving soon',
    badge: 'Leaving Soon',
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    provider: 'Google Gemini (v3+)',
    description: 'Low effort · Leaving soon',
    badge: 'Leaving Soon',
  },
  // Claude via Antigravity (Version 4.6 >= 3)
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6 (Thinking)',
    provider: 'Claude via Antigravity',
    description: 'Deep chain-of-thought Claude routed through AGY',
    badge: 'Thinking',
  },
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6 (Thinking)',
    provider: 'Claude via Antigravity',
    description: 'Full flagship thinking Claude routed through AGY',
    badge: 'Thinking',
  },
  // Open Weights via Antigravity
  {
    id: 'gpt-oss-120b',
    name: 'GPT-OSS 120B (Medium)',
    provider: 'Open Weights via Antigravity',
    description: '120B open-weights reasoning model routed through AGY',
    badge: '120B',
  },
];

export const CODEX_PRESETS: ModelPreset[] = [
  {
    id: 'default',
    name: 'Codex Default',
    provider: 'OpenAI Codex',
    description: 'Default recommended model for Codex CLI (Medium reasoning)',
    badge: 'Recommended',
    isLatest: true,
  },
  {
    id: '6-luna',
    name: 'Codex 6 Luna',
    provider: 'OpenAI Codex',
    description: 'Codex 6 Luna next-generation model',
    badge: '6 Luna',
  },
  {
    id: '5.6-terra',
    name: 'Codex 5.6 Terra',
    provider: 'OpenAI Codex',
    description: 'Codex 5.6 Terra balanced model (Medium reasoning)',
    badge: '5.6 Terra',
  },
  {
    id: '5.6-luna',
    name: 'Codex 5.6 Luna',
    provider: 'OpenAI Codex',
    description: 'Codex 5.6 Luna fast and optimized model',
    badge: '5.6 Luna',
  },
  {
    id: '5.5',
    name: 'Codex 5.5',
    provider: 'OpenAI Codex',
    description: 'Codex 5.5 stable release',
    badge: 'v5.5',
  },
];

export const OLLAMA_PRESETS: ModelPreset[] = [
  {
    id: 'deepseek-r1:latest',
    name: 'DeepSeek R1',
    provider: 'Local / Ollama',
    description: 'Open reasoning model with transparent chain-of-thought',
    badge: 'Open Reasoning',
    isLatest: true,
  },
  {
    id: 'deepseek-r1:14b',
    name: 'DeepSeek R1 (14B)',
    provider: 'Local / Ollama',
    description: 'Balanced open reasoning model for local hardware',
    badge: '14B Local',
  },
  {
    id: 'deepseek-r1:8b',
    name: 'DeepSeek R1 (8B)',
    provider: 'Local / Ollama',
    description: 'Fast local reasoning model for everyday machines',
    badge: '8B Local',
  },
  {
    id: 'llama3.3:70b',
    name: 'Llama 3.3 (70B)',
    provider: 'Local / Ollama',
    description: 'Frontier-grade open-weights model by Meta',
    badge: 'Frontier Open',
  },
  {
    id: 'llama3.2',
    name: 'Llama 3.2 (3B)',
    provider: 'Local / Ollama',
    description: 'Ultra-fast lightweight local model',
    badge: 'Lightweight',
  },
  {
    id: 'qwen2.5-coder:32b',
    name: 'Qwen 2.5 Coder (32B)',
    provider: 'Local / Ollama',
    description: 'State-of-the-art open code model for generation & debugging',
    badge: 'Code SOTA',
  },
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen 2.5 Coder (7B)',
    provider: 'Local / Ollama',
    description: 'Efficient local code model for developer laptops',
    badge: 'Code Fast',
  },
  {
    id: 'phi4:latest',
    name: 'Phi-4 (14B)',
    provider: 'Local / Ollama',
    description: 'Microsoft state-of-the-art small language model',
    badge: 'Reasoning',
  },
  {
    id: 'mistral:latest',
    name: 'Mistral (7B)',
    provider: 'Local / Ollama',
    description: 'Standard lightweight general open model',
    badge: 'General',
  },
];

export const ALL_SYSTEM_ENGINES: Array<{
  id: EngineId;
  label: string;
  command: string;
  desc: string;
  badge: string;
  installTip: string;
}> = [
  {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    command: 'claude -p',
    desc: 'Runs local `claude -p` via ~/.local/bin/claude',
    badge: 'Claude Code',
    installTip: 'npm i -g @anthropic-ai/claude-code',
  },
  {
    id: 'agy-cli',
    label: 'Antigravity CLI (agy)',
    command: 'agy -p',
    desc: 'Runs local `agy -p` via ~/.local/bin/agy',
    badge: 'Google AGY',
    installTip: 'Installed via Antigravity SDK',
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    command: 'codex exec',
    desc: 'Runs local `codex exec` via ~/.local/bin/codex',
    badge: 'OpenAI Codex',
    installTip: 'npm i -g @openai/codex',
  },
  {
    id: 'ollama',
    label: 'Local Ollama',
    command: 'http://127.0.0.1:11434',
    desc: 'Uses local Ollama HTTP instance (e.g. llama3.2)',
    badge: 'Ollama Local',
    installTip: 'curl -fsSL https://ollama.com/install.sh',
  },
  {
    id: 'heuristic',
    label: 'Built-in Heuristic',
    command: 'Offline Core',
    desc: 'Zero-latency rules engine (100% offline, instant)',
    badge: 'Offline Rules',
    installTip: 'Built into SP-Kickstack Core',
  },
];

interface ModelSelectorProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  presets: ModelPreset[];
  quickPills?: string[];
  placeholder?: string;
  helperText?: string;
}

function ModelSelector({
  label,
  value,
  onChange,
  presets,
  quickPills = [],
  placeholder = 'Enter custom model ID...',
  helperText,
}: ModelSelectorProps) {
  const matchedPreset = presets.find((p) => p.id === value);
  const [isManual, setIsManual] = useState(!matchedPreset && Boolean(value));

  // If external value changes to something not in presets, keep or flip manual state
  useEffect(() => {
    if (!presets.some((p) => p.id === value) && value !== '') {
      setIsManual(true);
    }
  }, [value, presets]);

  // Group presets by provider
  const groupedPresets = presets.reduce<Record<string, ModelPreset[]>>((acc, p) => {
    acc[p.provider] = acc[p.provider] || [];
    acc[p.provider].push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
          {label}
        </label>
        <button
          type="button"
          onClick={() => setIsManual(!isManual)}
          className="text-[10px] font-semibold text-[#7b68ee] hover:text-[#6c5ce7] dark:text-[#9b8cfc] hover:underline flex items-center gap-1 transition-colors"
        >
          {isManual ? (
            <>
              <ListFilter className="w-3 h-3" />
              <span>Choose preset</span>
            </>
          ) : (
            <>
              <Edit3 className="w-3 h-3" />
              <span>Add manual model</span>
            </>
          )}
        </button>
      </div>

      {isManual ? (
        <div className="relative">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full px-2.5 py-1.5 pr-20 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
            Manual ID
          </span>
        </div>
      ) : (
        <select
          value={matchedPreset ? value : '__custom_value__'}
          onChange={(e) => {
            if (e.target.value === '__add_manual__') {
              setIsManual(true);
            } else if (e.target.value !== '__custom_value__') {
              onChange(e.target.value);
            }
          }}
          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
        >
          {!matchedPreset && value && (
            <option value="__custom_value__">
              Custom: {value}
            </option>
          )}
          {Object.entries(groupedPresets).map(([group, items]) => (
            <optgroup key={group} label={`── ${group} ──`}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.id}) {item.badge ? `[${item.badge}]` : ''}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="── Manual Option ──">
            <option value="__add_manual__">✏️ Custom / Add manual model ID...</option>
          </optgroup>
        </select>
      )}

      {/* Description or hint */}
      <div className="min-h-[16px] flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
        {matchedPreset ? (
          <span className="truncate">
            <span className="font-semibold text-slate-700 dark:text-slate-300">{matchedPreset.name}:</span>{' '}
            {matchedPreset.description}
          </span>
        ) : isManual ? (
          <span className="text-amber-600 dark:text-amber-400 font-medium truncate">
            Custom: <code className="font-mono text-slate-700 dark:text-slate-200">{value || '(empty)'}</code>
          </span>
        ) : (
          <span className="truncate">{helperText || 'Select a recommended model or add manually'}</span>
        )}
      </div>

      {/* Quick-select pills */}
      {quickPills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[10px] font-medium text-slate-400">Quick:</span>
          {quickPills.map((pillId) => {
            const isSelected = value === pillId;
            const presetItem = presets.find((p) => p.id === pillId);
            const pillLabel = presetItem ? presetItem.name.split(' (')[0] : pillId;
            return (
              <button
                key={pillId}
                type="button"
                onClick={() => {
                  onChange(pillId);
                  setIsManual(false);
                }}
                className={`text-[10px] px-2 py-0.5 rounded-md font-mono transition-all ${
                  isSelected
                    ? 'bg-[#7b68ee] text-white font-bold shadow-sm'
                    : 'bg-slate-200/60 dark:bg-[#2b2b2b] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#333333]'
                }`}
              >
                {pillLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ClaudeModeCardProps {
  model: string;
  onSelectModel: (model: string) => void;
  effort: ReasoningEffort;
  onChangeEffort: (effort: ReasoningEffort) => void;
  ultracode: boolean;
  onToggleUltracode: (val: boolean) => void;
}

export function ClaudeModeCard({
  model,
  onSelectModel,
  effort,
  onChangeEffort,
  ultracode,
  onToggleUltracode,
}: ClaudeModeCardProps) {
  const [showManual, setShowManual] = useState(
    !CLAUDE_PRESETS.some((p) => p.id === model) && Boolean(model)
  );

  const effortSteps: ReasoningEffort[] = ['low', 'medium', 'high', 'max'];
  const effortIndex = effortSteps.indexOf(effort) !== -1 ? effortSteps.indexOf(effort) : 1;

  const getEffortLabel = (lvl: ReasoningEffort) => {
    switch (lvl) {
      case 'low':
        return 'Low';
      case 'medium':
        return 'Medium';
      case 'high':
        return 'High';
      case 'max':
      case 'xhigh':
        return 'Max';
      default:
        return 'Medium';
    }
  };

  const primaryModels = [
    {
      id: 'default',
      name: 'Default (recommended)',
      desc: 'Opus 5.5 · Best for everyday, complex tasks',
    },
    {
      id: 'opus',
      name: 'Opus',
      desc: 'Opus 5.5 · Best for everyday, complex tasks',
    },
    {
      id: 'fable',
      name: 'Fable',
      desc: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
    },
    {
      id: 'sonnet',
      name: 'Sonnet',
      desc: 'Sonnet 5.5 · Efficient for routine tasks',
    },
    {
      id: 'haiku',
      name: 'Haiku',
      desc: 'Haiku 5.5 · Fastest for quick answers',
    },
    {
      id: 'sonnet-5',
      name: 'Sonnet 5',
      desc: 'Newer version available · select Sonnet for Sonnet 5.5',
    },
  ];

  return (
    <div className="bg-[#242735] dark:bg-[#1e2230] border border-[#343b4f] dark:border-[#2d3345] rounded-2xl p-4 text-white shadow-xl space-y-3 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] font-medium text-slate-400">
          Select a model
        </span>
        <button
          type="button"
          onClick={() => setShowManual(!showManual)}
          className="text-[11px] font-semibold text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
        >
          {showManual ? (
            <>
              <ListFilter className="w-3 h-3" />
              <span>Choose preset</span>
            </>
          ) : (
            <>
              <Edit3 className="w-3 h-3" />
              <span>Enter manual ID</span>
            </>
          )}
        </button>
      </div>

      {showManual ? (
        <div className="p-3 bg-[#171924] rounded-xl border border-[#2e3549] space-y-2">
          <label className="text-[11px] text-slate-400 font-semibold">
            Manual Model Identifier (--model)
          </label>
          <div className="relative">
            <input
              type="text"
              value={model}
              onChange={(e) => onSelectModel(e.target.value)}
              placeholder="e.g. sonnet, sonnet-5, opus, fable, haiku, or custom fine-tune"
              className="w-full px-3 py-2 pr-20 rounded-lg border border-[#3c445c] bg-[#0f1118] text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
              Manual ID
            </span>
          </div>
          <p className="text-[10px] text-slate-400">
            Type any model identifier to pass directly as <code className="font-mono text-purple-300">claude -p --model &lt;id&gt;</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {primaryModels.map((item) => {
            const isSelected = model === item.id;
            return (
              <div
                key={item.id}
                onClick={() => onSelectModel(item.id)}
                className={`px-3 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group ${
                  isSelected
                    ? 'bg-[#2f3549] text-white shadow-sm ring-1 ring-purple-500/50'
                    : 'hover:bg-[#282d3f] text-slate-200'
                }`}
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-white tracking-tight">
                      {item.name}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    {item.desc}
                  </p>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-purple-400 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer controls: Effort & Ultracode */}
      <div className="pt-2 border-t border-[#343b4f] dark:border-[#2d3345] space-y-3">
        {/* Effort row */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-slate-200">
            Effort ({getEffortLabel(effort)})
          </span>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#161823] border border-[#2e3549]">
            {effortSteps.map((lvl) => {
              const isActive = effortSteps[effortIndex] === lvl;
              return (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => onChangeEffort(lvl)}
                  title={`Effort: ${getEffortLabel(lvl)}`}
                  className={`relative flex items-center justify-center transition-all ${
                    isActive
                      ? 'w-6 h-4 rounded-full bg-[#8b5cf6] text-white shadow-sm'
                      : 'w-3 h-3 rounded-full hover:bg-slate-700/50 text-slate-500'
                  }`}
                >
                  <span
                    className={`rounded-full transition-all ${
                      isActive ? 'w-1.5 h-1.5 bg-white' : 'w-1 h-1 bg-slate-500'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Ultracode row */}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-slate-200">
            Ultracode
          </span>
          <button
            type="button"
            onClick={() => onToggleUltracode(!ultracode)}
            className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 cursor-pointer ${
              ultracode ? 'bg-[#8b5cf6]' : 'bg-[#3b4154]'
            }`}
          >
            <span
              className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform ${
                ultracode ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

interface AgyModeCardProps {
  model: string;
  onSelectModel: (model: string) => void;
  effort: ReasoningEffort;
  onChangeEffort: (effort: ReasoningEffort) => void;
  onOpenUsage?: () => void;
}

export function AgyModeCard({
  model,
  onSelectModel,
  effort,
  onChangeEffort,
  onOpenUsage,
}: AgyModeCardProps) {
  const [showManual, setShowManual] = useState(
    !AGY_PRESETS.some((p) => p.id === model) && Boolean(model)
  );

  const agyModels = [
    {
      id: 'gemini-3.8-flash',
      title: 'Gemini 3.8 Flash',
      subtext: 'Medium',
      badge: null,
      hasArrow: false,
      recommendedEffort: 'medium' as ReasoningEffort,
    },
    {
      id: 'gemini-3.7-flash',
      title: 'Gemini 3.7 Flash',
      subtext: 'Medium',
      badge: 'leaving_soon',
      hasArrow: true,
      recommendedEffort: 'medium' as ReasoningEffort,
    },
    {
      id: 'gemini-3.6-flash',
      title: 'Gemini 3.6 Flash',
      subtext: 'Medium',
      badge: 'leaving_soon',
      hasArrow: true,
      recommendedEffort: 'medium' as ReasoningEffort,
    },
    {
      id: 'gemini-3.1-pro',
      title: 'Gemini 3.1 Pro',
      subtext: 'Low',
      badge: 'leaving_soon',
      hasArrow: true,
      recommendedEffort: 'low' as ReasoningEffort,
    },
    {
      id: 'claude-sonnet-4.6',
      title: 'Claude Sonnet 4.6 (Thinking)',
      subtext: null,
      badge: 'notice',
      hasArrow: false,
      recommendedEffort: 'high' as ReasoningEffort,
    },
    {
      id: 'claude-opus-4.6',
      title: 'Claude Opus 4.6 (Thinking)',
      subtext: null,
      badge: 'notice',
      hasArrow: false,
      recommendedEffort: 'max' as ReasoningEffort,
    },
    {
      id: 'gpt-oss-120b',
      title: 'GPT-OSS 120B (Medium)',
      subtext: null,
      badge: 'notice',
      hasArrow: false,
      recommendedEffort: 'medium' as ReasoningEffort,
    },
  ];

  return (
    <div className="bg-[#242735] dark:bg-[#1e2230] border border-[#343b4f] dark:border-[#2d3345] rounded-2xl p-4 text-white shadow-xl space-y-3 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] font-medium text-slate-400">
          Model
        </span>
        <button
          type="button"
          onClick={() => setShowManual(!showManual)}
          className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
        >
          {showManual ? (
            <>
              <ListFilter className="w-3 h-3" />
              <span>Choose preset</span>
            </>
          ) : (
            <>
              <Edit3 className="w-3 h-3" />
              <span>Enter manual ID</span>
            </>
          )}
        </button>
      </div>

      {showManual ? (
        <div className="p-3 bg-[#171924] rounded-xl border border-[#2e3549] space-y-2">
          <label className="text-[11px] text-slate-400 font-semibold">
            Manual Antigravity Model Identifier (--model)
          </label>
          <div className="relative">
            <input
              type="text"
              value={model}
              onChange={(e) => onSelectModel(e.target.value)}
              placeholder="e.g. gemini-3.8-flash, gemini-2.5-pro, or custom"
              className="w-full px-3 py-2 pr-20 rounded-lg border border-[#3c445c] bg-[#0f1118] text-xs font-mono text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60">
              Manual ID
            </span>
          </div>
          <p className="text-[10px] text-slate-400">
            Passed to Antigravity CLI as <code className="font-mono text-cyan-300">agy -p --model &lt;id&gt;</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {agyModels.map((item) => {
            const isSelected = model === item.id;
            return (
              <div
                key={item.id}
                onClick={() => {
                  onSelectModel(item.id);
                  if (item.recommendedEffort) {
                    onChangeEffort(item.recommendedEffort);
                  }
                }}
                className={`px-3 py-2 rounded-xl cursor-pointer transition-all flex items-center justify-between group ${
                  isSelected
                    ? 'bg-[#2f3549] text-white shadow-sm ring-1 ring-cyan-500/50'
                    : 'hover:bg-[#282d3f] text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap min-w-0 pr-2">
                  <span className="text-[13px] font-semibold text-white tracking-tight">
                    {item.title}
                  </span>
                  {item.subtext && (
                    <span className="text-[12px] text-slate-400 font-normal">
                      {item.subtext}
                    </span>
                  )}
                  {item.badge === 'leaving_soon' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#2a3043] text-slate-300 border border-slate-600/40">
                      Leaving Soon
                      <Info className="w-2.5 h-2.5 text-slate-400" />
                    </span>
                  )}
                  {item.badge === 'notice' && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#2a3043] text-slate-300 border border-slate-600/40">
                      <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                      Notice
                      <Info className="w-2.5 h-2.5 text-slate-400" />
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isSelected && (
                    <Check className="w-4 h-4 text-cyan-400" />
                  )}
                  {item.hasArrow && !isSelected && (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 transition-colors" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: View Usage / Metrics row matching the screenshot */}
      <div className="pt-2 border-t border-[#343b4f] dark:border-[#2d3345] flex items-center justify-between px-1">
        <div
          className="flex items-center gap-2 text-xs text-slate-300 hover:text-white cursor-pointer transition-colors"
          onClick={() => {
            if (onOpenUsage) onOpenUsage();
          }}
        >
          <Gauge className="w-4 h-4 text-slate-400" />
          <span className="font-medium">View Usage</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span>Effort: <strong className="text-cyan-400 capitalize">{effort}</strong></span>
          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
        </div>
      </div>
    </div>
  );
}

export type SettingsTab = 'ai' | 'git' | 'ide' | 'appearance' | 'safety' | 'notifications';
export const VALID_TABS: SettingsTab[] = ['ai', 'git', 'ide', 'appearance', 'safety', 'notifications'];

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { isTabBarEnabled, setIsTabBarEnabled } = useAppTabs();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab') as SettingsTab | null;
  const initialTab: SettingsTab =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : 'ai';

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Sync activeTab with URL search params (supports back/forward browser history & direct links)
  useEffect(() => {
    const currentParam = searchParams.get('tab') as SettingsTab | null;
    const resolvedTab = currentParam && VALID_TABS.includes(currentParam) ? currentParam : 'ai';
    if (resolvedTab !== activeTab) {
      setActiveTab(resolvedTab);
    }
  }, [searchParams]);

  const handleTabChange = (newTab: SettingsTab) => {
    setActiveTab(newTab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', newTab);
    setSearchParams(nextParams);
  };

  const { data: settingsData } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const { data: aiProviders, refetch: refetchAiProviders } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: fetchAiProviders,
    refetchInterval: activeTab === 'ai' ? 8000 : false,
  });

  // Embedded IDE Settings
  const [idePort, setIdePort] = useState(8443);
  const [ideBinaryPath, setIdeBinaryPath] = useState('');
  const [ideExternalUrl, setIdeExternalUrl] = useState('');
  const [ideAutoStart, setIdeAutoStart] = useState(false);

  const { data: ideStatus } = useQuery({
    queryKey: ['ide-status'],
    queryFn: fetchIdeStatus,
    refetchInterval: activeTab === 'ide' ? 3000 : false,
  });

  const { data: ideSettingsData } = useQuery({
    queryKey: ['ide-settings'],
    queryFn: fetchIdeSettings,
  });

  const { data: detectedIdesList = [] } = useQuery({
    queryKey: ['detected-ides'],
    queryFn: fetchDetectedIdes,
  });

  const [idePreferredIde, setIdePreferredIde] = useState('');

  useEffect(() => {
    if (ideSettingsData) {
      setIdePort(ideSettingsData.port || 8443);
      setIdeBinaryPath(ideSettingsData.binaryPath || '');
      setIdeExternalUrl(ideSettingsData.externalUrl || '');
      setIdeAutoStart(Boolean(ideSettingsData.autoStart));
      setIdePreferredIde(ideSettingsData.preferredIde || '');
    }
  }, [ideSettingsData]);

  const updateIdeMutation = useMutation({
    mutationFn: () =>
      updateIdeIdeSettings(),
    onSuccess: () => {
      toast.success('IDE configuration saved');
      queryClient.invalidateQueries({ queryKey: ['ide-settings'] });
      queryClient.invalidateQueries({ queryKey: ['ide-status'] });
      queryClient.invalidateQueries({ queryKey: ['detected-ides'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save IDE settings');
    },
  });

  const updateIdeIdeSettings = () =>
    updateIdeSettings({
      port: Number(idePort) || 8443,
      binaryPath: ideBinaryPath.trim() || undefined,
      externalUrl: ideExternalUrl.trim() || undefined,
      autoStart: ideAutoStart,
      preferredIde: idePreferredIde || undefined,
    });

  const startIdeMutation = useMutation({
    mutationFn: () => startIdeServer({ port: Number(idePort) || 8443 }),
    onSuccess: () => {
      toast.success('Embedded IDE server started');
      queryClient.invalidateQueries({ queryKey: ['ide-status'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to start IDE server');
    },
  });

  const stopIdeMutation = useMutation({
    mutationFn: stopIdeServer,
    onSuccess: () => {
      toast.info('Embedded IDE server stopped');
      queryClient.invalidateQueries({ queryKey: ['ide-status'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to stop IDE server');
    },
  });

  // Branch Settings
  const [defaultBranch, setDefaultBranch] = useState('develop');
  const [mergePolicy, setMergePolicy] = useState<BranchMergePolicy>('manual_review_merge');
  const [taskBranchPattern, setTaskBranchPattern] = useState('{req}');
  const [pushBranches, setPushBranches] = useState(true);

  // AI CLI Settings
  const [enabledEngines, setEnabledEngines] = useState<EngineId[]>([
    'claude-cli',
    'agy-cli',
    'codex-cli',
    'ollama',
    'heuristic',
  ]);
  const [defaultProvider, setDefaultProvider] = useState<EngineId>('claude-cli');
  const [claudeModel, setClaudeModel] = useState('sonnet-5');
  const [claudeEffort, setClaudeEffort] = useState<ReasoningEffort>('medium');
  const [claudeUltracode, setClaudeUltracode] = useState(false);
  const [claudePath, setClaudePath] = useState('');

  const [agyModel, setAgyModel] = useState('gemini-3.8-flash');
  const [agyEffort, setAgyEffort] = useState<ReasoningEffort>('medium');
  const [agyPath, setAgyPath] = useState('');

  const [codexModel, setCodexModel] = useState('default');
  const [codexEffort, setCodexEffort] = useState<ReasoningEffort>('medium');
  const [codexPath, setCodexPath] = useState('');

  const [ollamaModel, setOllamaModel] = useState('llama3.2');
  const [ollamaUrl, setOllamaUrl] = useState('http://127.0.0.1:11434');

  useEffect(() => {
    if (settingsData?.branch_merge) {
      setDefaultBranch(settingsData.branch_merge.default_base_branch || 'develop');
      setMergePolicy(settingsData.branch_merge.merge_policy || 'manual_review_merge');
      setTaskBranchPattern(settingsData.branch_merge.task_branch_pattern || '{req}');
      setPushBranches(settingsData.branch_merge.push_branches !== false);
    }
    if (settingsData?.ai_cli) {
      const cli = settingsData.ai_cli;
      let activeList = enabledEngines;
      if (Array.isArray(cli.enabledEngines) && cli.enabledEngines.length > 0) {
        activeList = cli.enabledEngines;
        setEnabledEngines(cli.enabledEngines);
      }
      let prov = cli.defaultProvider || 'claude-cli';
      if (prov === 'auto' || !activeList.includes(prov as EngineId)) {
        prov = activeList[0] || 'claude-cli';
      }
      setDefaultProvider(prov as EngineId);
      setClaudeModel(cli.claude?.model || 'sonnet-5');
      setClaudeEffort(cli.claude?.effort || 'medium');
      setClaudeUltracode(Boolean(cli.claude?.ultracode));
      setClaudePath(cli.claude?.customPath || '');
      setAgyModel(cli.agy?.model || 'gemini-3.8-flash');
      setAgyEffort(cli.agy?.effort || 'medium');
      setAgyPath(cli.agy?.customPath || '');
      setCodexModel(cli.codex?.model || 'default');
      setCodexEffort(cli.codex?.effort || 'medium');
      setCodexPath(cli.codex?.customPath || '');
      setOllamaModel(cli.ollama?.model || 'llama3.2');
      setOllamaUrl(cli.ollama?.url || 'http://127.0.0.1:11434');
    }
  }, [settingsData]);

  const toggleEngine = (id: EngineId) => {
    setEnabledEngines((prev) => {
      let next: EngineId[];
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          toast.error('At least one engine must remain active in the system');
          return prev;
        }
        next = prev.filter((e) => e !== id);
      } else {
        next = [...prev, id];
      }

      if (!next.includes(defaultProvider)) {
        setDefaultProvider(next[0]);
      }
      return next;
    });
  };

  const updateBranchMutation = useMutation({
    mutationFn: () =>
      updateBranchMergeSettings({
        default_base_branch: defaultBranch.trim() || 'develop',
        merge_policy: mergePolicy,
        task_branch_pattern: taskBranchPattern.trim(),
        push_branches: pushBranches,
      }),
    onSuccess: () => {
      toast.success('Branch & merge rules saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save settings');
    },
  });

  const updateAiMutation = useMutation({
    mutationFn: () =>
      updateAiCliSettings({
        defaultProvider,
        enabledEngines,
        claude: {
          enabled: enabledEngines.includes('claude-cli'),
          model: claudeModel.trim() || 'sonnet-5',
          effort: claudeEffort,
          customPath: claudePath.trim() || undefined,
          ultracode: claudeUltracode,
        },
        agy: {
          enabled: enabledEngines.includes('agy-cli'),
          model: agyModel.trim() || 'gemini-3.8-flash',
          effort: agyEffort,
          customPath: agyPath.trim() || undefined,
        },
        codex: {
          enabled: enabledEngines.includes('codex-cli'),
          model: codexModel.trim() || 'default',
          effort: codexEffort,
          customPath: codexPath.trim() || undefined,
        },
        ollama: {
          enabled: enabledEngines.includes('ollama'),
          model: ollamaModel.trim() || 'llama3.2',
          effort: 'medium',
          url: ollamaUrl.trim() || 'http://127.0.0.1:11434',
        },
        heuristic: {
          enabled: enabledEngines.includes('heuristic'),
        },
      }),
    onSuccess: () => {
      toast.success('Local AI CLI configuration & active engines saved');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to save AI CLI settings');
    },
  });

  const tabs: {
    id: SettingsTab;
    label: string;
    sublabel: string;
    icon: typeof Bot;
    badge?: string;
  }[] = [
    {
      id: 'ai',
      label: 'AI & Local Engines',
      sublabel: 'Claude, AGY, Codex & Ollama',
      icon: Bot,
      badge: '100% Local',
    },
    {
      id: 'git',
      label: 'Git & Branch Rules',
      sublabel: 'Target branch & merge policy',
      icon: GitBranch,
    },
    { id: 'notifications', label: 'Notifications', sublabel: 'Slack, Telegram & webhooks', icon: Bell },
    {
      id: 'ide',
      label: 'Embedded IDE (VS Code)',
      sublabel: 'code-server & project review',
      icon: Code2,
      badge: 'Review & Diff',
    },
    {
      id: 'appearance',
      label: 'Appearance & Theme',
      sublabel: 'Light & dark workspace mode',
      icon: Monitor,
    },
    {
      id: 'safety',
      label: 'Safety & System Limits',
      sublabel: 'Depth caps & poll frequencies',
      icon: Shield,
    },
  ];

  return (
    <div className="w-full max-w-[1400px] mx-auto flex flex-col h-full min-h-0 space-y-4">
      {/* Top Header */}
      <div className="shrink-0">
        <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
          <span>Preferences & Control</span>
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Bridge Settings & Engine Control
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Configure local AI CLIs, models and reasoning effort, branch merge rules, and safety limits.
        </p>
      </div>

      {/* Main Layout: Fixed Left Tabs Sidebar + Scrollable Right Module Content */}
      <div className="flex flex-col md:flex-row gap-6 items-start flex-1 min-h-0 overflow-hidden">
        {/* Left Tabs Navigation */}
        <aside className="w-full md:w-64 shrink-0 bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-2.5 shadow-xs sticky top-0 self-start z-10">
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 hidden md:block">
            Modules
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-1 gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`w-full flex items-center gap-2.5 md:gap-3 px-2.5 md:px-3 py-2 md:py-2.5 rounded-xl text-left transition-all ${
                    isActive
                      ? 'bg-[#7b68ee]/10 dark:bg-[#7b68ee]/20 text-[#7b68ee] dark:text-purple-300 font-bold border border-[#7b68ee]/30 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2c2c2c] border border-transparent'
                  }`}
                >
                  <div
                    className={`p-1.5 md:p-2 rounded-lg shrink-0 transition-colors ${
                      isActive
                        ? 'bg-[#7b68ee] text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-[#1e1e1e] text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold truncate">{tab.label}</span>
                      {tab.badge && (
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 shrink-0 ml-1 hidden sm:inline-block">
                          {tab.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5 font-normal hidden md:block">
                      {tab.sublabel}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Content Area: Scroll Only Container */}
        <div className="flex-1 min-w-0 w-full h-full overflow-y-auto pr-2 pb-16 space-y-6">
          {/* ========================================================= */}
          {/* 1. AI CLI Configuration & Models */}
          {/* ========================================================= */}
          {activeTab === 'ai' && (
            <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-6 animate-in fade-in-50 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                <div className="flex items-center gap-2">
                  <Bot className="w-5 h-5 text-[#7b68ee]" />
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                      Local AI CLI Configuration & Default Engine
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Connect directly to your active local AI CLIs (`claude`, `agy`, or `ollama`).
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                  🔒 100% Local / Zero API Keys
                </span>
              </div>

              {/* Step 1: Select Active Engines for This System */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#7b68ee]/20 text-[#7b68ee] inline-flex items-center justify-center text-[11px] font-black">
                        1
                      </span>
                      <span>Select Active Engines for This System</span>
                    </label>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Choose which local AI engines to activate. Unselected engines will be hidden from default engine selectors, telemetry diagnostics, and model configuration below.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-purple-600 dark:text-purple-400 font-bold">
                    {enabledEngines.length} of {ALL_SYSTEM_ENGINES.length} Active
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ALL_SYSTEM_ENGINES.map((engine) => {
                    const isEnabled = enabledEngines.includes(engine.id);
                    const prov = aiProviders?.find((p) => p.id === engine.id);
                    const isInstalled = Boolean(prov?.installed);

                    return (
                      <div
                        key={engine.id}
                        onClick={() => toggleEngine(engine.id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between select-none ${
                          isEnabled
                            ? 'bg-purple-50/70 dark:bg-purple-950/30 border-[#7b68ee] ring-1 ring-[#7b68ee]/40 shadow-xs'
                            : 'bg-slate-50/60 dark:bg-[#181818] border-slate-200 dark:border-[#2a2a2a] opacity-60 hover:opacity-90'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <div
                                className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                                  isEnabled
                                    ? 'bg-[#7b68ee] border-[#7b68ee] text-white'
                                    : 'border-slate-300 dark:border-[#444] bg-white dark:bg-[#202020]'
                                }`}
                              >
                                {isEnabled && <Check className="w-3 h-3 stroke-[3]" />}
                              </div>
                              <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                {engine.label}
                              </span>
                            </div>

                            <span
                              className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded ${
                                isEnabled
                                  ? 'bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300'
                                  : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                              }`}
                            >
                              {isEnabled ? 'ACTIVE' : 'DISABLED'}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 leading-snug">
                            {engine.desc}
                          </p>

                          <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-[#282828] flex items-center justify-between gap-2 text-[10px]">
                            {isInstalled ? (
                              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-mono truncate">
                                <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                                <span className="truncate">Installed on PC</span>
                              </div>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400 font-mono truncate">
                                Not Detected
                              </span>
                            )}
                            <span className="text-slate-400 font-mono text-[9px]">
                              {engine.command}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Default Engine Radio Picker */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-[#2a2a2a]">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#7b68ee]/20 text-[#7b68ee] inline-flex items-center justify-center text-[11px] font-black">
                        2
                      </span>
                      <span>Default AI Engine for Requirement Drafting</span>
                    </label>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Primary engine used for requirement drafting. Showing only the engines enabled in Step 1.
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Click to select default
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ALL_SYSTEM_ENGINES.filter((e) => enabledEngines.includes(e.id)).map((engine) => {
                    const prov = aiProviders?.find((p) => p.id === engine.id);
                    const isInstalled = Boolean(prov?.installed);
                    const rl = prov?.rateLimit;
                    const isSelected = defaultProvider === engine.id;

                    return (
                      <div
                        key={engine.id}
                        onClick={() => setDefaultProvider(engine.id)}
                        className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between group ${
                          isSelected
                            ? 'bg-purple-50/80 dark:bg-purple-950/40 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                            : 'bg-slate-50 dark:bg-[#1a1a1a] border-slate-200 dark:border-[#2d2d2d] hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  !isInstalled
                                    ? 'bg-slate-400'
                                    : rl?.status === 'rate_limited'
                                    ? 'bg-rose-500 animate-ping'
                                    : rl?.status === 'unlimited'
                                    ? 'bg-cyan-400'
                                    : 'bg-emerald-500'
                                }`}
                              />
                              <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                {engine.label}
                              </span>
                            </div>

                            {isSelected ? (
                              <CheckCircle2 className="w-4 h-4 text-[#7b68ee] shrink-0" />
                            ) : (
                              <span className="text-[10px] font-mono text-slate-400 shrink-0">
                                {engine.badge}
                              </span>
                            )}
                          </div>

                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">
                            {engine.desc}
                          </p>

                          {/* Detected Path or Missing Notice */}
                          <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-[#282828] flex items-center justify-between gap-2 text-[10px]">
                            {isInstalled ? (
                              <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300 font-mono truncate">
                                <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                                <span className="truncate">
                                  {prov?.path || 'Ready on local PC'}
                                </span>
                              </div>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-300 font-mono truncate">
                                ✕ Not Detected
                              </span>
                            )}

                            <span
                              className={`px-1.5 py-0.2 rounded font-mono font-semibold shrink-0 text-[9px] ${
                                rl?.supportType === 'unlimited_offline'
                                  ? 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300'
                                  : rl?.status === 'rate_limited'
                                  ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                                  : 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                              }`}
                            >
                              {rl?.supportType === 'unlimited_offline'
                                ? '⚡ Unlimited'
                                : rl?.status === 'rate_limited'
                                ? '⚠️ Rate Limited'
                                : '🛡️ 429 Monitored'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Warning callout if selected provider is not installed */}
                {(() => {
                  const selectedProv = aiProviders?.find((p) => p.id === defaultProvider);
                  if (selectedProv && !selectedProv.installed) {
                    return (
                      <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <strong className="font-bold">
                            Engine Not Detected on Local PC: {selectedProv.name}
                          </strong>
                          <p className="text-[11px] opacity-90">
                            The selected engine was not found on your system PATH (~/.local/bin, /usr/local/bin, /opt/homebrew/bin). Running AI drafts or tasks will fail until you install the CLI or configure a custom executable path below.
                          </p>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* Live Rate Limit & Telemetry Dashboard */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200/70 dark:border-[#2d2d2d]">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <div>
                      <h3 className="font-bold text-xs text-slate-900 dark:text-white flex items-center gap-2">
                        <span>Engine Rate Limit & Telemetry Diagnostics</span>
                        <span className="text-[10px] font-mono px-2 py-0.2 rounded font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                          Live Monitor
                        </span>
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Real-time subprocess health, rate limit backoffs, and execution metrics.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => refetchAiProviders()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#222222] text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#282828] transition-colors"
                    title="Refresh Telemetry"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Refresh</span>
                  </button>
                </div>

                {/* Telemetry Comparison Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-[#2d2d2d] text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500">
                        <th className="pb-2 pl-2">Engine</th>
                        <th className="pb-2">Local Detection</th>
                        <th className="pb-2">Rate Limit Mode</th>
                        <th className="pb-2">Quota Health</th>
                        <th className="pb-2 text-right">Dispatches</th>
                        <th className="pb-2 text-right">Active</th>
                        <th className="pb-2 text-right pr-2">429 Pauses</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 dark:divide-[#252525]">
                      {(aiProviders || [])
                        .filter((prov) => enabledEngines.includes(prov.id as EngineId))
                        .map((prov) => {
                          const isSelected = prov.id === defaultProvider;
                          const rl = prov.rateLimit;
                          return (
                            <tr
                              key={prov.id}
                              className={`transition-colors ${
                                isSelected
                                  ? 'bg-purple-50/50 dark:bg-purple-950/20 font-medium'
                                  : 'hover:bg-slate-100/50 dark:hover:bg-[#222222]/50'
                              }`}
                            >
                              <td className="py-2.5 pl-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                      !prov.installed
                                        ? 'bg-slate-400'
                                        : rl?.status === 'rate_limited'
                                        ? 'bg-rose-500 animate-ping'
                                        : rl?.status === 'unlimited'
                                        ? 'bg-cyan-400'
                                        : 'bg-emerald-500'
                                    }`}
                                  />
                                  <div>
                                    <span className="font-bold text-slate-800 dark:text-slate-200">
                                      {prov.name}
                                    </span>
                                    {isSelected && (
                                      <span className="ml-1.5 text-[9px] font-mono px-1 py-0.2 rounded bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300 font-bold">
                                        DEFAULT
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5">
                                {prov.installed ? (
                                  <span className="text-[10px] font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/40 truncate max-w-[220px] inline-block">
                                    {prov.path || 'Available on PATH'}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                                    Not detected on PC
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5">
                                <span className="text-[11px] text-slate-600 dark:text-slate-400">
                                  {rl?.supportType === 'unlimited_offline'
                                    ? '100% Offline (Unlimited)'
                                    : 'Bridge 429 Backoff'}
                                </span>
                              </td>
                              <td className="py-2.5">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border ${
                                        rl?.status === 'rate_limited'
                                          ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300'
                                          : rl?.status === 'unlimited'
                                          ? 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-300'
                                          : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300'
                                      }`}
                                    >
                                      {rl?.status === 'rate_limited'
                                        ? 'PAUSED'
                                        : rl?.status === 'unlimited'
                                        ? 'UNLIMITED'
                                        : 'HEALTHY'}
                                    </span>
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                      Wk: {rl?.weeklyLimitRemainingPercent ?? 100}% · Sess: {rl?.sessionLimitRemainingPercent ?? 100}%
                                    </span>
                                  </div>
                                  {rl?.sessionResetsIn && rl?.supportType !== 'unlimited_offline' && (
                                    <div className="text-[9px] text-slate-400">
                                      {rl?.sessionResetsIn}
                                    </div>
                                  )}
                                </div>
                              </td>
                            <td className="py-2.5 text-right font-mono font-semibold text-slate-700 dark:text-slate-300">
                              {rl?.totalDispatches ?? 0}
                            </td>
                            <td className="py-2.5 text-right font-mono text-purple-600 dark:text-purple-400">
                              {rl?.activeTasks ?? 0}
                            </td>
                            <td className="py-2.5 text-right pr-2 font-mono text-amber-600 dark:text-amber-400">
                              {rl?.rateLimitEvents ?? 0}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Technical Explanation Callout */}
                <div className="p-3 rounded-lg bg-slate-100 dark:bg-[#20222e] border border-slate-200 dark:border-[#2d3040] text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800 dark:text-slate-200">
                    <Info className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    <span>How SP-Kickstack Monitors Engine Rate Limits</span>
                  </div>
                  <p>
                    Command-line AI tools (Claude Code, Google AGY, OpenAI Codex) use authenticated local developer sessions and <strong>do not provide interactive command-line rate-limit query flags</strong>.
                  </p>
                  <p>
                    Instead, SP-Kickstack’s Studio Bridge monitors all CLI subprocess execution streams. When an HTTP 429 rate limit occurs, the bridge automatically captures the rate limit, calculates a <code className="font-mono text-purple-600 dark:text-purple-400">paused_until</code> backoff timestamp, and pauses subsequent tasks to prevent token waste until the quota resets.
                  </p>
                </div>
              </div>

              {/* Step 4: Detail Cards per AI CLI */}
              <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-[#2a2a2a]">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#7b68ee]/20 text-[#7b68ee] inline-flex items-center justify-center text-[11px] font-black">
                      4
                    </span>
                    <span>Engine Configuration & Model Settings</span>
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Customize models, reasoning effort, and custom binary paths. Only active engines enabled in Step 1 are displayed.
                  </p>
                </div>

                {/* Claude Code CLI Settings */}
                {enabledEngines.includes('claude-cli') && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/70 dark:border-[#2d2d2d]">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      <h3 className="font-bold text-xs text-slate-900 dark:text-white">
                        Claude Code CLI Configuration
                      </h3>
                    </div>
                    <span className="text-[10px] font-mono text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-950/60 px-2 py-0.5 rounded font-bold">
                      claude -p
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                    {/* Claude Model Select Option */}
                    <ModelSelector
                      label="Claude Model (--model)"
                      value={claudeModel}
                      onChange={setClaudeModel}
                      presets={CLAUDE_PRESETS}
                      quickPills={['opus', 'sonnet', 'fable', 'haiku']}
                      placeholder="e.g. opus, sonnet, fable, haiku, or custom"
                      helperText="Select official Claude presets, OpenAI models, or add manual model ID"
                    />

                    {/* Reasoning Effort Select Option */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Reasoning Effort (--effort)
                      </label>
                      <select
                        value={claudeEffort}
                        onChange={(e) => setClaudeEffort(e.target.value as ReasoningEffort)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
                      >
                        <option value="low">Low (Fast, brief thinking)</option>
                        <option value="medium">Medium (Standard thinking effort)</option>
                        <option value="high">High (Deep complex reasoning)</option>
                        <option value="max">Max (Exhaustive chain-of-thought)</option>
                      </select>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="text-[10px] text-slate-400">Quick:</span>
                        {(['low', 'medium', 'high', 'max'] as ReasoningEffort[]).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setClaudeEffort(lvl)}
                            className={`text-[10px] px-2 py-0.5 rounded-md font-mono capitalize transition-all ${
                              claudeEffort === lvl
                                ? 'bg-[#7b68ee] text-white font-bold shadow-sm'
                                : 'bg-slate-200/60 dark:bg-[#2b2b2b] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#333333]'
                            }`}
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center pt-2 border-t border-slate-100 dark:border-[#262626]">
                    {/* Custom Binary Path */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Custom Claude Binary Path (Optional)
                      </label>
                      <input
                        type="text"
                        value={claudePath}
                        onChange={(e) => setClaudePath(e.target.value)}
                        placeholder="~/.local/bin/claude"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
                      />
                      <span className="text-[10px] text-slate-400">
                        Leave blank for auto-detect (~/.local/bin/claude)
                      </span>
                    </div>

                    {/* Ultracode Switch */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] mt-1 sm:mt-0">
                      <div>
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                          <span>Ultracode Mode</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded font-mono font-bold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300">
                            Auto Loop
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Automated iterative prompt-execution cycles
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setClaudeUltracode(!claudeUltracode)}
                        className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 cursor-pointer ${
                          claudeUltracode ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3b4154]'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform ${
                            claudeUltracode ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
                )}

                {/* Antigravity CLI (agy) Settings */}
                {enabledEngines.includes('agy-cli') && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/70 dark:border-[#2d2d2d]">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                      <h3 className="font-bold text-xs text-slate-900 dark:text-white">
                        Antigravity CLI (`agy`) Configuration
                      </h3>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-700 dark:text-cyan-300 bg-cyan-100 dark:bg-cyan-950/60 px-2 py-0.5 rounded font-bold">
                      agy -p
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                    {/* Antigravity Model Select Option */}
                    <ModelSelector
                      label="Antigravity Model (--model)"
                      value={agyModel}
                      onChange={setAgyModel}
                      presets={AGY_PRESETS}
                      quickPills={['gemini-3.8-flash', 'claude-sonnet-4.6', 'gpt-oss-120b']}
                      placeholder="e.g. gemini-3.8-flash, gemini-2.5-pro, or custom"
                      helperText="Select official Google Gemini, Claude Thinking, or open-weights model routed via agy"
                    />

                    {/* Antigravity Reasoning Effort Select Option */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Reasoning Effort
                      </label>
                      <select
                        value={agyEffort}
                        onChange={(e) => setAgyEffort(e.target.value as ReasoningEffort)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      >
                        <option value="low">Low (Fast)</option>
                        <option value="medium">Medium (Standard)</option>
                        <option value="high">High (Deep reasoning)</option>
                        <option value="max">Max (Thorough exploration)</option>
                      </select>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="text-[10px] text-slate-400">Quick:</span>
                        {(['low', 'medium', 'high', 'max'] as ReasoningEffort[]).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setAgyEffort(lvl)}
                            className={`text-[10px] px-2 py-0.5 rounded-md font-mono capitalize transition-all ${
                              agyEffort === lvl
                                ? 'bg-cyan-600 text-white font-bold shadow-sm'
                                : 'bg-slate-200/60 dark:bg-[#2b2b2b] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#333333]'
                            }`}
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Custom Binary Path */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-[#262626]">
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      Custom Antigravity Binary Path (Optional)
                    </label>
                    <input
                      type="text"
                      value={agyPath}
                      onChange={(e) => setAgyPath(e.target.value)}
                      placeholder="~/.local/bin/agy"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                    <span className="text-[10px] text-slate-400">
                      Leave blank for auto-detect (~/.local/bin/agy)
                    </span>
                  </div>
                </div>
                )}

                {/* Codex Settings */}
                {enabledEngines.includes('codex-cli') && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/70 dark:border-[#2d2d2d]">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-emerald-500" />
                      <h3 className="font-bold text-xs text-slate-900 dark:text-white">
                        Codex CLI Configuration
                      </h3>
                    </div>
                    <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded font-bold">
                      ~/.local/bin/codex
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                    {/* Model Select */}
                    <ModelSelector
                      label="Codex Model (--model)"
                      value={codexModel}
                      onChange={setCodexModel}
                      presets={CODEX_PRESETS}
                      quickPills={['default', '6-luna', '5.6-terra', '5.5']}
                      placeholder="default"
                      helperText="Target model passed via codex exec -m <model>"
                    />

                    {/* Reasoning Effort */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Reasoning Effort (-c model_reasoning_effort=)
                      </label>
                      <select
                        value={codexEffort}
                        onChange={(e) => setCodexEffort(e.target.value as ReasoningEffort)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="low">Low (Fast reasoning)</option>
                        <option value="medium">Medium (Balanced default)</option>
                        <option value="high">High (Deep reasoning)</option>
                        <option value="max">Max (Maximum depth)</option>
                      </select>
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <span className="text-[10px] text-slate-400">Quick:</span>
                        {(['low', 'medium', 'high', 'max'] as ReasoningEffort[]).map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setCodexEffort(lvl)}
                            className={`text-[10px] px-2 py-0.5 rounded-md font-mono capitalize transition-all ${
                              codexEffort === lvl
                                ? 'bg-emerald-600 text-white font-bold shadow-sm'
                                : 'bg-slate-200/60 dark:bg-[#2b2b2b] text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#333333]'
                            }`}
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Custom Binary Path */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-[#262626]">
                    <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      Custom Codex Binary Path (Optional)
                    </label>
                    <input
                      type="text"
                      value={codexPath}
                      onChange={(e) => setCodexPath(e.target.value)}
                      placeholder="~/.local/bin/codex"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <span className="text-[10px] text-slate-400">
                      Leave blank for auto-detect (~/.local/bin/codex)
                    </span>
                  </div>
                </div>
                )}

                {/* Ollama Settings */}
                {enabledEngines.includes('ollama') && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200/70 dark:border-[#2d2d2d]">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <h3 className="font-bold text-xs text-slate-900 dark:text-white">
                        Local Ollama Instance Configuration
                      </h3>
                    </div>
                    <span className="text-[10px] font-mono text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 rounded font-bold">
                      http://127.0.0.1:11434
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                    <ModelSelector
                      label="Ollama Model"
                      value={ollamaModel}
                      onChange={setOllamaModel}
                      presets={OLLAMA_PRESETS}
                      quickPills={['llama3.2', 'deepseek-r1:latest', 'qwen2.5-coder:7b']}
                      placeholder="llama3.2"
                      helperText="Local Ollama model name"
                    />

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                        Ollama Host URL
                      </label>
                      <input
                        type="text"
                        value={ollamaUrl}
                        onChange={(e) => setOllamaUrl(e.target.value)}
                        placeholder="http://127.0.0.1:11434"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202020] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
                      />
                      <span className="text-[10px] text-slate-400">
                        Default local endpoint: http://127.0.0.1:11434
                      </span>
                    </div>
                  </div>
                </div>
                )}

                {/* Heuristic Only Notice */}
                {!enabledEngines.includes('claude-cli') &&
                  !enabledEngines.includes('agy-cli') &&
                  !enabledEngines.includes('codex-cli') &&
                  !enabledEngines.includes('ollama') && (
                    <div className="p-6 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] text-center space-y-1 py-8">
                      <Cpu className="w-6 h-6 text-purple-500 mx-auto" />
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Built-in Heuristic Engine is Active
                      </h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                        The heuristic rules engine operates 100% offline with zero external dependencies, no API keys, and zero configuration needed.
                      </p>
                    </div>
                  )}
              </div>

              {/* Save AI Settings Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => updateAiMutation.mutate()}
                  disabled={updateAiMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#7b68ee] hover:bg-[#6c5ce7] text-white text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{updateAiMutation.isPending ? 'Saving...' : 'Save AI Configuration'}</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-4 animate-in fade-in-50 duration-150">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                <Bot className="w-5 h-5 text-[#7b68ee]" />
                <div>
                  <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">Local AI CLI engine</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Runs fan-out tasks with an AI CLI on this PC, each in its own copy of the repository.
                  </p>
                </div>
              </div>
              <LocalEngineSettingsSection />
            </div>
          )}

          {/* ========================================================= */}
          {/* 2. Git Branch & Merge Strategy */}
          {/* ========================================================= */}
          {activeTab === 'git' && (
            <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-5 animate-in fade-in-50 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-[#7b68ee]" />
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                      Git Branch & Merge Strategy Rule
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Configure target implementation branches and review requirements.
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                  Rule Config
                </span>
              </div>

              {/* Default Target Branch */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Default Implementation Base Branch
                </label>
                <div className="flex items-center gap-2 max-w-sm">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-slate-400 font-mono text-xs">🌿</span>
                    <input
                      type="text"
                      value={defaultBranch}
                      onChange={(e) => setDefaultBranch(e.target.value)}
                      placeholder="develop"
                      className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#1a1a1a] font-mono text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7b68ee]"
                    />
                  </div>
                  <span className="text-xs text-slate-400">Default: <code className="text-[#7b68ee]">develop</code></span>
                </div>
                <p className="text-[11px] text-slate-400">
                  All feature fan-outs and agent runs will target this branch by default instead of production main.
                </p>
              </div>

              {/* Merge Policy Selector */}
              <div className="space-y-2 pt-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  Merge Policy
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    onClick={() => setMergePolicy('manual_review_merge')}
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                      mergePolicy === 'manual_review_merge'
                        ? 'bg-purple-50/70 dark:bg-purple-950/40 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                        : 'bg-slate-50 dark:bg-[#1a1a1a] border-slate-200 dark:border-[#2d2d2d] hover:border-slate-300'
                    }`}
                  >
                    <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/60 text-[#7b68ee] mt-0.5">
                      <GitMerge className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-xs text-slate-900 dark:text-white">
                          Review first
                        </h3>
                        {mergePolicy === 'manual_review_merge' && (
                          <CheckCircle2 className="w-4 h-4 text-[#7b68ee]" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        Each task works on its own branch. A person reviews the changes, then moving the requirement to <strong>QA</strong> (or <strong>&quot;Merge &amp; move to QA&quot;</strong>) merges every branch into the base branch, after the project tests pass.
                      </p>
                    </div>
                  </div>

                  <div
                    onClick={() => setMergePolicy('auto_merge')}
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                      mergePolicy === 'auto_merge'
                        ? 'bg-purple-50/70 dark:bg-purple-950/40 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                        : 'bg-slate-50 dark:bg-[#1a1a1a] border-slate-200 dark:border-[#2d2d2d] hover:border-slate-300'
                    }`}
                  >
                    <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 mt-0.5">
                      <Check className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-xs text-slate-900 dark:text-white">
                          Auto-merge (no review)
                        </h3>
                        {mergePolicy === 'auto_merge' && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        As soon as all work for a requirement is in review, the bridge merges every task branch into the base branch (after the project tests pass), pushes, and moves it to <strong>QA</strong>.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#2d2d2d]">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300" htmlFor="task-branch-pattern">
                  Task branch name
                </label>
                <input
                  id="task-branch-pattern"
                  value={taskBranchPattern}
                  onChange={(e) => setTaskBranchPattern(e.target.value)}
                  className="w-full max-w-sm px-3 py-2 rounded-lg bg-slate-50 dark:bg-[#141414] border border-slate-300 dark:border-[#333333] text-xs font-mono"
                />
                {(() => {
                  const ex = branchPatternExamples(taskBranchPattern);
                  return ex.problem ? (
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">{ex.problem}</p>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      {'{req}'}, {'{task}'} and {'{project}'} are filled in. A goal gets <code>{ex.goal}</code>, a ticket <code>{ex.ticket}</code>; a taken name gets -2. Existing branches keep their names.
                    </p>
                  );
                })()}
                <div className="flex items-center justify-between max-w-sm">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Push branches to origin</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={pushBranches}
                    aria-label="Push branches to origin"
                    onClick={() => setPushBranches(!pushBranches)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${pushBranches ? 'bg-[#7b68ee]' : 'bg-slate-300 dark:bg-[#3a3a3a]'}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${pushBranches ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  New task and target branches, and agents' new commits, are pushed by the bridge. Never forced; a failed push only adds a line to the task's Logs.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => updateBranchMutation.mutate()}
                  disabled={updateBranchMutation.isPending || Boolean(branchPatternExamples(taskBranchPattern).problem)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#7b68ee] hover:bg-[#6c5ce7] text-white text-xs font-bold shadow-md shadow-purple-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{updateBranchMutation.isPending ? 'Saving...' : 'Save Branch & Merge Rules'}</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* Notifications: Slack, Telegram & webhooks */}
          {/* ========================================================= */}
          {activeTab === 'notifications' && (
            <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-5 animate-in fade-in-50 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                <div className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-[#7b68ee]" />
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                      Notifications
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Send events that need a person to Slack, Telegram or a webhook.
                    </p>
                  </div>
                </div>
              </div>

              <NotificationSettingsSection />
            </div>
          )}

          {/* ========================================================= */}
          {/* 3. Embedded IDE (VS Code / code-server) */}
          {/* ========================================================= */}
          {activeTab === 'ide' && (
            <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-6 animate-in fade-in-50 duration-150">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                <div className="flex items-center gap-2">
                  <Code2 className="w-5 h-5 text-blue-500" />
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                      Embedded VS Code & In-App Project Review
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Configure local code-server or openvscode-server to review code and git changes before merging to main.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        ideStatus?.running ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                      }`}
                    />
                    <span>{ideStatus?.running ? `Online (Port ${ideStatus?.port})` : 'Offline'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => (ideStatus?.running ? stopIdeMutation.mutate() : startIdeMutation.mutate())}
                    disabled={startIdeMutation.isPending || stopIdeMutation.isPending}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      ideStatus?.running
                        ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 hover:bg-rose-200'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>{ideStatus?.running ? 'Stop Server' : 'Start Server'}</span>
                  </button>
                </div>
              </div>

              {/* Status Banner */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Binary Detection</span>
                  {ideStatus?.installed ? (
                    <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 rounded font-bold">
                      ✓ Installed: {ideStatus.binaryPath}
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono text-rose-600 dark:text-rose-400 bg-rose-100 dark:bg-rose-950/60 px-2 py-0.5 rounded font-bold">
                      Not found on PATH
                    </span>
                  )}
                </div>

                {!ideStatus?.installed && (
                  <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40 text-xs text-slate-600 dark:text-slate-300 space-y-2">
                    <p className="font-bold text-blue-700 dark:text-blue-300">
                      💡 Quick Setup (macOS / Linux):
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      Run <code className="font-mono bg-white dark:bg-slate-900 px-1 py-0.5 rounded border border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400">brew install code-server</code> or <code className="font-mono bg-white dark:bg-slate-900 px-1 py-0.5 rounded border border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400">npm install -g code-server</code> in your terminal.
                    </p>
                  </div>
                )}
              </div>

              {/* Installed PC IDEs Detection & Preferred Launcher */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Detected Local IDEs on PC
                  </span>
                  <span className="text-[11px] font-mono font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded">
                    {detectedIdesList.length} IDE{detectedIdesList.length === 1 ? '' : 's'} detected
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                  {detectedIdesList.map((ide) => (
                    <div
                      key={ide.id}
                      className={`p-2.5 rounded-lg border text-xs flex flex-col justify-between ${
                        ide.id === idePreferredIde || (!idePreferredIde && ide.isDefault)
                          ? 'bg-purple-50/60 dark:bg-purple-950/40 border-purple-300 dark:border-purple-800/60'
                          : 'bg-white dark:bg-[#202128] border-slate-200 dark:border-[#2d2f3d]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-800 dark:text-slate-200">{ide.name}</span>
                        {(ide.id === idePreferredIde || (!idePreferredIde && ide.isDefault)) && (
                          <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400">
                            ★ Active Default
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 truncate" title={ide.appPath || ide.command}>
                        {ide.appPath || ide.command || 'Installed'}
                      </span>
                    </div>
                  ))}
                  {detectedIdesList.length === 0 && (
                    <div className="col-span-full text-xs text-slate-500 py-2">
                      No standalone IDE apps detected on default paths. You can still use the default system editor or web code-server.
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-200 dark:border-[#2d2d2d] space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    Preferred Default IDE (Opened when clicking "Open in IDE" across projects)
                  </label>
                  <select
                    value={idePreferredIde}
                    onChange={(e) => setIdePreferredIde(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#333333] bg-white dark:bg-[#202128] text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Auto-detect (Recommended - use first detected IDE)</option>
                    {detectedIdesList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.appPath ? 'App' : 'CLI'})
                      </option>
                    ))}
                    <option value="antigravity">Antigravity IDE</option>
                    <option value="vscode">VS Code</option>
                    <option value="cursor">Cursor</option>
                    <option value="windsurf">Windsurf</option>
                    <option value="trae">Trae</option>
                    <option value="zed">Zed</option>
                    <option value="android-studio">Android Studio</option>
                    <option value="xcode">Xcode</option>
                    <option value="intellij">IntelliJ IDEA</option>
                    <option value="webstorm">WebStorm</option>
                    <option value="sublime">Sublime Text</option>
                  </select>
                </div>
              </div>

              {/* Configuration Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    Local Port
                  </label>
                  <input
                    type="number"
                    value={idePort}
                    onChange={(e) => setIdePort(Number(e.target.value) || 8443)}
                    placeholder="8443"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#1a1a1a] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[10px] text-slate-400">Default local port: 8443</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    Custom Binary Path (Optional)
                  </label>
                  <input
                    type="text"
                    value={ideBinaryPath}
                    onChange={(e) => setIdeBinaryPath(e.target.value)}
                    placeholder="e.g. /opt/homebrew/bin/code-server or ~/.local/bin/code-server"
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#1a1a1a] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-[10px] text-slate-400">Leave blank for auto-detect</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  External or Existing IDE URL (Optional)
                </label>
                <input
                  type="text"
                  value={ideExternalUrl}
                  onChange={(e) => setIdeExternalUrl(e.target.value)}
                  placeholder="e.g. http://localhost:8080 or https://ide.mycompany.internal"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#1a1a1a] text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-[10px] text-slate-400">
                  If you already run a code-server or OpenVSCode container on another port or host, specify it here.
                </span>
              </div>

              {/* Save Settings Button */}
              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => updateIdeMutation.mutate()}
                  disabled={updateIdeMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{updateIdeMutation.isPending ? 'Saving...' : 'Save IDE Configuration'}</span>
                </button>

                {ideStatus?.running && ideStatus?.url && (
                  <a
                    href={ideStatus.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <span>Open in Browser</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* 4. Appearance & Themes */}
          {/* ========================================================= */}
          {activeTab === 'appearance' && (
            <div className="space-y-6 animate-in fade-in-50 duration-150">
              <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                  <Monitor className="w-5 h-5 text-[#7b68ee]" />
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                      Appearance & Color Theme
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Choose your workspace display mode. Synchronized in local storage.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  {/* Light Mode Option */}
                  <div
                    onClick={() => setTheme('light')}
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                      theme === 'light'
                        ? 'bg-purple-50/60 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                        : 'bg-slate-50 dark:bg-[#1a1a1a] border-slate-200 dark:border-[#2d2d2d] hover:border-slate-300'
                    }`}
                  >
                    <div className="p-2.5 rounded-lg bg-amber-100 text-amber-600 mt-0.5">
                      <Sun className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-xs text-slate-900 dark:text-white">Light Mode</h3>
                        {theme === 'light' && (
                          <CheckCircle2 className="w-4 h-4 text-[#7b68ee]" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Crisp, clean white backgrounds with high contrast and readability.
                      </p>
                    </div>
                  </div>

                  {/* Dark Mode Option */}
                  <div
                    onClick={() => setTheme('dark')}
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                      theme === 'dark'
                        ? 'bg-purple-950/40 border-[#7b68ee] ring-2 ring-[#7b68ee]/30 shadow-sm'
                        : 'bg-slate-50 dark:bg-[#1a1a1a] border-slate-200 dark:border-[#2d2d2d] hover:border-slate-300'
                    }`}
                  >
                    <div className="p-2.5 rounded-lg bg-indigo-900/60 text-indigo-300 mt-0.5">
                      <Moon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-xs text-slate-900 dark:text-white">Dark Mode</h3>
                        {theme === 'dark' && (
                          <CheckCircle2 className="w-4 h-4 text-[#7b68ee]" />
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Neutral dark palette (#191919) engineered for focus and reduced eye strain.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Workspace In-App Tabs & Multi-Tab Navigation */}
              <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-[#7b68ee]" />
                    <div>
                      <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                        Multi-Tab Workspace (Desktop & Web)
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Browser & IDE-style in-app tab bar. Automatically intercepts target="_blank" links into new workspace tabs.
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isTabBarEnabled}
                      onChange={(e) => setIsTabBarEnabled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-[#333] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-[#7b68ee]"></div>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      target="_blank" Redirection
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                      Links clicked with <code className="px-1 py-0.5 rounded bg-slate-200 dark:bg-[#282828] font-mono text-[10px]">target="_blank"</code> or Cmd-clicks stay in-app as separate tabs rather than opening external windows.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-[#7b68ee]"></span>
                      Keyboard Shortcuts
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                      Press <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-[#282828] font-mono text-[10px]">Cmd/Ctrl+T</kbd> for a new tab, <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-[#282828] font-mono text-[10px]">Cmd/Ctrl+W</kbd> to close, and <kbd className="px-1 py-0.5 rounded bg-slate-200 dark:bg-[#282828] font-mono text-[10px]">Cmd+1..9</kbd> to switch.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d] space-y-1">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      State & Tab Persistence
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                      Active tabs, subpaths, and query strings (?tab=...) are remembered and restored across desktop app restarts and page reloads.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* 4. Safety & Governance Limits */}
          {/* ========================================================= */}
          {activeTab === 'safety' && (
            <div className="bg-white dark:bg-[#242424] border border-slate-200 dark:border-[#2d2d2d] rounded-2xl p-6 shadow-sm space-y-5 animate-in fade-in-50 duration-150">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-[#2d2d2d]">
                <Shield className="w-5 h-5 text-emerald-500" />
                <div>
                  <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                    Safety & Fan-Out Execution Limits
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Hardcoded guards preventing run-away autonomous loops and recursion.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d]">
                  <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold block">
                    MAX_DEPTH
                  </span>
                  <span className="text-slate-900 dark:text-white font-black text-xl">3</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-sans">
                    Maximum allowed cross-repo ticket recursion depth
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d]">
                  <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold block">
                    MAX_TICKETS_PER_REQ
                  </span>
                  <span className="text-slate-900 dark:text-white font-black text-xl">10</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-sans">
                    Maximum dependency tickets allowed per requirement
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d]">
                  <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold block">
                    WATCH_INTERVAL_MS
                  </span>
                  <span className="text-slate-900 dark:text-white font-black text-xl">5000 ms</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-sans">
                    Engine poller synchronization polling frequency
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#2d2d2d]">
                  <span className="text-slate-400 dark:text-slate-500 text-[10px] uppercase font-bold block">
                    MAX_BODY_BYTES
                  </span>
                  <span className="text-slate-900 dark:text-white font-black text-xl">20 KB</span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-sans">
                    Maximum ticket payload size for xticket creation
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

