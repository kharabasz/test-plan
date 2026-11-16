const now = () => new Date().toISOString();

const toGroup = (row) => row && {
  id: row.id,
  description: row.description,
  parentId: row.parent_id ?? null,
  createdAt: row.created_at,
};

const toTest = (row) => row && {
  id: row.id,
  groupId: row.group_id,
  shortDescription: row.short_description,
  fullDescription: row.full_description,
  deleted: row.deleted_at !== null,
  deletedAt: row.deleted_at ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
};

const toResult = (row) => row && {
  id: row.id,
  testId: row.test_id,
  runAt: row.run_at,
  status: row.status,
  failureDescription: row.failure_description ?? null,
  reportedAt: row.reported_at,
};

const emptyCounts = () => ({ pass: 0, fail: 0, notRun: 0, total: 0 });

function addCounts(target, source) {
  target.pass += source.pass;
  target.fail += source.fail;
  target.notRun += source.notRun;
  target.total += source.total;
}

function laterRun(a, b) {
  if (!a) return b;
  if (!b) return a;
  return b.runAtUtc > a.runAtUtc ? b : a;
}

export function createStore(db) {
  const sql = {
    groupById: db.prepare('SELECT * FROM test_groups WHERE id = ?'),
    groups: db.prepare('SELECT * FROM test_groups ORDER BY id'),
    insertGroup: db.prepare(
      'INSERT INTO test_groups (id, description, parent_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    testById: db.prepare('SELECT * FROM tests WHERE id = ?'),
    tests: db.prepare(`
      SELECT * FROM tests
      WHERE (:groupId IS NULL OR group_id = :groupId)
        AND (:includeDeleted = 1 OR deleted_at IS NULL)
      ORDER BY id`),
    insertTest: db.prepare(`
      INSERT INTO tests (id, group_id, short_description, full_description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    updateTest: db.prepare(`
      UPDATE tests
      SET short_description = ?, full_description = ?, updated_at = ?
      WHERE id = ?`),
    setDeleted: db.prepare('UPDATE tests SET deleted_at = ?, updated_at = ? WHERE id = ?'),
    insertResult: db.prepare(`
      INSERT INTO test_results (test_id, run_at, run_at_utc, status, failure_description, reported_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    resultById: db.prepare('SELECT * FROM test_results WHERE id = ?'),
    resultsForTest: db.prepare(`
      SELECT * FROM test_results WHERE test_id = ?
      ORDER BY run_at_utc DESC, id DESC`),
    resultsForTestLimited: db.prepare(`
      SELECT * FROM test_results WHERE test_id = ?
      ORDER BY run_at_utc DESC, id DESC LIMIT ?`),
    latestForTest: db.prepare(`
      SELECT * FROM test_results WHERE test_id = ?
      ORDER BY run_at_utc DESC, id DESC LIMIT 1`),
    latestPerActiveTest: db.prepare(`
      SELECT t.id, t.group_id, t.short_description,
             r.status, r.run_at, r.run_at_utc, r.failure_description
      FROM tests t
      LEFT JOIN test_results r ON r.id = (
        SELECT r2.id FROM test_results r2
        WHERE r2.test_id = t.id
        ORDER BY r2.run_at_utc DESC, r2.id DESC
        LIMIT 1)
      WHERE t.deleted_at IS NULL
      ORDER BY t.id`),
  };

  return {
    getGroup: (id) => toGroup(sql.groupById.get(id)),

    listGroups: () => sql.groups.all().map(toGroup),

    createGroup({ id, description, parentId }) {
      sql.insertGroup.run(id, description, parentId ?? null, now());
      return toGroup(sql.groupById.get(id));
    },

    getTest: (id) => toTest(sql.testById.get(id)),

    listTests: ({ groupId = null, includeDeleted = false } = {}) =>
      sql.tests.all({ groupId, includeDeleted: includeDeleted ? 1 : 0 }).map(toTest),

    createTest({ id, groupId, shortDescription, fullDescription }) {
      const at = now();
      sql.insertTest.run(id, groupId, shortDescription, fullDescription ?? '', at, at);
      return toTest(sql.testById.get(id));
    },

    updateTestDescriptions(id, { shortDescription, fullDescription }) {
      const current = sql.testById.get(id);
      sql.updateTest.run(
        shortDescription ?? current.short_description,
        fullDescription ?? current.full_description,
        now(),
        id,
      );
      return toTest(sql.testById.get(id));
    },

    setTestDeleted(id, deleted) {
      const current = sql.testById.get(id);
      const alreadyThere = (current.deleted_at !== null) === deleted;
      if (!alreadyThere) {
        const at = now();
        sql.setDeleted.run(deleted ? at : null, at, id);
      }
      return toTest(sql.testById.get(id));
    },

    appendResult({ testId, runAt, runAtUtc, status, failureDescription }) {
      const { lastInsertRowid } = sql.insertResult.run(
        testId, runAt, runAtUtc, status, failureDescription ?? null, now(),
      );
      return toResult(sql.resultById.get(lastInsertRowid));
    },

    listResults: (testId, limit) => (limit
      ? sql.resultsForTestLimited.all(testId, limit)
      : sql.resultsForTest.all(testId)).map(toResult),

    failingTests: () => sql.latestPerActiveTest.all()
      .filter((row) => row.status === 'fail')
      .map((row) => ({
        id: row.id,
        groupId: row.group_id,
        shortDescription: row.short_description,
        runAt: row.run_at,
        failureDescription: row.failure_description ?? null,
      })),

    latestResult: (testId) => toResult(sql.latestForTest.get(testId)),

    planSummary() {
      const groups = sql.groups.all().map(toGroup);
      const nodes = new Map(groups.map((g) => [g.id, {
        ...g, counts: emptyCounts(), lastRun: null, subgroups: [], tests: [],
      }]));

      for (const row of sql.latestPerActiveTest.all()) {
        const lastRun = row.status ? { runAt: row.run_at, runAtUtc: row.run_at_utc } : null;
        nodes.get(row.group_id).tests.push({
          id: row.id,
          shortDescription: row.short_description,
          status: row.status ?? null,
          lastRun,
        });
      }

      for (const node of nodes.values()) {
        for (const test of node.tests) {
          node.counts.total += 1;
          if (test.status === 'pass') node.counts.pass += 1;
          else if (test.status === 'fail') node.counts.fail += 1;
          else node.counts.notRun += 1;
          node.lastRun = laterRun(node.lastRun, test.lastRun);
        }
        if (node.parentId) nodes.get(node.parentId).subgroups.push(node);
      }

      const roots = [...nodes.values()].filter((n) => !n.parentId);
      const totals = emptyCounts();
      let lastRun = null;
      for (const root of roots) {
        for (const sub of root.subgroups) {
          addCounts(root.counts, sub.counts);
          root.lastRun = laterRun(root.lastRun, sub.lastRun);
        }
        addCounts(totals, root.counts);
        lastRun = laterRun(lastRun, root.lastRun);
      }

      return { totals, lastRun, groups: roots };
    },
  };
}
