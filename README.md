# Content & Task Command Center

A high-performance, unified operational workspace for planning social media content across **LinkedIn**, **Reddit**, **Threads**, and **X**, alongside personal task hierarchies, dependencies, server-side calendar scheduling, and AI assistant security boundaries.

---

## 1. Architecture & Technology Stack

- **Framework**: [Next.js](https://nextjs.org) (App Router, React 19, TypeScript)
- **Database**: [Supabase PostgreSQL](https://supabase.com) with Row Level Security (RLS) on all public tables
- **Authentication**: Supabase Auth with `@supabase/ssr` (Cookie-based session management, Next.js Edge middleware token refreshing, Email/Password, and Google OAuth)
- **Styling**: Tailwind CSS v4 with an accessible, high-density operational design system
- **Validation**: Zod for form, payload, and entity invariant validation
- **Testing**: Vitest for fast, type-safe unit and security boundary verification

---

## 2. Directory Structure

```text
├── docs/
│   ├── ARCHITECTURE.md                 # System overview, component layers & deployment requirements
│   ├── DATABASE_SCHEMA.md             # Complete 14-table schema, indexes, ER diagram & trade-offs
│   ├── AUTHENTICATION_AND_SECURITY.md # Supabase SSR auth, RLS matrix & Google Cloud configuration
│   └── AI_INTEGRATION_BOUNDARY.md     # Scoped MCP / AI integration architecture & confirmation model
├── supabase/
│   └── migrations/
│       └── 20261028000001_initial_schema.sql # 14 entities, triggers, RLS policies & performance indexes
├── src/
│   ├── app/
│   │   ├── auth/                      # Dedicated auth shell (sign-in, sign-up, recovery, callback, sign-out)
│   │   ├── dashboard/                 # Protected operational command center foundation view
│   │   ├── layout.tsx                 # Root layout with Geist font & theme styling
│   │   └── page.tsx                   # Public gateway & session-aware router
│   ├── components/
│   │   └── auth/                      # Accessible auth components (e.g. GoogleOAuthButton)
│   ├── lib/
│   │   ├── auth/                      # Server actions for sign-in, sign-up, password reset, and sign-out
│   │   ├── supabase/                  # Type-safe clients: client.ts, server.ts, middleware.ts, admin.ts
│   │   └── validation/                # Zod schemas for input validation
│   ├── types/
│   │   └── database.ts                # TypeScript database definitions generated from SQL schema
│   └── middleware.ts                  # Edge session refresh and route protection
├── tests/                             # Vitest test suite (Auth validation, security boundaries, schema invariants)
└── .env.example                       # Documented environment variable template
```

---

## 3. Local Development Prerequisites

### Prerequisites:
- **Node.js**: v20+ (developed and verified on Node v26)
- **npm**: v10+
- **Supabase Account**: A free or paid Supabase project (do not reuse the Irwin waitlist database)

### Setup Instructions:

1. **Clone and Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Open `.env.local` and add your project-specific credentials from your Supabase Dashboard:
   - `NEXT_PUBLIC_SUPABASE_URL`: Your Supabase Project URL (`https://<project-id>.supabase.co`)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Your Supabase Anon/Public Key
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Secret Service Role Key (Keep this secret; never expose to client!)
   - `NEXT_PUBLIC_SITE_URL`: `http://localhost:3000` (for local development)

3. **Apply Database Migration**:
   In your Supabase project's **SQL Editor**, run the contents of:
   ```text
   supabase/migrations/20261028000001_initial_schema.sql
   ```
   *(Or link your project via Supabase CLI: `supabase link --project-ref <your-ref> && supabase db push`)*.

4. **Run the Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Run Verification & Tests**:
   ```bash
   # Run unit & security test suite
   npm test

   # Run type check and production build
   npm run build

   # Run linter
   npm run lint
   ```

---

## 4. Supabase & Google Cloud Configuration

### Supabase Dashboard:
1. Under **Authentication -> URL Configuration**:
   - Set **Site URL** to `http://localhost:3000` (or your production URL).
   - Add Redirect URLs:
     - `http://localhost:3000/auth/callback`
     - `http://localhost:3000/auth/reset-password`
2. Under **Authentication -> Providers -> Google**:
   - Enable the Google provider once Client ID and Client Secret are obtained from Google Cloud Console.

### Google Cloud Console:
1. Create an OAuth 2.0 Web Application client.
2. Set Authorized redirect URI to:
   `https://<your-supabase-project-id>.supabase.co/auth/v1/callback`
3. Paste Client ID and Client Secret into the Supabase Dashboard.

---

## 5. Security & Boundary Guardrails

1. **Service-Role Isolation**: `SUPABASE_SERVICE_ROLE_KEY` is quarantined on the server. If `createAdminClient()` is ever invoked in a browser environment, it immediately throws a fatal security exception.
2. **Row Level Security (RLS)**: Active on all 14 database tables. Authenticated users can only read or mutate rows belonging to workspaces where they hold valid membership.
3. **Workspace-Centric Multi-Tenancy**: The database provisions a personal workspace on signup, but all queries and foreign keys route through `workspace_id`. Adding team collaboration requires zero database restructuring.
4. **AI Boundaries**: AI clients (MCP, Claude, ChatGPT) operate with scoped, revocable API tokens. Destructive operations (deletion, bulk rescheduling) require human approval via `ai_confirmation_requests`.

---

## 6. Implementation Status & Next Phase

- [x] **Phase 1: Project Foundation, Architecture, Database Schema, and Security Boundaries** (COMPLETED)
- [ ] **Phase 2: Core Workspace Engine & Task Management with Unified Scheduling** (RECOMMENDED NEXT)
- [ ] **Phase 3: Multi-Platform Social Content Engine (Idea Inbox to Scheduled Calendar)**
- [ ] **Phase 4: Unified Multi-View Planning (Calendar, Kanban, Timeline) & Notification Worker**
- [ ] **Phase 5: Authenticated AI Integration (MCP Server & ChatGPT Action)**
