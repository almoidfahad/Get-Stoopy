#!/usr/bin/env node
// Vercel ignored-build-step contract: exit 0 cancels the build, exit 1 proceeds.
// Only preview deployments are authorized. Production and unknown environments
// fail closed so a dashboard override or CLI --prod cannot silently promote.
const environment = process.env.VERCEL_ENV;

if (environment === 'preview') {
  console.log('Preview deployment allowed.');
  process.exit(1);
}

console.log('Build skipped: only preview deployments are authorized.');
process.exit(0);
