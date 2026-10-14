# Contributing to SP-Kickstack

Thank you for your interest in contributing to **SP-Kickstack**! We are building an open, developer-friendly orchestration bridge connecting autonomous AI coding agents across multi-repository architectures.

This document outlines the workflow and guidelines for contributing to this project.

---

## 🛠️ Codebase Structure

SP-Kickstack is organized as an npm workspaces monorepo:

- **`packages/shared`**: Shared TypeScript types, Zod schemas, branch naming, and validation rules.
- **`packages/server`**: Express REST API, SQLite database (`better-sqlite3`), and bridge orchestration services.
- **`packages/web`**: React 18 frontend dashboard built with Vite, Tailwind CSS, and Radix UI.
- **`packages/desktop`**: Native desktop shell built with Tauri v2.
- **`packages/xticket`**: Standalone CLI tool executed by AI agents in task repositories.

---

## 🚀 Development Setup

1. **Prerequisites**:
   - Node.js **22.19.0** (use `nvm use 22.19.0`).
   - Git.
   - Recommended: One or more local AI CLIs (`claude`, `agy`, `codex`, `ollama`).

2. **Install & Build**:
   ```bash
   git clone https://github.com/your-org/sp-kickstack.git
   cd sp-kickstack
   nvm use 22.19.0
   npm install
   npm run build
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```
   - Server runs on `http://localhost:4100`
   - Web client runs on `http://localhost:5173`

4. **Run Desktop App (Optional)**:
   ```bash
   npm run desktop:bundle-server
   npm run desktop:dev
   ```

---

## 📐 Engineering Guidelines

When contributing code, please follow these core principles:

1. **Radix UI Priority**:
   - For web UI components (dialogs, dropdowns, popovers, tabs), always prioritize `@radix-ui/react-*` accessible primitives over unstyled native HTML elements.

2. **Desktop & Web Parity**:
   - Ensure every new feature and API endpoint functions seamlessly in both web browser mode and the Tauri desktop app.
   - Check CORS and origin handling in `requestGuard.ts` for Tauri origins.

3. **Tab URL Governance**:
   - Views with tabs, sub-views, or segmented filters should synchronize active tabs with URL query parameters (`?tab=<id>`) to preserve reload state and browser history.

4. **Settings Module Governance**:
   - Any new configurable feature, AI engine preset, or safety rule should have corresponding controls in the **Settings page** (`SettingsPage.tsx`).

5. **Type Safety & Testing**:
   - Define all request/response schemas in `packages/shared`.
   - Write tests for new services and components using Vitest.

---

## 🧪 Verification

Before submitting a Pull Request, run the full verification suite:

```bash
# Typecheck and run all tests
npm run verify
```

---

## 📝 Pull Request Workflow

1. Fork the repo and create your branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Commit your changes with clear, descriptive commit messages.
3. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
4. Open a Pull Request on GitHub with a summary of changes, rationale, and screenshots/GIFs for UI enhancements.

Thank you for helping make SP-Kickstack better!
