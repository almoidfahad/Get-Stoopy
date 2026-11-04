import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { urls, asSuper, asUser } from './helpers';

const u = urls();
let countryId: string;
let subjectId: string;
let openerId: string;
let reviewerId: string;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Privileged writes still carry an explicit actor; the DB compares it to the row. */
async function asActor<T>(userId: string, fn: (c: any) => Promise<T>): Promise<T> {
  return asSuper(u.privileged, async c => {
    await c.query("SELECT set_config('app.user_id',$1,true)", [userId]);
    return fn(c);
  });
}

async function makeUser(label: string): Promise<string> {
  const id = randomUUID();
  await asSuper(u.privileged, async c => {
    await c.query(`INSERT INTO "User"(id,"displayName","updatedAt") VALUES ($1,$2,now())`, [id, `Risk ${label}`]);
  });
  return id;
}

async function openCase(actorId: string, targetSubject = subjectId): Promise<string> {
  const id = randomUUID();
  await asActor(actorId, async c => {
    await c.query(
      `INSERT INTO "RiskCase"(id,"countryId","subjectUserId",kind,"policyVersion","openedByUserId","updatedAt")
       VALUES ($1,$2,$3,'ORDER_ABUSE','risk-v1',$4,now())`,
      [id, countryId, targetSubject, actorId]
    );
  });
  return id;
}

async function addSignal(caseId: string, actorId: string, code: string, weight: number): Promise<void> {
  await asActor(actorId, async c => {
    await c.query(
      `INSERT INTO "RiskSignal"(id,"caseId",code,weight,"evidenceHash") VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), caseId, code, weight, hash(`${caseId}:${code}`)]
    );
  });
}

async function setScore(caseId: string, actorId: string, score: number, band: string, version: number): Promise<void> {
  await asActor(actorId, async c => {
    await c.query(`UPDATE "RiskCase" SET score=$2,band=$3,version=$4,"updatedAt"=now() WHERE id=$1`, [caseId, score, band, version]);
  });
}

async function readCase(caseId: string) {
  return asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "RiskCase" WHERE id=$1`, [caseId])).rows[0]);
}

