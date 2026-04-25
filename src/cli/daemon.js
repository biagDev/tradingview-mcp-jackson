#!/usr/bin/env node
/**
 * tv daemon — persistent CDP connection holder for the tv CLI.
 *
 * The daemon holds a single live CDP connection to TradingView Desktop and
 * serves CLI tool requests over a local Unix socket (or TCP on Windows).
 * CLI commands that would normally spend 500–1500ms establishing a fresh
 * CDP connection instead round-trip to the daemon in ~5ms.
 *
 * Protocol: newline-delimited JSON-RPC over a socket stream.
 *   Request:  { id, method, params }
 *   Response: { id, result } | { id, error }
 *
 * Usage:
 *   tv daemon start   — start the daemon (forks, writes PID file)
 *   tv daemon stop    — stop the running daemon
 *   tv daemon status  — show whether the daemon is running
 *   tv daemon restart — stop + start
 *
 * Or run directly (foreground, for debugging):
 *   node src/cli/daemon.js --foreground
 */

import net from 'node:net';
import { createWriteStream, existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import * as connection from '../connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ─── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR  = join(homedir(), '.tradingview-mcp');
const SOCK_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\tradingview-mcp-daemon'
  : join(DATA_DIR, 'daemon.sock');
const PID_PATH  = join(DATA_DIR, 'daemon.pid');
const LOG_PATH  = join(DATA_DIR, 'daemon.log');

export { SOCK_PATH, PID_PATH };

// ─── Logger ───────────────────────────────────────────────────────────────────

function makeLogger(toFile = false) {
  if (!toFile) return (...a) => console.error('[daemon]', ...a);
  mkdirSync(DATA_DIR, { recursive: true });
  const stream = createWriteStream(LOG_PATH, { flags: 'a' });
  return (...a) => {
    const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
    stream.write(line);
  };
}

// ─── Core module dispatcher ──────────────────────────────────────────────────
// Maps JSON-RPC method names to the core module functions they invoke.
// Methods are registered lazily on first call to avoid loading all modules
// at startup (some have side effects like db init).

const methodCache = new Map();

async function resolveMethod(method) {
  if (methodCache.has(method)) return methodCache.get(method);

  // method format: "module.function", e.g. "chart.getState", "data.getQuote"
  const dot = method.indexOf('.');
  if (dot < 0) throw new Error(`Invalid method: "${method}". Expected "module.function".`);
  const moduleName = method.slice(0, dot);
  const fnName     = method.slice(dot + 1);

  const mod = await import(`../core/${moduleName}.js`).catch(() => {
    throw new Error(`Unknown module: "${moduleName}"`);
  });
  const fn = mod[fnName];
  if (typeof fn !== 'function') throw new Error(`"${moduleName}.${fnName}" is not a function`);

  methodCache.set(method, fn);
  return fn;
}

// ─── Request handler ─────────────────────────────────────────────────────────

async function handleRequest(req) {
  // Built-in daemon control methods
  if (req.method === 'daemon.ping')   return { pong: true, pid: process.pid };
  if (req.method === 'daemon.status') return { alive: true, pid: process.pid, uptime_s: Math.floor(process.uptime()) };
  if (req.method === 'daemon.stop')   { setTimeout(() => process.exit(0), 100); return { stopping: true }; }

  const fn = await resolveMethod(req.method);
  return fn(req.params ?? {});
}

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startServer({ foreground = false } = {}) {
  mkdirSync(DATA_DIR, { recursive: true });
  const log = makeLogger(!foreground);

  // Clean up stale socket
  if (process.platform !== 'win32' && existsSync(SOCK_PATH)) {
    try { unlinkSync(SOCK_PATH); } catch {}
  }

  // Pre-warm the CDP connection so the first real request is fast
  try {
    await connection.getClient();
    log('CDP connection established');
  } catch (e) {
    log(`CDP pre-warm failed (will retry on first request): ${e.message}`);
  }

  const server = net.createServer(socket => {
    let buf = '';
    socket.setEncoding('utf8');

    socket.on('data', chunk => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop(); // last element is incomplete line
      for (const line of lines) {
        if (!line.trim()) continue;
        let req;
        try { req = JSON.parse(line); } catch { continue; }
        handleRequest(req)
          .then(result  => socket.write(JSON.stringify({ id: req.id, result }) + '\n'))
          .catch(err    => socket.write(JSON.stringify({ id: req.id, error: err.message }) + '\n'));
      }
    });

    socket.on('error', () => {});
  });

  server.listen(SOCK_PATH, () => {
    log(`Listening on ${SOCK_PATH} (pid ${process.pid})`);
    if (!foreground) {
      writeFileSync(PID_PATH, String(process.pid));
      // Detach stdio so the parent can exit
      process.stdin.destroy();
    }
  });

  server.on('error', e => { log(`Server error: ${e.message}`); process.exit(1); });

  // Graceful shutdown
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      log(`Received ${sig}, shutting down`);
      server.close();
      if (existsSync(PID_PATH)) try { unlinkSync(PID_PATH); } catch {}
      if (process.platform !== 'win32' && existsSync(SOCK_PATH)) try { unlinkSync(SOCK_PATH); } catch {}
      process.exit(0);
    });
  }

  return server;
}

// ─── CLI entry-point (called by "tv daemon start" directly) ──────────────────

const isForeground = process.argv.includes('--foreground');
if (process.argv[1] === __filename) {
  startServer({ foreground: isForeground }).catch(e => {
    console.error('[daemon] Fatal:', e.message);
    process.exit(1);
  });
}
