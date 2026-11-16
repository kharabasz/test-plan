import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';

let server;
let base;

before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => {
  server.close(resolve);
  server.closeAllConnections();
}));

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const isJson = res.headers.get('content-type')?.startsWith('application/json');
  return { status: res.status, body: isJson ? JSON.parse(text) : text };
}

const post = (path, body) => call('POST', path, body);

test('groups allow one level of nesting', async () => {
  assert.equal((await post('/api/groups', { id: 'checkout', description: 'Checkout' })).status, 201);
  const sub = await post('/api/groups', { id: 'checkout.payments', description: 'Payments', parentId: 'checkout' });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.parentId, 'checkout');

  const tooDeep = await post('/api/groups', { id: 'deep', description: 'Too deep', parentId: 'checkout.payments' });
  assert.equal(tooDeep.status, 400);
  assert.match(tooDeep.body.error, /one level of nesting/);

  assert.equal((await post('/api/groups', { id: 'checkout', description: 'Again' })).status, 409);
  assert.equal((await post('/api/groups', { id: 'orphan', description: 'x', parentId: 'nope' })).status, 400);
  assert.equal((await post('/api/groups', { description: 'no id' })).status, 400);
});

test('tests can be created, edited, soft deleted and restored', async () => {
  const created = await post('/api/tests', {
    id: 'PAY-1', groupId: 'checkout.payments', shortDescription: 'Card payment', fullDescription: '1. Add item\n2. Pay',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.deleted, false);

  assert.equal((await post('/api/tests', { id: 'PAY-1', groupId: 'checkout', shortDescription: 'x' })).status, 409);
  assert.equal((await post('/api/tests', { id: 'X-1', groupId: 'missing', shortDescription: 'x' })).status, 400);

  const edited = await call('PATCH', '/api/tests/PAY-1', { fullDescription: '1. Add item\n2. Pay by card' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.shortDescription, 'Card payment');
  assert.equal(edited.body.fullDescription, '1. Add item\n2. Pay by card');

  assert.equal((await call('PATCH', '/api/tests/PAY-1', { groupId: 'checkout' })).status, 400);
  assert.equal((await call('PATCH', '/api/tests/PAY-1', {})).status, 400);

  const deleted = await call('DELETE', '/api/tests/PAY-1');
  assert.equal(deleted.body.deleted, true);
  const listed = await call('GET', '/api/tests');
  assert.ok(!listed.body.some((t) => t.id === 'PAY-1'));
  const withDeleted = await call('GET', '/api/tests?includeDeleted=true');
  assert.ok(withDeleted.body.some((t) => t.id === 'PAY-1'));

  const restored = await post('/api/tests/PAY-1/restore');
  assert.equal(restored.body.deleted, false);
  assert.equal(restored.body.deletedAt, null);
});

test('results validate input and are append only', async () => {
  const bad = [
    { testId: 'PAY-1', runAt: '2026-11-16T10:00:00', status: 'pass' },
    { testId: 'PAY-1', runAt: '2026-02-30T10:00:00Z', status: 'pass' },
    { testId: 'PAY-1', runAt: 'yesterday', status: 'pass' },
    { testId: 'PAY-1', runAt: '2026-11-16T10:00:00Z', status: 'skipped' },
    { testId: 'PAY-1', runAt: '2026-11-16T10:00:00Z', status: 'pass', failureDescription: 'nope' },
    { testId: 'missing', runAt: '2026-11-16T10:00:00Z', status: 'pass' },
  ];
  for (const body of bad) {
    assert.equal((await post('/api/results', body)).status, 400, JSON.stringify(body));
  }

  const ok = await post('/api/results', { testId: 'PAY-1', runAt: '2026-11-16T10:00:00+01:00', status: 'pass' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.runAt, '2026-11-16T10:00:00+01:00');

  assert.equal((await call('PUT', '/api/results', {})).status, 405);
  assert.equal((await call('DELETE', '/api/results')).status, 405);
});

test('summary counts only the latest result per active test', async () => {
  await post('/api/tests', { id: 'PAY-2', groupId: 'checkout.payments', shortDescription: 'Refund' });
  await post('/api/tests', { id: 'CO-1', groupId: 'checkout', shortDescription: 'Guest checkout' });
  await post('/api/tests', { id: 'CO-2', groupId: 'checkout', shortDescription: 'Never run' });
  await post('/api/tests', { id: 'CO-3', groupId: 'checkout', shortDescription: 'Will be deleted' });

  await post('/api/results', { testId: 'PAY-1', runAt: '2026-11-16T09:30:00Z', status: 'fail', failureDescription: 'Card <declined>' });
  await post('/api/results', { testId: 'PAY-1', runAt: '2026-11-15T09:30:00Z', status: 'pass' });
  await post('/api/results', { testId: 'PAY-2', runAt: '2026-11-16T08:00:00Z', status: 'fail' });
  await post('/api/results', { testId: 'PAY-2', runAt: '2026-11-16T10:00:00+01:00', status: 'pass' });
  await post('/api/results', { testId: 'PAY-2', runAt: '2026-11-16T11:00:00+03:00', status: 'fail' });
  await post('/api/results', { testId: 'CO-1', runAt: '2026-11-16T07:00:00Z', status: 'pass' });
  await post('/api/results', { testId: 'CO-3', runAt: '2026-11-16T07:00:00Z', status: 'fail' });
  await call('DELETE', '/api/tests/CO-3');

  const pay1 = await call('GET', '/api/tests/PAY-1');
  assert.equal(pay1.body.latestResult.status, 'fail');
  const pay2 = await call('GET', '/api/tests/PAY-2');
  assert.equal(pay2.body.latestResult.runAt, '2026-11-16T10:00:00+01:00');

  const page = await call('GET', '/');
  assert.equal(page.status, 200);
  assert.ok(!/<script/i.test(page.body));
  const totalRow = page.body.match(/All tests \((\d+)\)[\s\S]*?num pass[^>]*>(\d+)<[\s\S]*?num fail[^>]*>(\d+)<[\s\S]*?num not-run[^>]*>(\d+)</);
  assert.deepEqual(totalRow.slice(1).map(Number), [4, 2, 1, 1]);
  assert.ok(page.body.includes('href="/tests/PAY-1"'));
  assert.ok(!page.body.includes('CO-3'));

  const summary = await call('GET', '/api/summary');
  assert.deepEqual(summary.body.totals, { pass: 2, fail: 1, notRun: 1, total: 4 });
  const failing = await call('GET', '/api/failing');
  assert.deepEqual(failing.body.map((t) => t.id), ['PAY-1']);
  assert.equal(failing.body[0].failureDescription, 'Card <declined>');
});

test('api refuses writes from other origins', async () => {
  const res = await fetch(`${base}/api/groups`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
    body: JSON.stringify({ id: 'evil', description: 'x' }),
  });
  assert.equal(res.status, 403);
});

test('drilldown shows plan and expandable failure details, escaped', async () => {
  const page = await call('GET', '/tests/PAY-1');
  assert.equal(page.status, 200);
  assert.ok(!/<script/i.test(page.body));
  assert.ok(page.body.includes('1. Add item\n2. Pay by card'));
  assert.ok(page.body.includes('Card &lt;declined&gt;'));
  assert.ok(page.body.includes('<details>'));
  const failIndex = page.body.indexOf('2026-11-16 09:30:00 Z');
  const passIndex = page.body.indexOf('2026-11-15 09:30:00 Z');
  assert.ok(failIndex > 0 && passIndex > failIndex, 'newest run comes first');

  assert.equal((await call('GET', '/tests/missing')).status, 404);
});

test('database rejects updates and deletes of results', () => {
  const db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO test_groups (id, description, created_at) VALUES ('g', 'g', 'now');
    INSERT INTO tests (id, group_id, short_description, created_at, updated_at) VALUES ('t', 'g', 't', 'now', 'now');
    INSERT INTO test_results (test_id, run_at, run_at_utc, status, reported_at) VALUES ('t', 'x', 'x', 'pass', 'now');`);
  assert.throws(() => db.exec("UPDATE test_results SET status = 'fail'"), /append only/);
  assert.throws(() => db.exec('DELETE FROM test_results'), /append only/);
  db.close();
});

test('api reports unknown routes as json', async () => {
  const res = await call('GET', '/api/nothing');
  assert.equal(res.status, 404);
  assert.ok(res.body.error);
  assert.equal((await call('GET', '/api/health')).body.ok, true);
});
