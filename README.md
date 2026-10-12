# SP-Kickstack

Cross-repo AI agent orchestration bridge connecting requirements, local developer AI CLIs, and multi-repository git workflows.

---

## Documentation & Guides

- 📘 [**User Guides Directory**](docs/guide/README.md)
  - ⚙️ [**Complete Settings & Configuration Guide**](docs/guide/settings-guide.md): Comprehensive user manual covering all Settings modules (AI CLIs, Git branch rules, embedded VS Code IDE, themes, and safety limits).
  - 🤖 [**Local AI CLI Engine & Rate Limit Management Guide**](docs/guide/ai-engine-guide.md): In-depth guide on configuring Claude Code, Google AGY, OpenAI Codex, and Ollama; understanding 429 rate limit backoff; and using the header quick switcher.
- 📐 [**DevFlow Bridge Specification (v0.2)**](docs/devflow-bridge-spec.md): Technical architecture and cross-repo orchestration design.

---

## Quick Start

### Prerequisites
- Node.js 22 (recommended via nvm: `nvm use 22.19.0`)
- Git

### Installation & Development

```bash
# Install dependencies
npm install

# Build all workspace packages
npm run build

# Run unit & integration tests
npm test

# Start the full stack development environment
npm run dev
```

The web dashboard opens at `http://localhost:5173`, connecting to the bridge server at `http://localhost:4100`.
