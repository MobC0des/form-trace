import { describe, expect, test } from "bun:test";
import {
  detectHubSpotForms,
  extractLinks,
  extractSitemapLocs,
  loadHubSpotForms,
  normalizeUrl,
  parseCsv,
  toCsv
} from "../src/utils.js";

describe("detectHubSpotForms", () => {
  test("detects an explicit HubSpot formId", () => {
    const html = `
      <script>
        hbspt.forms.create({
          portalId: "1576919",
          formId: "0d35ace8-afdc-4f18-96f4-a72a84ac1c28"
        });
      </script>
    `;

    const result = detectHubSpotForms(html);

    expect(result).toHaveLength(1);
    expect(result[0].formId).toBe("0d35ace8-afdc-4f18-96f4-a72a84ac1c28");
    expect(result[0].portalId).toBe("1576919");
  });

  test("matches a known form ID from the HubSpot export even without formId syntax", () => {
    const id = "2ec1a7a6-c330-4936-90fe-0038458116aa";

    const knownForms = new Map([
      [
        id,
        {
          id,
          name: "Accreditation Page Form | US | MQL",
          status: "Published"
        }
      ]
    ]);

    const html = `<script>window.pageConfig = {"componentGuid":"${id}"}</script>`;

    const result = detectHubSpotForms(html, knownForms);

    expect(result).toHaveLength(1);
    expect(result[0].matchedExport).toBe(true);
    expect(result[0].formName).toBe("Accreditation Page Form | US | MQL");
  });

  test("deduplicates the same form detected by multiple patterns", () => {
    const id = "0d35ace8-afdc-4f18-96f4-a72a84ac1c28";

    const html = `
      <div data-form-id="${id}"></div>
      <script>const formId = "${id}";</script>
    `;

    const result = detectHubSpotForms(html);

    expect(result).toHaveLength(1);
    expect(result[0].methods.length).toBeGreaterThan(1);
  });
});

describe("CSV handling", () => {
  test("parses quoted commas and quotes", () => {
    const rows = parseCsv('Name,Form ID\n"Hello, world","abc"\n"He said ""Hi""","def"\n');

    expect(rows[1][0]).toBe("Hello, world");
    expect(rows[2][0]).toBe('He said "Hi"');
  });

  test("round trips CSV output", () => {
    const csv = toCsv(
      [
        { Name: "Hello, world", Notes: 'He said "Hi"' }
      ],
      ["Name", "Notes"]
    );

    const rows = parseCsv(csv);

    expect(rows[1][0]).toBe("Hello, world");
    expect(rows[1][1]).toBe('He said "Hi"');
  });

  test("loads HubSpot form IDs from the export shape", () => {
    const csv = [
      "Name,Form ID,Status",
      "Contact Us,0d35ace8-afdc-4f18-96f4-a72a84ac1c28,Published"
    ].join("\n");

    const result = loadHubSpotForms(csv);

    expect(result.knownForms.size).toBe(1);
    expect(
      result.knownForms.get("0d35ace8-afdc-4f18-96f4-a72a84ac1c28").name
    ).toBe("Contact Us");
  });
});

describe("URL and sitemap helpers", () => {
  test("normalizes a page URL", () => {
    expect(
      normalizeUrl("https://www.insights.com/products/example?utm_source=test#section")
    ).toBe("https://www.insights.com/products/example/");
  });

  test("extracts same-host links", () => {
    const html = `
      <a href="/products/insights-discovery/">Discovery</a>
      <a href="https://www.insights.com/contact-us/">Contact</a>
      <a href="https://example.com/elsewhere/">External</a>
    `;

    const links = extractLinks(
      html,
      "https://www.insights.com/",
      "www.insights.com"
    );

    expect(links).toContain("https://www.insights.com/products/insights-discovery/");
    expect(links).toContain("https://www.insights.com/contact-us/");
    expect(links).not.toContain("https://example.com/elsewhere/");
  });

  test("extracts sitemap loc values", () => {
    const xml = `
      <urlset>
        <url><loc>https://www.insights.com/</loc></url>
        <url><loc>https://www.insights.com/contact-us/</loc></url>
      </urlset>
    `;

    expect(extractSitemapLocs(xml)).toEqual([
      "https://www.insights.com/",
      "https://www.insights.com/contact-us/"
    ]);
  });
});
