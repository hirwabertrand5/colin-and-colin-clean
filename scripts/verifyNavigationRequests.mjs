import assert from 'node:assert/strict';
import { navigationFetch, prepareNavigationRequest, clearNavigationRequests } from '../src/services/navigationRequest.ts';

const native = globalThis.fetch;
const auth = { headers: { Authorization: 'Bearer account-a' } };
let calls = 0;
let version = 1;
let fail = false;
let release;
let delayed = false;
globalThis.fetch = async (_url, init) => {
  calls++;
  const captured = version;
  if (init?.method === 'POST') { version++; return Response.json({ saved: true }); }
  if (delayed) { delayed = false; await new Promise(resolve => { release = resolve; }); }
  if (fail) { fail = false; throw new Error('offline'); }
  return Response.json({ version: captured });
};
try {
  await prepareNavigationRequest('https://api.invalid/cases?b=2&a=1', auth);
  assert.deepEqual(await (await navigationFetch('https://api.invalid/cases?a=1&b=2', auth)).json(), { version: 1 });
  assert.equal(calls, 1, 'Navigation consumes one prepared response');
  await navigationFetch('https://api.invalid/cases?a=1&b=2', auth);
  assert.equal(calls, 2, 'Subsequent reads stay fresh');
  delayed = true;
  const first = navigationFetch('https://api.invalid/tasks', auth);
  const second = navigationFetch('https://api.invalid/tasks', auth);
  release();
  assert.deepEqual(await (await first).json(), await (await second).json(), 'Concurrent callers have independently readable bodies');
  assert.equal(calls, 3);
  await prepareNavigationRequest('https://api.invalid/cases', auth);
  await navigationFetch('https://api.invalid/tasks', { ...auth, method: 'POST' });
  assert.deepEqual(await (await navigationFetch('https://api.invalid/cases', auth)).json(), { version: 2 }, 'Writes invalidate prepared data');
  delayed = true;
  const preparing = prepareNavigationRequest('https://api.invalid/late', auth);
  const waiting = navigationFetch('https://api.invalid/late', auth);
  await navigationFetch('https://api.invalid/tasks', { ...auth, method: 'POST' });
  release();
  await preparing;
  assert.equal((await (await waiting).json()).version, 3, 'A response started before a write cannot repopulate the cache');
  fail = true;
  await prepareNavigationRequest('https://api.invalid/retry', auth);
  assert.equal((await (await navigationFetch('https://api.invalid/retry', auth)).json()).version, 3);
  await prepareNavigationRequest('https://api.invalid/private', auth);
  const beforeAccount = calls;
  await navigationFetch('https://api.invalid/private', { headers: { Authorization: 'Bearer account-b' } });
  assert.equal(calls, beforeAccount + 1, 'Account changes never reuse another account’s response');
  await prepareNavigationRequest('https://api.invalid/fresh', auth);
  const beforeNoStore = calls;
  await navigationFetch('https://api.invalid/fresh', { ...auth, cache: 'no-store' });
  assert.equal(calls, beforeNoStore + 1, 'No-store reads bypass preparation');
  clearNavigationRequests();
  console.log('PASS: speculative reads, concurrent body isolation, fresh repeat reads, write invalidation, late-response races, retries, account separation, and no-store behavior.');
} finally { globalThis.fetch = native; clearNavigationRequests(); }
