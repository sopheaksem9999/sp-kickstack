import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Workspace } from '@sp-kickstack/shared';
import { fetchWorkspaces } from './api.js';

interface WorkspaceContextType {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  activeWorkspace: Workspace | null;
  setActiveWorkspaceId: (id: string) => void;
  isLoading: boolean;
  refreshWorkspaces: () => Promise<void>;
  upsertWorkspace: (workspace: Workspace, autoSwitch?: boolean) => void;
  wsPath: (subpath: string) => string;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  // Extract workspace slug from URL: /w/:workspaceId/*
  const match = location.pathname.match(/^\/w\/([^/]+)/);
  const urlWorkspaceId = match ? decodeURIComponent(match[1]) : null;

  // Stored preference for fallback/defaults
  const [storedWorkspaceId, setStoredWorkspaceId] = useState<string>(() => {
    const saved = localStorage.getItem('sp_active_workspace');
    if (!saved || saved === 'all') {
      return 'default';
    }
    return saved;
  });

  // Effective active workspace ID: driven by URL if on a /w/... route, else stored preference
  const rawWorkspaceId = urlWorkspaceId || storedWorkspaceId;
  const activeWorkspaceId = rawWorkspaceId === 'all' || !rawWorkspaceId ? 'default' : rawWorkspaceId;

  // Sync active workspace to localStorage when URL has it
  useEffect(() => {
    if (urlWorkspaceId && urlWorkspaceId !== 'all' && urlWorkspaceId !== storedWorkspaceId) {
      setStoredWorkspaceId(urlWorkspaceId);
      localStorage.setItem('sp_active_workspace', urlWorkspaceId);
    }
  }, [urlWorkspaceId, storedWorkspaceId]);

  // If URL explicitly had /w/all, normalize and redirect to /w/default
  useEffect(() => {
    if (urlWorkspaceId === 'all') {
      const subpath = location.pathname.replace(/^\/w\/[^/]+/, '') || '/requirements';
      navigate(`/w/default${subpath}${location.search}${location.hash}`, { replace: true });
    }
  }, [urlWorkspaceId, location.pathname, location.search, location.hash, navigate]);

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: fetchWorkspaces,
  });

  // Helper to construct a workspace-scoped path
  const wsPath = useCallback(
    (subpath: string) => {
      const stripped = subpath.replace(/^\/w\/[^/]+/, '');
      const cleanSubpath = stripped.startsWith('/') ? stripped : `/${stripped}`;
      return `/w/${encodeURIComponent(activeWorkspaceId)}${cleanSubpath || '/requirements'}`;
    },
    [activeWorkspaceId]
  );

  const setActiveWorkspaceId = useCallback(
    (id: string) => {
      const cleanId = !id || id === 'all' ? 'default' : id;
      setStoredWorkspaceId(cleanId);
      localStorage.setItem('sp_active_workspace', cleanId);

      // If currently on a /w/... route, switch the slug in URL while preserving the subpath
      const subpath = location.pathname.replace(/^\/w\/[^/]+/, '') || '/requirements';
      const targetUrl = `/w/${encodeURIComponent(cleanId)}${subpath}${location.search}${location.hash}`;
      if (location.pathname !== targetUrl) {
        navigate(targetUrl);
      }

      // Invalidate queries so workspace-scoped data refetches immediately
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['requirements'] });
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
    },
    [location.pathname, location.search, location.hash, navigate, queryClient]
  );

  const upsertWorkspace = useCallback(
    (ws: Workspace, autoSwitch: boolean = false) => {
      queryClient.setQueryData<Workspace[]>(['workspaces'], (old = []) => {
        const exists = old.some((w) => w.id === ws.id);
        if (exists) {
          return old.map((w) => (w.id === ws.id ? ws : w));
        }
        return [...old, ws];
      });

      if (autoSwitch) {
        setActiveWorkspaceId(ws.id);
      }

      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
    [queryClient, setActiveWorkspaceId]
  );

  const refreshWorkspaces = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
  }, [queryClient]);

  const activeWorkspace = useMemo(() => {
    return workspaces.find((w) => w.id === activeWorkspaceId) || null;
  }, [workspaces, activeWorkspaceId]);

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspaceId,
        activeWorkspace,
        setActiveWorkspaceId,
        isLoading,
        refreshWorkspaces,
        upsertWorkspace,
        wsPath,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
