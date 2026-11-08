#!/usr/bin/env node
// Vercel ignored-build-step contract: exit 0 cancels, exit 1 proceeds.
// Production is permitted only for an explicitly approved commit on the
// getstoopy project. The project-scoped approval is temporary, not a secret.
const environment = process.env.VERCEL_ENV;
const approvedSha = process.env.STOOPY_APPROVED_PRODUCTION_SHA;
const sha = process.env.VERCEL_GIT_COMMIT_SHA;
const project = process.env.VERCEL_PROJECT_ID;

if (environment === 'preview') {
  console.log('Preview deployment allowed.');
  process.exit(1);
}

if (environment === 'production' && project === 'prj_1SpAvyLnlx2mXAaXA1SSL1JQEmRq' &&
    /^[0-9a-f]{40}$/.test(approvedSha ?? '') && sha === approvedSha) {
  console.log('Explicitly approved getstoopy production commit allowed.');
  process.exit(1);
}

console.log('Build skipped: production requires explicit project and commit approval.');
process.exit(0);
