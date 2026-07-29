# Glace Staff Hub v2.5 — Promotion Workflow & Supabase Fix

This update keeps the full Staff Hub and removes the retired **Watch Records** system from the website.

## What changed

- Watch Records removed from navigation, dashboard cards, Quick Actions, access lists, forms, API routes, and preview modes.
- All other existing portal areas remain: Dashboard, Promotions, Staff Actions, Restricted Records, Documents, Updates, LOAs, and Audit Log.
- Dashboard summary cards now render their text above the decorative gradients and use a readable three-column layout.
- Promotion actions are available directly inside the dashboard action queue and the full Promotion Queue.
- Corporate Board can approve, return, or deny as usual.
- Presidential users now see **Approve Now · Skip Board** while a submission is awaiting Board review.
- A Presidential override requires a written reason and creates a permanent audit entry.
- Presidential approval is available even when that Presidential user originally submitted the promotion.
- Promotions into Corporate Board or Presidential still require two separate Presidential approvals.
- The assigned Corporate owner still carries out the promotion, applies the Discord rank, and uses **Verify & Complete**.
- Completed promotions continue to post to Staff Journey.

## Permanent Supabase promotion storage

The promotion workflow uses Supabase whenever both of these are configured in Render:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` **or** `SUPABASE_SECRET_KEY`

Run `supabase/glace_promotions.sql` once in your Supabase SQL Editor before adding the keys.

When Supabase is connected, the Promotion Queue displays **Permanent Supabase storage**. If it is not configured, the portal safely falls back to local JSON and displays **Temporary local storage**.

The Supabase key is server-only. Never place it in GitHub, Discord, or the browser.

## Existing test submissions

A promotion created in Render's old temporary filesystem may disappear during the deployment that switches to Supabase. If the test promotion is missing after v2.5 goes live, resubmit it once; all new submissions will then remain permanent.
