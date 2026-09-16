# FormTrace

> Crawl a website, discover forms, identify providers, and map where each form is used.

FormTrace is a lightweight website crawler for auditing forms across a web estate.

It was built for migration and QA work where you need to answer questions like:

- What forms exist on the current site?
- Where is each form used?
- Which HubSpot form IDs are actually live?
- Do live forms match an exported HubSpot inventory?
- Are there forms using another provider or portal?
- Which pages failed to crawl and need manual review?

FormTrace does not submit forms or modify any external systems.

## What it does

FormTrace:

- discovers pages from XML sitemaps
- optionally follows internal links
- fetches pages concurrently
- detects HubSpot form IDs in page markup
- matches live form IDs against a HubSpot CSV export
- records every URL where a form appears
- flags live forms that are missing from the supplied export
- records crawl errors and failed pages
- exports audit-friendly CSV files

## Example

```bash
bun scrape.js \
  --site https://example.com \
  --hubspot ./data/hubspot-forms.csv
```

Example output:

```text
Site:          https://example.com/
Host:          example.com
Concurrency:   6
Max pages:     5000
Follow links:  no
HubSpot forms: 245
Starting URLs: 812

Visited 50 pages; found 12 form occurrences.
Visited 100 pages; found 31 form occurrences.
...
```

## Output

FormTrace writes its results to `./output`.

### `form-usage-summary.csv`

One row per unique form.

Useful for answering:

> Which forms are actually live, and where are they used?

Includes:

- form ID
- HubSpot form name
- form status
- number of pages using the form
- live URLs
- detection methods
- submission metadata from the HubSpot export

### `live-form-occurrences.csv`

One row for every page/form combination.

Useful when the same form is reused across multiple pages.

### `unmatched-live-forms.csv`

Forms detected on the website that could not be matched to the supplied HubSpot export.

These should be investigated manually.

### `page-audit.csv`

One row per crawled page, including:

- HTTP status
- final URL
- page title
- detected form count
- request duration
- crawl errors

### `hubspot-forms-not-found-on-site.csv`

Forms present in the HubSpot export but not observed during the crawl.

> [!WARNING]
> A form not appearing in the crawl does **not** prove that it is unused.
>
> It may exist on a non-indexed page, another hostname, a dynamically rendered page, or an external application.

## Installation

FormTrace requires [Bun](https://bun.sh/).

Clone the repository:

```bash
git clone https://github.com/MobC0des/FormTrace.git
cd FormTrace
```

Run the tests:

```bash
bun test
```

No additional dependencies are required.

## Usage

Basic crawl:

```bash
bun scrape.js --site https://example.com
```

With a HubSpot export:

```bash
bun scrape.js \
  --site https://example.com \
  --hubspot ./data/hubspot-forms.csv
```

Follow internal links as well as sitemap URLs:

```bash
bun scrape.js \
  --site https://example.com \
  --hubspot ./data/hubspot-forms.csv \
  --follow-links
```

## Options

| Option           | Description                            | Default                        |
| ---------------- | -------------------------------------- | ------------------------------ |
| `--site`         | Website to crawl                       | required                       |
| `--hubspot`      | Path to HubSpot forms CSV              | none                           |
| `--seed-file`    | Additional URLs to crawl               | `./data/seed-urls.example.txt` |
| `--out`          | Output directory                       | `./output`                     |
| `--concurrency`  | Concurrent requests                    | `6`                            |
| `--timeout-ms`   | Request timeout                        | `15000`                        |
| `--delay-ms`     | Delay between requests per worker      | `100`                          |
| `--max-pages`    | Maximum pages to crawl                 | `5000`                         |
| `--follow-links` | Discover internal links while crawling | `false`                        |

## Detection

FormTrace currently detects HubSpot forms using several signals, including:

```html
<script>
  hbspt.forms.create({
    portalId: "123456",
    formId: "00000000-0000-0000-0000-000000000000",
  });
</script>
```

and markup such as:

```html
<div data-form-id="00000000-0000-0000-0000-000000000000"></div>
```

If a HubSpot export is supplied, GUIDs found in page markup are also compared directly against known HubSpot form IDs.

Matching by exact form ID is preferred over trying to infer relationships from names.

## Architecture

The project is deliberately small:

```text
sitemap / seed URLs
        ↓
     crawler
        ↓
      HTML
        ↓
 form detection
        ↓
 normalization
        ↓
 HubSpot matching
        ↓
     CSV output
```

The detection and parsing logic lives separately from the crawler so it can be tested without making network requests.

## Safety

FormTrace is designed as a read-only audit tool.

It:

- does not submit forms
- does not log into HubSpot
- does not modify CRM data
- does not modify workflows or properties
- remains on the configured hostname
- skips common asset and document types
- uses bounded concurrency and request timeouts

Use sensible request rates when crawling sites you do not own.

## Limitations

FormTrace currently inspects the HTML returned by the server.

Some forms may only appear after JavaScript executes in the browser. Those forms may not be detected by the default crawler.

A future browser-based fallback could use Playwright for pages where server-rendered HTML does not contain the form configuration.

FormTrace also currently focuses primarily on HubSpot form detection.

## Roadmap

- [ ] detect generic HTML `<form>` elements
- [ ] identify non-HubSpot form providers
- [ ] extract form field names and input types
- [ ] add Playwright fallback for JavaScript-rendered forms
- [ ] compare field schemas between live forms and CRM exports
- [ ] add JSON output
- [ ] add configurable hostname/subdomain scope
- [ ] improve crawl reporting

## Why I built this

Website migrations often start with a deceptively simple question:

> Which forms on the current site actually need to move?

CRM portals can contain hundreds of historical forms, while only a small subset may still exist on the live website.

FormTrace uses the website itself as the starting point, then traces live form usage back to the source system.

---

Built by [MobC0des](https://github.com/MobC0des)
