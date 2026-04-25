import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/alerts.js';

export function registerAlertTools(server) {
  server.tool('alert_create', 'Create a price alert via the TradingView alert dialog', {
    condition: z.string().describe('Alert condition (e.g., "crossing", "greater_than", "less_than")'),
    price: z.coerce.number().describe('Price level for the alert'),
    message: z.string().optional().describe('Alert message'),
  }, async ({ condition, price, message }) => {
    try { return jsonResult(await core.create({ condition, price, message })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('alert_list', 'List active alerts', {}, async () => {
    try { return jsonResult(await core.list()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('alert_delete', 'Delete one, several, or all alerts. Provide alert_id for a single alert, alert_ids array for multiple, or delete_all:true to wipe everything. alert_id values come from alert_list.', {
    alert_id:   z.coerce.string().optional().describe('Single alert ID to delete (from alert_list)'),
    alert_ids:  z.array(z.coerce.string()).optional().describe('Array of alert IDs to delete'),
    delete_all: z.coerce.boolean().optional().describe('Delete every active alert'),
  }, async ({ alert_id, alert_ids, delete_all }) => {
    try { return jsonResult(await core.deleteAlerts({ alert_id, alert_ids, delete_all })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
