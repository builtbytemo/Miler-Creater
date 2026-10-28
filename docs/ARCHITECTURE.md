# System Architecture & Technical Specification

## 1. Executive Overview

The **Content & Task Command Center** is a unified, high-performance operational workspace for managing social media content across LinkedIn, Reddit, Threads, and X, alongside personal tasks, dependencies, projects, and calendar schedules.

The application is built on a modern full-stack foundation:
- **Framework**: Next.js (App Router, React 19, TypeScript)
- **Styling**: Tailwind CSS v4 (minimalist, high-density, accessible interface)
- **Database**: Supabase PostgreSQL with Row Level Security (RLS)
- **Authentication**: Supabase Auth (Email/Password, Google OAuth, SSR Cookie Session Management)
- **Server Execution**: Next.js Server Actions, Route Handlers, and Supabase Edge Functions
- **AI Tooling**: Scoped Model Context Protocol (MCP) and REST endpoints with strict confirmation boundaries

---

## 2. System Architecture

```mermaid
flowchart TB
    subgraph Client Layer
        Browser[Modern Web Browser]
        AI_Client[External AI: Claude / ChatGPT]
    end

    subgraph Next.js App Router Layer
        MW[Edge Middleware: Session Refresh & Route Guard]
        SSR[Server Components: Data Prefetch]
        SA[Server Actions & Route Handlers]
        ClientUI[Interactive Client Components]
    end

    subgraph Security & Access Control
        AuthGuard{Session Valid?}
        ScopedTokenAuth{AI Scoped Token?}
        RLS[Supabase Row Level Security]
    end

    subgraph Supabase Postgres Database
        AuthUsers[(auth.users)]
        Profiles[(profiles)]
        Workspaces[(workspaces & members)]
        Content[(content_items)]
        Tasks[(tasks & dependencies)]
        Recurrence[(recurrence_rules)]
        Notifications[(notifications)]
        AI_Tokens[(ai_api_tokens)]
        Audit[(audit_events)]
    end

    Browser -->|HTTPS / Cookies| MW
    MW --> AuthGuard
    AuthGuard -->|Authenticated| SSR
    AuthGuard -->|Unauthorized| LoginRedirect[/auth/sign-in]
    SSR --> ClientUI
    ClientUI -->|Mutations| SA

    AI_Client -->|Bearer Token| ScopedTokenAuth
    ScopedTokenAuth --> SA

    SA --> RLS
    RLS --> Content
    RLS --> Tasks
    RLS --> Workspaces
    RLS --> Audit
```

---

## 3. Core Architectural Decisions

### 3.1. Unified Data Model for Tasks and Content
In productivity tools, content publishing and task execution frequently collide when isolated into separate tools. In this system:
- **Both tasks and content items share temporal attributes**: `scheduled_at` / `scheduled_start`, `duration_minutes`, `recurrence_rule_id`, and `workspace_id`.
- The **Unified Calendar Engine** can execute a single, performant composite query across both tables, projecting a single chronological timeline:
  ```sql
  SELECT id, 'content' as item_type, platform, title, scheduled_at as start_time, status FROM content_items WHERE workspace_id = $1 AND scheduled_at BETWEEN $2 AND $3
  UNION ALL
  SELECT id, 'task' as item_type, NULL as platform, title, scheduled_start as start_time, status FROM tasks WHERE workspace_id = $1 AND scheduled_start BETWEEN $2 AND $3
  ORDER BY start_time ASC;
  ```

### 3.2. Server-Side Rendering (SSR) & Cookie Auth
Using `@supabase/ssr`, authentication cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` (in production).
- Middleware validates tokens on every request using `supabase.auth.getUser()`.
- Data is fetched server-side inside React Server Components directly to avoid client waterfalls.
- Client components only handle local UI interactions (drag-and-drop, modals, form inputs).

### 3.3. Multi-Tenant Future-Proofing
While initial usage is personal-first, every query requires `workspace_id`.
- The database auto-generates a user's initial workspace upon registration.
- If the user later adds team members (e.g. an editor, designer, or virtual assistant), or manages multiple brands/workspaces, the data layer requires zero migration.

---

## 4. Production Deployment Prerequisites

1. **Hosting Platform**: Vercel or AWS Amplify (Node.js runtime).
2. **Database & Auth**: Supabase hosted project (or self-hosted Supabase instance).
3. **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon public key
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase secret service-role key (server-only)
   - `NEXT_PUBLIC_SITE_URL`: Application canonical domain
4. **DNS & Email**:
   - Production domain with SSL.
   - Transactional email provider (Resend, AWS SES, or SendGrid) configured in Supabase Auth settings.
