#!/usr/bin/env node
/**
 * Local, synthetic coexistence experiments. PGlite is instantiated without a
 * data directory, connection string, or environment-derived database URL.
 * This is NOT a replica of Supabase and must never be used as rollout approval.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 4 || process.argv[2] !== '--dependency-dir') throw new Error('Usage: node tools/verify-synthetic-shared-schema.mjs --dependency-dir <isolated npm directory>');
const dependencyDir = resolve(process.argv[3]);
for (const [pkg, version] of [['pglite', '0.5.16'], ['pglite-postgis', '0.2.16']]) {
  const manifest = JSON.parse(readFileSync(join(dependencyDir, 'node_modules', '@electric-sql', pkg, 'package.json'), 'utf8'));
  if (manifest.version !== version) throw new Error(`Expected @electric-sql/${pkg}@${version}`);
}
const require = createRequire(join(dependencyDir, 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const { postgis } = require('@electric-sql/pglite-postgis');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = join(root, 'packages/db/prisma/migrations');
const migrations = readdirSync(migrationDir).filter(name => /^\d{4}_/.test(name)).sort();
if (migrations.length !== 77 || migrations.at(-1) !== '0077_isolated_boundary_pointer_history') throw new Error('Migration chain changed; review this rehearsal before running');
const grants = readFileSync(join(root, 'scripts/db-grants.sql'), 'utf8');
const syntheticRoles = 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE gs_owner; CREATE ROLE gs_runtime; CREATE ROLE gs_privileged;';

async function fixture(db) {
  await db.exec(`
    ${syntheticRoles}
    CREATE EXTENSION postgis;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL);
    CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), status text NOT NULL DEFAULT 'active');
    CREATE TABLE public.categories (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL);
    CREATE TABLE public.articles (id uuid PRIMARY KEY, category_id uuid REFERENCES public.categories(id), title text NOT NULL);
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY editorial_profile_self ON public.profiles FOR SELECT TO authenticated USING (id = NULLIF(current_setting('fixture.user_id', true), '')::uuid);
    CREATE FUNCTION public.handle_new_auth_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
      BEGIN INSERT INTO public.profiles (id) VALUES (NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
    GRANT SELECT, UPDATE ON public.profiles TO authenticated;
    GRANT SELECT ON public.categories, public.articles TO anon, authenticated;
    INSERT INTO auth.users(id,email) VALUES ('11111111-1111-4111-8111-111111111111','synthetic@example.invalid');
    INSERT INTO public.categories(id,slug) VALUES ('22222222-2222-4222-8222-222222222222','fixture-category');
    INSERT INTO public.articles(id,category_id,title) VALUES ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Synthetic editorial record');
    GRANT USAGE, CREATE ON SCHEMA public TO gs_owner;
    -- Deliberately broad synthetic defaults model a possible shared schema;
    -- these are NOT a claim about the hosted project's current default ACLs.
    ALTER DEFAULT PRIVILEGES FOR ROLE gs_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO anon, authenticated;
  `);
}

async function editorialSnapshot(db) {
  const rows = await db.query(`
    SELECT 'data' AS kind, row_to_json(t)::text AS value FROM (
      SELECT (SELECT count(*) FROM auth.users) AS users, (SELECT string_agg(id::text || ':' || status, ',' ORDER BY id) FROM public.profiles) AS profiles,
        (SELECT string_agg(slug, ',' ORDER BY id) FROM public.categories) AS categories,
        (SELECT string_agg(title, ',' ORDER BY id) FROM public.articles) AS articles
    ) t
    UNION ALL SELECT 'relation', concat_ws('|',c.relname,c.relrowsecurity::text,c.relforcerowsecurity::text,c.relowner::text,coalesce(c.relacl::text,'')) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('profiles','categories','articles')
    UNION ALL SELECT 'constraint', concat_ws('|',c.relname,con.conname,pg_get_constraintdef(con.oid)) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('profiles','categories','articles')
    UNION ALL SELECT 'policy', concat_ws('|',tablename,policyname,roles::text,cmd,qual,with_check) FROM pg_policies WHERE schemaname='public' AND tablename IN ('profiles','categories','articles')
    UNION ALL SELECT 'trigger', pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal
    UNION ALL SELECT 'function', pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='handle_new_auth_user'
    ORDER BY 1,2`);
  return rows.rows;
}

async function sharedPublic() {
  const db = new PGlite({ extensions: { postgis } });
  try {
    await fixture(db);
    const before = await editorialSnapshot(db);
    await db.exec('SET ROLE gs_owner; SET search_path=public;');
    for (const name of migrations) await db.exec(readFileSync(join(migrationDir, name, 'migration.sql'), 'utf8'));
    await db.exec(grants);
    await db.exec('RESET ROLE; RESET search_path;');
    assert.deepEqual(await editorialSnapshot(db), before, 'synthetic editorial snapshot changed');
    // The inventory grant script controls gs_* roles; it does not remove an
    // independently configured broad default grant to anon/authenticated.
    const exposure = await db.query(`SELECT has_table_privilege('anon','public."Order"','TRUNCATE') AS anon_truncate,
      has_table_privilege('authenticated','public."Order"','UPDATE') AS authenticated_update,
      (SELECT relrowsecurity FROM pg_class WHERE oid='public."Order"'::regclass) AS rls_enabled`);
    assert.deepEqual(exposure.rows, [{ anon_truncate: true, authenticated_update: true, rls_enabled: true }]);
    console.log('Synthetic broad default grants on the new Order table remain after db-grants, despite RLS; actual hosted defaults were not tested.');
    // Verify the pre-existing auth trigger still inserts a profile after the chain.
    await db.exec("INSERT INTO auth.users(id,email) VALUES ('44444444-4444-4444-8444-444444444444','second@example.invalid')");
    const check = await db.query("SELECT status FROM public.profiles WHERE id='44444444-4444-4444-8444-444444444444'");
    assert.deepEqual(check.rows, [{ status: 'active' }]);
    console.log('Synthetic shared public: 77 migrations and grants ran; selected editorial data, ACLs, RLS policy, constraints, trigger and function were unchanged. Auth fixture trigger still fired.');
  } finally { await db.close(); }
}

async function otherNamespaceFailsClosed() {
  const db = new PGlite({ extensions: { postgis } });
  try {
    await fixture(db);
    const before = await editorialSnapshot(db);
    await db.exec('CREATE SCHEMA marketplace AUTHORIZATION gs_owner; SET ROLE gs_owner; SET search_path=marketplace,public; CREATE TABLE "User" (id uuid PRIMARY KEY);');
    const beforeUserAcl = (await db.query("SELECT relacl::text AS acl FROM pg_class WHERE oid='marketplace.\"User\"'::regclass")).rows;
    await assert.rejects(db.exec(grants), /missing or incorrectly owned Get Stoopy table/);
    await db.exec('ROLLBACK; RESET ROLE; RESET search_path;');
    assert.deepEqual(await editorialSnapshot(db), before);
    assert.deepEqual((await db.query("SELECT relacl::text AS acl FROM pg_class WHERE oid='marketplace.\"User\"'::regclass")).rows, beforeUserAcl);
    console.log('Different namespace: unmodified public-specific grants script refused the synthetic namespace-only inventory and did not alter the snapshots.');
  } finally { await db.close(); }
}

async function extensionNamespace() {
  const db = new PGlite({ extensions: { postgis } });
  try {
    await db.exec('CREATE SCHEMA extensions; CREATE EXTENSION postgis WITH SCHEMA extensions;');
    const result = await db.query("SELECT to_regoperator('public.=(extensions.geometry,extensions.geometry)')::text AS public_operator, to_regoperator('extensions.=(extensions.geometry,extensions.geometry)')::text AS extension_operator");
    assert.equal(result.rows[0].public_operator, null);
    assert.notEqual(result.rows[0].extension_operator, null);
    console.log('PostGIS in extensions: geometry equality exists in extensions, not public; migration 0036 hard-codes OPERATOR(public.=), requiring review before such deployment.');
  } finally { await db.close(); }
}

await sharedPublic();
await otherNamespaceFailsClosed();
await extensionNamespace();
console.log('Synthetic in-memory checks completed. These are not hosted integration, full security, restore, or production deployment tests.');
