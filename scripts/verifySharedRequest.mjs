import assert from 'node:assert/strict';
import { shareRequest } from '../src/services/sharedRequest.ts';

let calls = 0;
let finish;
const read = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
const first = shareRequest('workflow:case:account-a', read);
const second = shareRequest('workflow:case:account-a', read);
assert.equal(calls, 1);
assert.equal(first, second);
finish({ status: 'In Progress' });
await first;

// A read after an edit must fetch again, rather than return settled old data.
const fresh = shareRequest('workflow:case:account-a', read);
assert.equal(calls, 2);
finish({ status: 'Done' });
assert.deepEqual(await fresh, { status: 'Done' });

await assert.rejects(shareRequest('failed', async () => { throw new Error('offline'); }), /offline/);
assert.equal(await shareRequest('failed', async () => 'recovered'), 'recovered');
assert.equal(await shareRequest('workflow:case:account-b', async () => 'separate account'), 'separate account');
console.log('PASS: concurrent reads share one request; settled and failed reads are cleared; account keys remain separate.');
