# GSC Tracker

## Status

Proposed.

## Context

The Search Console integration ([spec 0003](0003-google-search-console-integration.md)) reads Google live on every request and keeps no history. That serves "how did last month go", but not the questions people ask over time: which queries climbed or dropped, what a page earned a year ago, which queries split their impressions between two of our pages. Answering those live means many Search Analytics calls per view, and Google only keeps 16 months, so anything older is gone for good.

## Decision

A project can turn on **GSC Tracker**. OpenSEO then copies the project's Search Console data into its own database, day by day, and serves trend views from it.

**What is stored.** For each day:

- the property's whole-day totals (clicks, impressions, average position), which include the anonymized queries, and
- the day's top query × page rows by clicks, capped per day (1,000 by default, `GSC_TRACKER_ROWS_PER_DAY` up to Google's 25,000 page size).

Queries and page URLs are stored once per project and referenced by id, which keeps 16 months small enough for a free D1 database. CTR is derived, not stored. Average positions are combined across days and pages weighted by impressions.

**Sync.** The 5-minute cron runs one small batch per tracked project: a few days of query × page rows (one Search Analytics call each) plus one call for the batch's totals. Recent days come first, then older history, back to Google's 16-month floor. Search Console keeps revising its last days, so they are fetched again every few hours. Re-fetching a day replaces it, so every sync is idempotent. The batch size keeps a tick inside the Workers free-plan subrequest cap; a full backfill takes a few hours. Turning tracking on also runs the first batch right away, and members who manage integrations can start one from the page.

**Ownership and lifecycle.** History belongs to one property. If the project switches property, the stored history is dropped and the backfill starts over. Turning tracking off, disconnecting Search Console, or deleting the project deletes the stored data.

**Views.** The tracker page compares a window (7 days to 16 months, ending at the newest stored day) with the window before it:

- Overview: totals and a daily chart.
- Queries and Pages: per key current and previous clicks, impressions, CTR and position, with views for improved, declined, new and lost.
- Query detail: the query's daily trend and the pages that rank for it.
- Cannibalization: queries where a second page earns at least 10% of the impressions.

**Availability.** Self-hosted deployments with their own Google access. The hosted service would store Google data beyond the dashboard's short-lived cache, which is a privacy-policy decision first. Behind the Every App gateway, Google calls are made per member request, not from the cron.

## Alternatives considered

- **Live queries with `date` as a dimension.** No storage, but every view costs many Search Analytics calls, slow pages, and no history beyond 16 months.
- **Storing every row Google returns.** Exact, but a large site's 16 months outgrow a free D1 database. The per-day cap with exact daily totals keeps trends right while bounding size.
- **A Workflow per backfill.** Fewer, longer runs, but more moving parts than a cron batch for work that is naturally incremental and idempotent.

## Consequences

- Per-key numbers cover the stored top rows only; site totals are exact.
- A project's history is only as old as Google's 16 months on the day tracking starts, then grows from there.
- New views over the stored data (brand vs non-brand, page groups, an MCP tool) can build on the same tables.
