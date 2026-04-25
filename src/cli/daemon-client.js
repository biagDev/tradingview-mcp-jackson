/**
 * Daemon client for the tv CLI.
 *
 * Provides callViaDaemon() — a drop-in transport that routes a core
 * module call through the running daemon socket instead of establishing
 * a fresh CDP connection.
 *
 * Falls back to direct import + call if:
 *   - The daemon socket does not exist
 *   - The daemon does not respond within CONNECT_TIMEOUT_MS
 *   - Any socket error occurs
 *
 * The fallback path is transparent — callers never need to know which
 * path was taken.
 */

import net from 'node:net';
import { existsSync } from 'node:fs';
import { SOCK_PATH } from './daemon.js';

const CONNECT_TIMEOUT_MS = 300;   // fast fail so CLI doesn't stall
const REQUEST_TIMEOUT_MS = 30000; // max time waiting for a response

let _idCounter = 1;

/**
 * Send a single JSON-RPC request to the daemon and return the result.
 * Throws if the daemon returns an error or times out.
 */
export function callDaemon(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!existsSync(SOCK_PATH)) {
      return reject(new Error('daemon_not_running'));
    }

    const socket = net.createConnection(SOCK_PATH);
    const id = _idCounter++;
    let buf = '';
    let settled = false;

    const done = (err, val) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err); else resolve(val);
    };

    const connectTimer = setTimeout(() => done(new Error('daemon_connect_timeout')), CONNECT_TIMEOUT_MS);
    const requestTimer = setTimeout(() => done(new Error('daemon_request_timeout')), REQUEST_TIMEOUT_MS);

    socket.on('connect', () => {
      clearTimeout(connectTimer);
      socket.write(JSON.stringify({ id, method, params }) + '\n');
    });

    socket.on('data', chunk => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== id) continue;
        clearTimeout(requestTimer);
        if ('error' in msg) done(new Error(msg.error));
        else done(null, msg.result);
      }
    });

    socket.on('error', e => { clearTimeout(connectTimer); clearTimeout(requestTimer); done(e); });
    socket.on('close', () => done(new Error('daemon_socket_closed_early')));
  });
}

/**
 * Call a core function either via the daemon (fast path) or by importing
 * the module directly (fallback). The method string uses the same
 * "module.function" format as the daemon protocol.
 *
 * Example:
 *   await callViaDaemon('chart.getState', {})
 *   await callViaDaemon('data.getOhlcv', { count: 20, summary: true })
 */
export async function callViaDaemon(method, params = {}) {
  // Fast path: daemon is running
  if (existsSync(SOCK_PATH)) {
    try {
      return await callDaemon(method, params);
    } catch (e) {
      if (!['daemon_not_running', 'daemon_connect_timeout', 'daemon_socket_closed_early'].includes(e.message)) {
        throw e; // Real error from the core function — don't swallow
      }
      // Daemon unreachable — fall through to direct path
    }
  }

  // Fallback: direct import + call (original stateless behaviour)
  const dot = method.indexOf('.');
  if (dot < 0) throw new Error(`Invalid method "${method}"`);
  const moduleName = method.slice(0, dot);
  const fnName     = method.slice(dot + 1);
  const mod = await import(`../core/${moduleName}.js`);
  const fn  = mod[fnName];
  if (typeof fn !== 'function') throw new Error(`"${method}" is not a function`);
  return fn(params);
}

/**
 * Check whether the daemon is currently running and reachable.
 * Returns { running: true, pid, uptime_s } or { running: false, reason }.
 */
export async function daemonStatus() {
  if (!existsSync(SOCK_PATH)) return { running: false, reason: 'socket_not_found' };
  try {
    const res = await callDaemon('daemon.status', {});
    return { running: true, ...res };
  } catch (e) {
    return { running: false, reason: e.message };
  }
}
