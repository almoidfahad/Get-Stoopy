# Logical database dictionary — v0.1

Status: architecture proposal, not an implemented schema. UUID primary keys and createdAt are implicit; updatedAt is omitted on append-only records. Money is integer minor units. `encrypted` fields use envelope encryption; hashes use the policy in the security threat model. Geometry is PostGIS SRID 4326.

113 entities, 253 explicit relationships. All minimum entities in master §28 are mapped below. Required names VendorLedger, RiderLedger and CODLedger are owner/purpose-specific views over the common journal model, not competing sources of truth.


## Identity

### User
| Field | Logical type |
|---|---|
| emailNormalized | string nullable |
| emailVerifiedAt | datetime nullable |
| phoneE164 | string nullable |
| phoneVerifiedAt | datetime nullable |
| displayName | string |
| status | UserStatus |
| authorizationVersion | int |

**Constraints / authorization:** Partial UNIQUE(emailNormalized) WHERE NOT NULL; canonical account; provider identities are separate UserIdentity rows; never merge on email alone

**Retention:** Business policy; see retention register

### UserIdentity
| Field | Logical type |
|---|---|
| userId | uuid |
| issuer | string |
| subject | string |
| providerKey | string |
| providerEmailEncrypted | string nullable |
| providerEmailVerified | boolean |
| linkedAt | datetime |
| linkedBy | string |
| lastVerifiedAt | datetime |

**Constraints / authorization:** UNIQUE(issuer,subject); UNIQUE(userId,issuer); proof-based linking only; issuer+subject is stable identity, not email

**Retention:** Business policy; see retention register

### Role
| Field | Logical type |
|---|---|
| key | string UNIQUE |
| name | string |
| kind | RoleKind |
| description | string |

**Constraints / authorization:** System roles immutable keys; permission grants versioned

**Retention:** Business policy; see retention register

### Permission
| Field | Logical type |
|---|---|
| key | string UNIQUE |
| resource | string |
| action | string |
| sensitivity | PermissionSensitivity |

**Constraints / authorization:** No permission implies geographic access

**Retention:** Business policy; see retention register

### RolePermission
| Field | Logical type |
|---|---|
| roleId | uuid |
| permissionId | uuid |

**Constraints / authorization:** UNIQUE(roleId,permissionId)

**Retention:** Business policy; see retention register

### UserRole
| Field | Logical type |
|---|---|
| userId | uuid |
| roleId | uuid |
| grantedBy | uuid |
| expiresAt | datetime nullable |
| revokedAt | datetime nullable |

**Constraints / authorization:** No self-grant; scope granted separately; privileged grant requires step-up

**Retention:** Business policy; see retention register

### Session
| Field | Logical type |
|---|---|
| userId | uuid |
| tokenHash | bytes UNIQUE |
| assuranceLevel | AssuranceLevel |
| state | SessionState |
| deviceId | uuid nullable |
| providerSessionReference | string nullable |
| encryptedTokenEnvelope | bytes nullable |
| expiresAt | datetime |
| idleExpiresAt | datetime |
| revokedAt | datetime nullable |
| authVersion | int |

**Constraints / authorization:** Opaque random token hashed at rest; tokens never in analytics; check user status and authorizationVersion every request

**Retention:** Business policy; see retention register

### Device
| Field | Logical type |
|---|---|
| userId | uuid |
| label | string |
| publicBindingHash | bytes |
| lastSeenAt | datetime |
| trustedAt | datetime nullable |
| revokedAt | datetime nullable |

**Constraints / authorization:** Binding cookie is a risk signal, not proof of identity or location

**Retention:** Business policy; see retention register

### AdminScope
| Field | Logical type |
|---|---|
| userId | uuid |
| geographyType | GeographyType |
| countryId | uuid nullable |
| regionId | uuid nullable |
| districtId | uuid nullable |
| cityId | uuid nullable |
| serviceZoneId | uuid nullable |
| neighborhoodId | uuid nullable |
| grantedBy | uuid |
| effectiveFrom | datetime |
| expiresAt | datetime nullable |
| revokedAt | datetime nullable |

**Constraints / authorization:** Exactly one referenced scope level; consistent ancestry; higher-scope grantor; no self-scope modification

**Retention:** Business policy; see retention register

### AdminInvitation
| Field | Logical type |
|---|---|
| emailNormalized | string |
| intendedRoleIds | json |
| intendedScopeSnapshot | json |
| tokenHash | bytes UNIQUE |
| invitedBy | uuid |
| expiresAt | datetime |
| acceptedAt | datetime nullable |

**Constraints / authorization:** Single-use; authorized approver; public registration cannot create admin

**Retention:** Business policy; see retention register

### MfaEnrollment
| Field | Logical type |
|---|---|
| userId | uuid |
| providerReference | string UNIQUE |
| method | TOTP |
| enrolledAt | datetime nullable |
| lastVerifiedStep | bigint nullable |
| status | MfaStatus |

**Constraints / authorization:** Secrets and recovery credentials held by identity provider encrypted; no plaintext mirror in business DB

**Retention:** Business policy; see retention register

### StepUpChallenge
| Field | Logical type |
|---|---|
| userId | uuid |
| sessionId | uuid |
| purpose | string |
| resourceHash | bytes |
| tokenHash | bytes UNIQUE |
| expiresAt | datetime |
| consumedAt | datetime nullable |

**Constraints / authorization:** Binds approval to actor, session, exact action and payload hash; one use

**Retention:** Business policy; see retention register

### ConsentRecord
| Field | Logical type |
|---|---|
| userId | uuid nullable |
| guestReferenceHash | bytes nullable |
| purpose | ConsentPurpose |
| policyVersion | string |
| granted | boolean |
| source | string |
| occurredAt | datetime |

**Constraints / authorization:** Append-only consent history; no prechecked marketing/personalization consent

**Retention:** Business policy; see retention register

### PrivacyRequest
| Field | Logical type |
|---|---|
| userId | uuid |
| kind | PrivacyRequestKind |
| status | PrivacyRequestStatus |
| verifiedAt | datetime nullable |
| dueAt | datetime |
| resultReference | string nullable |

**Constraints / authorization:** Export/delete with legal-hold exceptions; propagate to search, AI profile and caches

**Retention:** Business policy; see retention register


## Geography

### Country
| Field | Logical type |
|---|---|
| iso2 | string UNIQUE |
| name | string |
| currencyCode | string |
| callingCode | string |
| timezone | string |
| status | CountryStatus |

**Constraints / authorization:** BD first; US configured but disabled; currency immutable after financial activity

**Retention:** Business policy; see retention register

