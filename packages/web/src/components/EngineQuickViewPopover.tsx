import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Bot,
  Cpu,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Settings,
  RefreshCw,
} from 'lucide-react';
import {
  fetchAiProviders,
  refreshAiProviders,
  fetchSettings,
  updateAiCliSettings,
} from '../lib/api.js';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover.js';
import { EngineProviderStatus, EngineId } from '@sp-kickstack/shared';
import { useWorkspace } from '../lib/WorkspaceContext.js';

interface CircularProgressRingProps {
  percent: number;
  size?: number;
  strokeWidth?: number;
}

function CircularProgressRing({
  percent,
  size = 22,
  strokeWidth = 2.5,
}: CircularProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  // Green ring by default matching sample image; amber if low, red if critical/rate-limited
  const strokeColor =
    clamped <= 15 ? '#ef4444' : clamped <= 35 ? '#f59e0b' : '#22c55e';

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      {/* Background circle track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="transparent"
        stroke="currentColor"
        className="text-slate-200 dark:text-[#2c3042]"
        strokeWidth={strokeWidth}
      />
      {/* Foreground progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="transparent"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        className="transition-all duration-500 ease-out"
      />
    </svg>
  );
}

function getEngineGroupTitle(id: string, name: string): string {
  switch (id) {
    case 'agy-cli':
      return 'Gemini Models';
    case 'claude-cli':
      return 'Claude and GPT models';
    case 'codex-cli':
      return 'Codex Models';
    case 'ollama':
      return 'Ollama Local Models';
    case 'heuristic':
      return 'Offline Heuristic Engine';
    default:
      return name;
  }
}

export function EngineQuickViewPopover() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspace();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Fetch settings for active default provider and enabled engines
  const { data: settingsData, refetch: refetchSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  // Fetch live engine status and rate limit telemetry
  const {
    data: providers,
    refetch: refetchProviders,
    isRefetching,
  } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => fetchAiProviders(),
    refetchInterval: 8000,
  });

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshAiProviders();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ai-providers'] }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ]);
      await Promise.all([
        refetchProviders(),
        refetchSettings(),
      ]);
      toast.success('Rate limit telemetry updated');
    } catch {
      toast.error('Failed to update rate limit telemetry');
    } finally {
      setIsRefreshing(false);
    }
  };

  const enabledEngineIds: EngineId[] =
    settingsData?.ai_cli?.enabledEngines ||
    ['claude-cli', 'agy-cli', 'codex-cli', 'ollama', 'heuristic'];

  // Filter providers to only enabled engines
  const enabledProviders = (providers || []).filter((p) =>
    enabledEngineIds.includes(p.id as EngineId)
  );

  const activeProviderId =
    (settingsData?.ai_cli?.defaultProvider === 'auto'
      ? enabledEngineIds[0] || 'claude-cli'
      : settingsData?.ai_cli?.defaultProvider) ||
    enabledEngineIds[0] ||
    'claude-cli';

  const currentProvider: EngineProviderStatus | undefined =
    enabledProviders.find((p) => p.id === activeProviderId) ||
    enabledProviders[0] ||
    providers?.find((p) => p.id === activeProviderId) || {
      id: activeProviderId,
      name: 'Claude Code CLI',
      installed: false,
      available: false,
      rateLimit: {
        supported: true,
        supportType: 'bridge_monitored',
        status: 'healthy',
        totalDispatches: 0,
        completedTasks: 0,
        rateLimitEvents: 0,
        activeTasks: 0,
      },
    };

  // Quick switch mutation
  const switchEngineMutation = useMutation({
    mutationFn: async (targetId: EngineId) => {
      const currentCli = settingsData?.ai_cli || {
        defaultProvider: targetId,
        enabledEngines: enabledEngineIds,
        claude: { enabled: true, model: 'sonnet-5', effort: 'medium' },
        agy: { enabled: true, model: 'gemini-3.8-flash', effort: 'medium' },
        codex: { enabled: true, model: 'default', effort: 'medium' },
        ollama: { enabled: true, model: 'llama3.2', effort: 'medium', url: 'http://127.0.0.1:11434' },
      };

      return updateAiCliSettings({
        ...currentCli,
        defaultProvider: targetId,
      });
    },
    onSuccess: (_, targetId) => {
      const target = providers?.find((p) => p.id === targetId);
      toast.success(`Default engine switched to ${target?.name || targetId}`);
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['ai-providers'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to switch default engine');
    },
  });

  const rateLimit = currentProvider?.rateLimit;
  const isRateLimited = rateLimit?.status === 'rate_limited';
  const isUnlimited = rateLimit?.status === 'unlimited';
  const isInstalled = Boolean(currentProvider?.installed);

  const getStatusDot = () => {
    if (!isInstalled) {
      return 'bg-amber-400 dark:bg-amber-500';
    }
    if (isRateLimited) {
      return 'bg-rose-500 animate-ping';
    }
    if (isUnlimited) {
      return 'bg-cyan-400 animate-pulse';
    }
    return 'bg-emerald-500 animate-pulse';
  };

  const getStatusBadge = () => {
    if (!isInstalled) {
      return {
        label: 'CLI Missing',
        classes: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300/60 dark:border-amber-800/60',
      };
    }
    if (isRateLimited) {
      return {
        label: 'Rate Limited',
        classes: 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-300/60 dark:border-rose-800/60',
      };
    }
    if (isUnlimited) {
      return {
        label: 'Unlimited Local',
        classes: 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-300/60 dark:border-cyan-800/60',
      };
    }
    return {
      label: 'Healthy',
      classes: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300/60 dark:border-emerald-800/60',
    };
  };

  const statusBadge = getStatusBadge();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#222222] hover:bg-slate-100 dark:hover:bg-[#2a2a2a] text-slate-800 dark:text-slate-200 text-xs font-medium transition-all shadow-2xs hover:border-purple-400/50 group"
          title="Engine & Rate Limit Quick View"
        >
          <div className="relative flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-purple-600 dark:text-[#7b68ee] shrink-0" />
            <span
              className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${getStatusDot()}`}
            />
          </div>

          <span className="font-semibold text-xs truncate max-w-[110px] hidden md:inline">
            {currentProvider?.name?.replace(' CLI', '') || 'Engine'}
          </span>

          <span
            className={`text-[9px] font-mono px-1.5 py-0.2 rounded border font-semibold hidden lg:inline-block ${statusBadge.classes}`}
          >
            {statusBadge.label}
          </span>

          <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200 shrink-0 transition-transform duration-200" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[380px] p-0 overflow-hidden shadow-2xl border-slate-200 dark:border-[#2e303d] bg-white dark:bg-[#1a1c27] text-slate-900 dark:text-slate-100"
      >
        {/* Header */}
        <div className="p-3.5 bg-slate-50 dark:bg-[#202231] border-b border-slate-200 dark:border-[#2a2c3d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-[#7b68ee] border border-purple-200 dark:border-purple-800/40">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>AI CLI Engine & Rate Limits</span>
              </h3>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <span>Live local engine telemetry & quota backoff</span>
                {currentProvider?.rateLimit?.lastRefreshedAt && (
                  <span className="text-[9px] text-purple-600 dark:text-purple-300 font-mono">
                    · {currentProvider.rateLimit.lastRefreshedAt}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing || isRefetching}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50"
              title="Refresh engine telemetry"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshing || isRefetching ? 'animate-spin text-purple-600 dark:text-purple-400' : ''
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate(wsPath('/settings?tab=ai'));
              }}
              className="p-1 rounded-md text-slate-400 hover:text-purple-600 dark:hover:text-purple-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/50 transition-colors"
              title="Open full AI settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Live Quota Progress Rings Section */}
        <div className="p-4 space-y-4 max-h-[460px] overflow-y-auto bg-white dark:bg-[#1a1c27] text-slate-900 dark:text-slate-100">
          {enabledProviders.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-500 dark:text-slate-400">
              No engines enabled in settings.
            </div>
          ) : (
            enabledProviders.map((provider, idx) => {
              const rl = provider.rateLimit;
              const isRateLimited = rl?.status === 'rate_limited';
              const weeklyRemaining = rl?.weeklyLimitRemainingPercent ?? 100;
              const sessionRemaining = rl?.sessionLimitRemainingPercent ?? 100;
              const groupTitle = getEngineGroupTitle(provider.id, provider.name);
              const isDefault = provider.id === activeProviderId;

              const isQuotaSupported = Boolean(
                rl?.supported &&
                provider.installed &&
                rl?.supportType !== 'unlimited_offline' &&
                (rl?.weeklyLimitRemainingPercent !== undefined || rl?.sessionLimitRemainingPercent !== undefined)
              );

              return (
                <div
                  key={provider.id}
                  className={`space-y-3 ${
                    idx > 0 ? 'pt-3.5 border-t border-slate-200 dark:border-[#2d3144]' : ''
                  }`}
                >
                  {/* Group Header */}
                  <div className="flex items-center justify-between">
                    <h4 className="text-[13px] font-semibold text-slate-800 dark:text-slate-300 flex items-center gap-2">
                      <span>{groupTitle}</span>
                      {provider.installed ? (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Detected locally on PC" />
                      ) : (
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-normal border border-amber-200 dark:border-transparent">
                          Not Installed
                        </span>
                      )}
                    </h4>
                    {isDefault && (
                      <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-purple-100 dark:bg-purple-500/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40">
                        ACTIVE DEFAULT
                      </span>
                    )}
                  </div>

                  {/* Quota Limits: Only shown if supported and installed on local PC */}
                  {isQuotaSupported ? (
                    <>
                      {/* Weekly Limit Remaining Row */}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="text-[13px] font-medium text-slate-800 dark:text-slate-200">
                            Weekly Limit Remaining
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {rl?.weeklyResetsIn || 'Resets in 7d'}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 min-w-[32px] text-right">
                            {weeklyRemaining}%
                          </span>
                          <CircularProgressRing percent={weeklyRemaining} />
                        </div>
                      </div>

                      {/* Five Hour Limit Remaining Row */}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <div className="text-[13px] font-medium text-slate-800 dark:text-slate-200">
                            {rl?.windowLabel || 'Five Hour Limit Remaining'}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {isRateLimited ? (
                              <span className="text-rose-600 dark:text-rose-400 font-medium">
                                {rl?.sessionResetsIn || 'Rate limited'}
                              </span>
                            ) : (
                              rl?.sessionResetsIn || 'Resets in 5h'
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 min-w-[32px] text-right">
                            {sessionRemaining}%
                          </span>
                          <CircularProgressRing percent={sessionRemaining} />
                        </div>
                      </div>
                    </>
                  ) : !provider.installed ? (
                    <div className="py-2 px-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 text-xs flex items-center justify-between">
                      <span className="font-medium">CLI Not Detected on Local PC</span>
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
                        Rate Limits Unavailable
                      </span>
                    </div>
                  ) : (
                    <div className="py-2 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs flex items-center justify-between">
                      <span className="font-medium flex items-center gap-1.5">
                        <span>Local AI · Unlimited Execution</span>
                      </span>
                      <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono">
                        Zero Rate Limits
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Quick Engine Switcher Section */}
          <div className="pt-3 border-t border-slate-200 dark:border-[#2d3144] space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Switch Default Engine
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                Active in System ({enabledProviders.length})
              </span>
            </div>

            <div className="space-y-1">
              {enabledProviders.map((provider) => {
                const isSelected = provider.id === activeProviderId;
                const pInstalled = Boolean(provider.installed);

                return (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => {
                      if (!isSelected) {
                        switchEngineMutation.mutate(provider.id as EngineId);
                      }
                    }}
                    disabled={switchEngineMutation.isPending}
                    className={`w-full p-2 rounded-xl text-left flex items-center justify-between border transition-all ${
                      isSelected
                        ? 'bg-purple-50 dark:bg-purple-900/40 border-purple-300 dark:border-purple-500/60 ring-1 ring-purple-200 dark:ring-purple-500/40 text-purple-900 dark:text-purple-200'
                        : 'bg-slate-50 dark:bg-[#202231] border-slate-200 dark:border-[#2c2e3e] hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-[#252839] text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          !pInstalled
                            ? 'bg-slate-400 dark:bg-slate-500'
                            : provider.rateLimit?.status === 'rate_limited'
                            ? 'bg-rose-500'
                            : provider.rateLimit?.status === 'unlimited'
                            ? 'bg-cyan-500 dark:bg-cyan-400'
                            : 'bg-emerald-500'
                        }`}
                      />
                      <div className="truncate">
                        <div className="font-semibold text-xs truncate flex items-center gap-1.5">
                          <span>{provider.name}</span>
                          {pInstalled ? (
                            <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-300/80 dark:border-emerald-800/40">
                              ✓ Local
                            </span>
                          ) : (
                            <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-normal">
                              Not Detected
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {provider.rateLimit?.supportType === 'unlimited_offline'
                            ? '100% Offline · Zero rate limits'
                            : 'Subprocess 429 monitored backoff'}
                        </p>
                      </div>
                    </div>

                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0 ml-2" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-2.5 bg-slate-50 dark:bg-[#14151e] border-t border-slate-200 dark:border-[#232532] flex items-center justify-between text-[11px]">
          <span className="text-slate-500 dark:text-slate-400">Zero cloud API keys required</span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate(wsPath('/settings?tab=ai'));
            }}
            className="font-semibold text-purple-600 dark:text-[#7b68ee] hover:underline flex items-center gap-1"
          >
            <span>Full AI Configuration</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
