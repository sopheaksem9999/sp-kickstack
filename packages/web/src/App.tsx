import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/AppLayout.js';
import { RequirementsPage } from './pages/RequirementsPage.js';
import { NewRequirementPage } from './pages/NewRequirementPage.js';
import { RequirementDetailPage } from './pages/RequirementDetailPage.js';
import { QueuePage } from './pages/QueuePage.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { AttachmentsPage } from './pages/AttachmentsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { MetricsPage } from './pages/MetricsPage.js';
import { AiChatPage } from './pages/AiChatPage.js';
import { useBridgeEvents } from './lib/useEvents.js';
import { WorkspaceProvider, useWorkspace } from './lib/WorkspaceContext.js';
import { ThemeProvider } from './lib/ThemeContext.js';
import { CreateRequirementProvider } from './lib/CreateRequirementContext.js';
import { TabProvider } from './lib/TabContext.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function LegacyRedirect({ to }: { to?: string }) {
  const { wsPath } = useWorkspace();
  const location = useLocation();
  const targetSubpath = to || location.pathname;
  return <Navigate to={`${wsPath(targetSubpath)}${location.search}${location.hash}`} replace />;
}

function WorkspaceRootRedirect() {
  const { wsPath } = useWorkspace();
  const location = useLocation();
  return <Navigate to={`${wsPath('/requirements')}${location.search}${location.hash}`} replace />;
}

function AppRoutes() {
  useBridgeEvents();

  return (
    <AppLayout>
      <Routes>
        {/* Workspace-scoped routes */}
        <Route path="/w/:workspaceId" element={<WorkspaceRootRedirect />} />
        <Route path="/w/:workspaceId/requirements" element={<RequirementsPage />} />
        <Route path="/w/:workspaceId/requirements/new" element={<NewRequirementPage />} />
        <Route path="/w/:workspaceId/requirements/:id" element={<RequirementDetailPage />} />
        <Route path="/w/:workspaceId/queue" element={<QueuePage />} />
        <Route path="/w/:workspaceId/chat" element={<AiChatPage />} />
        <Route path="/w/:workspaceId/attachments" element={<AttachmentsPage />} />
        <Route path="/w/:workspaceId/projects" element={<ProjectsPage />} />
        <Route path="/w/:workspaceId/metrics" element={<MetricsPage />} />
        <Route path="/w/:workspaceId/settings" element={<SettingsPage />} />

        {/* Legacy / Direct paths: automatically redirect into active workspace route */}
        <Route path="/" element={<LegacyRedirect to="/requirements" />} />
        <Route path="/requirements" element={<LegacyRedirect to="/requirements" />} />
        <Route path="/requirements/new" element={<LegacyRedirect to="/requirements/new" />} />
        <Route path="/requirements/:id" element={<LegacyRedirect />} />
        <Route path="/queue" element={<LegacyRedirect to="/queue" />} />
        <Route path="/chat" element={<LegacyRedirect to="/chat" />} />
        <Route path="/attachments" element={<LegacyRedirect to="/attachments" />} />
        <Route path="/projects" element={<LegacyRedirect to="/projects" />} />
        <Route path="/metrics" element={<LegacyRedirect to="/metrics" />} />
        <Route path="/settings" element={<LegacyRedirect to="/settings" />} />

        {/* Fallbacks */}
        <Route path="/w/:workspaceId/*" element={<WorkspaceRootRedirect />} />
        <Route path="*" element={<LegacyRedirect to="/requirements" />} />
      </Routes>
    </AppLayout>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <WorkspaceProvider>
            <CreateRequirementProvider>
              <TabProvider>
                <AppRoutes />
              </TabProvider>
            </CreateRequirementProvider>
          </WorkspaceProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
