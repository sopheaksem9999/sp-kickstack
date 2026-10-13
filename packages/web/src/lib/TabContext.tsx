import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWorkspace } from './WorkspaceContext.js';
import { toast } from 'sonner';

export interface AppTab {
  id: string;
  title: string;
  path: string;
  icon?: string;
  closable?: boolean;
}

interface TabContextType {
  tabs: AppTab[];
  activeTabId: string;
  openTab: (options: {
    path: string;
    title?: string;
    icon?: string;
    closable?: boolean;
    openInBackground?: boolean;
  }) => string;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  duplicateTab: (tabId: string) => void;
  isTabBarEnabled: boolean;
  setIsTabBarEnabled: (enabled: boolean) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

const STORAGE_KEY = 'sp_kickstack_tabs_v1';
const ACTIVE_TAB_KEY = 'sp_kickstack_active_tab_v1';
const TAB_ENABLED_KEY = 'sp_kickstack_tab_enabled_v1';

/**
 * Derives a human-readable title and icon based on subpath and query parameters
 */
export function resolveTabInfo(
  fullPath: string
): { title: string; icon: string } {
  try {
    const url = new URL(fullPath, 'http://localhost');
    const pathname = url.pathname.replace(/^\/w\/[^/]+/, '') || '/requirements';
    const searchParams = url.searchParams;

    if (pathname === '/requirements/new') {
      return { title: 'New Requirement', icon: 'layers' };
    }
    if (pathname.startsWith('/requirements/')) {
      const parts = pathname.split('/');
      const reqId = parts[2] || 'Ticket';
      return { title: reqId, icon: 'layers' };
    }
    if (pathname === '/requirements') {
      const tab = searchParams.get('tab');
      if (tab === 'backlog') return { title: 'Backlog', icon: 'layers' };
      if (tab === 'all') return { title: 'All Requirements', icon: 'layers' };
      return { title: 'Requirements', icon: 'layers' };
    }
    if (pathname === '/queue') {
      return { title: 'Agent Queue', icon: 'queue' };
    }
    if (pathname === '/chat') {
      return { title: 'AI Architect Chat', icon: 'chat' };
    }
    if (pathname === '/browser') {
      const u = searchParams.get('url');
      const cleanUrl = u ? u.replace(/^https?:\/\//, '') : '';
      return {
        title: cleanUrl ? `Web: ${cleanUrl.slice(0, 25)}` : 'In-App Browser',
        icon: 'globe',
      };
    }
    if (pathname === '/attachments') {
      return { title: 'Attachments', icon: 'paperclip' };
    }
    if (pathname === '/projects') {
      const project = searchParams.get('project');
      const tab = searchParams.get('tab');
      if (tab === 'editor') {
        return {
          title: project ? `Editor: ${project}` : 'Code Editor',
          icon: 'code',
        };
      }
      if (tab === 'terminal') {
        return {
          title: project ? `Terminal: ${project}` : 'Terminal',
          icon: 'terminal',
        };
      }
      return {
        title: project ? `Repo: ${project}` : 'Repositories',
        icon: 'folder',
      };
    }
    if (pathname === '/metrics') {
      return { title: 'Telemetry & Sprints', icon: 'chart' };
    }
    if (pathname === '/settings') {
      const tab = searchParams.get('tab');
      if (tab) {
        return { title: `Settings: ${tab.toUpperCase()}`, icon: 'settings' };
      }
      return { title: 'Settings', icon: 'settings' };
    }

    return { title: 'Workspace', icon: 'layers' };
  } catch {
    return { title: 'Workspace', icon: 'layers' };
  }
}

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { wsPath } = useWorkspace();

  const [isTabBarEnabled, setIsTabBarEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(TAB_ENABLED_KEY);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const setIsTabBarEnabled = (enabled: boolean) => {
    setIsTabBarEnabledState(enabled);
    try {
      localStorage.setItem(TAB_ENABLED_KEY, String(enabled));
    } catch {}
  };

  // Initial tabs state from localStorage or default current route
  const [tabs, setTabs] = useState<AppTab[]>(() => {
    const currentPath = location.pathname + location.search;
    const initialInfo = resolveTabInfo(currentPath);

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {}

    return [
      {
        id: 'tab-initial',
        title: initialInfo.title,
        path: currentPath,
        icon: initialInfo.icon,
        closable: false,
      },
    ];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const storedActive = localStorage.getItem(ACTIVE_TAB_KEY);
      if (storedActive) return storedActive;
    } catch {}
    return 'tab-initial';
  });

  const isNavigatingFromTabSwitch = useRef(false);

  // Keep localStorage updated with tab state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
      localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
    } catch {}
  }, [tabs, activeTabId]);

  // Sync active tab path & title when location changes organically (e.g. sidebar navigation)
  useEffect(() => {
    const currentFullPath = location.pathname + location.search;

    if (isNavigatingFromTabSwitch.current) {
      isNavigatingFromTabSwitch.current = false;
      return;
    }

    setTabs((prevTabs) => {
      const index = prevTabs.findIndex((t) => t.id === activeTabId);
      if (index === -1) return prevTabs;

      const currentTab = prevTabs[index];
      if (currentTab.path === currentFullPath) return prevTabs;

      const info = resolveTabInfo(currentFullPath);
      const updated = [...prevTabs];
      updated[index] = {
        ...currentTab,
        path: currentFullPath,
        title: info.title,
        icon: info.icon,
      };
      return updated;
    });
  }, [location.pathname, location.search, activeTabId]);

  // Switch to a tab
  const switchTab = useCallback(
    (tabId: string) => {
      const target = tabs.find((t) => t.id === tabId);
      if (!target) return;

      setActiveTabId(tabId);
      isNavigatingFromTabSwitch.current = true;
      navigate(target.path);
    },
    [tabs, navigate]
  );

  // Open a new tab
  const openTab = useCallback(
    ({
      path,
      title,
      icon,
      closable = true,
      openInBackground = false,
    }: {
      path: string;
      title?: string;
      icon?: string;
      closable?: boolean;
      openInBackground?: boolean;
    }) => {
      // Normalize path (if given a relative path or full URL matching localhost)
      let targetPath = path;
      try {
        if (targetPath.startsWith('http://') || targetPath.startsWith('https://')) {
          const parsed = new URL(targetPath);
          targetPath = parsed.pathname + parsed.search + parsed.hash;
        }
      } catch {}

      const info = resolveTabInfo(targetPath);
      const finalTitle = title || info.title;
      const finalIcon = icon || info.icon;
      const newTabId = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const newTab: AppTab = {
        id: newTabId,
        title: finalTitle,
        path: targetPath,
        icon: finalIcon,
        closable,
      };

      setTabs((prev) => [...prev, newTab]);

      if (!openInBackground) {
        setActiveTabId(newTabId);
        isNavigatingFromTabSwitch.current = true;
        navigate(targetPath);
      }

      return newTabId;
    },
    [navigate]
  );

  // Close a tab
  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) {
          // Do not close the very last tab, just reset its path to requirements
          const fallback = wsPath('/requirements');
          navigate(fallback);
          return [
            {
              id: 'tab-initial',
              title: 'Requirements',
              path: fallback,
              icon: 'layers',
              closable: false,
            },
          ];
        }

        const closeIndex = prev.findIndex((t) => t.id === tabId);
        if (closeIndex === -1) return prev;

        const nextTabs = prev.filter((t) => t.id !== tabId);

        // If we closed the currently active tab, switch to adjacent tab
        if (activeTabId === tabId) {
          const nextActiveIndex = Math.max(0, closeIndex - 1);
          const nextActiveTab = nextTabs[nextActiveIndex] || nextTabs[0];
          setActiveTabId(nextActiveTab.id);
          isNavigatingFromTabSwitch.current = true;
          navigate(nextActiveTab.path);
        }

        return nextTabs;
      });
    },
    [activeTabId, navigate, wsPath]
  );

  // Close other tabs
  const closeOtherTabs = useCallback(
    (targetId: string) => {
      const keep = tabs.find((t) => t.id === targetId);
      if (!keep) return;

      setTabs([{ ...keep, closable: true }]);
      setActiveTabId(targetId);
      navigate(keep.path);
    },
    [tabs, navigate]
  );

  // Close tabs to the right
  const closeTabsToRight = useCallback(
    (targetId: string) => {
      const idx = tabs.findIndex((t) => t.id === targetId);
      if (idx === -1) return;

      const remaining = tabs.slice(0, idx + 1);
      setTabs(remaining);

      if (!remaining.some((t) => t.id === activeTabId)) {
        setActiveTabId(targetId);
        navigate(remaining[remaining.length - 1].path);
      }
    },
    [tabs, activeTabId, navigate]
  );

  // Duplicate a tab
  const duplicateTab = useCallback(
    (tabId: string) => {
      const target = tabs.find((t) => t.id === tabId);
      if (!target) return;

      openTab({
        path: target.path,
        title: target.title,
        icon: target.icon,
      });
    },
    [tabs, openTab]
  );

  // =========================================================================
  // Global Interceptor for target="_blank" and Cmd/Ctrl+Click links
  // =========================================================================
  useEffect(() => {
    if (!isTabBarEnabled) return;

    const handleAnchorClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest('a');
      if (!target) return;

      const href = target.getAttribute('href');
      const targetAttr = target.getAttribute('target');

      // Check if clicked with target="_blank" or Cmd/Ctrl modifier
      const isBlankOrMeta = targetAttr === '_blank' || e.metaKey || e.ctrlKey;

      if (isBlankOrMeta && href) {
        // Test if URL is internal or local service
        const isRelative = href.startsWith('/') && !href.startsWith('//');
        const isInternalHost =
          href.includes('127.0.0.1') ||
          href.includes('localhost') ||
          (typeof window !== 'undefined' && href.startsWith(window.location.origin));

        if (isRelative || isInternalHost) {
          e.preventDefault();
          e.stopPropagation();

          const tabTitle =
            target.getAttribute('title') ||
            target.innerText?.trim() ||
            undefined;

          openTab({ path: href, title: tabTitle });
          toast.success('Opened in new tab');
        }
      }
    };

    document.addEventListener('click', handleAnchorClick, true);
    return () => document.removeEventListener('click', handleAnchorClick, true);
  }, [openTab, isTabBarEnabled]);

  // =========================================================================
  // Intercept window.open
  // =========================================================================
  useEffect(() => {
    if (!isTabBarEnabled || typeof window === 'undefined') return;

    const originalWindowOpen = window.open;

    window.open = (url?: string | URL, target?: string, features?: string) => {
      if (url) {
        const urlStr = url.toString();
        const isInternal =
          urlStr.startsWith('/') ||
          urlStr.includes('127.0.0.1') ||
          urlStr.includes('localhost') ||
          urlStr.startsWith(window.location.origin);

        if (isInternal && (target === '_blank' || !target)) {
          openTab({ path: urlStr });
          return null;
        }
      }
      return originalWindowOpen.call(window, url, target, features);
    };

    return () => {
      window.open = originalWindowOpen;
    };
  }, [openTab, isTabBarEnabled]);

  // =========================================================================
  // Keyboard Shortcuts: Cmd+T (New Tab), Cmd+W (Close Tab), Cmd+1..9 (Switch)
  // =========================================================================
  useEffect(() => {
    if (!isTabBarEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (!isMeta) return;

      // Cmd+T: New tab (Requirements)
      if (e.key.toLowerCase() === 't' && !e.shiftKey) {
        e.preventDefault();
        openTab({ path: wsPath('/requirements'), title: 'Requirements' });
        return;
      }

      // Cmd+W: Close active tab
      if (e.key.toLowerCase() === 'w' && !e.shiftKey) {
        e.preventDefault();
        closeTab(activeTabId);
        return;
      }

      // Cmd+1..9: Switch tab by index
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        const targetIndex = num - 1;
        if (tabs[targetIndex]) {
          e.preventDefault();
          switchTab(tabs[targetIndex].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTabBarEnabled, activeTabId, tabs, openTab, closeTab, switchTab, wsPath]);

  return (
    <TabContext.Provider
      value={{
        tabs,
        activeTabId,
        openTab,
        closeTab,
        switchTab,
        closeOtherTabs,
        closeTabsToRight,
        duplicateTab,
        isTabBarEnabled,
        setIsTabBarEnabled,
      }}
    >
      {children}
    </TabContext.Provider>
  );
};

export function useAppTabs() {
  const ctx = useContext(TabContext);
  if (!ctx) {
    throw new Error('useAppTabs must be used within a TabProvider');
  }
  return ctx;
}
