import { register } from '../router.js';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndValidateRules, validateRules } from '../../core/rules-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../..');
const DEFAULT_RULES_PATH = join(PROJECT_ROOT, 'rules.json');
const EXAMPLE_PATH       = join(PROJECT_ROOT, 'rules.example.json');

register('rules', {
  description: 'Manage and validate your rules.json trading configuration',
  subcommands: new Map([

    ['validate', {
      description: 'Validate rules.json and report errors or warnings',
      options: {
        path: { type: 'string', short: 'p', description: 'Path to rules.json (default: ./rules.json)' },
      },
      handler: (opts) => {
        const result = loadAndValidateRules(opts.path || DEFAULT_RULES_PATH);
        return {
          success: result.valid,
          path: result.path,
          loaded: result.loaded,
          valid: result.valid,
          summary: result.summary,
          errors: result.errors,
          warnings: result.warnings,
        };
      },
    }],

    ['show', {
      description: 'Print the current rules.json (pretty-printed)',
      options: {
        path: { type: 'string', short: 'p', description: 'Path to rules.json (default: ./rules.json)' },
      },
      handler: (opts) => {
        const result = loadAndValidateRules(opts.path || DEFAULT_RULES_PATH);
        if (!result.loaded) return { success: false, errors: result.errors };
        // Return the raw rules object (CLI router will JSON.stringify it)
        return { success: true, valid: result.valid, warnings: result.warnings, rules: result.rules ?? JSON.parse(readFileSync(result.path, 'utf8')) };
      },
    }],

    ['init', {
      description: 'Copy rules.example.json to rules.json (safe — will not overwrite)',
      options: {
        force: { type: 'boolean', short: 'f', description: 'Overwrite existing rules.json' },
        path:  { type: 'string',  short: 'p', description: 'Output path (default: ./rules.json)' },
      },
      handler: (opts) => {
        const dest = resolve(opts.path || DEFAULT_RULES_PATH);
        if (existsSync(dest) && !opts.force) {
          return {
            success: false,
            reason: 'rules.json already exists. Use --force to overwrite.',
            path: dest,
          };
        }
        if (!existsSync(EXAMPLE_PATH)) {
          return { success: false, reason: `rules.example.json not found at: ${EXAMPLE_PATH}` };
        }
        copyFileSync(EXAMPLE_PATH, dest);
        return { success: true, path: dest, note: 'rules.json created. Edit it with your watchlist and bias criteria.' };
      },
    }],

    ['set', {
      description: 'Set a top-level field in rules.json (watchlist, notes, default_timeframe)',
      options: {
        path:      { type: 'string', short: 'p', description: 'Path to rules.json' },
        watchlist: { type: 'string', short: 'w', description: 'Comma-separated symbol list, e.g. BTCUSD,ETHUSD' },
        timeframe: { type: 'string', short: 't', description: 'Default timeframe (e.g. 240, D)' },
        notes:     { type: 'string', short: 'n', description: 'Notes / macro context string' },
      },
      handler: (opts) => {
        const rulesPath = resolve(opts.path || DEFAULT_RULES_PATH);
        if (!existsSync(rulesPath)) {
          return { success: false, reason: `rules.json not found at: ${rulesPath}. Run: tv rules init` };
        }

        let rules;
        try { rules = JSON.parse(readFileSync(rulesPath, 'utf8')); }
        catch (e) { return { success: false, reason: `Could not parse rules.json: ${e.message}` }; }

        const changed = [];

        if (opts.watchlist) {
          rules.watchlist = opts.watchlist.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
          changed.push(`watchlist → [${rules.watchlist.join(', ')}]`);
        }
        if (opts.timeframe) {
          rules.default_timeframe = opts.timeframe;
          changed.push(`default_timeframe → ${opts.timeframe}`);
        }
        if (opts.notes !== undefined) {
          rules.notes = opts.notes;
          changed.push('notes updated');
        }

        if (changed.length === 0) {
          return { success: false, reason: 'No changes specified. Use --watchlist, --timeframe, or --notes.' };
        }

        // Validate before writing
        const validation = validateRules(rules);
        if (!validation.valid) {
          return { success: false, reason: 'Changes would produce invalid rules.json.', errors: validation.errors };
        }

        writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
        return { success: true, changed, warnings: validation.warnings, path: rulesPath };
      },
    }],

  ]),
});