async function resolveCase(caseId: string, actorId: string, decision: 'CLEAR' | 'CONFIRM_FRAUD', reason: string) {
  const current = await readCase(caseId);
  const nextVersion = current.version + 1;
  await asActor(actorId, async c => {
    await c.query(
      `INSERT INTO "RiskCaseReview"(id,"caseId","reviewerUserId",decision,"caseVersion","commandKey","payloadHash",reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), caseId, actorId, decision, nextVersion, `cmd-${randomUUID()}`, hash(`${caseId}:${decision}`), reason]
    );
    await c.query(
      `UPDATE "RiskCase" SET status=$2,version=$3,"resolvedByUserId"=$4,"resolvedAt"=now(),"resolutionReason"=$5,"updatedAt"=now() WHERE id=$1`,
      [caseId, decision === 'CLEAR' ? 'CLEARED' : 'CONFIRMED_FRAUD', nextVersion, actorId, reason]
    );
  });
}

beforeAll(async () => {
  countryId = await asSuper(u.privileged, async c => (await c.query(
    `INSERT INTO "Country"(id,iso2,name,"currencyCode","callingCode",timezone,status) VALUES ($1,'BD','Bangladesh','BDT','+880','Asia/Dhaka','ACTIVE')
     ON CONFLICT (iso2) DO UPDATE SET status='ACTIVE' RETURNING id`, [randomUUID()]
  )).rows[0].id as string);
  subjectId = await makeUser('subject');
  openerId = await makeUser('opener');
  reviewerId = await makeUser('reviewer');
});

describe('fraud-risk manual review', () => {
  it('denies the runtime role any access to risk records', async () => {
    const caseId = await openCase(openerId);
    const rows = await asUser(u.runtime, subjectId, async c => (await c.query(`SELECT * FROM "RiskCase" WHERE id=$1`, [caseId])).rows);
    expect(rows).toHaveLength(0);
    await expect(asUser(u.runtime, subjectId, async c => {
      await c.query(`INSERT INTO "RiskCase"(id,"countryId","subjectUserId",kind,"policyVersion","updatedAt") VALUES ($1,$2,$3,'ORDER_ABUSE','risk-v1',now())`, [randomUUID(), countryId, subjectId]);
    })).rejects.toThrow();
  });

  it('refuses self-opened cases and mismatched actors', async () => {
    await expect(openCase(subjectId, subjectId)).rejects.toThrow(/risk_case_self_open_denied/);
    const id = randomUUID();
    await expect(asActor(openerId, async c => {
      await c.query(`INSERT INTO "RiskCase"(id,"countryId","subjectUserId",kind,"policyVersion","openedByUserId","updatedAt") VALUES ($1,$2,$3,'ORDER_ABUSE','risk-v1',$4,now())`, [id, countryId, subjectId, reviewerId]);
    })).rejects.toThrow(/risk_case_actor_mismatch/);
  });

  it('rejects a score that its recorded evidence does not support', async () => {
    const caseId = await openCase(openerId);
    await expect(setScore(caseId, openerId, 60, 'REVIEW', 2)).rejects.toThrow(/risk_score_evidence_mismatch/);
    const unchanged = await readCase(caseId);
    expect(unchanged.score).toBe(0);
    expect(unchanged.version).toBe(1);
  });

  it('accepts a score that matches capped evidence and keeps evidence append-only', async () => {
    const caseId = await openCase(openerId);
    await addSignal(caseId, openerId, 'VELOCITY_ORDERS_HIGH', 25);
    await addSignal(caseId, openerId, 'COUPON_ABUSE_PATTERN', 25);
    await setScore(caseId, openerId, 50, 'REVIEW', 2);
    const stored = await readCase(caseId);
    expect(stored.score).toBe(50);
    expect(stored.band).toBe('REVIEW');

    await expect(asActor(openerId, async c => {
      await c.query(`UPDATE "RiskSignal" SET weight=1 WHERE "caseId"=$1`, [caseId]);
    })).rejects.toThrow();
    await expect(asActor(openerId, async c => {
      await c.query(`DELETE FROM "RiskSignal" WHERE "caseId"=$1`, [caseId]);
    })).rejects.toThrow();
  });

  it('requires an independent reviewer and blocks self-review', async () => {
    const caseId = await openCase(openerId);
    await expect(resolveCase(caseId, openerId, 'CLEAR', 'Reviewed the recorded evidence')).rejects.toThrow(/risk_review_not_independent/);

    const selfCase = await openCase(openerId, reviewerId);
    await expect(resolveCase(selfCase, reviewerId, 'CLEAR', 'Reviewed the recorded evidence')).rejects.toThrow(/risk_self_review_denied/);

    const stillOpen = await readCase(caseId);
    expect(stillOpen.status).toBe('OPEN');
  });

  it('rejects a resolution without a matching review record or a explained reason', async () => {
    const caseId = await openCase(openerId);
    await expect(asActor(reviewerId, async c => {
      await c.query(`UPDATE "RiskCase" SET status='CLEARED',version=2,"resolvedByUserId"=$2,"resolvedAt"=now(),"resolutionReason"='Reviewed the recorded evidence',"updatedAt"=now() WHERE id=$1`, [caseId, reviewerId]);
    })).rejects.toThrow(/risk_review_record_required/);

    await expect(resolveCase(caseId, reviewerId, 'CLEAR', 'short')).rejects.toThrow();
  });

  it('resolves once, emits audit plus outbox, and freezes the case afterwards', async () => {
    const caseId = await openCase(openerId);
    await addSignal(caseId, openerId, 'CONFIRMED_FAKE_ORDER_EVIDENCE', 60);
    await setScore(caseId, openerId, 60, 'REVIEW', 2);
    await resolveCase(caseId, reviewerId, 'CONFIRM_FRAUD', 'Evidence confirms coordinated fake orders');

    const resolved = await readCase(caseId);
    expect(resolved.status).toBe('CONFIRMED_FRAUD');
    expect(resolved.resolvedByUserId).toBe(reviewerId);

    const audit = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "AuditLog" WHERE "resourceType"='RiskCase' AND "resourceId"=$1`, [caseId])).rows);
    expect(audit.length).toBe(1);
    const outbox = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "OutboxEvent" WHERE "aggregateType"='RiskCase' AND "aggregateId"=$1`, [caseId])).rows);
    expect(outbox.length).toBe(1);
    expect(outbox[0].eventType).toBe('risk.case.resolved');

    await expect(addSignal(caseId, openerId, 'VELOCITY_ORDERS_HIGH', 25)).rejects.toThrow(/risk_case_terminal/);
    await expect(resolveCase(caseId, reviewerId, 'CLEAR', 'Attempting to reverse a terminal decision')).rejects.toThrow();
    await expect(asActor(reviewerId, async c => {
      await c.query(`UPDATE "RiskCase" SET "countryId"=$2,version=version+1 WHERE id=$1`, [caseId, randomUUID()]);
    })).rejects.toThrow();
  });

  it('never lets a risk decision move money or grant permissions', async () => {
    const caseId = await openCase(openerId);
    await resolveCase(caseId, reviewerId, 'CONFIRM_FRAUD', 'Evidence confirms coordinated fake orders');
    const grants = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "UserRole" WHERE "userId"=$1`, [reviewerId])).rows);
    expect(grants).toHaveLength(0);
    const ledgers = await asSuper(u.privileged, async c => (await c.query(`SELECT * FROM "AuditLog" WHERE "resourceType"='RiskCase' AND "resourceId"=$1 AND action NOT IN ('risk.case.resolved')`, [caseId])).rows);
    expect(ledgers).toHaveLength(0);
  });
});
