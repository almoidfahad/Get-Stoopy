# ADR-001: One modular marketplace backend

Status: ACCEPTED for development — owner approval 2026-11-01. Production/provider gates remain. Date: 2026-11-01.

Context: Nine role experiences share orders, identity, geography and money. The master requires one centralized backend/database and forbids unnecessary initial microservices. Historical suggestions of separate AI services do not override this.

Decision: TypeScript monorepo with Next.js web/BFF, one NestJS domain API and a worker process running the same domain code. Redis/BullMQ/Socket.IO support asynchronous work and realtime hints. PostgreSQL is the business source of truth. Modules expose application commands and versioned events; no role-specific database or raw cross-module table writes.

Consequences: Simpler transactions and lower initial operating cost; strong module discipline is still required. Web/API/worker can scale independently without splitting business ownership. Extract a service only after measured scale/isolation need, with an explicit data ownership and migration ADR.

Alternatives: A well-structured Next.js backend is permitted and reduces deployables; NestJS is proposed for explicit guards/domain structure. Per-role microservices are rejected initially.

Review gate: Approve deployable topology and operating responsibility before Phase 2. No code/deployment exists yet.
