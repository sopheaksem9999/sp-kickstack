import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppLayout } from './components/AppLayout.js';
import { RequirementsPage } from './pages/RequirementsPage.js';
import { NewRequirementPage } from './pages/NewRequirementPage.js';
import { RequirementDetailPage } from './pages/RequirementDetailPage.js';
import { ProjectsPage } from './pages/ProjectsPage.js';
import { AttachmentsPage } from './pages/AttachmentsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { useBridgeEvents } from './lib/useEvents.js';
import { WorkspaceProvider } from './lib/WorkspaceContext.js';
import { ThemeProvider } from './lib/ThemeContext.js';
import { CreateRequirementProvider } from './lib/CreateRequirementContext.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function AppRoutes() {
  useBridgeEvents();

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/requirements" replace />} />
        <Route path="/requirements" element={<RequirementsPage />} />
        <Route path="/requirements/new" element={<NewRequirementPage />} />
        <Route path="/requirements/:id" element={<RequirementDetailPage />} />
        <Route path="/attachments" element={<AttachmentsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </AppLayout>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <WorkspaceProvider>
          <CreateRequirementProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </CreateRequirementProvider>
        </WorkspaceProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
