# Role, ownership and geographic permission matrix

Status: proposed deny-by-default policy. Machine-readable companion: `../contracts/role-permission-matrix.csv`.

## Decision order

1. Validate session, account status, authorization version and required assurance.
2. Require an explicit permission for the command/resource.
3. Resolve the target row and its owner/destination scope on the server.
4. Apply vendor membership OR rider ownership OR admin geographic scope as appropriate.
5. Project only allowed fields; apply step-up, maker–checker and export policy.
6. Execute through a scoped transaction; audit sensitive reads, writes and denied attempts.

**Legend:** G = explicit global Super Admin policy; C/R/T/Z/L = assigned country/region/city/zone/local scope; O = own customer account; V = own vendor/store membership; D = own assigned delivery; — = no access. Scope never widens a role permission. “Review” is not authority to approve one's own case or financial action.

| Capability | Super | Country | Regional | City | Zone / Local | Vendor owner / staff | Rider | Customer |
|---|---|---|---|---|---|---|---|---|
| Public catalog/search | Public | Public | Public | Public | Public | Public | Public | Public |
| Customer profile/addresses | G, restricted support | C support | R support | T support | Z/L support | — | — | O |
| Wishlist/cart/checkout | — | — | — | — | — | — | — | O |
| Own orders/remote tracking | — | — | — | — | — | — | D, minimum data | O, buyer view |
| Vendor application | — | — | — | — | — | V, draft only | — | O, applicant only |
| Vendor/rider activation/suspension | G, step-up, non-self | C delegated, step-up, non-self | — by default | — by default | — | — | — | — |
| Vendor membership grant/revoke | G oversight | C oversight | — | — | — | V owner, step-up, non-OWNER roles | — | — |
| Product/variant/inventory write | G moderation | C oversight | R oversight | T oversight | Z/L monitoring only by default | V, approved store; draft-only foundation implemented | — | — |
| Store activation/suspension | G, step-up, non-self | C delegated, step-up, non-self | — by default | — by default | — | — | — | — |
| Accept/reject/set prep/ready | G exception, audited | C exception policy | R exception policy | T operations | Z/L delegated operations | V, own suborder | — | — |
| KYC submit/upload | — | — | — | — | Authorized office assistance | V | D, own profile | — |
| KYC review/approval | G | C delegated | R delegated | T delegated | L review only if granted | — | — | — |
| Admin invite / scope grant | G | C descendants, delegated | R descendants, delegated | T zone/local, delegated | — | — | — | — |
| Edit own geographic scope | — | — | — | — | — | — | — | — |
| Start/end shift, location | — | — | — | — | — | — | D, consented | — |
| Delivery offer acceptance | — | — | — | — | — | — | D, eligible offer | — |
| Manual dispatch / override | G | C delegated | R delegated | T delegated | Z/L delegated | — | — | — |
| Pickup / OTP delivery proof | — | — | — | — | Audited exception only | V, pickup handoff only | D | Recipient OTP, not account role |
| Commission / rider rates | G | C only if delegated | — | — | — | V, view effective own charges | D, view own snapshot | — |
| Financial ledger direct edit | — | — | — | — | — | — | — | — |
| Refund request/review | G approval policy | C delegated review | R review | T review | L intake | V, own request | D, evidence only | O, request |
| Refund approval | G, maker–checker | C, explicit permission | R, explicit permission | T, explicit permission | — | — | — | — |
| Verify COD deposit | G | C delegated finance | R delegated finance | T delegated finance | L intake only | — | D, submit evidence | — |
| Approve payout/settlement | G, maker–checker | C delegated | R delegated | T delegated | — | V, request only | D, request only | — |
| Execute approved money transfer | G finance worker | C finance worker | R finance worker | T finance worker | — | — | — | — |
| Raw KYC / bank detail export | G, exceptional approval | — by default | — | — | — | — | — | — |
| Fraud hold/review | G | C | R | T | Z/L | V, own evidence | D, own evidence | O, appeal |
| Reject confirmed fraud | G authorized reviewer | C authorized reviewer | R authorized reviewer | T authorized reviewer | — | — | — | — |
| AI reports/assistant | G | C | R | T | Z/L | V aggregate | D own | O consented |
| AI payout/refund/KYC/role execution | — | — | — | — | — | — | — | — |
| Audit log read | G security | C delegated | R delegated | T delegated | L delegated | V, own activity only | D, own login history | O, own login history |
| Emergency privileged-session lock | G, step-up | — | — | — | — | — | — | — |
| Country creation / cross-border enable | G, legal gate | — | — | — | — | — | — | — |

## Roles and nuances

- **Local Admin** is an operational role mapped to an assigned zone or neighborhood; it is not an extra ancestry level and does not automatically equal Zone Admin. The master requires both Local and Zone portals; they share a scoped layout but distinct grants.
- **Country/Regional/City/Zone Admin** can have narrower permissions than their scope. Being a City Admin does not automatically grant payout approval or raw identity-document export.
- **Dispatch Manager, KYC Reviewer, Finance Maker, Finance Checker, Support Agent, Security Analyst** are additional staff roles, not public registration choices. Their scope remains constrained; finance maker cannot check the same action.
- **Vendor staff** membership can be store-limited. Vendor owner cannot access a different legal vendor even if both operate in the same zone.
- **Rider** access to recipient name/phone/address is limited to active assignment and a short post-delivery support window; no bulk customer export or browsing other offers' private data.
- **Customer** may be both buyer and applicant/vendor/rider. Roles are additive but endpoints select the relevant capability; a vendor login does not grant admin access.
- **AI Agent** has a unique workload identity, an allowed-tool list and the intersection of caller scope and agent scope. Read-only by default. Draft descriptions/answers/alerts are allowed where configured; money, permissions, KYC approval and ledger writes require the normal human command and cannot be executed through an AI shortcut.
- **Super Admin** global access is audited and step-up protected. Direct DB maintenance uses separate privileged infrastructure access; no shared permanent human DB credential.

## Mandatory negative tests

1. Mymensingh City Admin requests Dhaka order, financial summary, export job, notification recipient list, KYC document and AI report: deny without leaking existence; no aggregate inclusion.
2. Zone A Admin changes URL/body scope to Zone B or grants self Zone B: deny and audit.
3. Vendor A requests Vendor B suborder by guessed ID; websocket subscribes to B; export includes B: deny/filter at backend and query layer.
4. Rider A accepts Rider B offer, replays expired offer or accepts twice concurrently: at most one valid assignment.
5. Customer A guesses B's order/tracking/recipient/KYC URL: deny; signed tracking token scoped and revocable.
6. Staff with KYC review permission but no export permission attempts signed-URL or bulk export: deny.
7. Revoked admin session calls API and reconnects socket after emergency lock: both denied; queued privileged jobs revalidate authority.
8. AI asks tool to refund, approve KYC, edit ledger or change role: schema/policy denial; human approval endpoint still enforces maker–checker.
9. Finance maker attempts checker approval or payout-destination change plus immediate payout: deny/cooldown.
10. Lower-scope admin attempts global report cache key or search index query: scope required before cache/index access.

These are planned tests, not results. Permission changes bump `authorizationVersion`; all caches, sessions and socket rooms must observe revocation.
