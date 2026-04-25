/**
 * CLI commands for Stage 1B — NQ Report Scheduler.
 *
 * Usage:
 *   tv scheduler install    — add crontab entries for 09:00 and 16:05 ET
 *   tv scheduler uninstall  — remove those crontab entries
 *   tv scheduler status     — show install state + next scheduled run times
 *   tv scheduler run        — run a report immediately (ignores trading-day check)
 *     tv scheduler run premarket
 *     tv scheduler run postclose
 */

import { register } from '../router.js';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { isTradingDay, todayET, nextTradingDay } from '../../scheduler/calendar.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const SCHEDULER_DIR = join(__dir, '..', '..', 'scheduler');
const PREMARKET_SCRIPT = join(SCHEDULER_DIR, 'premarket-run.js');
const POSTCLOSE_SCRIPT = join(SCHEDULER_DIR, 'postclose-run.js');
const NODE_BIN = process.execPath;
const LOG_FILE = join(homedir(), '.tradingview-mcp', 'logs', 'scheduler.log');

// Marker comment used to identify our crontab entries
const CRON_MARKER = '# tradingview-mcp-scheduler';

// ─── Cron Helpers ─────────────────────────────────────────────────────────────

function readCrontab() {
  try {
    return execSync('crontab -l 2>/dev/null', { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function writeCrontab(content) {
  // pipe the new crontab via echo | crontab -
  execSync(`echo ${JSON.stringify(content)} | crontab -`, { shell: true });
}

function buildCronLines() {
  // TZ header + env vars + two entries. Using cron TZ directive (supported on macOS & most Linux).
  // DISPLAY is set so TradingView can auto-launch on headless Linux servers (Xvfb :1).
  const display = process.env.DISPLAY || ':1';
  return [
    `TZ=America/New_York ${CRON_MARKER}`,
    `DISPLAY=${display} ${CRON_MARKER}`,
    `0 9 * * 1-5 "${NODE_BIN}" "${PREMARKET_SCRIPT}" >> "${LOG_FILE}" 2>&1 ${CRON_MARKER}`,
    `5 16 * * 1-5 "${NODE_BIN}" "${POSTCLOSE_SCRIPT}" >> "${LOG_FILE}" 2>&1 ${CRON_MARKER}`,
  ];
}

function isInstalled(crontab) {
  return crontab.includes(CRON_MARKER);
}

function installCron() {
  const existing = readCrontab();
  if (isInstalled(existing)) {
    // remove old entries first so we don't duplicate
    const cleaned = existing
      .split('\n')
      .filter(line => !line.includes(CRON_MARKER))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
    writeCrontab(cleaned.trim() + '\n');
  }

  const current = readCrontab();
  const newLines = buildCronLines().join('\n');
  const updated = (current.trim() ? current.trim() + '\n\n' : '') + newLines + '\n';
  writeCrontab(updated);
}

function uninstallCron() {
  const existing = readCrontab();
  const cleaned = existing
    .split('\n')
    .filter(line => !line.includes(CRON_MARKER))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  writeCrontab(cleaned ? cleaned + '\n' : '');
}

// ─── Next-run helpers ─────────────────────────────────────────────────────────

function nextRunInfo() {
  const today = todayET();
  const isTradingToday = isTradingDay(today);

  const now = new Date();
  const etHour = parseInt(
    now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }),
    10,
  );
  const etMin = parseInt(
    now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }),
    10,
  );
  const etMinuteOfDay = etHour * 60 + etMin;

  const PREMARKET_MIN  = 9 * 60;       // 09:00
  const POSTCLOSE_MIN  = 16 * 60 + 5;  // 16:05

  let nextPremarket, nextPostclose;

  if (isTradingToday && etMinuteOfDay < PREMARKET_MIN) {
    nextPremarket = `${today} 09:00 ET (today)`;
  } else {
    const next = nextTradingDay(today);
    nextPremarket = next ? `${next} 09:00 ET` : 'unknown';
  }

  if (isTradingToday && etMinuteOfDay < POSTCLOSE_MIN) {
    nextPostclose = `${today} 16:05 ET (today)`;
  } else {
    const next = nextTradingDay(today);
    nextPostclose = next ? `${next} 16:05 ET` : 'unknown';
  }

  return { nextPremarket, nextPostclose };
}

// ─── Register Commands ────────────────────────────────────────────────────────

register('scheduler', {
  description: 'Manage automated NQ premarket and post-close report scheduling via cron',
  subcommands: new Map([

    // ── install ────────────────────────────────────────────────────────────
    ['install', {
      description: 'Install crontab entries to auto-run premarket (09:00 ET) and post-close (16:05 ET) reports on trading days',
      options: {},
      handler: async () => {
        installCron();
        const { nextPremarket, nextPostclose } = nextRunInfo();
        return {
          success: true,
          message: 'Scheduler installed',
          entries: buildCronLines(),
          next_premarket: nextPremarket,
          next_postclose: nextPostclose,
          log_file: LOG_FILE,
          note: 'Reports run automatically Mon–Fri on NYSE trading days. TV must be running (it auto-launches if not).',
        };
      },
    }],

    // ── uninstall ──────────────────────────────────────────────────────────
    ['uninstall', {
      description: 'Remove the tradingview-mcp crontab entries',
      options: {},
      handler: async () => {
        const wasThere = isInstalled(readCrontab());
        uninstallCron();
        return {
          success: true,
          message: wasThere
            ? 'Scheduler removed from crontab'
            : 'No scheduler entries found in crontab (nothing to remove)',
        };
      },
    }],

    // ── status ─────────────────────────────────────────────────────────────
    ['status', {
      description: 'Show scheduler install state, cron entries, and next scheduled run times',
      options: {},
      handler: async () => {
        const crontab = readCrontab();
        const installed = isInstalled(crontab);
        const today = todayET();
        const { nextPremarket, nextPostclose } = nextRunInfo();

        const schedulerLines = crontab
          .split('\n')
          .filter(l => l.includes(CRON_MARKER));

        return {
          installed,
          today,
          is_trading_day: isTradingDay(today),
          next_premarket: nextPremarket,
          next_postclose: nextPostclose,
          log_file: LOG_FILE,
          node_binary: NODE_BIN,
          cron_entries: schedulerLines,
        };
      },
    }],

    // ── run ────────────────────────────────────────────────────────────────
    ['run', {
      description: 'Run a report immediately. Subcommand: premarket | postclose',
      options: {
        type: {
          type: 'string',
          short: 't',
          description: 'Report type: premarket | postclose',
        },
        force: {
          type: 'boolean',
          short: 'f',
          description: 'Run even if today is not a trading day',
        },
      },
      handler: async ({ type, force }) => {
        if (!type || !['premarket', 'postclose'].includes(type)) {
          throw new Error('--type is required: premarket or postclose');
        }

        const today = todayET();
        if (!force && !isTradingDay(today)) {
          return {
            success: false,
            skipped: true,
            reason: `${today} is not a NYSE trading day. Use --force to run anyway.`,
          };
        }

        const script = type === 'premarket' ? PREMARKET_SCRIPT : POSTCLOSE_SCRIPT;
        const result = spawnSync(NODE_BIN, [script], {
          stdio: 'inherit',
          env: { ...process.env },
        });

        return {
          success: result.status === 0,
          exit_code: result.status,
          type,
          date: today,
          ...(result.error && { error: result.error.message }),
        };
      },
    }],

  ]),
});
