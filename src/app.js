import http from 'node:http';
import { openDatabase } from './db.js';
import { createStore } from './store.js';
import { createOperations } from './operations.js';
import { apiRoutes } from './api.js';
import { pageRoutes, errorPage } from './pages.js';
import { createMcpHandler, parseError, SUPPORTED_PROTOCOL_VERSIONS } from './mcp.js';
import {
  HttpError, readBody, readJson, sendJson, sendHtml, isAllowedOrigin,
} from './http.js';

const METHODS_WITH_BODY = new Set(['POST', 'PATCH', 'PUT']);

function decodeParams(groups = {}) {
  const params = {};
  for (const [key, value] of Object.entries(groups)) {
    try {
      params[key] = decodeURIComponent(value);
    } catch {
      throw new HttpError(400, `path segment '${value}' is not valid URL encoding`);
    }
  }
  return params;
}

export function createApp({ dbPath }) {
  const db = openDatabase(dbPath);
  const store = createStore(db);
  const ops = createOperations(store);
  const routes = [...apiRoutes(ops), ...pageRoutes(store)];
  const mcp = createMcpHandler(ops);

  async function handleMcp(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'the MCP endpoint takes POST only' }, { allow: 'POST' });
      return;
    }
    const version = req.headers['mcp-protocol-version'];
    if (version && !SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
      throw new HttpError(400, `MCP protocol version ${version} is not supported`);
    }
    const text = await readBody(req);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      sendJson(res, 400, parseError());
      return;
    }
    const response = mcp(message, { baseUrl: `http://${req.headers.host ?? 'localhost'}` });
    if (response === null) sendJson(res, 202);
    else sendJson(res, response.error?.code === -32600 ? 400 : 200, response);
  }

  async function handle(req, res) {
    if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
      throw new HttpError(403, 'requests from other origins are not allowed');
    }
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;

    if (path === '/mcp') {
      await handleMcp(req, res);
      return;
    }

    let pathMatched = false;
    for (const [method, pattern, handler] of routes) {
      const match = pattern.exec(path);
      if (!match) continue;
      pathMatched = true;
      if (method !== req.method) continue;
      const params = decodeParams(match.groups);
      const body = METHODS_WITH_BODY.has(req.method) ? await readJson(req) : {};
      const result = await handler({ params, body, query: url.searchParams });
      if (result.html !== undefined) sendHtml(res, result.status, result.html);
      else sendJson(res, result.status, result.json);
      return;
    }

    throw pathMatched
      ? new HttpError(405, `${req.method} is not allowed on ${path}`)
      : new HttpError(404, `nothing at ${path}`);
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : 'internal server error';
      if (status === 500) console.error(error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (req.url.startsWith('/api') || req.url.startsWith('/mcp')) {
        sendJson(res, status, { error: message });
      } else {
        sendHtml(res, status, errorPage(status, message));
      }
    }
  });

  server.on('close', () => db.close());
  return server;
}
