import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Brain,
  Plus,
  Trash2,
  FileCheck,
  Layers,
  Bug,
  Code,
  Package,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchNeuronRules,
  createNeuronRule,
  updateNeuronRule,
  deleteNeuronRule,
  syncNeuronMarkdown,
} from '../lib/api.js';
import type { NeuronCategory, CreateNeuronRuleInput } from '@sp-kickstack/shared';
import { RadixSelect } from './ui/select.js';

interface NeuronAuditSectionProps {
  workspaceId: string;
}

const CATEGORY_COLORS: Record<NeuronCategory, { bg: string; text: string; icon: any }> = {
  architecture: { bg: 'bg-purple-100 dark:bg-purple-950/60', text: 'text-purple-700 dark:text-purple-300', icon: Layers },
  convention: { bg: 'bg-blue-100 dark:bg-blue-950/60', text: 'text-blue-700 dark:text-blue-300', icon: Code },
  dependency: { bg: 'bg-emerald-100 dark:bg-emerald-950/60', text: 'text-emerald-700 dark:text-emerald-300', icon: Package },
  testing: { bg: 'bg-amber-100 dark:bg-amber-950/60', text: 'text-amber-700 dark:text-amber-300', icon: Bug },
  triage: { bg: 'bg-indigo-100 dark:bg-indigo-950/60', text: 'text-indigo-700 dark:text-indigo-300', icon: Sparkles },
};

