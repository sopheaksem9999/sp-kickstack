import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Globe,
  ExternalLink,
  BookOpen,
  Layout,
  Search,
  Sparkles,
  ChevronDown,
  FileText,
  Code2,
  MessageSquare,
} from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover.js';

interface BrowserNavBarProps {
  url: string;
  onNavigate: (newUrl: string) => void;
  onReload: () => void;
  isLoading: boolean;
  viewMode: 'iframe' | 'reader';
  onViewModeChange: (mode: 'iframe' | 'reader') => void;
  onTriggerAiTool?: (tool: 'summarize' | 'extract' | 'inspect' | 'ask') => void;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function BrowserNavBar({
  url,
  onNavigate,
  onReload,
  isLoading,
  viewMode,
  onViewModeChange,
  onTriggerAiTool,
  isSidebarOpen,
  onToggleSidebar,
}: BrowserNavBarProps) {
  const [inputUrl, setInputUrl] = useState(url);

  useEffect(() => {
    setInputUrl(url);
  }, [url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let target = inputUrl.trim();
    if (!target) return;
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `https://${target}`;
    }
    onNavigate(target);
  };

  return (
    <div className="flex items-center border-b border-slate-200 dark:border-[#2d2f3d] bg-white dark:bg-[#1f202b] px-4 py-2.5 gap-2 shadow-sm">
      {/* Navigation Buttons */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2d2f3d] transition-colors"
          title="Go Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => window.history.forward()}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2d2f3d] transition-colors"
          title="Go Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onReload}
          className={`p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2d2f3d] transition-colors ${
            isLoading ? 'animate-spin text-indigo-500 dark:text-indigo-400' : ''
          }`}
          title="Reload Page"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      {/* Address Bar */}
      <form onSubmit={handleSubmit} className="flex-1 flex items-center">
        <div className="relative w-full flex items-center">
          <div className="absolute left-3 text-slate-400 dark:text-slate-500 pointer-events-none">
            <Globe className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Enter URL (e.g. http://localhost:5173 or https://vite.dev)..."
            className="w-full pl-9 pr-20 py-1.5 text-xs font-mono rounded-xl bg-slate-100 dark:bg-[#14151e] border border-slate-200 dark:border-[#2d2f3d] text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition-all"
          />
          <button
            type="submit"
            className="absolute right-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center gap-1 shadow-sm"
          >
            <Search className="w-3 h-3" />
            Go
          </button>
        </div>
      </form>

      {/* Mode Switcher & External Link */}
      <div className="flex items-center gap-1.5">
        {/* AI Web Tools Header Trigger */}
        {onTriggerAiTool && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-all shadow-2xs"
                title="AI Web Tools (Summarize, Extract Requirement, Inspect APIs)"
              >
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span className="hidden sm:inline">AI Web Tools</span>
                <ChevronDown className="w-3 h-3 text-indigo-500" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1.5 space-y-1">
              <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Active Page AI Tools
              </div>
              <button
                type="button"
                onClick={() => onTriggerAiTool('summarize')}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#252737] text-left transition-colors"
              >
                <Search className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <div>
                  <div className="font-semibold text-[11px]">Summarize Page</div>
                  <div className="text-[9px] text-slate-400">Architecture & takeaways</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onTriggerAiTool('extract')}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#252737] text-left transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                <div>
                  <div className="font-semibold text-[11px]">Extract Req</div>
                  <div className="text-[9px] text-slate-400">Create ticket specification</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onTriggerAiTool('inspect')}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#252737] text-left transition-colors"
              >
                <Code2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <div>
                  <div className="font-semibold text-[11px]">Inspect APIs & Code</div>
                  <div className="text-[9px] text-slate-400">Data models & endpoints</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onTriggerAiTool('ask')}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#252737] text-left transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <div>
                  <div className="font-semibold text-[11px]">Ask Page</div>
                  <div className="text-[9px] text-slate-400">Freeform Q&A prompt</div>
                </div>
              </button>
            </PopoverContent>
          </Popover>
        )}

        <div className="flex items-center bg-slate-100 dark:bg-[#14151e] p-0.5 rounded-xl border border-slate-200 dark:border-[#2d2f3d]">
          <button
            type="button"
            onClick={() => onViewModeChange('iframe')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
              viewMode === 'iframe'
                ? 'bg-white dark:bg-[#2d2f3d] text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Interactive Webpage Frame"
          >
            <Layout className="w-3.5 h-3.5" />
            Frame
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('reader')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
              viewMode === 'reader'
                ? 'bg-white dark:bg-[#2d2f3d] text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
            title="Clean Reader Text & Headings View"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Reader
          </button>
        </div>

        <button
          type="button"
          onClick={() => window.open(url, '_blank')}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2d2f3d] transition-colors"
          title="Open in System Browser"
        >
          <ExternalLink className="w-4 h-4" />
        </button>

        {/* AI Assistant Sidebar Toggle Button */}
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-xl border transition-all ${
              isSidebarOpen
                ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                : 'border-slate-200 dark:border-[#2d2f3d] bg-slate-50 dark:bg-[#14151e] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
            title={isSidebarOpen ? 'Collapse AI Assistant' : 'Open AI Assistant'}
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span className="hidden sm:inline">AI Assistant</span>
          </button>
        )}
      </div>
    </div>
  );
}
