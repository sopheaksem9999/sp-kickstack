import { createContext, useContext, useState, ReactNode } from 'react';

interface CreateRequirementContextType {
  isOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

const CreateRequirementContext = createContext<CreateRequirementContextType | undefined>(undefined);

export function CreateRequirementProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openSheet = () => setIsOpen(true);
  const closeSheet = () => setIsOpen(false);

  return (
    <CreateRequirementContext.Provider value={{ isOpen, openSheet, closeSheet }}>
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