### CountryConfiguration
| Field | Logical type |
|---|---|
| countryId | uuid |
| version | int |
| effectiveFrom | datetime |
| localeDefaults | json |
| taxPolicyRef | string |
| kycPolicyRef | string |
| deliveryPolicyRef | string |
| settlementPolicyRef | string |
| legalPolicyRef | string |
| crossBorderEnabled | boolean |
| featureFlags | json |

**Constraints / authorization:** UNIQUE(countryId,version); crossBorderEnabled default false; activation requires legal gate

**Retention:** Business policy; see retention register

### Region
| Field | Logical type |
|---|---|
| countryId | uuid |
| code | string |
| name | string |
| status | AreaStatus |

**Constraints / authorization:** UNIQUE(countryId,code); division/region/state terminology per country

**Retention:** Business policy; see retention register

### District
| Field | Logical type |
|---|---|
| regionId | uuid |
| code | string |
| name | string |
| status | AreaStatus |

**Constraints / authorization:** UNIQUE(regionId,code)

**Retention:** Business policy; see retention register

### City
| Field | Logical type |
|---|---|
| districtId | uuid |
| code | string |
| name | string |
| kind | CityOrUpazila |
| status | AreaStatus |
| boundaryVersionId | uuid nullable |

**Constraints / authorization:** UNIQUE(districtId,code); city/upazila are siblings, not ancestor/descendant

**Retention:** Business policy; see retention register

### ServiceZone
| Field | Logical type |
|---|---|
| cityId | uuid |
| code | string |
| name | string |
| status | ZoneStatus |
| activeBoundaryVersionId | uuid nullable |
| operatingHours | json |
| priority | int |

**Constraints / authorization:** UNIQUE(cityId,code); overlapping active coverage requires explicit deterministic resolution

**Retention:** Business policy; see retention register

### Neighborhood
| Field | Logical type |
|---|---|
| serviceZoneId | uuid |
| code | string |
| name | string |
| boundaryVersionId | uuid nullable |

**Constraints / authorization:** UNIQUE(serviceZoneId,code); optional lowest locality level

**Retention:** Business policy; see retention register

### BoundaryVersion
| Field | Logical type |
|---|---|
| ownerType | GeographyType |
| ownerId | uuid |
| version | int |
| boundary | geometry_MultiPolygon_4326 |
| source | string |
| validFrom | datetime |
| approvedBy | uuid |
| contentHash | bytes |

**Constraints / authorization:** UNIQUE(ownerType,ownerId,version); ST_IsValid; immutable after approval; GiST boundary; no geometry in client write authority

**Retention:** Business policy; see retention register

### Address
| Field | Logical type |
|---|---|
| customerId | uuid nullable |
| vendorId | uuid nullable |
| riderId | uuid nullable |
| label | string nullable |
| countryCode | string |
| regionId | uuid |
| districtId | uuid |
| cityId | uuid |
| serviceZoneId | uuid nullable |
| neighborhoodId | uuid nullable |
| line1 | string |
| line2 | string nullable |
| postalCode | string nullable |
| point | geometry_Point_4326 |
| geocodeSource | string |
| geocodeConfidence | decimal nullable |
| normalizedSnapshot | json |

**Constraints / authorization:** Exactly one customer, vendor or rider owner; store address vendor must match; ancestry checked; coordinates revalidated against active polygon at quote/checkout; customer address-book owner isolated

**Retention:** Business policy; see retention register


## Commerce

### Customer
| Field | Logical type |
|---|---|
| userId | uuid UNIQUE |
| locale | string |
| defaultAddressId | uuid nullable |
| riskStatus | CustomerRiskStatus |

**Constraints / authorization:** No compulsory retail KYC; profile deletion does not erase legally retained financial records

**Retention:** Business policy; see retention register

### Vendor
| Field | Logical type |
|---|---|
| legalName | string |
| displayName | string |
| ownerUserId | uuid |
| businessType | VendorBusinessType |
| status | VendorStatus |
| kycCaseId | uuid nullable UNIQUE |
| homeCountryId | uuid |
| contactPhone | string |
| slug | string UNIQUE |

**Constraints / authorization:** Activation requires current KYC and authorized approval; one legal vendor can have multiple stores

**Retention:** Business policy; see retention register

### VendorMembership
| Field | Logical type |
|---|---|
| vendorId | uuid |
| userId | uuid |
| storeId | uuid nullable |
| vendorRole | VendorRole |
| status | MembershipStatus |

**Constraints / authorization:** UNIQUE NULLS NOT DISTINCT(vendorId,userId,storeId); store staff limited to store; owner cannot read another vendor

**Retention:** Business policy; see retention register

### Store
| Field | Logical type |
|---|---|
| vendorId | uuid |
| name | string |
| addressId | uuid |
| pickupPoint | geometry_Point_4326 |
| cityId | uuid |
| status | StoreStatus |
| operatingHours | json |

**Constraints / authorization:** Address and city ancestry match; pickup point verified; active KYC required

**Retention:** Business policy; see retention register

### VendorServiceArea
| Field | Logical type |
|---|---|
| storeId | uuid |
| serviceZoneId | uuid |
| active | boolean |
| approvedBy | uuid |

**Constraints / authorization:** UNIQUE(storeId,serviceZoneId); destination eligibility; same-country only initially

**Retention:** Business policy; see retention register

### Wishlist
| Field | Logical type |
|---|---|
| customerId | uuid |
| name | string |

**Constraints / authorization:** Owner-scoped; unique default list

**Retention:** Business policy; see retention register

### WishlistItem
| Field | Logical type |
|---|---|
| wishlistId | uuid |
| productId | uuid |

**Constraints / authorization:** UNIQUE(wishlistId,productId)

**Retention:** Business policy; see retention register

### Cart
| Field | Logical type |
|---|---|
| customerId | uuid nullable |
| guestTokenHash | bytes nullable |
| destinationAddressSnapshot | json nullable |
| currency | string |
| version | int |

**Constraints / authorization:** Exactly one owner kind; merge only after authenticated ownership proof; never trust client totals

**Retention:** Business policy; see retention register

### CartItem
| Field | Logical type |
|---|---|
| cartId | uuid |
| variantId | uuid |
| storeId | uuid |
| quantity | int |
| addedAt | datetime |

**Constraints / authorization:** UNIQUE(cartId,variantId,storeId); quantity >0; revalidate price/stock/destination

**Retention:** Business policy; see retention register

### Review
| Field | Logical type |
|---|---|
| customerId | uuid |
| productId | uuid |
| orderItemId | uuid UNIQUE |
| rating | int |
| body | string |
| status | ReviewStatus |
| verifiedPurchase | boolean |

