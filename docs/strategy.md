# Project "Flux" — Full Product Strategy, Design & Production-Grade Architecture

## 0. Business Strategy

### 0.1 Brand & product structure
- **Company/brand name is chosen independently of the first product name.** e.g. Company = "Nimbus Labs", Product #1 = "Nimbus Flow" (the Jira alternative). This mirrors Atlassian (brand) vs. Jira/Confluence/Trello (products) — lets you add Product #2, #3 later under the same brand without a rebrand or customer confusion.
- Reserve the domain, trademark search, and social handles for the **brand name**, not just the product name, before public launch.

### 0.2 Go-to-market sequencing
1. **Launch one product only**: the Jira alternative. Do not build a second product until Product #1 has paying, retained customers (target: 50–100 paying teams with <5% monthly logo churn before starting Product #2).
2. Land on teams actively frustrated with Jira: dev teams at 10–200 person companies, agencies, and startups migrating off Trello/Asana who need more structure. Acquisition channels: SEO/content on "Jira alternatives," "Jira is slow," comparison pages; Product Hunt/HN launch; free Jira-import as the hook.
3. Once retained, cross-sell Product #2 (candidates: a lightweight Confluence-alternative docs tool, or a service-desk/ITSM module) to the *same* installed base — this is where the "brand house" pays off.

