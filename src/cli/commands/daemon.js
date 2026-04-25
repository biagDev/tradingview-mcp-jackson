/**
 * tv daemon — manage the persistent CDP connection daemon.
 *
 * Commands:
 *   tv daemon start    — start the daemon in the background
 *   tv daemon stop     — stop the running daemon
 *   tv daemon status   — show daemon state, uptime, PID
 *   tv daemon restart  — stop + start
 *   tv daemon run      — run daemon in the foreground (debugging)
 */
import { register } from '../router.js';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { callDaemon, daemonStatus } from '../daemon-client.js';
import { SOCK_PATH, PID_PATH } from '../daemon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = join(__dirname, '../daemon.js');

async function startDaemon() {
  const status = await daemonStatus();
  if (status.running) {
    return { success: false, reason: 'already_running', pid: status.pid, uptime_s: status.uptime_s };
  }

  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait up to 3 seconds for the socket to appear
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));
    if (existsSync(SOCK_PATH)) {
      // Give the daemon a moment to finish CDP pre-warm
      await new Promise(r => setTimeout(r, 300));
      const check = await daemonStatus();
      if (check.running) return { success: true, pid: check.pid, socket: SOCK_PATH };
    }
  }

  return { success: false, reason: 'daemon_did_not_start_within_3s', socket: SOCK_PATH };
}

async function stopDaemon() {
  const status = await daemonStatus();
  if (!status.running) return { success: false, reason: 'not_running' };
  try {
    await callDaemon('daemon.stop', {});
  } catch { /* expected — socket closes */ }
  await new Promise(r => setTimeout(r, 500));
  const after = await daemonStatus();
  return { success: !after.running, was_pid: status.pid };
}

register('daemon', {
  description: 'Manage the persistent CDP connection daemon (speeds up CLI)',
  subcommands: new Map([

    ['start', {
      description: 'Start the daemon in the background',
      handler: () => startDaemon(),
    }],

    ['stop', {
      description: 'Stop the running daemon',
      handler: () => stopDaemon(),
    }],

    ['status', {
      description: 'Show daemon state, PID, and uptime',
      handler: async () => {
        const s = await daemonStatus();
        let pid_from_file = null;
        if (existsSync(PID_PATH)) {
          try { pid_from_file = parseInt(readFileSync(PID_PATH, 'utf8').trim(), 10); } catch {}
        }
        return { ...s, socket_path: SOCK_PATH, pid_file: PID_PATH, pid_from_file };
      },
    }],

    ['restart', {
      description: 'Stop then start the daemon',
      handler: async () => {
        const stopped = await stopDaemon();
        await new Promise(r => setTimeout(r, 300));
        const started = await startDaemon();
        return { stopped, started };
      },
    }],

    ['run', {
      description: 'Run the daemon in the foreground (useful for debugging)',
      handler: async () => {
        // Import and run inline so output goes to terminal
        const { startServer } = await import('../daemon.js');
        await startServer({ foreground: true });
        // Block forever (daemon runs until killed)
        await new Promise(() => {});
      },
    }],

  ]),
});