**Constraints / authorization:** Rating 1..5; verified purchase derived server-side; moderation audit

**Retention:** Business policy; see retention register

### SupportTicket
| Field | Logical type |
|---|---|
| requesterId | uuid |
| subjectType | string |
| subjectId | uuid nullable |
| category | string |
| status | TicketStatus |
| assignedStaffId | uuid nullable |
| priority | TicketPriority |
| countryId | uuid |
| zoneId | uuid nullable |

**Constraints / authorization:** Scope by associated resource; private attachments; SOS uses dedicated safety workflow

**Retention:** Business policy; see retention register

### SupportMessage
| Field | Logical type |
|---|---|
| ticketId | uuid |
| authorId | uuid |
| body | string |
| attachmentKeys | json |
| createdAt | datetime |

**Constraints / authorization:** Participants and authorized support only; immutable edit history

**Retention:** Business policy; see retention register

### Coupon
| Field | Logical type |
|---|---|
| codeHash | bytes |
| codeDisplay | string |
| policy | json |
| status | CouponStatus |
| startsAt | datetime |
| endsAt | datetime |
| usageLimit | int nullable |
| perCustomerLimit | int nullable |
| version | int |

**Constraints / authorization:** Server validates scope/eligibility; redemption lock prevents overuse

**Retention:** Business policy; see retention register

### CouponRedemption
| Field | Logical type |
|---|---|
| couponId | uuid |
| customerId | uuid |
| orderId | uuid UNIQUE |
| amount | bigint |
| state | RedemptionState |

**Constraints / authorization:** UNIQUE(couponId,orderId); partial cancellation policy explicit

**Retention:** Business policy; see retention register

### Campaign
| Field | Logical type |
|---|---|
| name | string |
| kind | CampaignKind |
| audiencePolicy | json |
| placements | json |
| content | json |
| startsAt | datetime |
| endsAt | datetime |
| countryId | uuid |
| status | CampaignStatus |

**Constraints / authorization:** Claims such as free shipping require actual eligibility; consent-based targeting

**Retention:** Business policy; see retention register

### NewsletterSubscription
| Field | Logical type |
|---|---|
| emailHash | bytes UNIQUE |
| emailEncrypted | string |
| consentId | uuid |
| status | SubscriptionStatus |
| verifiedAt | datetime nullable |

**Constraints / authorization:** Double opt-in proposed; unsubscribe single use signed token

**Retention:** Business policy; see retention register

### LoyaltyAccount
| Field | Logical type |
|---|---|
| customerId | uuid UNIQUE |
| programVersion | string |
| status | LoyaltyStatus |

**Constraints / authorization:** Feature-flagged; points/cashback financial liability tracked through ledger where redeemable

**Retention:** Business policy; see retention register

### LoyaltyEvent
| Field | Logical type |
|---|---|
| accountId | uuid |
| eventKey | string UNIQUE |
| kind | LoyaltyEventKind |
| points | bigint |
| sourceReference | string |
| journalId | uuid nullable |
| occurredAt | datetime |

**Constraints / authorization:** Append-only; expiry/reversal explicit; no duplicate campaign awards

**Retention:** Business policy; see retention register

### Referral
| Field | Logical type |
|---|---|
| referrerId | uuid |
| referredCustomerId | uuid nullable |
| codeHash | bytes UNIQUE |
| status | ReferralStatus |
| qualifiedOrderId | uuid nullable |
| rewardEventId | uuid nullable |

**Constraints / authorization:** Anti-self-referral; reward only after configured qualifying event

**Retention:** Business policy; see retention register


## Delivery

### Rider
| Field | Logical type |
|---|---|
| userId | uuid UNIQUE |
| status | RiderStatus |
| kycCaseId | uuid nullable UNIQUE |
| emergencyContactEncrypted | json |
| addressId | uuid |
| homeCityId | uuid |
| capacity | int |

**Constraints / authorization:** Capacity default 1 active delivery; current KYC and vehicle eligibility required

**Retention:** Business policy; see retention register

### RiderServiceArea
| Field | Logical type |
|---|---|
| riderId | uuid |
| serviceZoneId | uuid |
| approvedBy | uuid |
| validFrom | datetime |
| expiresAt | datetime nullable |
| overrideReason | string nullable |

**Constraints / authorization:** UNIQUE active grant; overrides audited and time-limited

**Retention:** Business policy; see retention register

### Vehicle
| Field | Logical type |
|---|---|
| riderId | uuid |
| type | VehicleType |
| registrationNumberEncrypted | string nullable |
| make | string nullable |
| model | string nullable |
| status | VehicleStatus |

**Constraints / authorization:** Motor vehicles require applicable license/registration; bicycle does not

**Retention:** Business policy; see retention register

### RiderShift
| Field | Logical type |
|---|---|
| riderId | uuid |
| startedAt | datetime |
| endedAt | datetime nullable |
| consentVersion | string |
| startZoneId | uuid |
| trackingState | TrackingState |

**Constraints / authorization:** At most one open shift per rider; end shift blocked from new offers but active delivery finishes safely

**Retention:** Business policy; see retention register

### RiderLocation
| Field | Logical type |
|---|---|
| riderId | uuid |
| shiftId | uuid |
| deliveryId | uuid nullable |
| point | geometry_Point_4326 |
| accuracyMeters | decimal |
| recordedAt | datetime |
| receivedAt | datetime |
| source | LocationSource |
| mockSignal | boolean nullable |

**Constraints / authorization:** Append-only; GiST(riderId,recordedAt); active consent/shift required; raw retention proposed <=30 days

**Retention:** Business policy; see retention register

### Delivery
| Field | Logical type |
|---|---|
| suborderId | uuid |
| attemptNumber | int |
| pickupStoreId | uuid |
| destinationZoneId | uuid |
| recipientId | uuid |
| status | DeliveryStatus |
| assignedRiderId | uuid nullable |
| routeSnapshotId | uuid nullable |
| rateSnapshotId | uuid nullable |
| pickupConfirmedAt | datetime nullable |
| deliveredAt | datetime nullable |
| completedAt | datetime nullable |
| codAmount | bigint |
| version | int |

**Constraints / authorization:** UNIQUE(suborderId,attemptNumber); one current nonterminal delivery per suborder by partial unique index; replacement preserves prior attempts; completion requires proof and COD accounting

**Retention:** Business policy; see retention register

### DeliveryRouteSnapshot
| Field | Logical type |
|---|---|
| deliveryId | uuid nullable |
| purpose | RoutePurpose |
| originPoint | geometry_Point_4326 |
| destinationPoint | geometry_Point_4326 |
| distanceMeters | int |
| durationSeconds | int nullable |
| routingMethod | string |
| provider | string |
| providerRouteReference | string nullable |
| capturedAt | datetime |
| expiresAt | datetime nullable |

