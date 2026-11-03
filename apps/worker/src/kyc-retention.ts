import type { Pool } from 'pg';
import type { StructuredLogger } from '@getstoopy/observability';
import type { ObjectStorage } from '@getstoopy/storage';
/** Bounded expiry + approved purge. File deletion precedes tombstone commit; retry is idempotent. */
export async function runKycRetentionTick(pool:Pool,storage:ObjectStorage,log:StructuredLogger,batchSize:number):Promise<{expired:number;purged:number}>{
 const client=await pool.connect();let expired=0,purged=0;
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('app.is_super','true',true)");await client.query("SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000000',true)");
  expired=Number((await client.query('SELECT gs_kyc_retention_tick($1,NULL::uuid) AS n',[batchSize])).rows[0].n);await client.query('COMMIT');
  await client.query("SELECT set_config('app.is_super','true',false)");await client.query("SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000000',false)");
  const requests=await client.query(`SELECT r.id,r."caseId",r."countryId" FROM "KycDeletionRequest" r JOIN "KycCase" c ON c.id=r."caseId" WHERE r.status='APPROVED' AND r."dueAt"<=CURRENT_TIMESTAMP AND c.status IN ('REJECTED','REVOKED','EXPIRED') AND NOT EXISTS (SELECT 1 FROM "KycLegalHold" h WHERE h."caseId"=c.id AND h."releasedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "Vendor" v WHERE v."kycCaseId"=c.id AND v.status='ACTIVE') AND NOT EXISTS (SELECT 1 FROM "RiderProfile" rp WHERE rp."kycCaseId"=c.id AND rp.status='ACTIVE') ORDER BY r."dueAt",r.id LIMIT $1`,[batchSize]);
  for(const r of requests.rows){
   await client.query('BEGIN');await client.query("SELECT set_config('app.is_super','true',true)");await client.query("SELECT set_config('app.user_id','00000000-0000-0000-0000-000000000000',true)");
   await client.query('SELECT id FROM "KycCase" WHERE id=$1 FOR UPDATE',[r.caseId]);
   const preHold=await client.query('SELECT 1 FROM "KycLegalHold" WHERE "caseId"=$1 AND "releasedAt" IS NULL',[r.caseId]);if(preHold.rowCount){await client.query('ROLLBACK');continue;}
   const docs=await client.query('SELECT s."objectKey" FROM "KycDocument" d JOIN "StorageObject" s ON s.id=d."storageObjectId" WHERE d."caseId"=$1 ORDER BY s.id',[r.caseId]);
   for(const d of docs.rows)await storage.delete(d.objectKey);
   const locked=await client.query('SELECT status FROM "KycDeletionRequest" WHERE id=$1 FOR UPDATE',[r.id]);if(locked.rows[0]?.status!=='APPROVED'){await client.query('ROLLBACK');continue;}
   const hold=await client.query('SELECT 1 FROM "KycLegalHold" WHERE "caseId"=$1 AND "releasedAt" IS NULL',[r.caseId]);if(hold.rowCount){await client.query('ROLLBACK');continue;}
   await client.query(`UPDATE "StorageObject" SET state='DELETED',"deletedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE id IN (SELECT "storageObjectId" FROM "KycDocument" WHERE "caseId"=$1) AND "deletedAt" IS NULL`,[r.caseId]);
   await client.query(`UPDATE "KycDeletionRequest" SET status='PURGED',version=version+1,"purgedAt"=CURRENT_TIMESTAMP WHERE id=$1`,[r.id]);
   await client.query(`INSERT INTO "KycRetentionEvent"(id,"caseId","countryId",kind,"caseVersion") SELECT gen_random_uuid(),$1,$2,'PURGED',version FROM "KycCase" WHERE id=$1`,[r.caseId,r.countryId]);
   await client.query(`INSERT INTO "AuditLog"(id,"actorType",action,"resourceType","resourceId","scopeSnapshot","requestId") VALUES(gen_random_uuid(),'SYSTEM','kyc.retention.purged','KycDeletionRequest',$1,jsonb_build_object('countryId',$2::uuid),gen_random_uuid())`,[r.id,r.countryId]);
   await client.query('COMMIT');purged++;
  }
  if(expired||purged)log.info('kyc_retention_batch',{expired,purged});return {expired,purged};
 }catch(e){await client.query('ROLLBACK').catch(()=>undefined);log.error('kyc_retention_failed',{error:e instanceof Error?e.message:'unknown'});return {expired,purged};}finally{client.release();}
}
