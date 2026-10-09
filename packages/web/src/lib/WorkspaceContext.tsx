import React, { createContext, useContext, useState } from 'react';
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
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string>(() => {
    return localStorage.getItem('sp_active_workspace') || 'all';
  });

  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: fetchWorkspaces,
  });

  const setActiveWorkspaceId = (id: string) => {
    setActiveWorkspaceIdState(id);
    localStorage.setItem('sp_active_workspace', id);
    // Invalidate queries so workspace-scoped data refetches immediately
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.invalidateQueries({ queryKey: ['requirements'] });
    queryClient.invalidateQueries({ queryKey: ['sprints'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['ai-chat-sessions'] });
  };

  const upsertWorkspace = (ws: Workspace, autoSwitch: boolean = false) => {
    // 1. Immediately update React Query cache so UI components have the new workspace synchronously
    queryClient.setQueryData<Workspace[]>(['workspaces'], (old = []) => {
      const exists = old.some((w) => w.id === ws.id);
      if (exists) {
        return old.map((w) => (w.id === ws.id ? ws : w));
      }
      return [...old, ws];
    });

    // 2. Auto-switch active workspace if requested
    if (autoSwitch) {
      setActiveWorkspaceId(ws.id);
    }

    // 3. Reconcile with server in background
    queryClient.invalidateQueries({ queryKey: ['workspaces'] });
  };

  const refreshWorkspaces = async () => {
    await queryClient.invalidateQueries({ queryKey: ['workspaces'] });
  };

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || null;

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