**Constraints / authorization:** Road-route evidence; no silent straight-line fallback; earnings route is store-to-recipient

**Retention:** Business policy; see retention register

### RiderRateRule
| Field | Logical type |
|---|---|
| countryId | uuid |
| cityId | uuid nullable |
| serviceZoneId | uuid nullable |
| version | int |
| effectiveFrom | datetime |
| effectiveTo | datetime nullable |
| status | RuleStatus |
| minimumAmount | bigint |
| maximumAmount | bigint nullable |
| currency | string |
| routingMethod | string |
| createdBy | uuid |

**Constraints / authorization:** No overlapping active versions for same scope/effective interval; future edits immutable version; approved scope precedence

**Retention:** Business policy; see retention register

### RiderRateSlab
| Field | Logical type |
|---|---|
| rateRuleId | uuid |
| lowerMeters | int |
| upperMeters | int nullable |
| paymentAmount | bigint |

**Constraints / authorization:** Lower inclusive, upper exclusive; no gaps/overlaps within rule; last upper nullable only with approved policy

**Retention:** Business policy; see retention register

### RiderRateSnapshot
| Field | Logical type |
|---|---|
| deliveryId | uuid |
| assignmentId | uuid UNIQUE |
| rateRuleId | uuid |
| rateVersion | int |
| distanceMeters | int |
| routeSnapshotId | uuid |
| slabSnapshot | json |
| payableAmount | bigint |
| currency | string |
| policyBasis | string |
| capturedAt | datetime |

**Constraints / authorization:** One snapshot per accepted assignment; captured atomically on final rider acceptance by default; later rate/route changes do not rewrite history

**Retention:** Business policy; see retention register

### RiderAssignment
| Field | Logical type |
|---|---|
| deliveryId | uuid |
| riderId | uuid |
| offerId | uuid nullable UNIQUE |
| assignmentMode | AssignmentMode |
| authorizedBy | uuid nullable |
| reason | string nullable |
| acceptedAt | datetime |
| releasedAt | datetime nullable |
| releaseReason | string nullable |
| rateSnapshotId | uuid nullable |

**Constraints / authorization:** Partial UNIQUE(deliveryId) WHERE releasedAt IS NULL; rider capacity checked under lock; manual mode requires authorized actor/reason and same eligibility

**Retention:** Business policy; see retention register

### DeliveryOffer
| Field | Logical type |
|---|---|
| deliveryId | uuid |
| riderId | uuid |
| attempt | int |
| sequenceTokenHash | bytes UNIQUE |
| status | OfferStatus |
| offeredAt | datetime |
| expiresAt | datetime |
| respondedAt | datetime nullable |
| roadDistanceMeters | int |

**Constraints / authorization:** UNIQUE(deliveryId,attempt); partial UNIQUE(deliveryId) WHERE status=OFFERED; 30-second database-time expiry

**Retention:** Business policy; see retention register

### DeliveryProof
| Field | Logical type |
|---|---|
| deliveryId | uuid UNIQUE |
| method | RecipientOTP |
| recipientPhoneHash | bytes |
| otpHash | bytes |
| otpExpiresAt | datetime |
| attempts | int |
| verifiedAt | datetime nullable |
| verifiedByRiderId | uuid nullable |
| fallbackReviewId | uuid nullable |

**Constraints / authorization:** Hash OTP with server pepper; short TTL and attempt cap; rider submits but cannot mint/read code; only designated recipient receives code; fallback separately authorized

**Retention:** Business policy; see retention register

### DeliveryException
| Field | Logical type |
|---|---|
| deliveryId | uuid |
| kind | DeliveryExceptionKind |
| reportedBy | uuid |
| reason | string |
| evidenceObjectKeys | json |
| status | ExceptionStatus |
| reviewedBy | uuid nullable |
| resolution | string nullable |
| reviewedAt | datetime nullable |

**Constraints / authorization:** Append-only decision history via audit; OTP fallback/failed delivery/return requires authorized review; never silently marks delivered

**Retention:** Business policy; see retention register


## Finance

### PayoutDestination
| Field | Logical type |
|---|---|
| ownerType | PartyType |
| ownerId | uuid |
| rail | PayoutRail |
| encryptedDetails | json |
| displayMask | string |
| verificationStatus | VerificationStatus |
| verifiedAt | datetime nullable |
| providerReference | string nullable |
| active | boolean |

**Constraints / authorization:** Never exposed in full to ordinary admin; ownership proof + verification; change triggers payout cooldown/step-up

**Retention:** Business policy; see retention register

### CODCollection
| Field | Logical type |
|---|---|
| deliveryId | uuid UNIQUE |
| riderId | uuid |
| expectedAmount | bigint |
| collectedAmount | bigint |
| currency | string |
| confirmedAt | datetime |
| receiptReference | string UNIQUE |
| journalId | uuid |

**Constraints / authorization:** Cash collection is a liability, not rider earnings; discrepancy creates review case

**Retention:** Business policy; see retention register

### CODDeposit
| Field | Logical type |
|---|---|
| riderId | uuid |
| method | CODDepositMethod |
| amount | bigint |
| currency | string |
| depositorReference | string nullable |
| merchantAccountReference | string nullable |
| evidenceObjectKey | string nullable |
| status | DepositStatus |
| submittedAt | datetime |
| verifiedBy | uuid nullable |
| verifiedAt | datetime nullable |
| journalId | uuid nullable |

**Constraints / authorization:** Unverified deposit never reduces due balance; unique verified external reference; no screenshot-only confirmation

**Retention:** Business policy; see retention register

### CODAllocation
| Field | Logical type |
|---|---|
| depositId | uuid |
| collectionId | uuid |
| amount | bigint |

**Constraints / authorization:** Verified deposit allocations cannot exceed deposit or collection outstanding; append-only reversal links

**Retention:** Business policy; see retention register

### PaymentProviderAccount
| Field | Logical type |
|---|---|
| countryId | uuid |
| providerKey | string |
| merchantReference | string |
| encryptedCredentials | json |
| capabilities | json |
| contractReference | string |
| status | ProviderStatus |

**Constraints / authorization:** No credentials in frontend; live disabled until contract/capability/security gates

**Retention:** Business policy; see retention register

### Payment
| Field | Logical type |
|---|---|
| orderId | uuid |
| providerAccountId | uuid nullable |
| method | PaymentMethod |
| status | PaymentStatus |
| amount | bigint |
| currency | string |
| merchantReference | string |
| providerTransactionReference | string nullable |
| idempotencyKey | string UNIQUE |
| verifiedAt | datetime nullable |
| journalId | uuid nullable |

