import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';
import { useWorkspace } from '../lib/WorkspaceContext.js';

export function NewRequirementPage() {
  const navigate = useNavigate();
  const { openSheet } = useCreateRequirement();
  const { wsPath } = useWorkspace();

  useEffect(() => {
    openSheet();
    navigate(wsPath('/requirements'), { replace: true });
  }, [openSheet, navigate, wsPath]);

  return null;
}
