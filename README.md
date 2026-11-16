# Test plan

A small local server that test harnesses report results into, and that agents can read and drive over MCP.

One Node.js process serves:

- **HTML pages** for people, with no JavaScript: a summary of pass, fail and not-run counts by group, and a page per test with its plan and history.
- **A REST API** for test harnesses.
- **An MCP endpoint** at `/mcp` for agents.

Data lives in SQLite. There are no npm dependencies; it uses Node 24's built-in `node:http` and `node:sqlite`. It is for local use and has no auth.

This repository is also a Claude Code plugin that connects Claude to the server and teaches it how to use it.

## Run the server

```bash
docker run -d --name test-plan --restart unless-stopped -p 127.0.0.1:3000:3000 -v test-plan-data:/data ghcr.io/kharabasz/test-plan:latest
```

Open http://localhost:3000. Data stays in the `test-plan-data` volume.

From a clone, `docker compose up -d --build` does the same with a locally built image, and `npm start` runs it without Docker (Node 24 or later, database at `./data/testplan.db`).

Settings are environment variables: `PORT` (default 3000), `HOST` (default 127.0.0.1, 0.0.0.0 in the container) and `DB_PATH`.

## Connect an agent

### Claude Code plugin

```
/plugin install test-plan --marketplace kharabasz/test-plan
```

Or from a shell:

```bash
claude plugin marketplace add kharabasz/test-plan
```

```bash
claude plugin install test-plan@test-plan
```

The plugin adds the `test-plan` MCP server and a `test-plan` skill that covers starting the server, the tools, and writing harness reporters. It connects to `http://localhost:3000/mcp`; set `TEST_PLAN_URL` before starting Claude Code to point it elsewhere.

### Any other MCP client

Point it at the Streamable HTTP endpoint `http://localhost:3000/mcp`. For Claude Code without the plugin:

```bash
claude mcp add --transport http test-plan http://localhost:3000/mcp
```

### MCP tools

| Tool | What it does |
|---|---|
| `get_summary` | Counts for the plan, each group, sub group and test, using each test's latest result |
| `get_failing_tests` | Tests whose latest result failed, with the failure text and page link |
| `list_groups`, `create_group` | Read and add groups |
| `list_tests`, `get_test`, `create_test`, `update_test` | Read, add and edit tests |
| `delete_test`, `restore_test` | Soft delete a test and undo it |
| `list_results` | A test's history, newest first |
| `report_result` | Append a pass or fail; `runAt` defaults to now |

The endpoint is stateless, answers with JSON (no SSE stream), and refuses requests whose `Origin` is not local.

## Model

- **Test group**: `id`, `description`, optional `parentId`. A group with a parent is a sub group, and a sub group cannot have sub groups of its own.
- **Test**: `id`, `groupId`, `shortDescription`, `fullDescription` (the plan). Tests can be soft deleted and restored. Deleted tests are left out of the counts but their pages and history stay.
- **Test result**: `testId`, `runAt`, `status` (`pass` or `fail`), optional `failureDescription`. Results are append only; nothing can change them and the database refuses updates and deletes.

`runAt` is an ISO 8601 date-time with an offset, such as `2026-11-16T09:30:00+01:00` or `2026-11-16T08:30:00Z`. It is stored and shown as sent. The latest result of a test is the one with the latest instant; on a tie, the one reported last wins.

## REST API

All bodies are JSON. Errors come back as `{ "error": "..." }` with a 4xx status.

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/health` | | `{ "ok": true }` |
| GET | `/api/summary` | | counts by group, sub group and test |
| GET | `/api/failing` | | tests whose latest result failed |
| GET | `/api/groups` | | all groups |
| POST | `/api/groups` | `{ id, description, parentId? }` | 201 group; 409 if the id exists; 400 if the parent is missing or is itself a sub group |
| GET | `/api/groups/{id}` | | group |
| GET | `/api/tests?groupId=&includeDeleted=true` | | tests, deleted ones only with `includeDeleted=true` |
| POST | `/api/tests` | `{ id, groupId, shortDescription, fullDescription? }` | 201 test; 409 if the id exists |
| GET | `/api/tests/{id}` | | test with `latestResult` |
| PATCH | `/api/tests/{id}` | `{ shortDescription?, fullDescription? }` | updated test |
| DELETE | `/api/tests/{id}` | | soft deletes, returns the test |
| POST | `/api/tests/{id}/restore` | | undeletes, returns the test |
| GET | `/api/tests/{id}/results?limit=` | | results, newest first |
| POST | `/api/results` | `{ testId, runAt, status, failureDescription? }` | 201 result |

Ids are free text up to 200 characters; URL-encode them in paths. A `failureDescription` is only accepted with `status: "fail"`. Results can be reported for a deleted test; they are kept but not counted while the test is deleted.

A harness that runs every time can create its groups and tests on each run and treat 409 as "already there".

```bash
curl -s -X POST localhost:3000/api/groups -H 'content-type: application/json' -d '{"id":"checkout","description":"Checkout"}'
```

```bash
curl -s -X POST localhost:3000/api/tests -H 'content-type: application/json' -d '{"id":"CO-001","groupId":"checkout","shortDescription":"Guest checkout","fullDescription":"1. Add an item\n2. Check out as a guest\nExpected: confirmation page"}'
```

```bash
curl -s -X POST localhost:3000/api/results -H 'content-type: application/json' -d '{"testId":"CO-001","runAt":"2026-11-16T09:30:00+01:00","status":"fail","failureDescription":"Got HTTP 502 from /api/orders"}'
```

## Pages

- `/` lists the top-level groups with pass, fail and not-run counts. Expand a group to see its sub groups and tests, and a sub group to see its tests.
- `/tests/{id}` shows a test's plan and history, newest first. Expand a failed run to read the failure description.

## Development

```bash
npm test
```

CI runs the tests and `claude plugin validate`, then publishes a multi-arch image to `ghcr.io/kharabasz/test-plan` from `main` (`latest`) and from `v*` tags.

## License

MIT
