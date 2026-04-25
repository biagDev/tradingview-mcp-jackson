/**
 * Core alert logic.
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';

export async function create({ condition, price, message }) {
  const opened = await evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label="Create Alert"]')
        || document.querySelector('[data-name="alerts"]');
      if (btn) { btn.click(); return true; }
      return false;
    })()
  `);

  if (!opened) {
    const client = await getClient();
    await client.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 1, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA' });
  }

  await new Promise(r => setTimeout(r, 1000));

  const priceSet = await evaluate(`
    (function() {
      var inputs = document.querySelectorAll('[class*="alert"] input[type="text"], [class*="alert"] input[type="number"]');
      for (var i = 0; i < inputs.length; i++) {
        var label = inputs[i].closest('[class*="row"]')?.querySelector('[class*="label"]');
        if (label && /value|price/i.test(label.textContent)) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSet.call(inputs[i], '${price}');
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      if (inputs.length > 0) {
        var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSet.call(inputs[0], '${price}');
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `);

  if (message) {
    await evaluate(`
      (function() {
        var textarea = document.querySelector('[class*="alert"] textarea')
          || document.querySelector('textarea[placeholder*="message"]');
        if (textarea) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          nativeSet.call(textarea, ${JSON.stringify(message)});
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
  }

  await new Promise(r => setTimeout(r, 500));
  const created = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button[data-name="submit"], button');
      for (var i = 0; i < btns.length; i++) {
        if (/^create$/i.test(btns[i].textContent.trim())) { btns[i].click(); return true; }
      }
      return false;
    })()
  `);

  return { success: !!created, price, condition, message: message || '(none)', price_set: !!priceSet, source: 'dom_fallback' };
}

export async function list() {
  // Use pricealerts REST API — returns structured data with alert_id, symbol, price, conditions
  const result = await evaluateAsync(`
    fetch('https://pricealerts.tradingview.com/list_alerts', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.s !== 'ok' || !Array.isArray(data.r)) return { alerts: [], error: data.errmsg || 'Unexpected response' };
        return {
          alerts: data.r.map(function(a) {
            var sym = '';
            try { sym = JSON.parse(a.symbol.replace(/^=/, '')).symbol || a.symbol; } catch(e) { sym = a.symbol; }
            return {
              alert_id: a.alert_id,
              symbol: sym,
              type: a.type,
              message: a.message,
              active: a.active,
              condition: a.condition,
              resolution: a.resolution,
              created: a.create_time,
              last_fired: a.last_fire_time,
              expiration: a.expiration,
            };
          })
        };
      })
      .catch(function(e) { return { alerts: [], error: e.message }; })
  `);
  return { success: true, alert_count: result?.alerts?.length || 0, source: 'internal_api', alerts: result?.alerts || [], error: result?.error };
}

/**
 * Delete one, several, or all alerts via the pricealerts REST API.
 *
 * Accepts three call patterns:
 *   deleteAlerts({ alert_id: '12345' })          — delete one alert by ID
 *   deleteAlerts({ alert_ids: ['1','2','3'] })    — delete a list of IDs
 *   deleteAlerts({ delete_all: true })            — fetch all IDs then delete them all
 *
 * The REST endpoint mirrors the list_alerts session cookie so no extra
 * auth is needed — the browser's TradingView session handles it.
 */
export async function deleteAlerts({ delete_all, alert_id, alert_ids } = {}) {
  // Resolve the target ID list
  let ids = [];

  if (delete_all) {
    const listed = await list();
    if (!listed.success) throw new Error(`Could not fetch alert list before deleting: ${listed.error}`);
    ids = (listed.alerts || []).map(a => String(a.alert_id)).filter(Boolean);
    if (ids.length === 0) return { success: true, deleted: 0, note: 'No active alerts to delete.' };
  } else if (alert_ids && Array.isArray(alert_ids)) {
    ids = alert_ids.map(String).filter(Boolean);
  } else if (alert_id != null) {
    ids = [String(alert_id)];
  } else {
    throw new Error('Provide alert_id, alert_ids, or delete_all: true.');
  }

  if (ids.length === 0) throw new Error('No alert IDs resolved for deletion.');

  // Build query-string body: alert_ids[]=1&alert_ids[]=2 ...
  const body = ids.map(id => `alert_ids%5B%5D=${encodeURIComponent(id)}`).join('&');

  const result = await evaluateAsync(`
    (function() {
      var ids = ${JSON.stringify(ids)};
      var body = ids.map(function(id) { return 'alert_ids%5B%5D=' + encodeURIComponent(id); }).join('&');
      return fetch('https://pricealerts.tradingview.com/delete_alerts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
      })
        .then(function(r) { return r.json(); })
        .then(function(data) { return { ok: data.s === 'ok', raw: data }; })
        .catch(function(e) { return { ok: false, error: e.message }; });
    })()
  `);

  if (!result?.ok) {
    // Fallback: some TV versions expect a JSON body instead
    const fallback = await evaluateAsync(`
      (function() {
        var ids = ${JSON.stringify(ids)};
        return fetch('https://pricealerts.tradingview.com/delete_alerts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alert_ids: ids }),
        })
          .then(function(r) { return r.json(); })
          .then(function(data) { return { ok: data.s === 'ok', raw: data }; })
          .catch(function(e) { return { ok: false, error: e.message }; });
      })()
    `);

    if (!fallback?.ok) {
      return {
        success: false,
        deleted: 0,
        ids_attempted: ids,
        error: fallback?.error || fallback?.raw?.errmsg || 'Delete API returned non-ok',
        raw: fallback?.raw,
      };
    }

    return { success: true, deleted: ids.length, ids_deleted: ids, source: 'rest_api_json' };
  }

  return { success: true, deleted: ids.length, ids_deleted: ids, source: 'rest_api_form' };
}
