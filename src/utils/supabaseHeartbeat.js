'use strict';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const HEARTBEAT_MS = Math.max(60 * 60 * 1000, Number(process.env.SUPABASE_HEARTBEAT_MS || 6 * 60 * 60 * 1000));

async function heartbeat() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, disabled: true };
  try {
    const url = new URL(`${SUPABASE_URL}/rest/v1/glace_staff_profiles`);
    url.searchParams.set('select', 'user_id');
    url.searchParams.set('limit', '1');
    const response = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[SUPABASE] Heartbeat failed (${response.status}): ${text.slice(0, 300)}`);
      return { ok: false, status: response.status };
    }
    console.log('[SUPABASE] Heartbeat OK.');
    return { ok: true };
  } catch (error) {
    console.warn('[SUPABASE] Heartbeat failed:', error.message || error);
    return { ok: false, error };
  }
}

function startSupabaseHeartbeat() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[SUPABASE] Heartbeat disabled because Supabase credentials are not configured.');
    return () => {};
  }
  heartbeat().catch(() => null);
  const timer = setInterval(() => heartbeat().catch(() => null), HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { heartbeat, startSupabaseHeartbeat };
