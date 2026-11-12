import type { Pool, PoolClient } from 'pg';
import type { StructuredLogger } from '@getstoopy/observability';
import type { ObjectStorage } from '@getstoopy/storage';

export interface KycRetentionTickResult { expired:number; purged:number; failed:number; }
const SYSTEM_USER='00000000-0000-0000-0000-000000000000';
async function beginSuper(client:PoolClient){await client.query('BEGIN');await client.query("SELECT set_config('app.is_super','true',true)");await client.query("SELECT set_config('app.user_id',$1,true)",[SYSTEM_USER]);}

/** Bounded expiry + test-only approved purge. Every privileged context is transaction-local.
 * Object deletion is external to PostgreSQL and cannot be rolled back. */
export async function runKycRetentionTick(pool:Pool,storage:ObjectStorage,log:StructuredLogger,batchSize:number,options?:{nodeEnv:string}):Promise<KycRetentionTickResult>{
 let client:PoolClient|undefined;const result:KycRetentionTickResult={expired:0,purged:0,failed:0};
 try{
  client=await pool.connect();
  await beginSuper(client);
  const expired=Number((await client.query('SELECT gs_kyc_retention_tick($1,NULL::uuid) AS n',[batchSize])).rows[0].n);
  await client.query('COMMIT');result.expired=expired;
  // External deletion is not transactionally reversible. Until a durable,
  // reviewed recovery and legal-hold protocol exists, do not purge outside
  // disposable test environments. Expiry/restriction remains available.
  if(options?.nodeEnv!=='test'){
   log.warn('kyc_retention_purge_disabled',{reason:'TEST_ONLY'});
   if(result.expired)log.info('kyc_retention_batch',{...result});
   return result;
  }
  await beginSuper(client);
  const requests=await client.query(`SELECT r.id,r."caseId",r."countryId" FROM "KycDeletionRequest" r JOIN "KycCase" c ON c.id=r."caseId" WHERE r.status='APPROVED' AND r."dueAt"<=CURRENT_TIMESTAMP AND c.status IN ('REJECTED','REVOKED','EXPIRED') AND NOT EXISTS (SELECT 1 FROM "KycLegalHold" h WHERE h."caseId"=c.id AND h."releasedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "Vendor" v WHERE v."kycCaseId"=c.id AND v.status='ACTIVE') AND NOT EXISTS (SELECT 1 FROM "RiderProfile" rp WHERE rp."kycCaseId"=c.id AND rp.status='ACTIVE') ORDER BY r."dueAt",r.id LIMIT $1`,[batchSize]);
  await client.query('COMMIT');
  for(const r of requests.rows){
   try{
    await beginSuper(client);
    await client.query('SELECT id FROM "KycCase" WHERE id=$1 FOR UPDATE',[r.caseId]);
    const locked=await client.query('SELECT status FROM "KycDeletionRequest" WHERE id=$1 FOR UPDATE SKIP LOCKED',[r.id]);
    if(locked.rows[0]?.status!=='APPROVED'){await client.query('ROLLBACK');continue;}
    const hold=await client.query('SELECT 1 FROM "KycLegalHold" WHERE "caseId"=$1 AND "releasedAt" IS NULL',[r.caseId]);
    if(hold.rowCount){await client.query('ROLLBACK');continue;}
    const docs=await client.query('SELECT s."objectKey" FROM "KycDocument" d JOIN "StorageObject" s ON s.id=d."storageObjectId" WHERE d."caseId"=$1 AND s."deletedAt" IS NULL ORDER BY s.id',[r.caseId]);
    for(const d of docs.rows)await storage.delete(d.objectKey);
    await client.query(`UPDATE "StorageObject" SET state='DELETED',"deletedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE id IN (SELECT "storageObjectId" FROM "KycDocument" WHERE "caseId"=$1) AND "deletedAt" IS NULL`,[r.caseId]);
    await client.query(`UPDATE "KycDeletionRequest" SET status='PURGED',version=version+1,"purgedAt"=CURRENT_TIMESTAMP WHERE id=$1`,[r.id]);
    await client.query(`INSERT INTO "KycRetentionEvent"(id,"caseId","countryId",kind,"caseVersion") SELECT gen_random_uuid(),$1,$2,'PURGED',version FROM "KycCase" WHERE id=$1`,[r.caseId,r.countryId]);
    await client.query(`INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES(gen_random_uuid(),'SYSTEM','kyc.retention.purged','KycDeletionRequest',$1,jsonb_build_object('countryId',$2::uuid),gen_random_uuid())`,[r.id,r.countryId]);
    await client.query('COMMIT');result.purged++;
   }catch{
    await client.query('ROLLBACK').catch(()=>undefined);result.failed++;
    // Storage/database errors may include sensitive paths or case data.
    log.error('kyc_retention_purge_failed',{error:'KYC_RETENTION_PURGE_ERROR'});
   }
  }
  if(result.expired||result.purged||result.failed)log.info('kyc_retention_batch',{...result});
  return result;
 }catch{if(client)await client.query('ROLLBACK').catch(()=>undefined);log.error('kyc_retention_failed',{error:'KYC_RETENTION_ERROR'});result.failed++;return result;}
 finally{client?.release();}
}
