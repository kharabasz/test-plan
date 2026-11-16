import { HttpError } from './http.js';

class Raw {
  constructor(value) {
    this.value = value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(value) {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escape(String(value));
}

function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Raw(out);
}

const testHref = (testId) => `/tests/${encodeURIComponent(testId)}`;

const formatDateTime = (value) =>
  value ? value.replace('T', ' ').replace(/(Z|[+-]\d{2}:\d{2})$/i, ' $1') : '';

const STYLES = `
:root { --pass: #1a7f37; --pass-bg: #dafbe1; --fail: #cf222e; --fail-bg: #ffebe9;
  --muted: #59636e; --line: #d1d9e0; --head: #f6f8fa; --link: #0969da; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 1100px; padding: 24px 16px 64px; background: #fff; color: #1f2328;
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
h1 { font-size: 1.6rem; margin: 0 0 4px; }
h2 { font-size: 1.15rem; margin: 28px 0 8px; }
a { color: var(--link); }
code { font: 0.9em ui-monospace, SFMono-Regular, Consolas, monospace; background: var(--head);
  border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
.muted { color: var(--muted); }
.table { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.row { display: grid; gap: 12px; align-items: center; padding: 7px 12px; border-top: 1px solid var(--line);
  color: inherit; text-decoration: none; }
.table > .row:first-child { border-top: 0; }
.plan-table .row { grid-template-columns: minmax(0, 1fr) 70px 70px 70px 210px; }
.history-table .row { grid-template-columns: 260px 90px minmax(0, 1fr); }
.head { background: var(--head); font-weight: 600; font-size: 0.85rem; color: var(--muted); }
.total { background: var(--head); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.num.zero { color: #b0b7be; }
.num.pass:not(.zero) { color: var(--pass); font-weight: 600; }
.num.fail:not(.zero) { color: var(--fail); font-weight: 600; }
.name { min-width: 0; overflow-wrap: anywhere; }
summary { cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary .name::before { content: "\\25B8"; display: inline-block; width: 1.1em; color: var(--muted); }
details[open] > summary .name::before { content: "\\25BE"; }
summary:hover, a.row:hover { background: #f3f6f9; }
.group-0 > summary { font-weight: 600; }
.indent-1 { padding-left: calc(12px + 1.6em); }
.indent-2 { padding-left: calc(12px + 3.2em); }
.test-row .name, .empty .name { padding-left: 1.1em; }
.empty { color: var(--muted); font-style: italic; }
.badge { display: inline-block; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.03em;
  border-radius: 999px; padding: 1px 8px; }
.badge.pass { color: var(--pass); background: var(--pass-bg); }
.badge.fail { color: var(--fail); background: var(--fail-bg); }
.badge.not-run { color: var(--muted); background: var(--head); border: 1px solid var(--line); }
.badge.deleted { color: #fff; background: var(--muted); }
.cell-badge { text-align: right; }
.crumbs { margin: 0 0 16px; color: var(--muted); }
.plan { white-space: pre-wrap; border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px;
  background: var(--head); overflow-wrap: anywhere; }
dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0 0; }
dl.facts dt { color: var(--muted); }
dl.facts dd { margin: 0; }
.failure { margin: 0; padding: 10px 12px 12px 2.4em; border-top: 1px dashed var(--line);
  white-space: pre-wrap; overflow-wrap: anywhere; font: 0.85rem/1.5 ui-monospace, Consolas, monospace;
  background: #fffafa; }
.history-table .plain .name { padding-left: 1.1em; }
@media (max-width: 720px) {
  .plan-table .row { grid-template-columns: minmax(0, 1fr) 44px 44px 52px; }
  .plan-table .last-run { display: none; }
  .history-table .row { grid-template-columns: minmax(0, 1fr) 70px; }
  .history-table .reported { display: none; }
}
`;

function layout(title, body) {
  return render(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${new Raw(STYLES)}</style>
</head>
<body>
${body}
</body>
</html>
`);
}

const countCell = (value, kind) =>
  html`<span class="num ${kind}${value === 0 ? ' zero' : ''}">${value}</span>`;

const countCells = (counts, lastRun) => html`
  ${countCell(counts.pass, 'pass')}
  ${countCell(counts.fail, 'fail')}
  ${countCell(counts.notRun, 'not-run')}
  <span class="last-run muted">${formatDateTime(lastRun?.runAt)}</span>`;

const STATUS_COLUMN = { pass: 0, fail: 1, null: 2 };
const STATUS_LABEL = { pass: 'PASS', fail: 'FAIL', null: 'NOT RUN' };
const STATUS_CLASS = { pass: 'pass', fail: 'fail', null: 'not-run' };

function testRow(test, depth) {
  const column = STATUS_COLUMN[test.status];
  const cells = [0, 1, 2].map((i) => (i === column
    ? html`<span class="cell-badge"><span class="badge ${STATUS_CLASS[test.status]}">${STATUS_LABEL[test.status]}</span></span>`
    : html`<span></span>`));
  return html`
  <a class="row test-row indent-${depth}" href="${testHref(test.id)}">
    <span class="name"><code>${test.id}</code> ${test.shortDescription}</span>
    ${cells}
    <span class="last-run muted">${formatDateTime(test.lastRun?.runAt)}</span>
  </a>`;
}

function groupBlock(group, depth) {
  const children = [
    ...group.subgroups.map((sub) => groupBlock(sub, depth + 1)),
    ...group.tests.map((test) => testRow(test, depth + 1)),
  ];
  return html`
  <details class="group-${depth}">
    <summary class="row ${depth > 0 ? `indent-${depth}` : ''}">
      <span class="name"><code>${group.id}</code> ${group.description}</span>
      ${countCells(group.counts, group.lastRun)}
    </summary>
    ${children.length > 0
      ? children
      : html`<div class="row indent-${depth + 1} empty"><span class="name">No tests in this group yet.</span></div>`}
  </details>`;
}

function planPage(summary) {
  const { totals, lastRun, groups } = summary;
  return layout('Test plan', html`
<h1>Test plan</h1>
<p class="muted">Counts use only the latest result of each test. Deleted tests are not counted.
Expand a group to see its sub groups and tests, and open a test to see its plan and history.</p>
<div class="table plan-table">
  <div class="row head">
    <span>Group / test</span><span class="num">Pass</span><span class="num">Fail</span>
    <span class="num">Not run</span><span class="last-run">Last run</span>
  </div>
  <div class="row total">
    <span class="name">All tests (${totals.total})</span>
    ${countCells(totals, lastRun)}
  </div>
  ${groups.length > 0
    ? groups.map((group) => groupBlock(group, 0))
    : html`<div class="row empty"><span class="name">No test groups yet. Create one with POST /api/groups.</span></div>`}
</div>
`);
}

function historyRow(result) {
  const cells = html`
    <span class="name">${formatDateTime(result.runAt)}</span>
    <span><span class="badge ${result.status}">${result.status.toUpperCase()}</span></span>
    <span class="reported muted">reported ${formatDateTime(result.reportedAt)}</span>`;
  if (result.status !== 'fail') {
    return html`<div class="row plain">${cells}</div>`;
  }
  return html`
  <details>
    <summary class="row">${cells}</summary>
    <pre class="failure">${result.failureDescription || 'No failure description was reported.'}</pre>
  </details>`;
}

function testPage(test, groups, results) {
  const latest = results[0];
  const latestStatus = latest ? latest.status : null;
  return layout(`${test.id} · Test plan`, html`
<p class="crumbs"><a href="/">Test plan</a>
${groups.map((g) => html` › <code>${g.id}</code> ${g.description}`)}</p>
<h1><code>${test.id}</code> ${test.shortDescription}
${test.deleted ? html` <span class="badge deleted">DELETED</span>` : ''}</h1>
<dl class="facts">
  <dt>Latest status</dt>
  <dd><span class="badge ${STATUS_CLASS[latestStatus]}">${STATUS_LABEL[latestStatus]}</span>
    ${latest ? html`<span class="muted">at ${formatDateTime(latest.runAt)}</span>` : ''}</dd>
  <dt>Results</dt><dd>${results.length}</dd>
  <dt>Created</dt><dd>${formatDateTime(test.createdAt)}</dd>
  <dt>Updated</dt><dd>${formatDateTime(test.updatedAt)}</dd>
  ${test.deleted ? html`<dt>Deleted</dt><dd>${formatDateTime(test.deletedAt)}</dd>` : ''}
</dl>
<h2>Plan</h2>
${test.fullDescription
    ? html`<div class="plan">${test.fullDescription}</div>`
    : html`<p class="empty">No full description yet.</p>`}
<h2>History</h2>
<p class="muted">Newest run first. Expand a failed run to read its failure details.</p>
<div class="table history-table">
  <div class="row head"><span>Run at</span><span>Status</span><span class="reported">Reported</span></div>
  ${results.length > 0
    ? results.map(historyRow)
    : html`<div class="row empty"><span class="name">No results reported yet.</span></div>`}
</div>
`);
}

export function errorPage(status, message) {
  return layout(`${status} · Test plan`, html`
<p class="crumbs"><a href="/">Test plan</a></p>
<h1>${status}</h1>
<p>${message}</p>
`);
}

export function pageRoutes(store) {
  return [
    ['GET', /^\/$/, () => ({ status: 200, html: planPage(store.planSummary()) })],

    ['GET', /^\/tests\/(?<testId>[^/]+)$/, ({ params }) => {
      const test = store.getTest(params.testId);
      if (!test) throw new HttpError(404, `Test '${params.testId}' does not exist.`);
      const groups = [];
      let group = store.getGroup(test.groupId);
      while (group) {
        groups.unshift(group);
        group = group.parentId ? store.getGroup(group.parentId) : null;
      }
      return { status: 200, html: testPage(test, groups, store.listResults(test.id)) };
    }],
  ];
}
