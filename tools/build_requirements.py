from pathlib import Path
import re,json,csv,hashlib
from PIL import Image
R=Path(__file__).resolve().parents[1]; D=R/'docs'; C=R/'contracts'
master=(D/'00-master-instructions.md').read_text()
phase_map={1:'All phases',2:'2 / 3 / all portals',3:'2 / architecture',4:'2 / 10 / 11',5:'2 / 6',6:'3',7:'2',8:'4 / 5 / 6 / 8',9:'2 / 8',10:'3 / 7',11:'3 / 4 / 7',12:'5',13:'5',14:'5 / 7',15:'5 / 7',16:'5 / 7',17:'7',18:'4 / 7',19:'9',20:'8',21:'6',22:'6',23:'4',24:'3',25:'2 / 8 / 11',26:'9',27:'2 / 6 / 11',28:'1 / 2 / 7',29:'2 / 3 / 10 / 11',30:'All phases',31:'All phases',32:'11 / handover',240:'Final acceptance'}
doc_map={1:'01-architecture.md',2:'08-design-and-screenshot-inventory.md',3:'01-architecture.md',4:'01-architecture.md; adr/',5:'04-geographic-model.md',6:'08-design-and-screenshot-inventory.md; 02-api-architecture.md',7:'05-security-threat-model.md',8:'07-kyc-workflow.md',9:'05-security-threat-model.md',10:'04-geographic-model.md',11:'06-finance-and-delivery-policy.md; 02-api-architecture.md',12:'06-finance-and-delivery-policy.md',13:'06-finance-and-delivery-policy.md',14:'06-finance-and-delivery-policy.md',15:'06-finance-and-delivery-policy.md',16:'06-finance-and-delivery-policy.md',17:'10-payment-integrations.md',18:'06-finance-and-delivery-policy.md',19:'11-ai-and-personalization.md',20:'05-security-threat-model.md',21:'03-role-permission-matrix.md; 08-design-and-screenshot-inventory.md',22:'03-role-permission-matrix.md; 04-geographic-model.md',23:'08-design-and-screenshot-inventory.md',24:'08-design-and-screenshot-inventory.md',25:'05-security-threat-model.md',26:'11-ai-and-personalization.md',27:'04-geographic-model.md; 10-payment-integrations.md',28:'12-data-dictionary.md; diagrams/',29:'01-architecture.md; 14-roadmap.md',30:'14-roadmap.md',31:'15-progress-and-decisions.md; 14-roadmap.md',32:'14-roadmap.md',240:'14-roadmap.md'}
rows=[]; sec=0; counter=0
for ln,line in enumerate(master.splitlines(),1):
 s=line.strip()
 if not s or s.startswith('>') or s=='---': continue
 m=re.match(r'## (\d+)\.',s)
 if m:
  sec=int(m.group(1));counter=0
  if sec==24 and 'FINAL ACCEPTANCE' in s:sec=240
  continue
 if s.startswith('## '):
  if 'Bengali instruction' in s:sec=310;counter=0
  elif 'Fidelity note' in s:sec=320;counter=0
  continue
 if s.startswith('#'): continue
 if sec==0:pass
 # Retain every non-heading source line, including standalone prose and list items.
 counter+=1; prefix='MS' if sec<300 else 'BN'
 rid=f'{prefix}-{sec:03d}-{counter:03d}'
 text=re.sub(r'^[-*]\s+|^\d+\.\s+','',s).replace('**','')
 status='Source instruction' if sec in (310,320) else 'Specified — not implemented'
 rows.append({'id':rid,'source':'master','source_ref':f'00-master-instructions.md:L{ln}; section {sec if sec<100 else "Bengali addendum"}','requirement':text,'phase':phase_map.get(sec,'All phases'),'design_ref':doc_map.get(sec,'00-master-instructions.md'),'status':status,'acceptance_ref':'V-'+rid})