**Constraints / authorization:** UNIQUE(providerAccountId,providerTransactionReference) where present; exact amount/currency/order validation

**Retention:** Business policy; see retention register

### PaymentEvent
| Field | Logical type |
|---|---|
| providerAccountId | uuid |
| providerEventKey | string |
| paymentId | uuid nullable |
| eventType | string |
| payloadHash | bytes |
| redactedPayload | json |
| verificationStatus | EventVerificationStatus |
| receivedAt | datetime |
| processedAt | datetime nullable |

**Constraints / authorization:** UNIQUE(providerAccountId,providerEventKey); raw sensitive data minimized; replay safe

**Retention:** Business policy; see retention register

### Refund
| Field | Logical type |
|---|---|
| orderId | uuid |
| suborderId | uuid nullable |
| paymentId | uuid nullable |
| amount | bigint |
| currency | string |
| reason | string |
| status | RefundStatus |
| approvedBy | uuid nullable |
| providerReference | string nullable |
| idempotencyKey | string UNIQUE |
| journalId | uuid nullable |

**Constraints / authorization:** Approved amount <= refundable balance; COD refund destination verified; provider acceptance is not completion

**Retention:** Business policy; see retention register

### Chargeback
| Field | Logical type |
|---|---|
| paymentId | uuid |
| providerCaseReference | string |
| amount | bigint |
| currency | string |
| status | ChargebackStatus |
| evidenceDueAt | datetime nullable |
| journalId | uuid nullable |

**Constraints / authorization:** UNIQUE(paymentId,providerCaseReference); ledger reversal not payment-row overwrite

**Retention:** Business policy; see retention register

### CommissionRule
| Field | Logical type |
|---|---|
| countryId | uuid |
| cityId | uuid nullable |
| serviceZoneId | uuid nullable |
| vendorId | uuid nullable |
| categoryId | uuid nullable |
| orderType | string nullable |
| kind | CommissionKind |
| percentageBps | int nullable |
| fixedAmount | bigint nullable |
| basis | CommissionBasis |
| currency | string |
| version | int |
| effectiveFrom | datetime |
| status | RuleStatus |

**Constraints / authorization:** Explicit precedence and overlap validation; default product subtotal excludes delivery; percent 0..10000

**Retention:** Business policy; see retention register

### CommissionSnapshot
| Field | Logical type |
|---|---|
| ruleId | uuid |
| ruleVersion | int |
| suborderId | uuid |
| basisAmount | bigint |
| commissionAmount | bigint |
| currency | string |
| policy | string |
| capturedAt | datetime |

**Constraints / authorization:** UNIQUE(suborderId,policy); historical rule immutable; partial refund prorates by approved policy

**Retention:** Business policy; see retention register

### LedgerAccount
| Field | Logical type |
|---|---|
| ownerType | LedgerOwnerType |
| ownerId | uuid nullable |
| purpose | LedgerPurpose |
| currency | string |
| normalSide | DebitOrCredit |
| code | string UNIQUE |

**Constraints / authorization:** Separate vendor receivable, rider earnings, COD custody, clearing, payout reserve and platform accounts

**Retention:** Business policy; see retention register

### JournalEntry
| Field | Logical type |
|---|---|
| businessEventKey | string UNIQUE |
| currency | string |
| kind | JournalKind |
| occurredAt | datetime |
| effectiveAt | datetime |
| createdBy | uuid |
| reversalOfId | uuid nullable |
| referenceType | string |
| referenceId | uuid |
| metadata | json |

**Constraints / authorization:** Append-only; all lines and accounts match journal currency; business event unique; corrections via reversal

**Retention:** Business policy; see retention register

### LedgerLine
| Field | Logical type |
|---|---|
| journalId | uuid |
| lineNumber | int |
| accountId | uuid |
| side | DebitOrCredit |
| amountMinor | bigint |
| referenceType | string nullable |
| referenceId | uuid nullable |

**Constraints / authorization:** UNIQUE(journalId,lineNumber); amount >0; deferred constraint SUM(debits)=SUM(credits); no UPDATE/DELETE

**Retention:** Business policy; see retention register

### LedgerBalanceSnapshot
| Field | Logical type |
|---|---|
| accountId | uuid |
| asOfJournalId | uuid |
| balanceMinor | bigint |
| version | int |
| calculatedAt | datetime |

**Constraints / authorization:** Rebuildable projection, not source of truth; reconcile to immutable lines

**Retention:** Business policy; see retention register

### Payout
| Field | Logical type |
|---|---|
| riderId | uuid |
| destinationId | uuid |
| periodStart | datetime |
| periodEnd | datetime |
| scheduleKey | string |
| amount | bigint |
| currency | string |
| mode | PayoutMode |
| status | PayoutStatus |
| approvedBy | uuid nullable |
| reservedJournalId | uuid nullable |
| completedJournalId | uuid nullable |
| version | int |

**Constraints / authorization:** UNIQUE(riderId,periodStart,periodEnd,scheduleKey); business payout stable across attempts; reserve before send; unknown result reconciles same attempt

**Retention:** Business policy; see retention register

### PayoutItem
| Field | Logical type |
|---|---|
| payoutId | uuid |
| deliveryId | uuid |
| earningJournalId | uuid |
| grossAmount | bigint |
| approvedAdjustmentAmount | bigint |
| netAmount | bigint |

**Constraints / authorization:** UNIQUE(deliveryId) and UNIQUE(earningJournalId); earning allocated once; failed attempt does not allocate it again; transparent COD adjustment journal if policy permits

**Retention:** Business policy; see retention register

### Settlement
| Field | Logical type |
|---|---|
| vendorId | uuid |
| destinationId | uuid |
| periodStart | datetime |
| periodEnd | datetime |
| grossAmount | bigint |
| commissionAmount | bigint |
| refundAmount | bigint |
| adjustmentAmount | bigint |
| netAmount | bigint |
| currency | string |
| status | SettlementStatus |
| approvedBy | uuid nullable |
| version | int |

**Constraints / authorization:** Net equation; verified destination; maker-checker; no double settlement; direct acquirer settlement reconciled separately

**Retention:** Business policy; see retention register

### SettlementItem
| Field | Logical type |
|---|---|
| settlementId | uuid |
| suborderId | uuid |
| journalId | uuid |
| amount | bigint |

**Constraints / authorization:** UNIQUE(suborderId); initial release settles each eligible suborder once; later adjustments use reversals; failed transfer retries same settlement

**Retention:** Business policy; see retention register

