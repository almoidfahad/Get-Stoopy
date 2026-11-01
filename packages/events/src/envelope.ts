import { z } from 'zod';
export const eventEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  eventKey: z.string().min(8).max(128),
  eventType: z.string().min(3).max(128),
  occurredAt: z.string().datetime(),
  aggregateType: z.string().min(1).max(64),
  aggregateId: z.string().uuid(),
  aggregateVersion: z.number().int().positive().optional(),
  correlationId: z.string().min(8).max(128).optional(),
  causationId: z.string().min(8).max(128).optional(),
  countryId: z.string().uuid().optional(),
  scopeRefs: z.array(z.string().uuid()).max(32).default([]),
  data: z.record(z.unknown()).default({})
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export function parseEventEnvelope(input: unknown): EventEnvelope { return eventEnvelopeSchema.parse(input); }
