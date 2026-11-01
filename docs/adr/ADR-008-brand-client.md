# ADR-008: Approved Get Stoopy identity and mobile-first clients

Status: ACCEPTED for development — owner approval 2026-11-01. Production/provider gates remain. Date: 2026-11-01.

Context: User approved the supplied homepage and role dashboards, explicitly rejecting a green replacement theme. Rider/admin use must work on mobile without pretending browsers provide native guarantees.

Decision: Next.js/React/TypeScript/Tailwind/shadcn with centralized red/white/black/charcoal tokens, restrained champagne gold, accessible keyboard/screen-reader behavior and Bengali/English support. Recreate approved layouts semantically. Customer web and role portals share components but enforce backend scope. Rider starts as mobile-first PWA; native wrapper later only if approved. Watermark/mask/audit sensitive web data; native capture controls only where supported.

Consequences: Original vector logo/photography rights and exact brand colors need confirmation. Mock claims/amounts are not production data. Browser screenshot/audio recording cannot be universally blocked. PWA background GPS limits must be disclosed. Visual regression and accessibility tests are required.

Alternatives: A green theme and screenshot-as-app are rejected.

Review gate: Approve token direction and client strategy; compare implemented screens at desktop/tablet/mobile before visual acceptance. No UI implementation exists yet.