### ReconciliationRecord
| Field | Logical type |
|---|---|
| kind | ReconciliationKind |
| sourceReference | string |
| internalReference | string |
| expectedAmount | bigint |
| actualAmount | bigint |
| currency | string |
| status | ReconciliationStatus |
| reviewedBy | uuid nullable |
| evidence | json |

**Constraints / authorization:** Daily provider/bank/COD/ledger checks; unmatched/unknown items escalated

**Retention:** Business policy; see retention register

### VendorPlan
| Field | Logical type |
|---|---|
| code | string |
| version | int |
| name | string |
| billingInterval | string |
| priceAmount | bigint |
| currency | string |
| unitLimit | int nullable |
| featureEntitlements | json |
| effectiveFrom | datetime |
| status | RuleStatus |

**Constraints / authorization:** No historical plan mutation; prices are business configuration, not hardcoded

**Retention:** Business policy; see retention register

### VendorSubscription
| Field | Logical type |
|---|---|
| vendorId | uuid |
| planId | uuid |
| startsAt | datetime |
| endsAt | datetime |
| introductoryEndsAt | datetime nullable |
| status | SubscriptionStatus |
| volumePolicy | json |
| version | int |

**Constraints / authorization:** First-year free offer if approved; explicit start/end and renewal notice; no silent backdated charge

**Retention:** Business policy; see retention register

### PayoutAttempt
| Field | Logical type |
|---|---|
| payoutId | uuid |
| attemptNumber | int |
| providerReference | string nullable |
| idempotencyKey | string UNIQUE |
| status | AttemptStatus |
| requestedAt | datetime |
| confirmedAt | datetime nullable |
| failureCode | string nullable |

**Constraints / authorization:** UNIQUE(payoutId,attemptNumber); unknown result stays reserved; definitive failure releases via reversal before a new attempt

**Retention:** Business policy; see retention register

### SettlementAttempt
| Field | Logical type |
|---|---|
| settlementId | uuid |
| attemptNumber | int |
| providerReference | string nullable |
| idempotencyKey | string UNIQUE |
| status | AttemptStatus |
| requestedAt | datetime |
| confirmedAt | datetime nullable |
| failureCode | string nullable |

**Constraints / authorization:** UNIQUE(settlementId,attemptNumber); retries never duplicate settlement items

**Retention:** Business policy; see retention register


## Verification

### KYCCase
| Field | Logical type |
|---|---|
| subjectType | PartyType |
| subjectId | uuid |
| status | KYCStatus |
| policyVersion | string |
| level | KYCLevel |
| submittedAt | datetime nullable |
| expiresAt | datetime nullable |
| assignedReviewerId | uuid nullable |

**Constraints / authorization:** One open case per subject/version; status separate from account suspension; no self approval

**Retention:** Business policy; see retention register

### VendorKYC
| Field | Logical type |
|---|---|
| caseId | uuid UNIQUE |
| vendorId | uuid |
| businessInformation | json |
| representativeInformationEncrypted | json |
| businessAddressId | uuid |

**Constraints / authorization:** Individual/company conditional document policy; payout destination verified separately

**Retention:** Business policy; see retention register

### RiderKYC
| Field | Logical type |
|---|---|
| caseId | uuid UNIQUE |
| riderId | uuid |
| identityProfile | json |
| vehicleId | uuid nullable |
| addressVerifiedAt | datetime nullable |

**Constraints / authorization:** Motor-vehicle conditional requirements; no unnecessary biometrics

**Retention:** Business policy; see retention register

### AdminKYC
| Field | Logical type |
|---|---|
| caseId | uuid UNIQUE |
| userId | uuid |
| identityVerifiedAt | datetime nullable |
| approvedBy | uuid nullable |
| provisioningStatus | ProvisioningStatus |

**Constraints / authorization:** Super Admin approval; bootstrap superadmins use offline two-person ceremony

**Retention:** Business policy; see retention register

### KYCDocument
| Field | Logical type |
|---|---|
| caseId | uuid |
| documentType | DocumentType |
| storageKey | string UNIQUE |
| contentHash | bytes |
| mimeType | string |
| sizeBytes | int |
| scanStatus | ScanStatus |
| encryptedNumber | json nullable |
| issuingCountry | string |
| expiresOn | date nullable |
| status | DocumentStatus |
| uploadedBy | uuid |
| uploadChannel | UploadChannel |

**Constraints / authorization:** Private quarantine bucket; object not publicly readable; document checksum and expiry; consent required

**Retention:** Business policy; see retention register

### KYCReview
| Field | Logical type |
|---|---|
| caseId | uuid |
| documentId | uuid nullable |
| reviewerId | uuid |
| decision | ReviewDecision |
| reasons | json |
| verificationMethod | VerificationMethod |
| authorizedSourceReference | string nullable |
| occurredAt | datetime |

**Constraints / authorization:** Append-only; reviewer cannot be subject/uploader for same approval; source and evidence recorded

**Retention:** Business policy; see retention register


## Catalog

### Category
| Field | Logical type |
|---|---|
| parentId | uuid nullable |
| slug | string UNIQUE |
| nameTranslations | json |
| sortOrder | int |
| status | CategoryStatus |
| requiredPermits | json |

**Constraints / authorization:** No category cycles; regulated goods feature-gated

**Retention:** Business policy; see retention register

### Product
| Field | Logical type |
|---|---|
| vendorId | uuid |
| categoryId | uuid |
| title | string |
| description | string |
| brand | string nullable |
| status | ProductStatus |
| moderationState | ModerationState |
| attributes | json |
| version | int |

**Constraints / authorization:** Vendor ownership enforced; publication requires approved vendor and product moderation

**Retention:** Business policy; see retention register

### ProductVariant
| Field | Logical type |
|---|---|
| productId | uuid |
| sku | string |
| optionValues | json |
| priceAmount | bigint |
| compareAtAmount | bigint nullable |
| currency | string |
| weightGrams | int nullable |
| active | boolean |
| version | int |

**Constraints / authorization:** UNIQUE(productId,sku); vendor-wide SKU policy enforced in command if required; nonnegative integer minor units; price history audited

**Retention:** Business policy; see retention register

### ProductImage
| Field | Logical type |
|---|---|
| productId | uuid |
| variantId | uuid nullable |
| storageKey | string |
| altText | string |
| sortOrder | int |
| width | int |
| height | int |
| checksum | bytes |

**Constraints / authorization:** Moderated media; no SVG/active content; approved CDN public product assets only

**Retention:** Business policy; see retention register

### Inventory
| Field | Logical type |
|---|---|
| variantId | uuid |
| storeId | uuid |
| onHand | int |
| reserved | int |
| reorderLevel | int |
| version | int |