### 0.3 Pricing strategy
- **Penetration pricing** on Product #1: priced meaningfully below Jira (e.g. 40–60% lower per seat) for the first 12–18 months, positioned explicitly as "introductory pricing."
- **Grandfathering commitment (non-negotiable):** every customer who signs up during the introductory period keeps that price for as long as they remain a customer, or for a stated minimum window (e.g. 3 years). State this explicitly on the pricing page and in the ToS at signup. This converts early adopters into advocates instead of a future churn risk, and is the single biggest lesson from SaaS companies that alienated early users with silent price hikes.
- Price increases going forward apply **only to new signups**, and are framed as "new tier unlocks X new capability" rather than "same product, costs more."
- No feature-gating on automation, reporting, or integrations by price tier in the first product — differentiate tiers by seats/usage limits and support SLA, not by withholding core functionality (this directly targets Jira's "automation is capped unless you pay more" complaint).

### 0.4 Competitive framing
"The market is crowded" is not a real objection in 2026 — Linear already proved that speed/UX/reliability differentiation beats incumbents even in a "solved" category. Position explicitly as: **fast, reliable, honestly priced, and built for teams who've been burned by Jira's slowness and complexity** — not as a feature-for-feature clone.

### 0.5 Switching-cost mitigation (critical, must ship early, not late)
The biggest barrier to adoption is migration friction, not feature gaps. A high-fidelity **Jira importer** (issues, comments, attachments, workflows, sprints, users) must ship in Phase 1, not be deferred — this was previously in Phase 5 and is now moved up because it is the actual unlock for switching, not a nice-to-have.

---

## 1. Jira's known drawbacks and Flux's answer

| # | Jira drawback | Why it hurts | Flux's answer |
|---|---|---|---|
| 1 | Slow, heavy UI, laggy boards at scale | Kills flow state | Virtualized rendering, optimistic UI, sub-100ms interaction budget, edge caching |
| 2 | Workflow/scheme configuration maze | Admin-hostile, needs training | Unified project settings, visual workflow diff/preview before publish |
| 3 | Automation capped/paywalled | Teams hit walls, feel upsold | Unlimited automation in core product regardless of tier |
| 4 | Weak cross-project reporting | No org-wide visibility natively | Native analytics warehouse, no plugin required |
| 5 | Slow/unreliable search, steep JQL curve | Devs give up searching | Sub-200ms full-text + structured search, JQL-compatible query language + NL-to-query layer |
| 6 | Notification fatigue | People mute Jira entirely | Fine-grained rules, digesting, smart-mute |
| 7 | Rigid, global-first permission schemes | Misconfig → security incidents | Project-scoped by default, "view as user" simulator |
| 8 | Custom field sprawl | Slower queries, admin chaos | Reusable field library, unused-field audit/archive |
| 9 | Poor offline support | Field/bad-network teams blocked | Local-first CRDT client with offline queue |
| 10 | Painful pricing scaling | Cost becomes political | Transparent tiers, grandfathered pricing (§0.3) |
| 11 | Roadmapping bolted on as separate product | Fragmented PM experience | Native dependency-aware timeline in core product |
| 12 | Invisible cross-team dependencies | Blockers surface too late | Cross-project dependency graph, critical-path highlighting |
| 13 | No real capacity intuition | Sprints chronically over/under-committed | Velocity + calendar-aware capacity planning |
| 14 | Painful Jira migration for switchers | Locks customers in by inertia | High-fidelity importer, shipped in Phase 1 (§0.5) |

---

## 2. Data model (core entities)

```
Organization
 └─ Team
     └─ Project
         ├─ IssueType (org templates, project overrides)
         ├─ Workflow (states, transitions, conditions, validators, post-functions)
         ├─ FieldSchema (reusable Field refs + project overrides)
         ├─ PermissionScheme (project-scoped, promotable to org policy)
         ├─ Board (Kanban/Scrum config, filters, swimlanes)
         ├─ Sprint
         └─ Issue
             ├─ Subtask[]
             ├─ Link[] (blocks/blocked-by/relates-to/duplicates)
             ├─ Comment[]
             ├─ Attachment[]
             ├─ WorklogEntry[]
             ├─ HistoryEvent[] (audit trail, revertible)
             └─ CustomFieldValue[]

AutomationRule (scope: project | org; trigger → condition[] → action[])
Dashboard (org or personal; Widget[] backed by AnalyticsWarehouse queries)
SLAPolicy (scope: project | team)
ImportJob (source: jira | trello | asana; status, mapping config, error log)
```

Design principle: **fields, workflows, and permissions are org-level templates instantiated and override-able per project** — this is the direct fix for Jira's scheme sprawl (drawback #2, #8).

---

## 3. Production-grade architecture

### 3.1 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Product frontend | React + TypeScript, Vite, TanStack Query, Zustand | Logged-in SPA; SSR buys nothing behind auth; fast HMR at scale |
| Marketing/docs site | Astro (or Next.js if team prefers one framework) | Needs SEO/first-paint; kept as a *separate* deployable from the product app |
| Realtime/offline | Yjs (CRDT) over WebSocket | Local-first editing, no merge conflicts, offline queue |
| API | Node.js (NestJS): REST + GraphQL | GraphQL suits variable-shape issue/custom-field queries |
| Primary DB | PostgreSQL (multi-tenant, row-level security) | Relational integrity + JSONB for custom fields |
| Search | Meilisearch or Typesense | Sub-200ms full-text/faceted search, lighter ops than Elasticsearch |
| Analytics warehouse | ClickHouse (Postgres materialized views for MVP) | Fast aggregates across millions of issue-events |
| Automation engine | Temporal.io | Durable, retryable, replayable multi-step automations; dry-run against history |
| Event backbone | Kafka or NATS | Decouples search/analytics/automation/notifications from the write path |
| Cache | Redis | Sessions, rate limiting, hot-path caching |
| Auth | OIDC/SAML via Keycloak or Auth0 | Standard SSO; avoid building auth primitives in-house |
| Object storage | S3-compatible (AWS S3 / MinIO for self-host) | Attachments, exports, import job artifacts |
| Infra | Docker + Kubernetes | Portable across cloud and self-host |

### 3.2 Multi-tenancy
- **Pooled model with row-level security (RLS)**: every table carries `organization_id`; Postgres RLS policies enforce isolation at the DB layer, not just application code — defense in depth against a query-layer bug leaking cross-tenant data.
- Large/enterprise tenants get an option for **dedicated schema or dedicated DB instance** (noisy-neighbor isolation, easier compliance story for enterprise sales later).

### 3.3 Security (production-grade baseline)
- Encryption in transit (TLS everywhere) and at rest (DB + object storage).
- Secrets management via Vault or cloud KMS — never in env files committed to repos.
- RBAC enforced server-side on every mutation, never trusted from client; permission simulator (§ drawback 7) is a read-only overlay on the same enforcement path, not a separate code path.
- Audit log is append-only and tamper-evident (hash-chained or written to an external log sink) — supports future SOC 2 requirements.
- Dependency scanning (Dependabot/Snyk) and SAST in CI on every PR.
- Rate limiting per-org and per-user on the API gateway to contain abuse and runaway automations.

### 3.4 Observability
- Structured logging (JSON) shipped to a central sink (e.g. Loki/ELK).
- Distributed tracing via OpenTelemetry across API, automation engine, and search/analytics consumers — critical once the event-driven backbone (§3.1) fans out writes to multiple services, so a slow path is traceable end to end.
- SLOs defined per the perf targets in §3.6, with alerting on burn rate, not just raw thresholds.
- Error tracking (Sentry) wired into both frontend and backend.

### 3.5 CI/CD & release process
- Trunk-based development, feature flags (e.g. Unleash/LaunchDarkly) for incomplete features, so main stays deployable.
- CI pipeline: lint → type-check → unit tests → integration tests (against ephemeral Postgres via Testcontainers) → build → SAST/dependency scan.
- Staging environment mirrors production topology (same event backbone, same multi-tenancy model) — catches issues that only appear with real service boundaries.
- Progressive delivery: canary or blue/green rollout with automatic rollback on error-rate/latency regression.
- Database migrations are backward-compatible and run separately from deploys (expand/contract pattern) to allow zero-downtime releases.

### 3.6 Performance targets (SLOs)
- Issue create/update round-trip: < 150ms p95
- Board render, 1,000 issues: < 500ms initial paint, virtualized scroll
- Search query: < 200ms p95
- Cross-project dashboard load: < 1s (pre-aggregated via warehouse)
- API availability: 99.9% monthly

### 3.7 Testing strategy
- Unit tests for domain logic (workflow transitions, permission evaluation, field validation).
- Integration tests for API + DB + event consumers (search/analytics/automation) using ephemeral infra.
- End-to-end tests (Playwright) for critical user journeys: create issue → transition workflow → automation fires → notification delivered.
- Load testing (k6) against the performance targets in §3.6 before every major release, not just at launch.
- Chaos/failure testing on the event backbone (dropped messages, consumer lag) since so much of the "fast and reliable" promise depends on it staying decoupled and resilient.

### 3.8 Backup, DR, and data portability
- Automated daily Postgres backups with point-in-time recovery; documented and *tested* restore procedure (untested backups are not backups).
- Multi-region failover plan documented from Phase 1, implemented once customer base justifies the cost (Phase 3+).
- **Full data export** (issues, history, attachments) available to every customer at any time in an open format — directly counters the "vendor lock-in" fear that makes prospects nervous about leaving Jira for you, too.

---

## 4. Phases — features, explanation, and production-grade techniques per phase

### Phase 1 — Core MVP + Jira Importer
**Goal:** smallest usable, migratable, production-safe product — not a prototype.

**Features:**
- Organizations, teams, projects, issues (story/task/bug/epic/subtask), custom issue types.
- Kanban + Scrum boards, backlog, sprints.
- Custom workflows (states/transitions/conditions/validators/post-functions), custom fields, project-scoped permissions.
- Comments, attachments, mentions, activity history.
- **Jira importer**: issues, comments, attachments, users, workflows, sprints — mapped into Flux's schema with an error/mismatch report the admin can review before committing.
- REST + GraphQL API, webhook support, OIDC/SAML SSO.

**Why these and not more:** this set is the minimum needed for a team to fully move off Jira and operate day-to-day — anything less isn't migratable, anything more delays first customers.

**Production-grade techniques applied here (not deferred):**
- Multi-tenant RLS from day one (retrofitting tenant isolation later is dangerous and expensive).
- CI/CD pipeline, structured logging, and error tracking live before the first customer, not after.
- Backward-compatible migrations and the expand/contract pattern established as a norm immediately.
- Import jobs run as durable Temporal workflows (not synchronous scripts) so a large Jira export can retry/resume on failure without corrupting partial state.

**Exit criteria:** a real team can import their existing Jira project, run a full sprint inside Flux, and hit every SLO in §3.6.

---

### Phase 2 — Differentiators v1: Automation, Dependencies, Capacity
**Features:**
- Automation engine: no-code rule builder (trigger → conditions → actions) plus a scripting escape hatch (JS), versioned rules, dry-run against historical data before enabling.
- Cross-project dependency graph with critical-path highlighting.
- Capacity-aware sprint planning: velocity history + calendar (PTO/holidays) factored into sprint capacity warnings.

**Why:** these are the top three complaints (capped automation, invisible dependencies, unrealistic sprint commitments) with no native Jira equivalent — this is where Flux stops being "cheaper Jira" and becomes "better Jira."

**Production-grade techniques:**
- Automation rules execute as Temporal workflows: every action is retryable and auditable, and a runaway/misconfigured rule can be paused mid-flight without data corruption — this matters because unlimited automation (a stated differentiator) increases the blast radius of a bad rule.
- Dry-run mode replays rules against a read-only snapshot, never against live data, to make "test before enabling" actually safe.
- Dependency graph queries served from the analytics warehouse (not live joins across projects) to keep it fast as tenants scale.

**Exit criteria:** a customer can build an automation rule that would have required a paid Jira Automation tier, dry-run it, and trust it enough to enable on a live project.

---

### Phase 3 — Analytics, SLAs, and Reliability Hardening
**Features:**
- Cross-project analytics warehouse: lead time, cycle time, throughput, SLA compliance by team/label/component; shareable saved dashboards.
- First-class SLA/escalation policies (usable for eng on-call, not just service desks).
- Multi-region failover plan implementation (from the design established in §3.8).

**Why:** this is the "org-wide visibility" gap Jira only fills via paid add-ons — and it's also the point where paying customers start demanding reliability guarantees, so DR work belongs here, not later.

**Production-grade techniques:**
- Event-sourced ingestion into ClickHouse (issue-events, not point-in-time snapshots) so historical trend queries are accurate even after workflow/field schema changes.
- SLA breach detection runs as a scheduled + event-triggered Temporal workflow, escalating through configured channels (email/Slack/webhook) with acknowledgement tracking.
- Load-test the warehouse against synthetic multi-year, multi-thousand-issue datasets before shipping dashboards — cross-project analytics is exactly the feature most likely to silently degrade under real data volume.

**Exit criteria:** an org admin can see cross-team throughput/SLA compliance in one dashboard with no plugin, at the same load a real 200-person org would generate.

---

### Phase 4 — Advanced Experience: Offline, AI Triage, NL Query, Workflow Simulation
**Features:**
- Offline-first client via CRDT (Yjs): create/edit issues offline, sync cleanly with no manual conflict resolution.
- AI-assisted triage: suggest issue type/priority/component/assignee from historical patterns; opt-in, with a stated model/privacy posture (local or hosted, disclosed to the customer).
- Natural-language query translated to the structured query language (JQL-equivalent), with the generated query always shown and editable — never a black box.
- Workflow-change simulation: preview a workflow edit's effect against existing issues before publishing.

**Why:** these are genuine "advanced" capabilities Jira lacks outright, positioned deliberately after the fundamentals (Phases 1–3) are solid — advanced features on a shaky core would undercut the "fast and reliable" positioning.

**Production-grade techniques:**
- CRDT sync conflict-tested via chaos scenarios (simultaneous offline edits from 2+ clients merging back) before general release.
- AI triage suggestions are always advisory and logged as a distinct "AI-suggested" field-change type in the audit log — never silently auto-applied, preserving trust and auditability.
- Workflow simulation runs against a copied dataset in an isolated sandbox, not production, to guarantee zero risk of the "preview" itself mutating real issues.

**Exit criteria:** offline edits survive a real network partition test; AI suggestions are measurably useful without eroding trust (tracked via suggestion-acceptance rate).

---

### Phase 5 — Ecosystem and Second Product Groundwork
**Features:**
- Hardened public API + versioning policy, rate limits published, deprecation policy documented.
- Deeper Git integration: branch/PR/commit status on issues, and issue-status gating on merges.
- Plugin/marketplace SDK (only once core API is stable enough to commit to backward compatibility).
- Groundwork for Product #2 under the same brand (§0.2), reusing the same auth, billing, and org/team model.

**Why:** ecosystem investments are expensive to maintain and only pay off once there's a retained customer base to build for — this is deliberately last, mirroring the go-to-market sequencing in §0.2.

**Production-grade techniques:**
- API versioning via URL/header versioning with a published deprecation window (e.g. 12 months), enforced by contract tests so breaking changes can't ship silently.
- Marketplace apps run in a sandboxed execution context (not arbitrary server-side code against the primary DB) to prevent a third-party plugin from becoming a security or reliability incident.
- Shared identity/org model extracted into its own service boundary before Product #2 starts, so the second product is a genuine additive sale, not a rebuild.

**Exit criteria:** public API has external consumers relying on it under the published stability guarantee; Product #2 scoping can begin without re-deriving auth/org/billing.

---

## 5. Open questions still to resolve

- Self-hosted vs. cloud-only vs. both — affects who operates Temporal/ClickHouse/Kafka (real ops burden for self-host customers).
- Exact AI triage posture: local/on-device model vs. hosted, and how that's disclosed for enterprise/privacy-sensitive prospects.
- Enterprise compliance roadmap (SOC 2, ISO 27001) — timing depends on when enterprise deals start requiring it; the security/audit groundwork in §3.3 is deliberately compliance-ready but not certified from day one.
