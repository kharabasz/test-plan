import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let base;
let nextId = 1;

before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => {
  server.close(resolve);
  server.closeAllConnections();
}));

async function rpc(method, params, { notification = false, headers = {} } = {}) {
  const message = { jsonrpc: '2.0', method, params };
  if (!notification) message.id = nextId++;
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(message),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function tool(name, args) {
  const { body } = await rpc('tools/call', { name, arguments: args });
  const { content, isError } = body.result;
  return { isError, value: isError ? content[0].text : JSON.parse(content[0].text) };
}

test('initialize negotiates the protocol version and describes the server', async () => {
  const known = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(known.status, 200);
  assert.equal(known.body.result.protocolVersion, '2025-06-18');
  assert.deepEqual(known.body.result.capabilities, { tools: { listChanged: false } });
  assert.match(known.body.result.instructions, /get_summary/);

  const unknown = await rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(unknown.body.result.protocolVersion, '2025-11-25');

  const initialized = await rpc('notifications/initialized', undefined, { notification: true });
  assert.equal(initialized.status, 202);
  assert.equal(initialized.body, null);

  assert.deepEqual((await rpc('ping')).body.result, {});
});

test('tools/list exposes every tool with an object input schema', async () => {
  const { body } = await rpc('tools/list');
  const names = body.result.tools.map((t) => t.name);
  assert.deepEqual(names.sort(), [
    'create_group', 'create_test', 'delete_test', 'get_failing_tests', 'get_summary', 'get_test',
    'list_groups', 'list_results', 'list_tests', 'report_result', 'restore_test', 'update_test',
  ]);
  for (const t of body.result.tools) {
    assert.equal(t.inputSchema.type, 'object');
    assert.ok(t.description.length > 20);
    assert.equal(t.run, undefined);
  }
});

test('an agent can build a plan, report results and read them back', async () => {
  assert.equal((await tool('create_group', { id: 'api', description: 'API' })).isError, false);
  await tool('create_group', { id: 'api-auth', description: 'Auth', parentId: 'api' });
  const nested = await tool('create_group', { id: 'too-deep', description: 'x', parentId: 'api-auth' });
  assert.equal(nested.isError, true);
  assert.match(nested.value, /one level of nesting/);

  const created = await tool('create_test', {
    id: 'AUTH 1', groupId: 'api-auth', shortDescription: 'Login', fullDescription: 'Log in with a valid user.',
  });
  assert.equal(created.value.pageUrl, `${base}/tests/AUTH%201`);
  assert.equal((await tool('create_test', { id: 'AUTH 1', groupId: 'api', shortDescription: 'x' })).isError, true);

  const now = await tool('report_result', { testId: 'AUTH 1', status: 'pass' });
  assert.match(now.value.runAt, /Z$/);
  const failed = await tool('report_result', {
    testId: 'AUTH 1', status: 'fail', runAt: '2099-01-01T00:00:00+02:00', failureDescription: '401 Unauthorized',
  });
  assert.equal(failed.value.status, 'fail');

  const summary = await tool('get_summary', {});
  assert.deepEqual(summary.value.totals, { pass: 0, fail: 1, notRun: 0, total: 1 });
  assert.equal(summary.value.groups[0].subgroups[0].tests[0].status, 'fail');

  const failing = await tool('get_failing_tests', {});
  assert.equal(failing.value.length, 1);
  assert.equal(failing.value[0].failureDescription, '401 Unauthorized');

  const history = await tool('list_results', { testId: 'AUTH 1', limit: 1 });
  assert.equal(history.value.length, 1);
  assert.equal(history.value[0].status, 'fail');

  await tool('update_test', { id: 'AUTH 1', shortDescription: 'Login with password' });
  await tool('delete_test', { id: 'AUTH 1' });
  assert.equal((await tool('get_summary', {})).value.totals.total, 0);
  assert.equal((await tool('restore_test', { id: 'AUTH 1' })).value.deleted, false);
  const fetched = await tool('get_test', { id: 'AUTH 1' });
  assert.equal(fetched.value.shortDescription, 'Login with password');
  assert.equal(fetched.value.latestResult.status, 'fail');
});

test('protocol errors and transport rules', async () => {
  const unknownTool = await rpc('tools/call', { name: 'nope', arguments: {} });
  assert.equal(unknownTool.body.error.code, -32602);
  assert.equal((await rpc('resources/list')).body.error.code, -32601);

  const get = await fetch(`${base}/mcp`);
  assert.equal(get.status, 405);

  const garbled = await fetch(`${base}/mcp`, { method: 'POST', body: '{not json' });
  assert.equal(garbled.status, 400);
  assert.equal((await garbled.json()).error.code, -32700);

  const badVersion = await rpc('ping', undefined, { headers: { 'mcp-protocol-version': '1999-01-01' } });
  assert.equal(badVersion.status, 400);

  const foreign = await rpc('ping', undefined, { headers: { origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
  const local = await rpc('ping', undefined, { headers: { origin: 'http://localhost:5173' } });
  assert.equal(local.status, 200);
});
