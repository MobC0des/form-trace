import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  detectHubSpotForms,
  extractLinks,
  extractSitemapLocs,
  extractTitle,
  isHtmlCandidate,
  isSitemapIndex,
  loadHubSpotForms,
  normalizeUrl,
  toCsv
} from "./src/utils.js";

const args = parseArgs(process.argv.slice(2));

const config = {
  site: args.site ?? "https://www.insights.com/",
  hubspot: args.hubspot ?? "",
  seedFile: args["seed-file"] ?? "./data/seed-urls.txt",
  out: args.out ?? "./output",
  concurrency: numberArg(args.concurrency, 6),
  timeoutMs: numberArg(args["timeout-ms"], 15000),
  delayMs: numberArg(args["delay-ms"], 100),
  maxPages: numberArg(args["max-pages"], 5000),
  followLinks: booleanArg(args["follow-links"], false),
  userAgent: args["user-agent"] ?? "InsightsFormsAudit/1.0 (+migration inventory)"
};

const siteUrl = new URL(config.site);
const allowedHost = siteUrl.hostname;
const baseUrl = normalizeUrl(siteUrl.toString());

await mkdir(config.out, { recursive: true });

console.log(`Site:          ${baseUrl}`);
console.log(`Host:          ${allowedHost}`);
console.log(`Concurrency:   ${config.concurrency}`);
console.log(`Max pages:     ${config.maxPages}`);
console.log(`Follow links:  ${config.followLinks ? "yes" : "no"}`);

let hubSpotData = {
  knownForms: new Map(),
  sourceRows: []
};

if (config.hubspot) {
  const hubspotText = await readFile(resolve(config.hubspot), "utf8");
  hubSpotData = loadHubSpotForms(hubspotText);
  console.log(`HubSpot forms: ${hubSpotData.knownForms.size}`);
} else {
  console.log("HubSpot forms: no export supplied (exact export matching disabled)");
}

const seedUrls = await readSeedUrls(config.seedFile, allowedHost);
const sitemapUrls = await discoverSitemaps(baseUrl);
const sitemapPageUrls = await discoverPageUrlsFromSitemaps(sitemapUrls, allowedHost);

const queue = [];
const queued = new Set();
const visited = new Set();

for (const url of [...sitemapPageUrls, ...seedUrls]) {
  enqueue(url);
}

if (queue.length === 0) {
  enqueue(baseUrl);
}

console.log(`Starting URLs: ${queue.length}`);

const pageRows = [];
const occurrenceRows = [];
const discoveredKnownFormIds = new Set();

let queueIndex = 0;

async function worker(workerNumber) {
  while (true) {
    const currentIndex = queueIndex;
    queueIndex += 1;

    if (currentIndex >= queue.length || visited.size >= config.maxPages) {
      return;
    }

    const pageUrl = queue[currentIndex];

    if (!pageUrl || visited.has(pageUrl)) {
      continue;
    }

    visited.add(pageUrl);

    const started = Date.now();

    try {
      const response = await fetchWithTimeout(pageUrl);
      const finalUrl = normalizeUrl(response.url || pageUrl);
      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.toLowerCase().includes("text/html")) {
        pageRows.push({
          "Page URL": pageUrl,
          "Final URL": finalUrl,
          "HTTP Status": response.status,
          "Content Type": contentType,
          "Page Title": "",
          "Forms Found": 0,
          "Matched Export Forms": 0,
          "Duration ms": Date.now() - started,
          "Error": "Skipped non-HTML response"
        });

        continue;
      }

      const html = await response.text();
      const title = extractTitle(html);
      const forms = detectHubSpotForms(html, hubSpotData.knownForms);

      const matchedCount = forms.filter((form) => form.matchedExport).length;

      pageRows.push({
        "Page URL": pageUrl,
        "Final URL": finalUrl,
        "HTTP Status": response.status,
        "Content Type": contentType,
        "Page Title": title,
        "Forms Found": forms.length,
        "Matched Export Forms": matchedCount,
        "Duration ms": Date.now() - started,
        "Error": ""
      });

      for (const form of forms) {
        if (form.matchedExport) {
          discoveredKnownFormIds.add(form.formId.toLowerCase());
        }

        occurrenceRows.push({
          "Page URL": pageUrl,
          "Final URL": finalUrl,
          "Page Title": title,
          "HTTP Status": response.status,
          "Form ID": form.formId,
          "Portal ID": form.portalId,
          "HubSpot Form Name": form.formName,
          "HubSpot Form Status": form.formStatus,
          "Matched HubSpot Export": form.matchedExport ? "Yes" : "No",
          "Detection Method": form.methods.join(" + "),
          "Form Submissions": form.formSubmissions,
          "Page Views": form.pageViews,
          "Last Submission": form.lastSubmission
        });
      }

      if (config.followLinks && queue.length < config.maxPages) {
        for (const link of extractLinks(html, finalUrl, allowedHost)) {
          enqueue(link);
        }
      }
    } catch (error) {
      pageRows.push({
        "Page URL": pageUrl,
        "Final URL": "",
        "HTTP Status": "",
        "Content Type": "",
        "Page Title": "",
        "Forms Found": 0,
        "Matched Export Forms": 0,
        "Duration ms": Date.now() - started,
        "Error": error instanceof Error ? error.message : String(error)
      });
    }

    if (config.delayMs > 0) {
      await sleep(config.delayMs);
    }

    if (visited.size % 50 === 0) {
      console.log(`Visited ${visited.size} pages; found ${occurrenceRows.length} form occurrences.`);
    }
  }

  function enqueue(value) {
    try {
      const normalized = normalizeUrl(value);

      if (
        !queued.has(normalized) &&
        isHtmlCandidate(normalized, allowedHost) &&
        queued.size < config.maxPages
      ) {
        queued.add(normalized);
        queue.push(normalized);
      }
    } catch {
      // Ignore invalid URLs.
    }
  }
}

