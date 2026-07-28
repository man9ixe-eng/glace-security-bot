# Glace Hotels Staff Hub — v2.1 Revamp

This patch is designed to be copied directly over the existing GitHub repository.

## Included

- Real team titles everywhere instead of OPS number labels.
- Larger typography, controls, records, dashboard cards, and navigation.
- Brighter glass panels with bubbly layered gradients.
- Dynamic themes: Intern pink, Management purple, Senior Management green, Corporate red, Corporate Board orange, Presidential gold.
- Presidential-only Preview As Tier selector.
- Preview mode is visual/read-only; it never lowers or overrides backend authorization.
- Separate session channels now satisfy the health checker without `SESSION_HUB_CHANNEL_ID`.
- Session queues fall back to the matching interview/training/mass-shift channel.
- Public npm registry URLs in `package-lock.json` for reliable Render builds.
- Safe free-Render default: `DATA_DIR` is blank in `.env.example`.

## After replacing GitHub files

Render should deploy automatically. No new environment variable is required for the UI revamp. Keep the existing separate session channel IDs. Open `/health`; `sessionChannels` should now report ready when the three separate channels and a session log are configured.
