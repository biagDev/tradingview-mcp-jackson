import { register } from '../router.js';
import * as core from '../../core/alerts.js';

register('alert', {
  description: 'Alert tools (list, create, delete)',
  subcommands: new Map([
    ['list', {
      description: 'List active alerts',
      handler: () => core.list(),
    }],
    ['create', {
      description: 'Create a price alert',
      options: {
        price: { type: 'string', short: 'p', description: 'Price level' },
        condition: { type: 'string', short: 'c', description: 'Condition: crossing, greater_than, less_than' },
        message: { type: 'string', short: 'm', description: 'Alert message' },
      },
      handler: (opts) => core.create({
        price: Number(opts.price),
        condition: opts.condition || 'crossing',
        message: opts.message,
      }),
    }],
    ['delete', {
      description: 'Delete alerts. Use --id <id>, --ids <id1,id2,...>, or --all',
      options: {
        id:  { type: 'string',  description: 'Single alert ID to delete (from tv alert list)' },
        ids: { type: 'string',  description: 'Comma-separated alert IDs to delete' },
        all: { type: 'boolean', description: 'Delete all active alerts' },
      },
      handler: (opts) => core.deleteAlerts({
        alert_id:   opts.id  || undefined,
        alert_ids:  opts.ids ? opts.ids.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        delete_all: opts.all || false,
      }),
    }],
  ]),
});