**Constraints / authorization:** UNIQUE(variantId,storeId); onHand>=reserved>=0; updates locked/versioned

**Retention:** Business policy; see retention register

### InventoryReservation
| Field | Logical type |
|---|---|
| variantId | uuid |
| storeId | uuid |
| quoteId | uuid |
| quantity | int |
| expiresAt | datetime |
| state | ReservationState |

**Constraints / authorization:** Positive quantity; idempotent checkout reservation; expiry releases stock; no negative inventory

**Retention:** Business policy; see retention register


## Orders

### CheckoutQuote
| Field | Logical type |
|---|---|
| checkoutId | uuid UNIQUE |
| customerId | uuid |
| recipientSnapshot | json |
| destinationAddressSnapshot | json |
| destinationZoneId | uuid |
| totals | json |
| groupQuotes | json |
| pricingVersion | string |
| expiresAt | datetime |
| quoteHash | bytes |

**Constraints / authorization:** Server computed; country equality; expiry; binding quote hash; buyer GPS not a destination filter

**Retention:** Business policy; see retention register

### OrderRecipient
| Field | Logical type |
|---|---|
| orderId | uuid UNIQUE |
| name | string |
| phoneEncrypted | string |
| phoneHash | bytes |
| addressSnapshot | json |
| destinationZoneId | uuid |
| verificationStatus | VerificationStatus |

**Constraints / authorization:** Separate from buyer; restricted contact fields; snapshot survives address-book edits

**Retention:** Business policy; see retention register

### Order
| Field | Logical type |
|---|---|
| publicReference | string UNIQUE |
| buyerId | uuid |
| countryId | uuid |
| destinationCountryId | uuid |
| destinationZoneId | uuid |
| status | ParentOrderStatus |
| subtotalAmount | bigint |
| deliveryFeeAmount | bigint |
| discountAmount | bigint |
| taxAmount | bigint |
| totalAmount | bigint |
| currency | string |
| pricingSnapshot | json |
| riskCaseId | uuid nullable |
| idempotencyKey | string |
| version | int |

**Constraints / authorization:** UNIQUE(buyerId,idempotencyKey); total equation; same buyer/recipient country initially; parent aggregates suborders

**Retention:** Business policy; see retention register

### VendorSuborder
| Field | Logical type |
|---|---|
| orderId | uuid |
| vendorId | uuid |
| storeId | uuid |
| destinationZoneId | uuid |
| publicReference | string UNIQUE |
| status | SuborderStatus |
| preparationMinutes | int nullable |
| readyConfirmedBy | uuid nullable |
| readyConfirmedAt | datetime nullable |
| subtotalAmount | bigint |
| allocatedDeliveryAmount | bigint |
| allocatedDiscountAmount | bigint |
| taxAmount | bigint |
| totalAmount | bigint |
| version | int |

**Constraints / authorization:** UNIQUE(orderId,vendorId,storeId); manual ready transition; vendors read only their own suborders

**Retention:** Business policy; see retention register

### OrderItem
| Field | Logical type |
|---|---|
| suborder_id | uuid |
| variantId | uuid |
| productSnapshot | json |
| quantity | int |
| unitPriceAmount | bigint |
| lineDiscountAmount | bigint |
| taxAmount | bigint |
| lineTotalAmount | bigint |
| commissionSnapshotId | uuid nullable |

**Constraints / authorization:** Quantity >0; immutable price/title/sku snapshot; partial cancellation by quantity

**Retention:** Business policy; see retention register

### OrderStatusEvent
| Field | Logical type |
|---|---|
| orderId | uuid nullable |
| suborderId | uuid nullable |
| fromStatus | string nullable |
| toStatus | string |
| actorId | uuid nullable |
| reason | string nullable |
| commandId | string UNIQUE |
| occurredAt | datetime |

**Constraints / authorization:** Exactly one order or suborder reference; append-only transition history; valid state machine enforced in service

**Retention:** Business policy; see retention register

### ReturnRequest
| Field | Logical type |
|---|---|
| orderId | uuid |
| suborderId | uuid |
| customerId | uuid |
| status | ReturnStatus |
| reason | string |
| requestedItems | json |
| evidenceObjectKeys | json |
| approvedBy | uuid nullable |
| refundId | uuid nullable |

**Constraints / authorization:** Only eligible order items; vendor sees own request; return and refund states separate

**Retention:** Business policy; see retention register


## Trust

### FraudCase
| Field | Logical type |
|---|---|
| subjectType | string |
| subjectId | uuid |
| orderId | uuid nullable |
| score | int |
| reasons | json |
| policyVersion | string |
| status | FraudStatus |
| assignedReviewerId | uuid nullable |
| holdExpiresAt | datetime nullable |

**Constraints / authorization:** Score 0..100; VPN alone insufficient for rejection; evidence preserved separately

**Retention:** Business policy; see retention register

### FraudEvidence
| Field | Logical type |
|---|---|
| caseId | uuid |
| signal | string |
| valueRedacted | json |
| source | string |
| observedAt | datetime |
| restrictedObjectKey | string nullable |

**Constraints / authorization:** Least-data evidence; no covert communications or device scraping

**Retention:** Business policy; see retention register

### FraudDecision
| Field | Logical type |
|---|---|
| caseId | uuid |
| reviewerId | uuid nullable |
| decision | FraudAction |
| reason | string |
| automated | boolean |
| occurredAt | datetime |

**Constraints / authorization:** Append-only; reject confirmed fraud requires evidence and authorized policy/human review

**Retention:** Business policy; see retention register


## Personalization

### ProductInteraction
| Field | Logical type |
|---|---|
| customerId | uuid nullable |
| guestReferenceHash | bytes nullable |
| productId | uuid nullable |
| variantId | uuid nullable |
| eventType | InteractionType |
| consentId | uuid nullable |
| zoneId | uuid nullable |
| occurredAt | datetime |
| eventKey | string UNIQUE |

**Constraints / authorization:** First-party only; indexed owner/time; proposed raw TTL 180 days; clear derived interests on deletion

**Retention:** Business policy; see retention register

### PersonalizationProfile
| Field | Logical type |
|---|---|
| customerId | uuid UNIQUE |
| consentVersion | string |
| interests | json |
| excludedCategories | json |
| frequencyPolicy | json |
| modelVersion | string |
| clearedAt | datetime nullable |

**Constraints / authorization:** Can opt out/clear; no raw cross-app audio; vendors get aggregates only

**Retention:** Business policy; see retention register

