---
name: test-plan
description: Work with the local test plan server, which holds test groups, tests with their written plans, and append-only pass/fail results. Use when asked what is passing or failing, to add or edit tests in the plan, to record test results, to start the test plan server, or to make a test harness report its results into the plan.
---

# Test plan

The test plan server keeps:

- **Groups**: an id and a description. A top-level group can have sub groups; a sub group cannot have its own.
- **Tests**: an id, a group, a short description (one line, shown in the summary) and a full description (the plan: steps, data, expected outcome).
- **Results**: pass or fail, when the test ran, and an optional failure description. Results are append only.

Counts use only the latest result of each test. Soft-deleted tests are not counted.

## Check the server is up

The `test-plan` MCP server in this plugin talks to `http://localhost:3000/mcp`, or to `$TEST_PLAN_URL/mcp` when that variable is set before Claude Code starts. If its tools fail to connect, check the server:

```bash
curl -s http://localhost:3000/api/health
```

If nothing answers, start it, then run `/mcp` to reconnect:

```bash
docker run -d --name test-plan --restart unless-stopped -p 127.0.0.1:3000:3000 -v test-plan-data:/data ghcr.io/kharabasz/test-plan:latest
```

Ask the user before starting a container. If one named `test-plan` already exists, start it with `docker start test-plan` instead.

## Use the MCP tools

- `get_summary`: counts for the whole plan, every group, sub group and test. Start here.
- `get_failing_tests`: tests whose latest result failed, with the failure text and page link.
- `list_groups`, `list_tests`, `get_test`, `list_results`: read the plan and a test's history.
- `create_group`, `create_test`, `update_test`: build and edit the plan. Create a group before its tests. An "already exists" error means it is there; carry on.
- `delete_test`, `restore_test`: soft delete and undo.
- `report_result`: append a pass or fail. `runAt` defaults to now.

When you report back to the user, link the pages: `http://localhost:3000/` for the summary and the `pageUrl` the tools return for a test.

Results cannot be changed or removed. Before reporting results the user did not ask for, confirm with them, because a wrong result stays in the history.

## Make a test harness report results

Harness code calls the REST API, not MCP. All bodies are JSON.

| Method | Path | Body |
|---|---|---|
| POST | `/api/groups` | `{ id, description, parentId? }` |
| POST | `/api/tests` | `{ id, groupId, shortDescription, fullDescription? }` |
| PATCH | `/api/tests/{id}` | `{ shortDescription?, fullDescription? }` |
| DELETE | `/api/tests/{id}` | soft delete |
| POST | `/api/tests/{id}/restore` | undo the soft delete |
| POST | `/api/results` | `{ testId, runAt, status, failureDescription? }` |
| GET | `/api/summary`, `/api/failing`, `/api/tests/{id}/results` | reads |

Rules a reporter must follow:

- `runAt` is required over REST and must carry an offset: `2026-11-16T09:30:00+01:00` or `2026-11-16T08:30:00Z`. Use the time the test started.
- `status` is `pass` or `fail`. `failureDescription` is only accepted with `fail`.
- Creating a group or test that exists returns 409. A reporter can create its groups and tests on every run and treat 409 as fine.
- URL-encode ids in paths.
- Read the base URL from an environment variable such as `TEST_PLAN_URL`, defaulting to `http://localhost:3000`, and never fail the test run because the server is down: log and carry on.

A minimal reporter in Node:

```js
const base = process.env.TEST_PLAN_URL ?? 'http://localhost:3000';

export async function report(testId, startedAt, error) {
  const body = error
    ? { testId, runAt: startedAt.toISOString(), status: 'fail', failureDescription: String(error.stack ?? error) }
    : { testId, runAt: startedAt.toISOString(), status: 'pass' };
  try {
    const res = await fetch(`${base}/api/results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`test plan rejected ${testId}: ${res.status} ${await res.text()}`);
  } catch (e) {
    console.warn(`test plan unreachable: ${e.message}`);
  }
}
```

Hook it into the framework's after-each or reporter API, and map each test to a stable id that matches a test in the plan.
