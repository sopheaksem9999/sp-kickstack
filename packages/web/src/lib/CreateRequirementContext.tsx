import { createContext, useContext, useState, ReactNode } from 'react';
import type { Requirement } from '@sp-kickstack/shared';

interface CreateRequirementContextType {
  isOpen: boolean;
  editingRequirement: Requirement | null;
  openSheet: (reqOrEvent?: unknown) => void;
  openCreate: () => void;
  openEdit: (req: Requirement) => void;
  closeSheet: () => void;
}

const CreateRequirementContext = createContext<CreateRequirementContextType | undefined>(undefined);

export function CreateRequirementProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<Requirement | null>(null);

  const openSheet = (reqOrEvent?: unknown) => {
    if (reqOrEvent && typeof reqOrEvent === 'object' && 'id' in reqOrEvent && 'seq' in reqOrEvent) {
      setEditingRequirement(reqOrEvent as Requirement);
    } else {
      setEditingRequirement(null);
    }
    setIsOpen(true);
  };

  const openCreate = () => {
    setEditingRequirement(null);
    setIsOpen(true);
  };

  const openEdit = (req: Requirement) => {
    setEditingRequirement(req);
    setIsOpen(true);
  };

  const closeSheet = () => {
    setIsOpen(false);
    setEditingRequirement(null);
  };

  return (
    <CreateRequirementContext.Provider
      value={{ isOpen, editingRequirement, openSheet, openCreate, openEdit, closeSheet }}
    >
      {children}
    </CreateRequirementContext.Provider>
  );
}

export function useCreateRequirement() {
  const context = useContext(CreateRequirementContext);
  if (!context) {
    throw new Error('useCreateRequirement must be used within a CreateRequirementProvider');
  }
  return context;
}
