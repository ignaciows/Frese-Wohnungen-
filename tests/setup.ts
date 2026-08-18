/**
 * One-off setup for integration tests. Runs migrations against
 * TEST_DATABASE_URL and clears every table before each test file.
 */

import 'dotenv/config';
import { execSync } from 'node:child_process';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must be set for integration tests.');
}
// Point Prisma at the test database for this process.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

let migrated = false;

export function ensureMigrated() {
  if (migrated) return;
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: 'ignore',
  });
  migrated = true;
}

export async function truncateAll() {
  const { prisma } = await import('@/lib/prisma');
  // Order matters: children before parents to keep DELETE happy without CASCADE.
  const tables = [
    'AuditEvent',
    'SystemTransfer',
    'ContactAttempt',
    'ListingClaim',
    'DuplicateMember',
    'DuplicateGroup',
    'CandidateListingMatch',
    'ListingFact',
    'Listing',
    'SourceCheck',
    'SearchRun',
    'SourceFilterMapping',
    'Source',
    'ApplicationMessage',
    'SearchProfile',
    'CandidateCase',
    'AppSetting',
    'User',
  ];
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tables.join('","')}" RESTART IDENTITY CASCADE`);
}
