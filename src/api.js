const ok = (json) => ({ status: 200, json });
const created = (json) => ({ status: 201, json });

export function apiRoutes(ops) {
  return [
    ['GET', /^\/api\/health$/, () => ok({ ok: true })],

    ['GET', /^\/api\/summary$/, () => ok(ops.summary())],

    ['GET', /^\/api\/failing$/, () => ok(ops.failingTests())],

    ['GET', /^\/api\/groups$/, () => ok(ops.listGroups())],

    ['POST', /^\/api\/groups$/, ({ body }) => created(ops.createGroup(body))],

    ['GET', /^\/api\/groups\/(?<id>[^/]+)$/, ({ params }) => ok(ops.getGroup(params))],

    ['GET', /^\/api\/tests$/, ({ query }) => ok(ops.listTests({
      groupId: query.get('groupId') || undefined,
      includeDeleted: query.get('includeDeleted') === 'true',
    }))],

    ['POST', /^\/api\/tests$/, ({ body }) => created(ops.createTest(body))],

    ['GET', /^\/api\/tests\/(?<id>[^/]+)$/, ({ params }) => ok(ops.getTest(params))],

    ['PATCH', /^\/api\/tests\/(?<id>[^/]+)$/, ({ params, body }) =>
      ok(ops.updateTest({ ...body, id: params.id }))],

    ['DELETE', /^\/api\/tests\/(?<id>[^/]+)$/, ({ params }) => ok(ops.deleteTest(params))],

    ['POST', /^\/api\/tests\/(?<id>[^/]+)\/restore$/, ({ params }) => ok(ops.restoreTest(params))],

    ['GET', /^\/api\/tests\/(?<id>[^/]+)\/results$/, ({ params, query }) =>
      ok(ops.listResults({ testId: params.id, limit: query.get('limit') ?? undefined }))],

    ['POST', /^\/api\/results$/, ({ body }) => created(ops.reportResult(body))],
  ];
}
