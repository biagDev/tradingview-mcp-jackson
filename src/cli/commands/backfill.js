/**
 * CLI for the historical backfill / replay harness.
 *
 * Usage:
 *   tv backfill run --from YYYY-MM-DD --to YYYY-MM-DD [--overwrite] [--chunk 5] [--rebuild-end-only] [--no-train]
 *   tv backfill status
 *   tv backfill resume [--no-train]
 *   tv backfill abort
 *   tv backfill inspect --date YYYY-MM-DD
 *   tv backfill list
 */

import { register } from '../router.js';
import * as core from '../../core/backfill.js';

register('backfill', {
  description: 'Historical replay backfill — generate premarket + post-close pairs across a date range',
  subcommands: new Map([

    ['run', {
      description: 'Run a replay backfill across a date range',
      options: {
        from:      { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
        to:        { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
        overwrite: { type: 'boolean', short: 'o', description: 'Re-generate even if reports already exist' },
        chunk:     { type: 'string', description: 'Rebuild analytics/dataset every N days (default 5)' },
        'rebuild-end-only': { type: 'boolean', description: 'Skip chunk rebuilds — only rebuild at batch end' },
        'no-train': { type: 'boolean', description: 'Skip model training during rebuilds' },
      },
      handler: async (opts) => {
        if (!opts.from || !opts.to) throw new Error('--from and --to are required (YYYY-MM-DD)');
        return core.runBatch({
          from:             opts.from,
          to:               opts.to,
          overwrite:        !!opts.overwrite,
          chunk:            opts.chunk ? Number(opts.chunk) : undefined,
          rebuild_end_only: !!opts['rebuild-end-only'],
          train_models:     !opts['no-train'],
        });
      },
    }],

    ['status', {
      description: 'Show current + last batch status and history',
      options: {},
      handler: async () => core.status(),
    }],

    ['resume', {
      description: 'Resume the last interrupted batch',
      options: { 'no-train': { type: 'boolean', description: 'Skip model training during rebuilds' } },
      handler: async (opts) => core.resume({ train_models: !opts['no-train'] }),
    }],

    ['abort', {
      description: 'Mark the currently active batch as aborted',
      options: {},
      handler: async () => core.abort(),
    }],

    ['inspect', {
      description: 'Inspect the saved premarket + post-close artifacts for a date (and backfill metadata)',
      options: { date: { type: 'string', description: 'Trading date YYYY-MM-DD' } },
      handler: async ({ date }) => {
        if (!date) throw new Error('--date is required');
        return core.inspect({ date });
      },
    }],

    ['list', {
      description: 'List every batch that has ever run',
      options: {},
      handler: async () => core.listBatches(),
    }],

  ]),
});
