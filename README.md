<<<<<<< HEAD
# FormTrace

FormTrace crawls a website and builds an inventory of the forms it finds.

It can detect HubSpot forms, map form IDs back to a HubSpot export, and show which forms appear on which live URLs.

Originally built for website migration and form-audit work.
=======
# Insights Form Scraper

A small, disposable migration-audit crawler for `www.insights.com`.

Its job is intentionally narrow:

1. discover live URLs from the site's sitemaps;
2. fetch each HTML page without submitting anything;
3. detect HubSpot form GUIDs in the page HTML;
4. match those GUIDs to a HubSpot forms export;
5. report exactly which form appears on which live URL.

There is no UI, database, authentication, HubSpot write access, or form submission logic.

## Why this is useful

The HubSpot export may contain hundreds of historical forms. The migration question is different:

> Which HubSpot forms are actually in use on the current website?

The strongest match is a live page containing a GUID that exactly equals a `Form ID` from the HubSpot export. The scraper labels that as an exact export match rather than trying to infer the relationship from a form name.

## Requirements

- Bun 1.x
- network access to `https://www.insights.com`
- the HubSpot forms CSV export if you want exact export matching

There are **no npm dependencies**.

## Quick start

From this folder:

```bash
bun test
```

Then run the audit:

```bash
bun scrape.js \
  --site https://www.insights.com \
  --hubspot /path/to/hubspot-listing-lib-exports-all-forms-2026-09-16.csv
```

Results are written to `./output`.

## Recommended first run for the client audit

Use the sitemap only first:

```bash
bun scrape.js \
  --site https://www.insights.com \
  --hubspot /path/to/hubspot-listing-lib-exports-all-forms-2026-09-16.csv \
  --concurrency 6 \
  --delay-ms 100 \
  --max-pages 5000
```

If you suspect there are internally linked pages that are omitted from the sitemap, run again with link discovery enabled:

```bash
bun scrape.js \
  --site https://www.insights.com \
  --hubspot /path/to/hubspot-listing-lib-exports-all-forms-2026-09-16.csv \
  --follow-links \
  --concurrency 6 \
  --delay-ms 100 \
  --max-pages 5000
```

## Output files

### `form-usage-summary.csv`

The most useful client-audit output.

One row per unique form ID, including:

- Form ID
- HubSpot form name
- HubSpot form status
- whether it matched the HubSpot export
- number of live pages using it
- every live URL where it was found
- form activity metadata from the export

This is the file to join into the migration workbook.

### `live-form-occurrences.csv`

One row per page/form occurrence.

Use this when the same form is reused across several pages.

### `page-audit.csv`

One row per fetched page, with:

- HTTP status
- content type
- page title
- number of forms found
- duration
- errors

This makes gaps visible instead of silently dropping failed pages.

### `unmatched-live-forms.csv`

Form-looking GUIDs detected on the live site that did **not** match the supplied HubSpot export.

These need manual investigation.

### `hubspot-forms-not-found-on-site.csv`

Every form in the HubSpot export that was not found during this crawl.

Do **not** automatically treat these as safe to retire. A form can be used outside `www.insights.com`, embedded dynamically, used on a non-indexed URL, or be part of another estate/subdomain.

### `summary.json`

Counts and run settings for quick checking.

## Detection strategy

The detector combines several signals:

- exact GUIDs that also exist in the supplied HubSpot export;
- `formId` / `form_id` configuration;
- `data-form-id`, `data-hs-form-id`, or `form-id` attributes;
- HubSpot/form URL patterns;
- a form-context GUID fallback.

Exact IDs from the export are the most useful signal for this project.

## Scope safety

The crawler:

- only fetches `http`/`https`;
- stays on the hostname passed with `--site`;
- does not submit forms;
- does not log into HubSpot;
- does not modify HubSpot, Dynamics, workflows, properties, or CRM records;
- strips query strings and fragments when deduplicating page URLs;
- skips common document/media/static asset extensions;
- uses a bounded concurrency level and request timeout.

This is still a client site, so keep the request rate modest.

## Important limitation: JavaScript-rendered forms

The default version inspects the HTML returned by the server.

That is deliberate: it is fast, low-risk, and often enough because a HubSpot form GUID usually exists in page configuration even when the visible form is rendered later.

However, if you manually inspect a page and can see a form in the browser but this scraper reports no form ID, the form may only appear after client-side JavaScript executes.

That is the point to add a Playwright fallback. Do not start with a full browser crawl unless the raw-HTML run proves it is necessary.

## Useful flags

```text
--site          Site origin. Default: https://www.insights.com/
--hubspot       Path to HubSpot forms CSV export.
--seed-file     Extra URLs to always include. Default: ./data/seed-urls.txt
--out           Output directory. Default: ./output
--concurrency   Concurrent requests. Default: 6
--timeout-ms    Request timeout. Default: 15000
--delay-ms      Delay after each page per worker. Default: 100
--max-pages     Hard page cap. Default: 5000
--follow-links  Also discover internal links while crawling.
--user-agent    Override the audit user-agent.
```

## What this does not prove

Finding a form on a live page proves live usage of that form ID.

It does **not** by itself prove:

- every field/property is sanctioned;
- a property is mapped into Dynamics;
- existing workflows can safely be changed;
- a new site requirement does not need an additional field.

Those remain the form/property review stage of the migration audit.
>>>>>>> 2a145cd (Initial FormTrace scraper)
