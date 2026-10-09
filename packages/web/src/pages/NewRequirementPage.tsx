import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateRequirement } from '../lib/CreateRequirementContext.js';

export function NewRequirementPage() {
  const navigate = useNavigate();
  const { openSheet } = useCreateRequirement();

  useEffect(() => {
    openSheet();
    navigate('/requirements', { replace: true });
  }, [openSheet, navigate]);

  return null;
}