function enqueue(value) {
  try {
    const normalized = normalizeUrl(value);

    if (
      !queued.has(normalized) &&
      isHtmlCandidate(normalized, allowedHost) &&
      queued.size < config.maxPages
    ) {
      queued.add(normalized);
      queue.push(normalized);
    }
  } catch {
    // Ignore invalid URLs.
  }
}

const workers = Array.from(
  { length: Math.max(1, config.concurrency) },
  (_, index) => worker(index + 1)
);

await Promise.all(workers);

pageRows.sort((a, b) => a["Page URL"].localeCompare(b["Page URL"]));
occurrenceRows.sort((a, b) => {
  const byForm = a["Form ID"].localeCompare(b["Form ID"]);
  return byForm !== 0 ? byForm : a["Page URL"].localeCompare(b["Page URL"]);
});

const usageRows = buildUsageSummary(occurrenceRows);
const unmatchedLiveRows = occurrenceRows.filter((row) => row["Matched HubSpot Export"] !== "Yes");
const unusedExportRows = buildUnusedExportRows(
  hubSpotData.sourceRows,
  discoveredKnownFormIds
);

await writeCsv("page-audit.csv", pageRows, [
  "Page URL",
  "Final URL",
  "HTTP Status",
  "Content Type",
  "Page Title",
  "Forms Found",
  "Matched Export Forms",
  "Duration ms",
  "Error"
]);

await writeCsv("live-form-occurrences.csv", occurrenceRows, [
  "Page URL",
  "Final URL",
  "Page Title",
  "HTTP Status",
  "Form ID",
  "Portal ID",
  "HubSpot Form Name",
  "HubSpot Form Status",
  "Matched HubSpot Export",
  "Detection Method",
  "Form Submissions",
  "Page Views",
  "Last Submission"
]);

await writeCsv("form-usage-summary.csv", usageRows, [
  "Form ID",
  "HubSpot Form Name",
  "HubSpot Form Status",
  "Matched HubSpot Export",
  "Pages Found On",
  "Live URLs",
  "Detection Methods",
  "Form Submissions",
  "Page Views",
  "Last Submission"
]);

await writeCsv("unmatched-live-forms.csv", unmatchedLiveRows, [
  "Page URL",
  "Final URL",
  "Page Title",
  "HTTP Status",
  "Form ID",
  "Portal ID",
  "Detection Method"
]);

if (config.hubspot) {
  const exportHeaders = hubSpotData.sourceRows.length
    ? Object.keys(hubSpotData.sourceRows[0])
    : [];

  await writeCsv("hubspot-forms-not-found-on-site.csv", unusedExportRows, exportHeaders);
}

const failedPages = pageRows.filter((row) => row.Error).length;
const pagesWithForms = pageRows.filter((row) => Number(row["Forms Found"]) > 0).length;
const exactMatches = usageRows.filter((row) => row["Matched HubSpot Export"] === "Yes").length;

const summary = {
  generatedAt: new Date().toISOString(),
  site: baseUrl,
  host: allowedHost,
  settings: {
    concurrency: config.concurrency,
    timeoutMs: config.timeoutMs,
    delayMs: config.delayMs,
    maxPages: config.maxPages,
    followLinks: config.followLinks
  },
  discovery: {
    sitemapCount: sitemapUrls.length,
    sitemapPageUrls: sitemapPageUrls.length,
    seedUrls: seedUrls.length
  },
  results: {
    pagesVisited: pageRows.length,
    failedOrSkippedPages: failedPages,
    pagesWithForms,
    formOccurrences: occurrenceRows.length,
    uniqueFormIds: usageRows.length,
    exactMatchesToHubSpotExport: exactMatches,
    unmatchedLiveFormIds: usageRows.length - exactMatches,
    hubSpotExportForms: hubSpotData.knownForms.size,
    hubSpotExportFormsNotFoundOnSite: config.hubspot ? unusedExportRows.length : null
  }
};