# Additional requirements from the shared conversation that are not fully enumerated in the master.
hist=[
('H001','4–50, 304–330','Bangladesh pilot: Mymensingh City and Purbadhala as separately scoped service areas; exact launch boundaries require approval.','2 / 6','04-geographic-model.md'),
('H002','26–48, 62–65','Grocery/clothing/home items and other approved categories; stores connect to one marketplace; configurable free-delivery campaigns with explicit funding source.','3 / 4','06-finance-and-delivery-policy.md'),
('H003','70–95, 137','Vendor subscription module: free/basic/plus/pro configurable plans; first year free offer; monthly billing, renewal/expiry, upgrade/downgrade and payment history.','4 / 7','06-finance-and-delivery-policy.md'),
('H004','77–95, 137','Configurable sales-volume/unit tiers and entitlements; historical 5,000/10,000 units and fee suggestions are examples, not approved prices.','4 / 7','06-finance-and-delivery-policy.md'),
('H005','137','Staff/department management; city activation/deactivation; vendor suspend/reactivate; global search across permitted vendors/customers/orders/products/cities/transactions.','6','03-role-permission-matrix.md'),
('H006','137','Daily/weekly/monthly/yearly and city/vendor/product/customer/revenue reports; controlled CSV/Excel export.','6 / 10','03-role-permission-matrix.md'),
('H007','137','Homepage banners, featured products, campaigns and promotion analytics; no hardcoded production catalog or unsupported claims.','3 / 6','08-design-and-screenshot-inventory.md'),
('H008','145, 201, 226','Manual dispatch fallback and delivery-manager controls; future third-party courier/hybrid adapter retained but not enabled without contract.','5 / 6','06-finance-and-delivery-policy.md'),
('H009','145, 201','Initial one-order/one-rider model; future multi-pickup batching behind feature flag; PWA background-GPS limitations disclosed.','5 / 11','01-architecture.md'),
('H010','187–219','Vendor acceptance precedes preparation estimate and manual Ready for Pickup; preparation, waiting and transit timestamps distinguish operations, not extra rider pay.','4 / 5','06-finance-and-delivery-policy.md'),
('H011','239–268','Central marketplace Bangla QR preferred, subject to acquirer-approved merchant/agreement and dynamic-QR capability; online/COD retained.','7','10-payment-integrations.md'),
('H012','262–268, 512–535','Rider and vendor wallet views, full history, approved MFS/bank destination; Sunday rider payout supersedes earlier twice-weekly suggestion.','5 / 7','06-finance-and-delivery-policy.md'),
('H013','268–277','Vendor gross/delivered sales, commission, refund/adjustment, available/pending/paid settlement; manual approval first, automation later; vendor calendar remains configurable.','4 / 7','06-finance-and-delivery-policy.md'),
('H014','278–297','Conditional passport/company/address/vehicle documents: incorporation, TIN/BIN, authorization letter, store photos, fitness/tax token/insurance where applicable; no bicycle motor-license requirement.','4 / 5 / 8','07-kyc-workflow.md'),
('H015','281–297','Per-document status, rejection reason, re-upload, expiry alert/restriction, assigned reviewer, identity/business/vehicle verification levels and official-source reference.','4 / 5 / 8','07-kyc-workflow.md'),
('H016','304–313','Map polygon drawing, per-zone operating hours/minimum order/free-delivery/max distance, own-zone default and authorized temporary neighboring-zone extension.','2 / 5 / 6','04-geographic-model.md'),
('H017','322–330','Country-wise marketplace first; future cross-border capability prepared but disabled; currency/language/tax/exchange-rate snapshot design.','2 / 6 / 7','04-geographic-model.md'),
('H018','353–375','Earlier strict buyer GPS rule superseded by separate buyer/recipient remote ordering; retain risk checks without blocking valid remote gifts.','3 / 8','04-geographic-model.md'),
('H019','379–385','Suspicious orders hold for manual review; confirmed fraud rejection with evidence and appeal; no perfect-fraud-prevention promise.','8','05-security-threat-model.md'),
('H020','404–414','Admin identity approval, TOTP and new/suspicious-device email challenge; historical every-login Gmail suggestion reconciled with final risk-based master.','2 / 8','05-security-threat-model.md'),
('H021','415–430','Customer natural-language search, filters, comparison, voice search, shopping/complaint assistant, tracking, easy reorder and trust badges.','3 / 9','11-ai-and-personalization.md'),
('H022','428–430','Vendor description/image assistant, inventory/sales/demand forecast, low-stock alerts, pricing suggestions, performance reports; no autonomous price/payout/refund changes.','9','11-ai-and-personalization.md'),
('H023','428–430','Rider route/traffic navigation, multi-delivery planning, voice guidance, delivery priority/communication assistance, earnings analysis and emergency SOS.','5 / 9','11-ai-and-personalization.md'),
('H024','428–430','Admin daily/weekly/monthly AI summaries, forecasts, vendor/rider performance, compliance reminders and anomaly/fraud alerts within assigned scope.','6 / 9','11-ai-and-personalization.md'),
('H025','428–430','Email/SMS/in-app/push and approved WhatsApp outbound notifications with preferences; never read private chats.','2 / 9','11-ai-and-personalization.md'),
('H026','428–430','Loyalty points, cashback, referrals, membership levels, verified reviews, disputes, refund tracking, vendor reliability and transparent pricing.','7 / 9','06-finance-and-delivery-policy.md; 11-ai-and-personalization.md'),
('H027','428–430','Bengali/English, mobile-first, voice assistance, accessible navigation and standards compliance; additional languages country-configurable.','2 / 3 / 10','08-design-and-screenshot-inventory.md'),
('H028','470–497','Consented device-local interests, opt-in cross-device sync, personalized homepage, predictive/related products, smart deals, frequency control and interest clearing.','9','11-ai-and-personalization.md'),
('H029','475–494, master §19','No covert listening to phone/WhatsApp/IMO/Viber/X; explicit user-initiated voice or share-sheet product link instead.','9','11-ai-and-personalization.md'),
('H030','538–552','Fixed distance slabs controlled by Super Admin; historical 30/45/60 BDT examples not final; rejected traffic/waiting bonus superseded.','5 / 7','06-finance-and-delivery-policy.md'),
('H031','554–588','Get Stoopy name/logo/tagline retained; final red accents on white with dark nav/footer supersede historical green themes.','2 / 3','08-design-and-screenshot-inventory.md'),
('H032','558–563','Visible dynamic watermark, masked sensitive data, export/clipboard controls, panic/emergency lock; native capture controls only in supported native app.','6 / 8','05-security-threat-model.md'),
('H033','592–629','Use all approved homepage/admin/vendor/rider/login references; include KYC and admin Authenticator flows; mockup is not working software.','1 / 2–6','08-design-and-screenshot-inventory.md'),
('H034','Login screenshot','Apple sign-in appears in visual reference but not master provider list: optional adapter, not silently enabled; Google/Facebook/LinkedIn/X remain specified.','2 / 3','08-design-and-screenshot-inventory.md'),
('H035','All dashboard screenshots','All sample names, USD amounts, counts, ratings, dates, maps, addresses, notification badges and charts are design fixtures only; real values derive from scoped database queries.','1 / 2–6','08-design-and-screenshot-inventory.md'),
('H036','Homepage/login screenshots','Payment logos (Visa/Mastercard/PayPal/Stripe) and shipping/support claims are visual references, not proof of active provider contracts or worldwide service.','3 / 7 / 11','10-payment-integrations.md'),
('H038','137, 430','Recharts analytics, React Hook Form/Zod forms, loading/empty/error states, dialogs/toasts and server pagination retained as implementation guidance.','2 / 10','08-design-and-screenshot-inventory.md'),
('H039','145, 306','Firebase Cloud Messaging, Mapbox/OSRM, Turf.js and native app suggestions are candidates, not extra mandatory vendors; select via ADR and cost approval.','2 / 5 / 11','adr/ADR-006-external-providers.md'),
('H040','320, historical legal/payment assertions','Do not treat generated timestamps, unverified legal citations or provider-settlement assertions as production facts; independently verify before launch.','1 / 11','09-source-review.md')]
for rid,ref,text,phase,doc in hist:rows.append({'id':rid,'source':'shared-conversation','source_ref':'Message '+ref,'requirement':text,'phase':phase,'design_ref':doc,'status':'Mapped — implementation pending','acceptance_ref':'V-'+rid})
# Every screenshot inventory row is also an atomic traceability item.
inv=(D/'08-design-and-screenshot-inventory.md').read_text()
for ln,line in enumerate(inv.splitlines(),1):
 if not re.match(r'\| UI-[A-Z]\d+ \|',line): continue
 cells=[x.strip() for x in line.strip().strip('|').split('|')]
 if len(cells)<3: continue
 rid,visible,meaning=cells[:3]
 rows.append({'id':rid,'source':'screenshot','source_ref':f'08-design-and-screenshot-inventory.md:L{ln}','requirement':visible+' — '+meaning,'phase':'1–6 / 10','design_ref':'08-design-and-screenshot-inventory.md','status':'Inventoried — not implemented','acceptance_ref':'V-'+rid})
