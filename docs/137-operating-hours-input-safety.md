# Operating-hours input safety

`PUT /catalog/stores/:id/operating-hours` validates window ranges and overlaps before replacing the schedule, but nested array entries are untrusted JSON. A null entry previously caused a JavaScript TypeError; the service turned its message into a public error code instead of a stable domain code. No evidence of an actual incident is implied.

The shared domain validator now rejects null, primitive and array entries with `OPERATING_HOURS_INVALID`, while preserving the existing specific codes for invalid days, minutes, windows and overlaps. The service forwards only recognized domain errors as 400 responses; unexpected errors go through the generic exception filter rather than exposing their message. Validation still occurs before the transaction and before any schedule delete/create. Existing authorized, valid window behavior is unchanged; this is not a full nested schema/unknown-field validation overhaul.

Unit tests cover malformed entries and invalid fields. An isolated PostgreSQL API integration test checks the response code and message and verifies existing schedule, audit and outbox records are unchanged. These tests do not verify a hosted backend. No remote migration, database write or production deployment was performed.
