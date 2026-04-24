/**
 * CLI for Stage 7 — Edge Acceleration.
 *
 * Usage:
 *   tv edge coldstart [--days 90] [--chunk 10] [--overwrite] [--skip-backfill]
 *   tv edge retrain
 *   tv edge evaluate
 *   tv edge status
 *   tv edge report
 *   tv edge weights
 *   tv edge promotion
 */

import { register } from '../router.js';
import * as core from '../../core/edge.js';

register('edge', {
  description: 'Edge Acceleration — research-only ML training + evaluation. Rules engine stays production.',
  subcommands: new Map([

    ['coldstart', {
      description: 'Full research sweep: backfill history → rebuild dataset → retrain models → evaluate → sync',
      options: {
        days:             { type: 'string', description: 'Trading days of history to backfill (default 90)' },
        chunk:            { type: 'string', description: 'Backfill chunk size (default 10)' },
        overwrite:        { type: 'boolean', short: 'o', description: 'Regenerate reports even if already present' },
        'skip-backfill':  { type: 'boolean', description: 'Run retrain + evaluate only (no replay)' },
        'chunk-rebuilds': { type: 'boolean', description: 'Rebuild analytics/dataset during backfill chunks (default OFF)' },
      },
      handler: async (opts) => core.coldStart({
        days:             opts.days  ? Number(opts.days)  : undefined,
        chunk:            opts.chunk ? Number(opts.chunk) : undefined,
        overwrite:        !!opts.overwrite,
        skip_backfill:    !!opts['skip-backfill'],
        rebuild_end_only: !opts['chunk-rebuilds'],
      }),
    }],

    ['retrain', {
      description: 'Rebuild dataset + retrain all models with weighted samples + evaluate',
      options: {},
      handler: async () => core.retrain(),
    }],

    ['evaluate', {
      description: 'Honest ML-vs-rules-vs-baseline evaluation + agreement matrix + breakdowns',
      options: {},
      handler: async () => core.evaluate(),
    }],

    ['status',     { description: 'Status of edge artifacts', options: {}, handler: async () => core.status() }],
    ['report',     { description: 'Champion report for each task', options: {}, handler: async () => core.getChampionReport() }],
    ['agreement',  { description: 'Rules-vs-ML agreement matrix', options: {}, handler: async () => core.getAgreementMatrix() }],
    ['summary',    { description: 'Evaluation summary (hit rates, MAE, ML vs baseline vs rules)', options: {}, handler: async () => core.getEvaluationSummary() }],
    ['weights',    { description: 'Sample-weighting scheme documentation', options: {}, handler: async () => core.getWeightingScheme() }],
    ['promotion',  { description: 'Promotion criteria + current check result (DEFINED but NEVER activated)', options: {}, handler: async () => core.getPromotionCheck() }],

  ]),
});
