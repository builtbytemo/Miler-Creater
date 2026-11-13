# Zahi AI Sidebar & Dock Architecture Specification

> Status: **Layout Architecture Prepared (Model Runtime Deferred to Next Dedicated Phase)**
> Constraint: Zero synthetic responses or non-functional chat controls ship before backend runtime & provider integration.

## 1. Layout Shell Geometry

All authenticated routes render inside [`WorkspaceShell`](../src/components/layout/WorkspaceShell.tsx) with three orthogonal horizontal regions on desktop viewports:

1. **Left Navigation Rail (`AppNavigation`)**:
   - Expanded: `240px` (`data-sidebar-state="expanded"`), Collapsed icon rail: `68px` (`data-sidebar-state="collapsed"`).
   - Keyboard toggle: `[` (outside form controls and modal dialogs).
   - Persistence key: `localStorage["zahi:sidebar-collapsed"]`.
2. **Center Workspace Column (`<main id="main-content">`)**:
   - Uses `flex-1 min-w-0` so expanding or collapsing either sidebar smoothly resizes center content without horizontal overflow.
   - Standard container caps (`max-w-[1440px]` for primary workspaces, `max-w-4xl`/`5xl`/`6xl`/`7xl` per route density).
3. **Right Assistant Rail (`ZahiAiRail`)**:
   - Desktop (`lg+`, `>=1024px`):
     - Collapsed: `42px` minimal inspector edge rail (`[PanelRightOpen]`, `]` indicator, `ZahiDiamondMark`).
     - Expanded: `308px` (`lg`) to `340px` (`xl+`) docked inspector sidebar (`data-ai-rail-state="expanded"`).
   - Tablet (`768px–1023px`) & Mobile (`<768px`):
     - Collapsed trigger lives on the `42px` tablet right edge strip or the mobile header (`ZahiAiMobileTrigger`).
     - Expanded opens an accessible `role="dialog" aria-modal="true"` slide-over sheet (`w-[min(340px,92vw)]`) so `<main>` content never crushes on narrow screens.
   - Keyboard toggle: `]` (outside inputs/dialogs); `Esc` closes narrow-screen overlay sheet.
   - Persistence key: `localStorage["zahi:ai-rail-open"]` via `useSyncExternalStore` (server snapshot always returns `false` for hydration safety).

## 2. Planned Phase 2 Integration Contracts

### A. Context Injection Model (Read-Scoped)
When the user opens an AI session on any workspace route, the client submits a lightweight `AiContextEnvelope`:
- `workspaceId` (verified server-side against `workspace_members` + RLS; client values never trusted alone).
- `route`: `'dashboard' | 'tasks' | 'calendar' | 'content' | 'notifications' | 'settings'`
- `selectedEntityId?: string` and `selectedEntityType?: 'task' | 'content_item' | 'notification'`
- `timeZone`: resolved from `profiles.timezone` so natural-language dates resolve deterministically.

### B. Provider / BYOK Credential Boundaries
- User or workspace LLM provider keys (OpenAI / Anthropic / Google) MUST be encrypted at rest in a dedicated server-side table or vault and NEVER serialized to client props or `localStorage`.
- Model execution MUST run solely in Server Actions or Route Handlers (`/api/ai/chat`) under authenticated Supabase user session + membership validation.
- Existing `ai_tokens` and OAuth/MCP scopes (`/settings/tokens`, `/api/mcp`) stay isolated for external CLI and MCP agent clients (e.g. `miler login`, Claude Desktop/Web).

### C. Two-Step Read vs. Write Safety Lifecycle
1. **Read & Synthesis Tools** (search tasks, inspect overdue backlog, summarize unscheduled content, query calendar slots): execute automatically within the active workspace RLS boundary.
2. **Mutation Proposals** (reschedule task, mark done, draft/schedule content post, update briefing preferences):
   - Model emits a structured `ProposedWorkspaceAction` card showing exact field diffs and human-readable target timestamps in `userTimeZone`.
   - User explicitly clicks **Apply** or **Discard** before invoking existing Zod-validated domain services (`task-service`, `content-service`, `notification-service`).
   - Bulk mutations (`> 1` record) require explicit confirmation summary count.

### D. Streaming & Failure States
- Token streaming via abortable `ReadableStream` (`AbortController` wired to a **Stop generating** control).
- Graceful degradation states:
  - **Missing/Invalid Key**: clear inline banner linking directly to AI provider key settings.
  - **Rate Limit / Provider Outage**: preserve unsent prompt draft + one-click retry without losing thread history.