await writeFile(
  resolve(config.out, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
  "utf8"
);

console.log("");
console.log("Done.");
console.log(JSON.stringify(summary.results, null, 2));
console.log(`Output directory: ${resolve(config.out)}`);

async function discoverSitemaps(site) {
  const values = new Set();

  try {
    const robotsUrl = new URL("/robots.txt", site).toString();
    const response = await fetchWithTimeout(robotsUrl);
    const robots = await response.text();

    for (const line of robots.split(/\r?\n/)) {
      const match = line.match(/^\s*Sitemap:\s*(\S+)\s*$/i);

      if (match) {
        values.add(match[1]);
      }
    }
  } catch (error) {
    console.warn(`Could not read robots.txt: ${error.message}`);
  }

  if (values.size === 0) {
    values.add(new URL("/sitemap.xml", site).toString());
  }

  return [...values];
}

async function discoverPageUrlsFromSitemaps(sitemapUrls, host) {
  const pageUrls = new Set();
  const visitedSitemaps = new Set();

  async function visitSitemap(sitemapUrl, depth = 0) {
    if (visitedSitemaps.has(sitemapUrl) || depth > 8) {
      return;
    }

    visitedSitemaps.add(sitemapUrl);

    try {
      const response = await fetchWithTimeout(sitemapUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xml = await response.text();
      const locs = extractSitemapLocs(xml);

      if (isSitemapIndex(xml)) {
        for (const loc of locs) {
          await visitSitemap(loc, depth + 1);
        }

        return;
      }

      for (const loc of locs) {
        try {
          const normalized = normalizeUrl(loc);

          if (isHtmlCandidate(normalized, host)) {
            pageUrls.add(normalized);
          }
        } catch {
          // Ignore malformed sitemap URLs.
        }
      }
    } catch (error) {
      console.warn(`Sitemap failed: ${sitemapUrl} (${error.message})`);
    }
  }

  for (const sitemapUrl of sitemapUrls) {
    await visitSitemap(sitemapUrl);
  }

  return [...pageUrls];
}

async function readSeedUrls(filePath, host) {
  if (!filePath) {
    return [];
  }

  try {
    const text = await readFile(resolve(filePath), "utf8");
    const urls = new Set();

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith("#")) {
        continue;
      }

      try {
        const normalized = normalizeUrl(line);

        if (isHtmlCandidate(normalized, host)) {
          urls.add(normalized);
        }
      } catch {
        console.warn(`Ignoring invalid seed URL: ${line}`);
      }
    }

    return [...urls];
  } catch {
    return [];
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    return await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": config.userAgent,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function writeCsv(fileName, rows, headers) {
  const path = resolve(config.out, fileName);
  const csv = toCsv(rows, headers);
  await writeFile(path, csv, "utf8");
}

function buildUsageSummary(rows) {
  const forms = new Map();

  for (const row of rows) {
    const id = row["Form ID"].toLowerCase();

    if (!forms.has(id)) {
      forms.set(id, {
        "Form ID": row["Form ID"],
        "HubSpot Form Name": row["HubSpot Form Name"],
        "HubSpot Form Status": row["HubSpot Form Status"],
        "Matched HubSpot Export": row["Matched HubSpot Export"],
        "Pages Found On": 0,
        "Live URLs": new Set(),
        "Detection Methods": new Set(),
        "Form Submissions": row["Form Submissions"],
        "Page Views": row["Page Views"],
        "Last Submission": row["Last Submission"]
      });
    }

    const entry = forms.get(id);
    entry["Live URLs"].add(row["Final URL"] || row["Page URL"]);

    for (const method of String(row["Detection Method"] || "").split(" + ")) {
      if (method) {
        entry["Detection Methods"].add(method);
      }
    }
  }

  return [...forms.values()]
    .map((entry) => ({
      ...entry,
      "Pages Found On": entry["Live URLs"].size,
      "Live URLs": [...entry["Live URLs"]].sort().join(" | "),
      "Detection Methods": [...entry["Detection Methods"]].sort().join(" | ")
    }))
    .sort((a, b) => {
      const aName = a["HubSpot Form Name"] || a["Form ID"];
      const bName = b["HubSpot Form Name"] || b["Form ID"];
      return aName.localeCompare(bName);
    });
}

function buildUnusedExportRows(sourceRows, discoveredIds) {
  if (!sourceRows.length) {
    return [];
  }

  const idHeader = Object.keys(sourceRows[0]).find(
    (key) => key.trim().toLowerCase() === "form id"
  );

  if (!idHeader) {
    return [];
  }

  return sourceRows.filter((row) => {
    const id = String(row[idHeader] ?? "").trim().toLowerCase();
    return id && !discoveredIds.has(id);
  });
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];

    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = values[index + 1];

    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }

  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined || value === true) {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function booleanArg(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  if (value === true) {
    return true;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
