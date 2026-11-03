import { Injectable } from '@nestjs/common';
/** Deterministic local adapter. It never performs network I/O or moves money. */
@Injectable()
export class SandboxPayoutAdapter {
 async submit(input:{providerKey:string;simulateUnknown?:boolean}):Promise<{status:'SUBMITTED'|'UNKNOWN';providerReference:string|null;mode:'TEST_ONLY'}>{
  if(!input.providerKey.startsWith('TEST_ONLY:'))throw new Error('SANDBOX_PROVIDER_KEY_REQUIRED');
  return input.simulateUnknown?{status:'UNKNOWN',providerReference:null,mode:'TEST_ONLY'}:{status:'SUBMITTED',providerReference:input.providerKey,mode:'TEST_ONLY'};
 }
}
