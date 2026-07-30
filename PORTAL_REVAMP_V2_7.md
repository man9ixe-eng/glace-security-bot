# Glace Staff Hub v2.7 — Complete Request Panel

This patch expands the existing Supabase-backed request center without removing
any other portal system. It adds resignation, username-update, LOA-removal, and
updated timezone submissions alongside the existing LOA workflow.

## Routing
- Intern through Senior Management requests: Corporate+
- Corporate and Corporate Board requests: Presidential
- Resignations: Corporate Board

## Privacy
Decisions remain inside private review/log channels and direct messages. No Staff
Journey or public announcement is generated.

## Review locking
The request record stores the active reviewer. Other reviewers are prevented from
finishing that request unless the original reviewer releases it.