export function NeuronAuditSection({ workspaceId }: NeuronAuditSectionProps) {
  const queryClient = useQueryClient();
  const [isAdding, setIsAdding] = useState(false);
  const [newRule, setNewRule] = useState<CreateNeuronRuleInput>({
    workspace_id: workspaceId,
    project: 'all',
    category: 'architecture',
    rule_text: '',
    confidence_score: 0.9,
  });

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['neuron-rules', workspaceId],
    queryFn: () => fetchNeuronRules(workspaceId),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateNeuronRuleInput) => createNeuronRule(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['neuron-rules', workspaceId] });
      setIsAdding(false);
      setNewRule({
        workspace_id: workspaceId,
        project: 'all',
        category: 'architecture',
        rule_text: '',
        confidence_score: 0.9,
      });
      toast.success('Learned rule added to Neuron engine');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { is_active?: boolean; confidence_score?: number } }) =>
      updateNeuronRule(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['neuron-rules', workspaceId] });
      toast.success('Rule status updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNeuronRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['neuron-rules', workspaceId] });
      toast.success('Rule deleted from Neuron engine');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const syncMutation = useMutation({
    mutationFn: () => syncNeuronMarkdown(),
    onSuccess: (data) => {
      toast.success(`Synced ${data.count} rules to .agents/rules/learned-patterns.md`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const activeCount = rules.filter((r) => r.is_active).length;
  const avgConfidence = rules.length
    ? Math.round((rules.reduce((acc, r) => acc + r.confidence_score, 0) / rules.length) * 100)
    : 100;

  return (
    <div className="bg-white dark:bg-[#1a1b24] border border-slate-200 dark:border-[#2d2f3d] rounded-2xl p-6 shadow-sm space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-[#2d2f3d]">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              Neuron Continuous Learning & Rule Audit
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Autonomous run audit engine that extracts lessons learned and enforces quality rules across agents.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#2d2f3d] hover:bg-slate-50 dark:hover:bg-[#252736] text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-50"
            title="Export to .agents/rules/learned-patterns.md"
          >
            <FileCheck className="w-3.5 h-3.5 text-indigo-500" />
            <span>Sync Markdown</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAdding((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Rule</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#151620] border border-slate-200 dark:border-[#2d2f3d]">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Total Rules</div>
          <div className="text-xl font-bold text-slate-900 dark:text-white">{rules.length}</div>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#151620] border border-slate-200 dark:border-[#2d2f3d]">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Active Rules</div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{activeCount}</div>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#151620] border border-slate-200 dark:border-[#2d2f3d]">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Avg Confidence</div>
          <div className="text-xl font-bold text-purple-600 dark:text-purple-400">{avgConfidence}%</div>
        </div>
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#151620] border border-slate-200 dark:border-[#2d2f3d]">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Prompt Enrichment</div>
          <div className="text-xl font-bold text-indigo-600 dark:text-indigo-400">Active</div>
        </div>
      </div>

      {/* Manual Add Rule Form */}
      {isAdding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newRule.rule_text.trim()) {
              toast.error('Rule text is required');
              return;
            }
            createMutation.mutate(newRule);
          }}
          className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 space-y-3"
        >
          <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
            Create New Learned Rule
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Category
              </label>
              <RadixSelect<NeuronCategory>
                size="sm"
                value={newRule.category}
                onChange={(cat) => setNewRule({ ...newRule, category: cat })}
                options={[
                  { value: 'architecture', label: 'Architecture' },
                  { value: 'convention', label: 'Code Convention' },
                  { value: 'dependency', label: 'Dependency' },
                  { value: 'testing', label: 'Testing' },
                  { value: 'triage', label: 'Triage / Error' },
                ]}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Project Scope
              </label>
              <input
                type="text"
                value={newRule.project}
                onChange={(e) => setNewRule({ ...newRule, project: e.target.value })}
                placeholder="all or project name"
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1b1c26] text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Confidence (0.0 – 1.0)
              </label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={newRule.confidence_score}
                onChange={(e) => setNewRule({ ...newRule, confidence_score: parseFloat(e.target.value) || 0.9 })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1b1c26] text-xs text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Rule Instruction (Injected into agent prompts)
            </label>
            <textarea
              rows={2}
              value={newRule.rule_text}
              onChange={(e) => setNewRule({ ...newRule, rule_text: e.target.value })}
              placeholder="e.g. Always write comprehensive Vitest unit tests before marking task complete."
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1b1c26] text-xs text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 text-xs rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#20212d]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
            >
              {createMutation.isPending ? 'Saving...' : 'Save Rule'}
            </button>
          </div>
        </form>
      )}

      {/* Rules List */}
      <div className="space-y-2.5">
        {isLoading ? (
          <div className="py-8 text-center text-xs text-slate-400">Loading Neuron rules...</div>
        ) : rules.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400 italic">
            No rules recorded yet. Add one above or let the agent runner extract lessons automatically.
          </div>
        ) : (
          rules.map((rule) => {
            const cat = CATEGORY_COLORS[rule.category] || CATEGORY_COLORS.architecture;
            const Icon = cat.icon;
            return (
              <div
                key={rule.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border transition-all gap-3 ${
                  rule.is_active
                    ? 'border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#181923]'
                    : 'border-slate-200/60 dark:border-[#222430] bg-slate-50 dark:bg-[#14151e] opacity-60'
                }`}
              >
                <div className="flex items-start gap-3 flex-1">
                  <div className={`p-1.5 rounded-lg mt-0.5 ${cat.bg} ${cat.text}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${cat.bg} ${cat.text}`}>
                        {rule.category}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-100 dark:bg-[#252736] text-slate-600 dark:text-slate-300">
                        {rule.project}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Confidence: {Math.round(rule.confidence_score * 100)}%
                      </span>
                      {rule.trigger_count > 0 && (
                        <span className="text-[10px] text-indigo-500 font-medium">
                          Triggered {rule.trigger_count}x
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed font-sans">
                      {rule.rule_text}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  {/* Active Toggle Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={rule.is_active}
                    onClick={() => updateMutation.mutate({ id: rule.id, updates: { is_active: !rule.is_active } })}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                      rule.is_active ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-[#3a3a3a]'
                    }`}
                    title={rule.is_active ? 'Deactivate rule' : 'Activate rule'}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                        rule.is_active ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>

                  {/* Delete Button */}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Delete this learned rule?')) {
                        deleteMutation.mutate(rule.id);
                      }
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                    title="Delete rule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
