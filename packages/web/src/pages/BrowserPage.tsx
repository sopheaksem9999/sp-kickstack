import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { useWorkspace } from '../lib/WorkspaceContext.js';
import { BrowserNavBar } from '../components/BrowserNavBar.js';
import { BrowserAiSidebar } from '../components/BrowserAiSidebar.js';
import { fetchBrowserPage } from '../lib/api.js';
import type { BrowserPageContent } from '@sp-kickstack/shared';
import {
  PanelRightClose,
  PanelRightOpen,
  AlertCircle,
  ExternalLink,
  BookOpen,
  List,
} from 'lucide-react';

const DEFAULT_URL = 'http://localhost:5173';
const VALID_TABS = ['iframe', 'reader'] as const;
type TabId = (typeof VALID_TABS)[number];

export function BrowserPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { activeWorkspaceId } = useWorkspace();

  const isBrowserActive = location.pathname.includes('/browser');
  const urlParam = searchParams.get('url') || DEFAULT_URL;
  const tabParam = (searchParams.get('tab') as TabId) || 'iframe';

  const [currentUrl, setCurrentUrl] = useState<string>(urlParam);
  const [viewMode, setViewMode] = useState<'iframe' | 'reader'>(
    VALID_TABS.includes(tabParam) ? tabParam : 'iframe'
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [externalToolTrigger, setExternalToolTrigger] = useState<{
    id: string;
    timestamp: number;
  } | null>(null);

  const [pageContent, setPageContent] = useState<BrowserPageContent | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [, setIframeError] = useState(false);

  // Sync state when URL search parameters change (supports browser back/forward history)
  useEffect(() => {
    if (!isBrowserActive) return;
    const u = searchParams.get('url');
    if (u && u !== currentUrl) {
      setCurrentUrl(u);
    }
    const t = searchParams.get('tab') as TabId | null;
    if (t && VALID_TABS.includes(t) && t !== viewMode) {
      setViewMode(t);
    }
  }, [searchParams, isBrowserActive]);

  // Fetch page metadata and readable text
  const loadPageContent = useCallback(async (targetUrl: string) => {
    setIsLoading(true);
    setIframeError(false);
    try {
      const data = await fetchBrowserPage(targetUrl);
      setPageContent(data);
    } catch {
      setPageContent({
        url: targetUrl,
        title: targetUrl,
        textContent: '',
        headings: [],
        error: 'Unable to fetch page contents.',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPageContent(currentUrl);
  }, [currentUrl, loadPageContent]);

  const handleNavigate = (newUrl: string) => {
    setCurrentUrl(newUrl);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('url', newUrl);
        next.set('tab', viewMode);
        return next;
      },
      { replace: false }
    );
  };

  const handleReload = () => {
    setReloadKey((prev) => prev + 1);
    loadPageContent(currentUrl);
  };

  const handleViewModeChange = (mode: 'iframe' | 'reader') => {
    setViewMode(mode);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('url', currentUrl);
        next.set('tab', mode);
        return next;
      },
      { replace: false }
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-100 dark:bg-[#12131a] overflow-hidden">
      {/* Top Browser Navigation Bar */}
      <BrowserNavBar
        url={currentUrl}
        onNavigate={handleNavigate}
        onReload={handleReload}
        isLoading={isLoading}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
        onTriggerAiTool={(tool) => {
          setIsSidebarOpen(true);
          setExternalToolTrigger({ id: tool, timestamp: Date.now() });
        }}
      />

      {/* Main Content: Web View Canvas + AI Sidebar */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Web View Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#181922] overflow-hidden">
          {viewMode === 'iframe' ? (
            <div className="relative w-full h-full flex flex-col">
              {/* Optional X-Frame-Options notice bar */}
              <div className="px-3 py-1 bg-amber-50/80 dark:bg-amber-950/30 border-b border-amber-200/60 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  If this external site prevents embedded framing, switch to{' '}
                  <button
                    type="button"
                    onClick={() => handleViewModeChange('reader')}
                    className="underline font-semibold hover:text-amber-900 dark:hover:text-amber-100"
                  >
                    Reader Mode
                  </button>{' '}
                  or open in your browser.
                </span>
                <button
                  type="button"
                  onClick={() => window.open(currentUrl, '_blank')}
                  className="flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400 hover:underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  External
                </button>
              </div>

              {/* Live Iframe */}
              <iframe
                key={`${currentUrl}-${reloadKey}`}
                src={currentUrl}
                title={pageContent?.title || 'In-App Browser'}
                className="w-full flex-1 border-0 bg-white"
                sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                onError={() => setIframeError(true)}
              />
            </div>
          ) : (
            /* Reader Mode View */
            <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
              <div className="mb-6 pb-4 border-b border-slate-200 dark:border-[#2d2f3d]">
                <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs font-semibold mb-1">
                  <BookOpen className="w-4 h-4" />
                  READER MODE CONTENT
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {pageContent?.title || currentUrl}
                </h1>
                <a
                  href={currentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono text-slate-400 hover:text-indigo-500 mt-1 inline-flex items-center gap-1"
                >
                  {currentUrl}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Headings Table of Contents */}
              {pageContent?.headings && pageContent.headings.length > 0 && (
                <div className="mb-6 p-4 rounded-2xl bg-slate-50 dark:bg-[#1a1b26] border border-slate-200 dark:border-[#2d2f3d]">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                    <List className="w-3.5 h-3.5" />
                    Key Sections
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {pageContent.headings.map((h, i) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 text-xs rounded-lg bg-white dark:bg-[#222433] border border-slate-200 dark:border-[#2d2f3d] text-slate-700 dark:text-slate-300 font-medium"
                      >
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Text Body */}
              <div className="prose dark:prose-invert max-w-none text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line font-sans">
                {pageContent?.textContent || (
                  <p className="text-slate-400 italic">No readable text found for this page.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Toggle Sidebar Button */}
        <button
          type="button"
          onClick={() => setIsSidebarOpen((prev) => !prev)}
          className={`absolute top-3 z-20 p-1.5 rounded-l-xl bg-white dark:bg-[#232431] border-y border-l border-slate-200 dark:border-[#2d2f3d] text-slate-600 dark:text-slate-300 shadow-md hover:bg-slate-50 dark:hover:bg-[#2b2c3c] transition-all ${
            isSidebarOpen ? 'right-[380px] lg:right-[420px]' : 'right-0'
          }`}
          title={isSidebarOpen ? 'Collapse AI Sidebar' : 'Expand AI Sidebar'}
        >
          {isSidebarOpen ? (
            <PanelRightClose className="w-4 h-4" />
          ) : (
            <PanelRightOpen className="w-4 h-4 text-indigo-500" />
          )}
        </button>

        {/* Right AI Sidebar (kept mounted to preserve chat messages and state) */}
        <div
          className={
            isSidebarOpen
              ? 'w-[380px] lg:w-[420px] flex-shrink-0 h-full border-l border-slate-200 dark:border-[#2d2f3d]'
              : 'hidden'
          }
        >
          <BrowserAiSidebar
            pageContent={pageContent}
            isLoadingPage={isLoading}
            workspaceId={activeWorkspaceId || 'default'}
            externalToolTrigger={externalToolTrigger}
          />
        </div>
      </div>
    </div>
  );
}
