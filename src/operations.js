import { HttpError } from './http.js';

const ID_MAX = 200;
const DESCRIPTION_MAX = 500;
const LONG_TEXT_MAX = 200_000;
const OFFSET_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/i;

function field(input, name, { required, max, allowEmpty = false }) {
  const value = input[name];
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${name} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed === '') throw new HttpError(400, `${name} must not be empty`);
  if (trimmed.length > max) throw new HttpError(400, `${name} must be at most ${max} characters`);
  return trimmed;
}

const id = (input, name, required = true) => field(input, name, { required, max: ID_MAX });
const description = (input, name, required = true) =>
  field(input, name, { required, max: DESCRIPTION_MAX });
const longText = (input, name) =>
  field(input, name, { required: false, max: LONG_TEXT_MAX, allowEmpty: true });

export function parseRunAt(value) {
  const invalid = () => new HttpError(
    400,
    'runAt must be an ISO 8601 date-time with an offset, such as 2026-11-16T09:30:00+01:00 or 2026-11-16T08:30:00Z',
  );
  if (typeof value !== 'string') throw invalid();
  const runAt = value.trim();
  const match = OFFSET_DATETIME.exec(runAt);
  const parsed = new Date(runAt);
  if (!match || Number.isNaN(parsed.getTime())) throw invalid();
  const [, year, month, day, , , , offsetHours, offsetMinutes] = match;
  const calendarDay = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendarDay.getUTCMonth() !== Number(month) - 1 || calendarDay.getUTCDate() !== Number(day)) {
    throw invalid();
  }
  if (offsetHours !== undefined && (Number(offsetHours) > 14 || Number(offsetMinutes) > 59)) {
    throw invalid();
  }
  return { runAt, runAtUtc: parsed.toISOString() };
}

function optionalLimit(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new HttpError(400, 'limit must be a positive integer');
  return limit;
}

export function createOperations(store) {
  const requireTest = (testId) => {
    const test = store.getTest(testId);
    if (!test) throw new HttpError(404, `test '${testId}' does not exist`);
    return test;
  };

  return {
    summary: () => store.planSummary(),

    failingTests: () => store.failingTests(),

    listGroups: () => store.listGroups(),

    getGroup(input) {
      const groupId = id(input, 'id');
      const group = store.getGroup(groupId);
      if (!group) throw new HttpError(404, `group '${groupId}' does not exist`);
      return group;
    },

    createGroup(input) {
      const groupId = id(input, 'id');
      const groupDescription = description(input, 'description');
      const parentId = id(input, 'parentId', false);
      if (store.getGroup(groupId)) throw new HttpError(409, `group '${groupId}' already exists`);
      if (parentId !== undefined) {
        const parent = store.getGroup(parentId);
        if (!parent) throw new HttpError(400, `parent group '${parentId}' does not exist`);
        if (parent.parentId) {
          throw new HttpError(
            400,
            `group '${parentId}' is already a sub group; only one level of nesting is allowed`,
          );
        }
      }
      return store.createGroup({ id: groupId, description: groupDescription, parentId });
    },

    listTests(input) {
      const groupId = id(input, 'groupId', false);
      return store.listTests({ groupId: groupId ?? null, includeDeleted: input.includeDeleted === true });
    },

    getTest(input) {
      const test = requireTest(id(input, 'id'));
      return { ...test, latestResult: store.latestResult(test.id) ?? null };
    },

    createTest(input) {
      const testId = id(input, 'id');
      const groupId = id(input, 'groupId');
      const shortDescription = description(input, 'shortDescription');
      const fullDescription = longText(input, 'fullDescription');
      if (store.getTest(testId)) throw new HttpError(409, `test '${testId}' already exists`);
      if (!store.getGroup(groupId)) throw new HttpError(400, `group '${groupId}' does not exist`);
      return store.createTest({ id: testId, groupId, shortDescription, fullDescription });
    },

    updateTest(input) {
      const testId = id(input, 'id');
      requireTest(testId);
      const unknown = Object.keys(input).filter(
        (key) => !['id', 'shortDescription', 'fullDescription'].includes(key),
      );
      if (unknown.length > 0) {
        throw new HttpError(
          400,
          `only shortDescription and fullDescription can be edited (got ${unknown.join(', ')})`,
        );
      }
      const shortDescription = description(input, 'shortDescription', false);
      const fullDescription = longText(input, 'fullDescription');
      if (shortDescription === undefined && fullDescription === undefined) {
        throw new HttpError(400, 'send shortDescription, fullDescription or both');
      }
      return store.updateTestDescriptions(testId, { shortDescription, fullDescription });
    },

    deleteTest(input) {
      const testId = id(input, 'id');
      requireTest(testId);
      return store.setTestDeleted(testId, true);
    },

    restoreTest(input) {
      const testId = id(input, 'id');
      requireTest(testId);
      return store.setTestDeleted(testId, false);
    },

    listResults(input) {
      const testId = id(input, 'testId');
      requireTest(testId);
      return store.listResults(testId, optionalLimit(input.limit));
    },

    reportResult(input) {
      const testId = id(input, 'testId');
      const { runAt, runAtUtc } = parseRunAt(input.runAt);
      const status = input.status;
      if (status !== 'pass' && status !== 'fail') {
        throw new HttpError(400, "status must be 'pass' or 'fail'");
      }
      const failureDescription = longText(input, 'failureDescription');
      if (status === 'pass' && failureDescription) {
        throw new HttpError(400, 'failureDescription is only allowed when status is fail');
      }
      if (!store.getTest(testId)) throw new HttpError(400, `test '${testId}' does not exist`);
      return store.appendResult({
        testId, runAt, runAtUtc, status, failureDescription: failureDescription || null,
      });
    },
  };
}
