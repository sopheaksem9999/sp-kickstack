import React, { useState } from 'react';
import { createSprint } from '../lib/api.js';
import { Sprint } from '@sp-kickstack/shared';
import { toast } from 'sonner';
import { X, Calendar, Flag, Zap } from 'lucide-react';

interface CreateSprintModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  onSprintCreated?: (sprint: Sprint) => void;
}

export function CreateSprintModal({
  isOpen,
  onClose,
  workspaceId,
  onSprintCreated,
}: CreateSprintModalProps) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Sprint name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createSprint({
        workspace_id: workspaceId || 'default',
        name: name.trim(),
        goal: goal.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });

      toast.success(`Sprint "${created.name}" planned successfully!`);
      if (onSprintCreated) {
        onSprintCreated(created);
      }
      onClose();
      setName('');
      setGoal('');
      setStartDate('');
      setEndDate('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create sprint');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-[#1e1f26] border border-slate-200 dark:border-[#2e303d] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-200 dark:border-[#262732] flex items-center justify-between bg-slate-50/70 dark:bg-[#181920]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-base leading-tight">
                Plan New Sprint
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create a time-boxed sprint iteration for agile execution
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#282a36] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Sprint Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Sprint 1 - MVP Authentication"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-[#15161c] border border-slate-300 dark:border-[#2e303d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all placeholder:text-slate-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Sprint Goal <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={3}
              placeholder="What is the key objective and outcome of this sprint?"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-[#15161c] border border-slate-300 dark:border-[#2e303d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all placeholder:text-slate-400 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-400" /> Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-[#15161c] border border-slate-300 dark:border-[#2e303d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <Flag className="w-3.5 h-3.5 text-rose-400" /> End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-[#15161c] border border-slate-300 dark:border-[#2e303d] rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#282a36] rounded-xl transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? 'Creating...' : 'Create Sprint'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
