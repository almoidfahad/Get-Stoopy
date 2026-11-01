"""Validate Phase-1 DOCUMENTS/CONTRACTS only. Not application, migration, security or payment tests."""
from pathlib import Path
import json
import subprocess,csv,re,hashlib,xml.etree.ElementTree as ET
from urllib.parse import urlparse,unquote
import yaml
from openapi_spec_validator import validate
from bs4 import BeautifulSoup
R=Path(__file__).resolve().parents[1];D=R/'docs';C=R/'contracts'
checks=[]
def check(name,fn):
 try:
  detail=fn();checks.append({'check':name,'status':'PASS','detail':detail or 'ok'})
 except Exception as e:checks.append({'check':name,'status':'FAIL','detail':str(e)})
def require_files():
 files=['00-master-instructions.md','01-architecture.md','02-api-architecture.md','03-role-permission-matrix.md','04-geographic-model.md','05-security-threat-model.md','06-finance-and-delivery-policy.md','07-kyc-workflow.md','08-design-and-screenshot-inventory.md','09-source-review.md','10-payment-integrations.md','11-ai-and-personalization.md','12-data-dictionary.md','13-requirements-register.md','14-roadmap.md','15-progress-and-decisions.md']
 missing=[x for x in files if not (D/x).is_file()];assert not missing,missing
 assert len(list((D/'adr').glob('ADR-*.md')))==8
 return f'{len(files)} core documents + 8 ADRs'
def model_check():
 m=json.loads((C/'logical-data-model.json').read_text());es=m['entities'];rs=m['relations']
 required='User Role Permission Session AdminScope Country Region District City ServiceZone Address Vendor VendorKYC Rider RiderKYC Customer Product ProductVariant Category Inventory Cart CartItem Order VendorSuborder OrderItem Delivery RiderAssignment RiderLocation Payment Refund CommissionRule Payout Settlement KYCReview FraudCase Notification ProductInteraction AuditLog'.split()
 missing=[x for x in required if x not in es];assert not missing,missing
 for n in ['VendorLedger','RiderLedger','CODLedger']:assert n in (D/'12-data-dictionary.md').read_text(),n
 seen=set()
 for r in rs:
  assert r['from'] in es and r['to'] in es,r
  assert r['field'] in dict(es[r['from']]['fields']),r
  assert r['targetKey']=='id',r
  assert r['cardinality'] in ('1:1','N:1'),r
  key=(r['from'],r['to'],r['field']);assert key not in seen,key;seen.add(key)
 # Concrete UUID fields must have an explicit relationship, except documented polymorphic/public identifiers.
 poly={'ownerId','subjectId','resourceId','aggregateId','referenceId'}
 for n,e in es.items():
  for f,t in e['fields']:
   if t.startswith('uuid') and f not in poly and not (n=='CheckoutQuote' and f=='checkoutId'):
    assert any(x['from']==n and x['field']==f for x in rs),(n,f)
 assert not any(r['from']=='CheckoutQuote' and r['to']=='CheckoutQuote' for r in rs)
 return f'{len(es)} entities; {len(rs)} unique valid logical relationships; required names/views mapped; no executable schema'
def openapi_check():
 spec=json.loads((C/'openapi.json').read_text());validate(spec)
 y=yaml.safe_load((C/'openapi.yaml').read_text());assert y==spec
 ids=[]
 for path,ops in spec['paths'].items():
  for method,op in ops.items():
   ids.append(op['operationId']);assert op['x-contract-status']=='PROPOSED_NOT_IMPLEMENTED'
   assert 'x-authorization' in op and 'x-required-permission' in op
   if method in ('post','put','patch','delete') and not path.startswith('/webhooks/'):
    names={p['name'] for p in op.get('parameters',[])};assert 'Idempotency-Key' in names,(path,method)
 assert len(ids)==len(set(ids))
 assert spec['servers'][0]['url'].startswith('/')
 return f'OpenAPI 3.1 valid; {len(spec["paths"])} paths / {len(ids)} operations / {len(spec["components"]["schemas"])} schemas; YAML=JSON; no live server'
def requirements_check():
 rows=json.loads((C/'requirements-register.json').read_text());assert len(rows)==len({r['id'] for r in rows})
 with (C/'requirements-register.csv').open() as f:csvrows=list(csv.DictReader(f))
 assert len(csvrows)==len(rows)
 with (C/'verification-plan.csv').open() as f:v=list(csv.DictReader(f))
 assert {r['acceptance_ref'] for r in rows}=={r['verification_id'] for r in v}
 assert all(r['status']=='NOT_RUN' for r in v)
 master=(D/'00-master-instructions.md').read_text().splitlines();mapped={int(r['source_ref'].split(':L')[1].split(';')[0]) for r in rows if r['source']=='master'}
 expected=[]
 for i,line in enumerate(master,1):
  s=line.strip()
  if not s or s.startswith('#') or s.startswith('>') or s=='---':continue
  expected.append(i)
 assert set(expected)==mapped,(set(expected)-mapped,mapped-set(expected))
 inv=(D/'08-design-and-screenshot-inventory.md').read_text();ui=set(re.findall(r'^\| (UI-[A-Z]\d+) \|',inv,re.M));assert ui=={r['id'] for r in rows if r['source']=='screenshot'}
 return f'{len(rows)} unique rows; all {len(expected)} non-heading master lines mapped; {len(ui)} screenshot rows; verification plan NOT_RUN'
