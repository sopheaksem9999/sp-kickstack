# Web UI Radix UI Priority Rule

## Standard
When building, modifying, or enhancing frontend UI components in `@sp-kickstack/web`:

1. **Prioritize Radix UI Primitives First**:
   - Always prefer `@radix-ui/react-*` components (`@radix-ui/react-popover`, `@radix-ui/react-dialog`, `@radix-ui/react-slot`, etc.) over native browser HTML `<select>`, `<dialog>`, or ad-hoc unstyled popups.
   - For dropdown menus, engine selectors, model selectors, and filter pickers, use Radix UI Popover / Select primitives styled with Tailwind CSS.

2. **UX Requirements for Radix UI Components**:
   - Include smooth animations (`data-[state=open]:animate-in`, `data-[state=closed]:animate-out`, `fade-in-0`, `zoom-in-95`).
   - Ensure keyboard accessibility (Arrow navigation, Enter/Space selection, Escape to dismiss).
   - Ensure proper dark mode / light mode styling matching the SP-Kickstack design tokens (`dark:bg-[#1a1b24]`, `dark:border-[#2d2f3d]`).
   - Use Lucide icons alongside labels for visual clarity and polish.
