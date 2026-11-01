# Source review, coverage and limitations

Review date: 2026-11-01. This document distinguishes user decisions, historical proposals, visual fixtures and verified external facts.

## Workspace inspection

No Git repository, application source, database, migration, environment file, dependency lockfile or deployment was present. Five uploaded reference images were available and visually inspected. Nothing existing was overwritten. The workspace now contains documentation, logical contracts, diagram sources/renders and documentation-generation/validation scripts only.

## Shared conversation recovery

Source: https://chatgpt.com/share/6ae70089-14c4-83ec-aaf9-b382b6b04347

The ordinary page fetch exposed only the application shell. The public HTML's embedded serialized response was decoded locally without executing remote scripts. The recovered graph contained 633 nodes, from which 460 visible messages were retained: 209 user messages in 203 grouped turns and 251 assistant replies. User audio transcriptions were recovered where present. Other graph nodes are structural/metadata entries and are not claimed as additional readable messages.

Persisted evidence:

| File | Coverage |
|---|---|
| `../research/visible-conversation.json` | 460 visible messages with source indexes/roles/transcriptions |
| `../research/conversation-transcript.md` | Full retained visible transcript |
| `../research/user-requirements-transcript.md` | All 209 user messages / 203 groups; fully reviewed |
| `../research/historical-business-proposals.md` | Focused business/finance/geography extracts; fully reviewed |
| `../research/historical-ai-and-admin.md` | Focused AI/admin/privacy extracts; fully reviewed |
| `../research/historical-security-and-design.md` | Focused security/design extracts; fully reviewed |
| `../research/other-assistant-replies.md` | Remaining 224 assistant replies; fully reviewed |
| `../research/conversation-attachments.json` | Six historical image pointers and dimensions |
| `../contracts/source-manifest.json` | Six current upload hashes/dimensions and conversation counts |
| `../contracts/requirements-register.csv` | Atomic source-line requirements, historical additions and screenshot inventory |

Focused extracts overlap the full transcript; they are not additional messages. All 251 retained assistant replies were reviewed across focused extracts plus the remaining-reply file. An assistant proposal is not automatically a user-approved requirement.

## What could not be recovered

- Private/internal reasoning, redacted code/tool output and unavailable historical image binaries were not accessible and were not invented.
- Six historical image pointers are not proof that they are byte-identical to the five current uploads; no such identity is asserted.
- The original master-script attachment/message was not independently archived in the recovered share transcript. `00-master-instructions.md` is a normalized reconstruction from the supplied task context, checked against the retained requirements. It is not certified byte-for-byte identical to an original file. The final Bengali instruction is retained; uncertain wording is not silently corrected.
- No original production logo/vector asset or photography license was supplied. The screenshot logo is a visual reference, not a verified trademark/license asset.

## Precedence and conflict handling

1. Final master instructions and explicit later user corrections control.
2. Approved current Get Stoopy visuals control brand/layout, but mock numbers/claims are not business facts.
3. Earlier user requests remain in traceability; where superseded, the conflict and resolution are recorded.
4. Assistant-generated suggestions are proposals unless accepted by the user.
5. Provider capability/legal claims require authoritative current evidence and merchant-specific confirmation.

| Conflict | Resolution retained |
|---|---|
| Green theme suggestions vs final red/white/black | Final red accents, ordinary white backgrounds, dark navigation/footer; no green brand replacement |
| Buyer GPS must match destination vs remote gifting | Separate buyer/recipient; recipient destination controls service; buyer location only risk evidence |
| Immediate wallet withdrawal / twice-weekly / manual-only vs final Sunday | Sunday automatic payout default plus manual/verified bank option; exact cutoff pending |
| Rider travel/traffic/waiting bonus suggestions | Rejected; fixed store→recipient road-distance slabs, admin-configured |
| Automatic ready after prep timer | Rejected; vendor manually confirms ready |
| Every-login Gmail code vs final master | Mandatory privileged TOTP; risk-based new/suspicious-device email challenge |
| Separate AI microservice vs modular monolith | AI module/worker initially; extraction only after measured need |
| Apple in login image vs Google/Facebook/LinkedIn/X in master | Apple optional inventoried addition; specified providers remain required when configured |
| Worldwide/free shipping/payment logos | Capability- and policy-driven display; not enabled by a mockup |
| Admin chart $48,750 vs bars totaling $119,000 | Mock inconsistency; real aggregates must reconcile |
| Vendor “Last 30 Days” with seven weekday labels | Use period-consistent dates/buckets in implementation |
| Historical legal/QR assertions | Not treated as verified law or acquirer permission |

## External research boundary

Official documentation was consulted for identity, routing, ORM and payment entry points. Search snippets are not a substitute for a provider contract. SSLCOMMERZ's reviewed public v4 page is dated 2019; aamarPay documents signed IPN and transaction lookup; shurjoPay capabilities remain to be confirmed from current merchant documentation. Keycloak account-linking and TOTP features require configuration/interoperability tests. Google Routes exposes road distance/duration and matrix operations; pricing/coverage/quotas remain deployment decisions. Prisma 8's PostGIS extension was announced in October 2026; exact release maturity and pinned compatibility must be verified before implementation. [1](https://www.keycloak.org/docs/latest/server_admin/index.html) [2](https://aamarpay.readme.io/reference/instant-payment-notification) [1](https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRoutes) [2](https://www.prisma.io/blog/prisma-orm-8-closes-330-most-requested-issues)

No paid service, merchant account, OAuth app, cloud resource or production deployment was created. No legal opinion is offered.

## Traceability method and honest limit

The generator retains every non-heading, non-note line of the normalized master, including standalone prose and list items, with source line references. Headings supply section/phase context. Historical additions and every inventory row from the six images are added separately. This provides broad, auditable coverage of the available text, not a proof that every unavailable artifact or ambiguous human intention has been recovered. Acceptance IDs are planned mappings, not passed tests.