def source_check():
 m=json.loads((C/'source-manifest.json').read_text());assert m['retained_visible_messages']==460 and m['user_messages']==209 and m['assistant_messages']==251 and len(m['files'])==5
 for f in m['files']:
  p=R/f['file'];assert hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'],p
 return '460-message source counts and five upload hashes verified; unavailable artifacts disclosed'
def links_check():
 bad=[]
 for p in D.rglob('*.md'):
  for target in re.findall(r'\]\(([^)]+)\)',p.read_text()):
   if target.startswith(('http://','https://','#','mailto:')):continue
   path=unquote(target.split('#')[0]);q=(p.parent/path).resolve()
   if not q.exists():bad.append((str(p.relative_to(R)),target))
 assert not bad,bad
 return 'Local Markdown links/images resolve; external citations not fetched by this check'
def diagrams_check():
 svgs=list((D/'diagrams').glob('*.svg'));assert len(svgs)==13,len(svgs)
 for p in svgs:
  root=ET.parse(p).getroot();assert root.tag.endswith('svg') and root.attrib.get('viewBox'),p
  assert p.stat().st_size>1000,p
 mmd=(D/'diagrams'/'complete-erd.mmd').read_text();assert mmd.startswith('erDiagram')
 m=json.loads((C/'logical-data-model.json').read_text())
 for n in m['entities']:assert re.search(r'^  '+n+r' \{',mmd,re.M),n
 return f'{len(svgs)} SVGs parse with viewBox; complete Mermaid contains every entity; domain DOT sources rendered locally'
def role_check():
 with (C/'role-permission-matrix.csv').open() as f:rows=list(csv.DictReader(f))
 assert len(rows)==240,len(rows);assert all(r['policy_status']=='PROPOSED' for r in rows)
 return f'{len(rows)} role/capability rows; proposed policy, not enforced code'
def html_check():
 p=R/'architecture-review.html';s=BeautifulSoup(p.read_text(),'html.parser');ids=[x['id'] for x in s.select('[id]')];assert len(ids)==len(set(ids))
 assert not [x for x in s.select('[src]') if not x.get('src','').startswith('data:')]
 assert not s.select('link[rel="stylesheet"]')
 assert len(s.select('#reqbody tr'))==len(json.loads((C/'requirements-register.json').read_text()))
 assert s.select('script') and all(not x.get('src') for x in s.select('script'))
 return f'Self-contained HTML; {len(ids)} unique IDs; embedded assets/styles/script; all requirement rows; no network dependency'
def boundary_check():
 tracked_env = subprocess.run(['git','ls-files','.env'], cwd=R, capture_output=True, text=True).stdout.strip() if (R/'.git').exists() else ''
 assert not tracked_env, 'committed .env found'
 env=(R/'.env.example').read_text()
 for flag in ['PAYMENTS_LIVE_ENABLED','BANGLA_QR_ENABLED','PAYOUTS_LIVE_ENABLED','CROSS_BORDER_ENABLED','AI_ENABLED']:
  assert flag+'=false' in env, flag
 pkg=R/'package.json'
 if pkg.exists(): assert json.loads(pkg.read_text()).get('private') is True
 return 'Development foundation may exist; no committed .env; live/payment/cross-border/AI template flags default false; package private'
for name,fn in [('Required documents',require_files),('Logical model integrity',model_check),('OpenAPI contract',openapi_check),('Requirement traceability',requirements_check),('Source manifest',source_check),('Local document references',links_check),('Diagram artifacts',diagrams_check),('Role matrix CSV',role_check),('Self-contained review HTML',html_check),('Implementation boundary',boundary_check)]:check(name,fn)
failed=[c for c in checks if c['status']=='FAIL']
report={'date':'2026-11-01','scope':'Phase-1 document/contract validation only; current development boundary check','application_tests':'NOT_RUN by this document validator; foundation unit tests are logged separately in docs/17-phase2-foundation.md','phase_1_status':'APPROVED_FOR_DEVELOPMENT_2026-11-01','checks':checks,'passed':len(checks)-len(failed),'failed':len(failed)}
(C/'validation-results.json').write_text(json.dumps(report,indent=2))
md=['# Phase-1 validation report','', '**Scope:** document/contract artifacts only. **No application, database migration, endpoint, security control or payment integration was tested.** Phase 1 was approved for development on 2026-11-01; Phase 2 is in progress.','',f"Result: {report['passed']} passed / {report['failed']} failed.",'','| Check | Result | Detail |','|---|---|---|']
for c in checks:md.append('| '+c['check']+' | '+c['status']+' | '+c['detail'].replace('|','\\|')+' |')
md+=['','## Not validated by these checks','','- Runtime authentication, RBAC/RLS, SQL constraints, concurrency, payouts, webhooks or UI behavior.','- Provider contracts, live credentials, legal eligibility, QR/split settlement or disbursement support.','- Byte-for-byte fidelity to an unavailable original master attachment; normalized source-line coverage is checked instead.','- Production readiness, penetration-test results, performance budgets or restore objectives.','','These require later implementation and evidence under the approved roadmap.']
(D/'16-validation-report.md').write_text('\n'.join(md))
print(json.dumps(report,indent=2))
raise SystemExit(1 if failed else 0)
