/**
 * rules.json validator.
 *
 * Validates structure, types, and common mistakes without blocking
 * normal operation — validation is advisory. The morning brief still
 * runs if rules.json has warnings; it only blocks on hard errors.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Valid TradingView timeframe strings
const VALID_TIMEFRAMES = new Set([
  '1','3','5','10','15','30','45','60','120','180','240',
  'D','W','M','1D','1W','1M',
]);

// Obvious typos / non-TradingView symbol patterns to warn on
const SUSPICIOUS_SYMBOL = /[a-z]|\s|[^A-Z0-9!._/-]/;

// ─── Schema Definition ────────────────────────────────────────────────────────

const SCHEMA = {
  watchlist: {
    required: true,
    type: 'array',
    minItems: 1,
    itemType: 'string',
    itemValidate: (sym, i) => {
      if (typeof sym !== 'string' || sym.trim() === '') return `watchlist[${i}]: must be a non-empty string`;
      if (SUSPICIOUS_SYMBOL.test(sym)) return `watchlist[${i}]: "${sym}" looks unusual — TradingView symbols are uppercase (e.g. BTCUSD, ES1!)`;
      return null;
    },
  },
  default_timeframe: {
    required: false,
    type: 'string',
    validate: (v) => {
      if (!VALID_TIMEFRAMES.has(String(v))) {
        return `default_timeframe: "${v}" is not a recognised TradingView timeframe. Common values: 60 (1H), 240 (4H), D (daily).`;
      }
      return null;
    },
  },
  bias_criteria: {
    required: true,
    type: 'object',
    subkeys: {
      bullish:  { required: true,  type: 'array', itemType: 'string', minItems: 1 },
      bearish:  { required: true,  type: 'array', itemType: 'string', minItems: 1 },
      neutral:  { required: false, type: 'array', itemType: 'string' },
    },
  },
  risk_rules: {
    required: false,
    type: 'array',
    itemType: 'string',
  },
  notes: {
    required: false,
    type: 'string',
  },
};

// ─── Core validator ───────────────────────────────────────────────────────────

export function validateRules(rules) {
  const errors   = [];   // hard: morning brief will refuse to run
  const warnings = [];   // soft: morning brief runs, but notes are returned

  if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
    errors.push('rules.json must be a JSON object, not an array or primitive.');
    return { valid: false, errors, warnings };
  }

  // Check for unknown top-level keys
  const knownKeys = new Set(Object.keys(SCHEMA));
  for (const k of Object.keys(rules)) {
    if (!knownKeys.has(k)) warnings.push(`Unknown key "${k}" — will be ignored.`);
  }

  // Validate each schema entry
  for (const [key, spec] of Object.entries(SCHEMA)) {
    const val = rules[key];

    if (val === undefined || val === null) {
      if (spec.required) errors.push(`Missing required field: "${key}".`);
      continue;
    }

    // Top-level type check
    const actualType = Array.isArray(val) ? 'array' : typeof val;
    if (actualType !== spec.type) {
      errors.push(`"${key}" must be ${spec.type}, got ${actualType}.`);
      continue;
    }

    // Array checks
    if (spec.type === 'array') {
      if (spec.minItems && val.length < spec.minItems) {
        errors.push(`"${key}" must have at least ${spec.minItems} item(s), got ${val.length}.`);
      }
      if (spec.itemType) {
        val.forEach((item, i) => {
          if (typeof item !== spec.itemType) {
            errors.push(`"${key}[${i}]" must be ${spec.itemType}, got ${typeof item}.`);
          }
        });
      }
      if (spec.itemValidate) {
        for (let i = 0; i < val.length; i++) {
          const msg = spec.itemValidate(val[i], i);
          if (msg) warnings.push(msg);
        }
      }
    }

    // Object subkey checks
    if (spec.type === 'object' && spec.subkeys) {
      for (const [sub, subSpec] of Object.entries(spec.subkeys)) {
        const subVal = val[sub];
        if (subVal === undefined || subVal === null) {
          if (subSpec.required) errors.push(`"${key}.${sub}" is required.`);
          continue;
        }
        const subType = Array.isArray(subVal) ? 'array' : typeof subVal;
        if (subType !== subSpec.type) {
          errors.push(`"${key}.${sub}" must be ${subSpec.type}, got ${subType}.`);
          continue;
        }
        if (subSpec.type === 'array') {
          if (subSpec.minItems && subVal.length < subSpec.minItems) {
            errors.push(`"${key}.${sub}" must have at least ${subSpec.minItems} item(s).`);
          }
          if (subSpec.itemType) {
            subVal.forEach((item, i) => {
              if (typeof item !== subSpec.itemType) {
                errors.push(`"${key}.${sub}[${i}]" must be ${subSpec.itemType}, got ${typeof item}.`);
              }
            });
          }
        }
      }
    }

    // Custom field validator
    if (spec.validate) {
      const msg = spec.validate(val);
      if (msg) warnings.push(msg);
    }
  }

  // Watchlist-specific warnings
  if (Array.isArray(rules.watchlist)) {
    const seen = new Set();
    rules.watchlist.forEach((sym, i) => {
      if (typeof sym === 'string') {
        if (seen.has(sym)) warnings.push(`watchlist[${i}]: "${sym}" appears more than once.`);
        seen.add(sym);
      }
    });
    if (rules.watchlist.length > 20) {
      warnings.push(`watchlist has ${rules.watchlist.length} symbols. Morning brief will be slow — consider trimming to your most-watched symbols.`);
    }
  }

  // bias_criteria empty string check
  if (rules.bias_criteria && typeof rules.bias_criteria === 'object') {
    for (const dir of ['bullish', 'bearish', 'neutral']) {
      if (Array.isArray(rules.bias_criteria[dir])) {
        rules.bias_criteria[dir].forEach((item, i) => {
          if (typeof item === 'string' && item.trim() === '') {
            warnings.push(`bias_criteria.${dir}[${i}]: empty string — remove or fill in a criterion.`);
          }
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: errors.length === 0 && warnings.length === 0
      ? 'rules.json looks good.'
      : errors.length > 0
        ? `${errors.length} error(s), ${warnings.length} warning(s). Morning brief blocked until errors are resolved.`
        : `0 errors, ${warnings.length} warning(s). Morning brief will run.`,
  };
}

// ─── File loader + validator ──────────────────────────────────────────────────

export function loadAndValidateRules(rulesPath) {
  const absPath = resolve(rulesPath);

  if (!existsSync(absPath)) {
    return {
      loaded: false,
      valid: false,
      path: absPath,
      errors: [`rules.json not found at: ${absPath}. Run: cp rules.example.json rules.json`],
      warnings: [],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absPath, 'utf8'));
  } catch (e) {
    return {
      loaded: false,
      valid: false,
      path: absPath,
      errors: [`rules.json is not valid JSON: ${e.message}`],
      warnings: [],
    };
  }

  const result = validateRules(parsed);
  return { loaded: true, path: absPath, rules: result.valid ? parsed : null, ...result };
}
