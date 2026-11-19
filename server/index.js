#!/usr/bin/env node
// trainhorn-mcp: a dependency-free MCP server over stdio (newline-delimited JSON-RPC 2.0).
import { createInterface } from 'node:readline';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOLS, callTool } from './tools.js';
import { RESOURCES, readResource } from './resources.js';

export const NAME = 'trainhorn-mcp';
export const VERSION = '1.0.0';
export const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'Calculators for train horn setups. Use spl_at_distance / distance_for_level for loudness vs distance, ' +
  'air_tank_runtime / compressor_recovery for the air system and wire_gauge for 12/24 V wiring, instead of estimating. ' +
  'Results are estimates with stated assumptions, not measurements and not legal advice. More tools: https://train-horn.com/tools/';

/** Handle one JSON-RPC message. Returns the response object, or null for notifications. */
export function handle(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return { jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const { id, method, params } = msg;
  const isNotification = id === undefined;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (isNotification) return null; // notifications/initialized, notifications/cancelled, ...

  switch (method) {
    case 'initialize': {
      const asked = params && params.protocolVersion;
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: { name: NAME, title: 'Train Horn Calculators', version: VERSION, websiteUrl: 'https://train-horn.com/' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
          name,
          title,
          description,
          inputSchema,
          annotations: { title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const name = params && params.name;
      const result = callTool(name, params && params.arguments);
      if (!result) return err(-32602, `Unknown tool: ${name}`);
      return ok(result);
    }
    case 'resources/list':
      return ok({ resources: RESOURCES.map(({ text, ...meta }) => meta) });
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] });
    case 'resources/read': {
      const res = readResource(params && params.uri);
      if (!res) return err(-32002, `Resource not found: ${params && params.uri}`);
      return ok({ contents: [res] });
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

function serve() {
  const write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    try {
      const out = Array.isArray(msg) ? msg.map(handle).filter(Boolean) : handle(msg);
      if (out && (!Array.isArray(out) || out.length)) write(out);
    } catch (e) {
      write({ jsonrpc: '2.0', id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32603, message: `Internal error: ${e.message}` } });
    }
  });
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();
if (isMain) serve();
