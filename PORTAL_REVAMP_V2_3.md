# Glace Staff Hub v2.3 — Bright & Role-Private

This update focuses on two non-negotiable portal rules:

1. A staff member only sees tools and dashboard information available to their current Discord tier.
2. The portal uses a bright, colorful ice-glass design instead of a dark navy background.

## Visible access changes

- Dashboard statistics are built only from capabilities the current tier has.
- Locked statistics no longer appear as blank cards or advertise the rank required to unlock them.
- The action queue disappears entirely for tiers that do not have a promotion or staff-action queue.
- The dashboard's workspace card lists only pages currently available to the viewer.
- Quick Actions include only actions available to the viewer.
- The promotion workflow panel appears only when Promotion Submissions are available.
- Navigation and forms continue to be hidden by the live Discord permission map.
- Presidential Preview As Tier uses the exact same visibility filtering and remains read-only.

## Login changes

The public login screen no longer advertises confidential or higher-rank systems. It now describes the portal in general terms and explains that the workspace adapts after Discord verification.

## Visual changes

- Bright white/ice background with pastel role-colored lighting.
- White glass cards with readable dark text.
- Brighter sidebar and top navigation.
- Stronger role accents without turning the interface into a rainbow.
- Larger stat cards, Quick Actions, labels, and available-workspace rows.
- Intern: pink/magenta; Management: violet; Senior Management: emerald; Corporate: red; Corporate Board: orange; Presidential: gold.

## Security

This is a visibility and design update. The existing server-side capability checks remain in place. No Discord token, OAuth secret, channel ID, or Render environment variable is included or changed.