# Sources and image inventory.
source_files=[]
for p in sorted((R/'references').iterdir()):
 im=Image.open(p)
 source_files.append({'file':str(p.relative_to(R)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'width':im.width,'height':im.height})
(C/'source-manifest.json').write_text(json.dumps({'review_date':'2026-11-01','workspace_before':'No source repository; uploads only','shared_conversation':'https://chatgpt.com/share/6ae70089-14c4-83ec-aaf9-b382b6b04347','shared_nodes':633,'retained_visible_messages':460,'user_messages':209,'assistant_messages':251,'user_groups':203,'historical_image_references':6,'files':source_files},indent=2))
with (C/'requirements-register.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
(C/'requirements-register.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
md=['# Requirements traceability register',f'\n{len(rows)} source-line requirements/additions. Every non-heading source line in the normalized master is retained with a line reference; the Bengali addendum is included. This is specification coverage, NOT implementation completion.\n','| ID | Source | Requirement / instruction | Phase | Design reference | Status |','|---|---|---|---|---|---|']
for r in rows:md.append('| '+ ' | '.join(str(r[k]).replace('|','\\|') for k in ['id','source_ref','requirement','phase','design_ref','status'])+' |')
(D/'13-requirements-register.md').write_text('\n'.join(md))
# Planned verification: one stable reference per requirement; NOT a test result.
def method(r):
 t=r['requirement'].lower()
 if r['source']=='screenshot': return 'Visual comparison at desktop/tablet/mobile + keyboard/accessibility review + real-data behavior test where interactive'
 if any(x in t for x in ['never','do not','no public','cannot','must not','forbid','without approval']): return 'Negative policy/security test or documented review gate; inspect evidence before approval'
 if any(x in t for x in ['test','pass','acceptance']): return 'Automated test suite and linked CI evidence at the relevant phase'
 if any(x in t for x in ['database','ledger','transaction','constraint','immutable']): return 'Schema/constraint review + migration/integration/concurrency test'
 if any(x in t for x in ['api','endpoint','webhook','session','permission','scope']): return 'API contract + integration/negative authorization test'
 if any(x in t for x in ['document','guide','checklist','roadmap','architecture','erd']): return 'Document review against source requirement and implementation evidence'
 return 'Requirement review + relevant automated/manual acceptance demonstration'
with (C/'verification-plan.csv').open('w',newline='') as f:
 w=csv.DictWriter(f,fieldnames=['verification_id','requirement_id','planned_method','evidence_required','status']);w.writeheader()
 for r in rows:w.writerow({'verification_id':r['acceptance_ref'],'requirement_id':r['id'],'planned_method':method(r),'evidence_required':'Link to future commit/test report/review record; no evidence exists yet','status':'NOT_RUN'})
from collections import Counter
counts=Counter(r['source'] for r in rows)
print('Requirement rows:',len(rows),dict(counts))
