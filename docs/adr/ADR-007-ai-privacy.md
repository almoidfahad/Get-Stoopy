# ADR-007: Scoped AI assistance and consented first-party personalization

Status: ACCEPTED for development — owner approval 2026-11-01. Production/provider gates remain. Date: 2026-11-01.

Context: Historical requests include recommendations, forecasts, voice and admin assistance, but also impossible/covert surveillance and autonomous sensitive-action ideas. Final master requires privacy and human approval.

Decision: AI module inside monolith plus worker jobs. Unique agent identity; effective scope is caller∩agent∩country policy. Read-only allowlisted tools by default. No payout/refund/KYC/role/ledger execution. Human exact-payload approval uses normal domain authority. Personalization uses consented first-party events with view/clear/opt-out and opt-in sync. Voice starts only on explicit action; sharing uses explicit share sheet. No private communications/microphone/call ingestion.

Consequences: Requires consent propagation, retrieval-injection tests, groundedness evaluation, budgets and provider data terms. Core commerce works with AI disabled. Historical microservice/auto-execution suggestions are superseded.

Alternatives: Separate AI service later only for measured need. Covert cross-app listening and universal recording prevention are rejected as invalid/unsafe.

Review gate: Approve data categories, provider terms and prohibited-tool policy before enabling AI. No provider is connected.
