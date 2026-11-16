import { HttpError } from './http.js';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'test-plan', title: 'Test plan', version: '0.1.0' };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const idSchema = (description) => ({ type: 'string', minLength: 1, maxLength: 200, description });
const object = (properties = {}, required = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const READ = { readOnlyHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const TOGGLE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const withPage = (baseUrl, testId, value) => ({
  ...value, pageUrl: `${baseUrl}/tests/${encodeURIComponent(testId)}`,
});

const TOOLS = [
  {
    name: 'get_summary',
    title: 'Test plan summary',
    description: 'Pass, fail and not-run counts for the whole plan, each top-level group, each sub group and each test, using only the latest result of every test. Deleted tests are left out. Start here to see the state of the plan.',
    inputSchema: object(),
    annotations: READ,
    run: (ops) => ops.summary(),
  },
  {
    name: 'get_failing_tests',
    title: 'Failing tests',
    description: 'Tests whose latest result is a fail, with the failure description and a link to each test page. Use this to see what is broken right now.',
    inputSchema: object(),
    annotations: READ,
    run: (ops, args, baseUrl) => ops.failingTests().map((t) => withPage(baseUrl, t.id, t)),
  },
  {
    name: 'list_groups',
    title: 'List test groups',
    description: 'All test groups. A group with a parentId is a sub group; sub groups cannot have sub groups.',
    inputSchema: object(),
    annotations: READ,
    run: (ops) => ops.listGroups(),
  },
  {
    name: 'create_group',
    title: 'Create a test group',
    description: 'Create a test group, optionally as a sub group of a top-level group. Fails if the id already exists, which you can treat as already created.',
    inputSchema: object({
      id: idSchema('Group id, for example "checkout" or "checkout-payments".'),
      description: { type: 'string', minLength: 1, maxLength: 500, description: 'Readable group name.' },
      parentId: idSchema('Id of a top-level group to nest this group under. Omit for a top-level group.'),
    }, ['id', 'description']),
    annotations: WRITE,
    run: (ops, args) => ops.createGroup(args),
  },
  {
    name: 'list_tests',
    title: 'List tests',
    description: 'Tests in the plan, optionally only those directly in one group. Deleted tests are left out unless includeDeleted is true.',
    inputSchema: object({
      groupId: idSchema('Only return tests directly in this group.'),
      includeDeleted: { type: 'boolean', description: 'Also return soft-deleted tests.' },
    }),
    annotations: READ,
    run: (ops, args) => ops.listTests(args),
  },
  {
    name: 'get_test',
    title: 'Get a test',
    description: 'One test with its short description, full description (the plan), deleted flag and latest result.',
    inputSchema: object({ id: idSchema('Test id.') }, ['id']),
    annotations: READ,
    run: (ops, args, baseUrl) => withPage(baseUrl, args.id, ops.getTest(args)),
  },
  {
    name: 'create_test',
    title: 'Create a test',
    description: 'Create a test in a group. fullDescription holds the test plan: steps, data and expected outcome. Fails if the id already exists, which you can treat as already created.',
    inputSchema: object({
      id: idSchema('Test id, for example "PAY-001".'),
      groupId: idSchema('Group the test belongs to. It must exist.'),
      shortDescription: { type: 'string', minLength: 1, maxLength: 500, description: 'One-line name shown in the summary.' },
      fullDescription: { type: 'string', maxLength: 200000, description: 'The test plan. Plain text; line breaks are kept.' },
    }, ['id', 'groupId', 'shortDescription']),
    annotations: WRITE,
    run: (ops, args, baseUrl) => withPage(baseUrl, args.id, ops.createTest(args)),
  },
  {
    name: 'update_test',
    title: 'Edit test descriptions',
    description: 'Change the short description, the full description or both. Only these two fields can be edited.',
    inputSchema: object({
      id: idSchema('Test id.'),
      shortDescription: { type: 'string', minLength: 1, maxLength: 500 },
      fullDescription: { type: 'string', maxLength: 200000 },
    }, ['id']),
    annotations: TOGGLE,
    run: (ops, args) => ops.updateTest(args),
  },
  {
    name: 'delete_test',
    title: 'Soft delete a test',
    description: 'Soft delete a test. It leaves the counts, but its history is kept and restore_test brings it back.',
    inputSchema: object({ id: idSchema('Test id.') }, ['id']),
    annotations: TOGGLE,
    run: (ops, args) => ops.deleteTest(args),
  },
  {
    name: 'restore_test',
    title: 'Restore a deleted test',
    description: 'Undo a soft delete so the test counts again.',
    inputSchema: object({ id: idSchema('Test id.') }, ['id']),
    annotations: TOGGLE,
    run: (ops, args) => ops.restoreTest(args),
  },
  {
    name: 'list_results',
    title: 'Test history',
    description: 'Results of one test, newest run first, including failure descriptions.',
    inputSchema: object({
      testId: idSchema('Test id.'),
      limit: { type: 'integer', minimum: 1, description: 'Return at most this many results.' },
    }, ['testId']),
    annotations: READ,
    run: (ops, args) => ops.listResults(args),
  },
  {
    name: 'report_result',
    title: 'Report a test result',
    description: 'Append a pass or fail result to a test. Results are append only and cannot be changed later. runAt defaults to now.',
    inputSchema: object({
      testId: idSchema('Test id. The test must exist.'),
      status: { type: 'string', enum: ['pass', 'fail'] },
      runAt: { type: 'string', description: 'When the test ran, ISO 8601 with an offset, for example 2026-11-16T09:30:00+01:00. Defaults to now.' },
      failureDescription: { type: 'string', maxLength: 200000, description: 'What went wrong. Only allowed when status is fail.' },
    }, ['testId', 'status']),
    annotations: WRITE,
    run: (ops, args, baseUrl) => withPage(
      baseUrl,
      args.testId,
      ops.reportResult({ ...args, runAt: args.runAt ?? new Date().toISOString() }),
    ),
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));
const TOOL_LIST = TOOLS.map(({ run, ...tool }) => tool);

const instructions = (baseUrl) => `Test plan keeps test groups (one level of sub groups), tests (an id, a short description and a full description that holds the plan) and append-only pass/fail results.
Counts use only each test's latest result; deleted tests are not counted.
Start with get_summary or get_failing_tests. Create a group before its tests and a test before its results; create_group and create_test fail when the id exists, which means it is already there.
People read the plan at ${baseUrl}/ and each test at ${baseUrl}/tests/<id>; link those pages when you report back.`;

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export function parseError() {
  return failure(null, PARSE_ERROR, 'request body is not valid JSON');
}

export function createMcpHandler(ops) {
  function callTool(id, params, baseUrl) {
    const tool = TOOLS_BY_NAME.get(params?.name);
    if (!tool) return failure(id, INVALID_PARAMS, `unknown tool '${params?.name}'`);
    const args = params.arguments ?? {};
    if (typeof args !== 'object' || Array.isArray(args)) {
      return failure(id, INVALID_PARAMS, 'arguments must be an object');
    }
    try {
      const value = tool.run(ops, args, baseUrl);
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: false });
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      const message = error instanceof HttpError ? error.message : 'internal error';
      return reply(id, { content: [{ type: 'text', text: message }], isError: true });
    }
  }

  return function handle(message, { baseUrl }) {
    if (Array.isArray(message)) return failure(null, INVALID_REQUEST, 'batch requests are not supported');
    if (message === null || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      return failure(null, INVALID_REQUEST, 'expected a JSON-RPC 2.0 message');
    }
    if (typeof message.method !== 'string') return null;
    if (message.id === undefined || message.id === null) return null;

    const { id, method, params } = message;
    switch (method) {
      case 'initialize': {
        const requested = params?.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return reply(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: instructions(baseUrl),
        });
      }
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOL_LIST });
      case 'tools/call':
        return callTool(id, params, baseUrl);
      default:
        return failure(id, METHOD_NOT_FOUND, `method '${method}' is not supported`);
    }
  };
}