### AIInvocation
| Field | Logical type |
|---|---|
| actorUserId | uuid |
| agentIdentity | string |
| scopeSnapshot | json |
| toolName | string |
| inputHash | bytes |
| outputRedacted | json |
| status | AIInvocationStatus |
| modelProvider | string |
| costMinor | bigint nullable |
| approvalId | uuid nullable |
| occurredAt | datetime |

**Constraints / authorization:** Scoped read-only tools by default; sensitive execution prohibited; log denials and human approval

**Retention:** Business policy; see retention register

### AIApproval
| Field | Logical type |
|---|---|
| invocationId | uuid UNIQUE |
| actionHash | bytes |
| approverId | uuid nullable |
| status | ApprovalStatus |
| stepUpChallengeId | uuid nullable |
| expiresAt | datetime |
| decidedAt | datetime nullable |

**Constraints / authorization:** Human approval bound to exact action; no AI self-approval; execute via normal domain service

**Retention:** Business policy; see retention register


## Platform

### Notification
| Field | Logical type |
|---|---|
| recipientId | uuid |
| channel | NotificationChannel |
| templateKey | string |
| templateVersion | string |
| payloadRedacted | json |
| status | NotificationStatus |
| dedupeKey | string UNIQUE |
| sentAt | datetime nullable |

**Constraints / authorization:** Recipient scoped; preferences and consent honored; security alerts separate lawful basis

**Retention:** Business policy; see retention register

### NotificationPreference
| Field | Logical type |
|---|---|
| userId | uuid |
| channel | NotificationChannel |
| purpose | string |
| enabled | boolean |
| policyVersion | string |

**Constraints / authorization:** UNIQUE(userId,channel,purpose); marketing opt-in separate from service messages

**Retention:** Business policy; see retention register

### AuditLog
| Field | Logical type |
|---|---|
| actorId | uuid nullable |
| actorType | ActorType |
| sessionId | uuid nullable |
| action | string |
| resourceType | string |
| resourceId | uuid nullable |
| scopeSnapshot | json |
| beforeRedacted | json nullable |
| afterRedacted | json nullable |
| reason | string nullable |
| requestId | string |
| occurredAt | datetime |

**Constraints / authorization:** Append-only; restricted read; no passwords/OTPs/tokens; include sensitive reads/exports/denials

**Retention:** Business policy; see retention register

### OutboxEvent
| Field | Logical type |
|---|---|
| aggregateType | string |
| aggregateId | uuid |
| eventKey | string UNIQUE |
| eventType | string |
| payload | json |
| occurredAt | datetime |
| publishedAt | datetime nullable |
| attempts | int |

**Constraints / authorization:** Written in same transaction as domain change; at-least-once delivery; consumers idempotent

**Retention:** Business policy; see retention register

### InboxReceipt
| Field | Logical type |
|---|---|
| consumer | string |
| eventKey | string |
| processedAt | datetime |

**Constraints / authorization:** UNIQUE(consumer,eventKey)

**Retention:** Business policy; see retention register

### IdempotencyRecord
| Field | Logical type |
|---|---|
| actorId | uuid |
| route | string |
| key | string |
| requestHash | bytes |
| responseStatus | int nullable |
| responseHash | bytes nullable |
| resourceReference | string nullable |
| expiresAt | datetime |
| state | IdempotencyState |

**Constraints / authorization:** UNIQUE(actorId,route,key); same key/different payload =>409; finance retention follows linked records

**Retention:** Business policy; see retention register

### FeatureFlag
| Field | Logical type |
|---|---|
| key | string |
| countryId | uuid nullable |
| environment | string |
| enabled | boolean |
| rolloutRule | json |
| version | int |
| updatedBy | uuid |

**Constraints / authorization:** UNIQUE NULLS NOT DISTINCT(key,countryId,environment); default false for unfinished/payment/cross-border/AI features

**Retention:** Business policy; see retention register


## Required-name mapping

| Master name | Physical design |
|---|---|
| VendorLedger | LedgerAccount(ownerType=VENDOR) + LedgerLine view |
| RiderLedger | LedgerAccount(ownerType=RIDER, purpose=EARNINGS/RESERVE) + LedgerLine view |
| CODLedger | LedgerAccount(ownerType=RIDER, purpose=COD_CUSTODY) + CODCollection/Deposit/Allocation |
| RiderLocation | Active-shift/active-delivery records with restrictive retention |
| VendorKYC / RiderKYC | Role-specific extension of KYCCase; AdminKYC also included |

## Index / constraint implementation plan

- B-tree: every concrete FK; status/time composites for orders, offers, KYC, payouts and audit; public references and provider transaction keys unique.
- GiST: BoundaryVersion.boundary, Address.point, Store.pickupPoint, RiderLocation.point; rider/time and shift/time B-tree companions.
- Partial unique: one open shift per rider; one active assignment per delivery; one active offer per delivery; active provider references where present.
- Deferred constraint triggers: balanced journal lines and matching currency; inventory nonnegative/reserved bounds; allocation caps; ancestry checks where composite FKs cannot express them.
- Polymorphic ownerId/subjectId/resourceId/aggregateId/referenceId are logical references, not fake foreign keys. Validate type+ID in guarded commands; use concrete join tables where integrity requires it.
- Circular current-case/address/boundary pointers are nullable and validated/deferred. Immutable history remains the authority; never delete history to change a pointer.
- UUID targetKey=id unless explicitly documented. Relationship cardinality is FK-owner→target; optional means nullable. Business cardinality such as one current delivery is a separate partial constraint.

## Retention proposal — owner/legal approval required

| Data class | Proposed operational target | Deletion / hold rule |
|---|---|---|
| Active account/profile | While active + closure processing | Delete/minimize on verified request unless lawful hold |
| KYC uploads and raw identity evidence | Shortest policy-required period; rejected/unneeded evidence promptly purged | Legal/contractual schedule must be approved before collection |
| Raw rider GPS | ≤30 days after collection | Keep only required route/dispute evidence; no off-shift stream |
| First-party personalization events | ≤180 days | Clear derived profiles/caches on opt-out/delete |
| Session/security metadata | ≤90 days after expiry/revocation unless incident hold | Hash tokens; restrict access |
| Orders/recipient snapshots | Business support window then minimize | Financial/tax hold only for required fields |
| Financial journals/payout evidence | Applicable statutory/contractual period | Immutable; never reset by deleting transactions |
| Audit logs | ≥12 months proposed; sensitive access longer if approved | Tamper-evident restricted archive; legal hold |
| Backups | Encrypted rolling window proposed ≤35 days | Expiry plus documented deletion propagation on restore |
| Support/SOS evidence | Purpose-specific shortest window | Restricted access; incident/legal hold documented |
No period above is a claim about Bangladesh law. Counsel/provider review must set the final retention register before real data collection.