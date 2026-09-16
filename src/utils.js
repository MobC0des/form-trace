const GUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
const GUID_RE = new RegExp(GUID_PATTERN, "g");

export function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";

  if (url.pathname !== "/") {
    const trimmedPath = url.pathname.replace(/\/+$/, "");
    const lastSegment = trimmedPath.split("/").pop() ?? "";

    // Canonicalise normal content routes with a trailing slash, but leave
    // file-like paths alone so asset-extension filtering still works.
    url.pathname = lastSegment.includes(".")
      ? trimmedPath
      : `${trimmedPath}/`;
  }

  return url.toString();
}

export function isHtmlCandidate(value, allowedHost) {
  let url;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  if (url.hostname !== allowedHost) {
    return false;
  }

  const path = url.pathname.toLowerCase();

  const blockedExtensions = [
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".rar", ".7z", ".mp3", ".mp4", ".mov", ".avi", ".webm",
    ".css", ".js", ".json", ".xml", ".txt", ".woff", ".woff2", ".ttf",
    ".eot"
  ];

  return !blockedExtensions.some((extension) => path.endsWith(extension));
}

export function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (!match) {
    return "";
  }

  return decodeHtml(match[1]).replace(/\s+/g, " ").trim();
}

export function extractLinks(html, pageUrl, allowedHost) {
  const links = new Set();
  const hrefRe = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;

  for (const match of html.matchAll(hrefRe)) {
    const href = match[2]?.trim();

    if (!href || href.startsWith("#")) {
      continue;
    }

    try {
      const absolute = normalizeUrl(new URL(href, pageUrl).toString());

      if (isHtmlCandidate(absolute, allowedHost)) {
        links.add(absolute);
      }
    } catch {
      // Ignore malformed links.
    }
  }

  return [...links];
}

export function extractSitemapLocs(xml) {
  const locs = [];
  const locRe = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;

  for (const match of xml.matchAll(locRe)) {
    const value = decodeHtml(match[1]).trim();

    if (value) {
      locs.push(value);
    }
  }

  return locs;
}

export function isSitemapIndex(xml) {
  return /<sitemapindex\b/i.test(xml);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }

      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }

    if (char === ",") {
      row.push(value);
      value = "";
      continue;
    }

    if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    value += char;
  }

  row.push(value);

  if (row.length > 1 || row[0] !== "") {
    rows.push(row);
  }

  return rows;
}

export function csvRowsToObjects(rows) {
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((value) => value.trim());

  return rows.slice(1).map((row) => {
    const object = {};

    headers.forEach((header, index) => {
      object[header] = row[index] ?? "";
    });

    return object;
  });
}

export function toCsv(rows, headers) {
  const escape = (value) => {
    const stringValue = value === null || value === undefined ? "" : String(value);

    if (/[",\r\n]/.test(stringValue)) {
      return `"${stringValue.replaceAll('"', '""')}"`;
    }

    return stringValue;
  };

  const lines = [headers.map(escape).join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(","));
  }

  return lines.join("\n") + "\n";
}

export function loadHubSpotForms(csvText) {
  const objects = csvRowsToObjects(parseCsv(csvText));

  const knownForms = new Map();

  for (const row of objects) {
    const formId = findValue(row, ["Form ID", "form id", "formId", "guid"]).trim();

    if (!isGuid(formId)) {
      continue;
    }

    knownForms.set(formId.toLowerCase(), {
      id: formId,
      name: findValue(row, ["Name", "Form Name", "name"]),
      status: findValue(row, ["Status", "status"]),
      submissions: findValue(row, ["Form Submissions", "Submissions"]),
      pageViews: findValue(row, ["Page Views"]),
      lastSubmission: findValue(row, ["Last submission received", "Last Submission"]),
      raw: row
    });
  }

  return {
    knownForms,
    sourceRows: objects
  };
}

export function detectHubSpotForms(html, knownForms = new Map()) {
  const detections = new Map();
  const portalIds = detectPortalIds(html);
  const pagePortalId = portalIds[0] ?? "";

  const add = (formId, method) => {
    if (!isGuid(formId)) {
      return;
    }

    const normalized = formId.toLowerCase();
    const known = knownForms.get(normalized);

    const existing = detections.get(normalized);

    if (existing) {
      if (!existing.methods.includes(method)) {
        existing.methods.push(method);
      }
      return;
    }

    detections.set(normalized, {
      formId,
      portalId: pagePortalId,
      methods: [method],
      matchedExport: Boolean(known),
      formName: known?.name ?? "",
      formStatus: known?.status ?? "",
      formSubmissions: known?.submissions ?? "",
      pageViews: known?.pageViews ?? "",
      lastSubmission: known?.lastSubmission ?? ""
    });
  };

  // Strongest signal for this audit:
  // if a GUID in the page exists in the HubSpot export, it is an exact ID match.
  for (const match of html.matchAll(GUID_RE)) {
    const formId = match[0];

    if (knownForms.has(formId.toLowerCase())) {
      add(formId, "known HubSpot Form ID found in HTML");
    }
  }

  const explicitPatterns = [
    {
      name: "formId config",
      regex: new RegExp(`(?:formId|form_id)\\s*[:=]\\s*["'](${GUID_PATTERN})["']`, "gi")
    },
    {
      name: "data-form-id attribute",
      regex: new RegExp(`(?:data-form-id|data-hs-form-id|form-id)\\s*=\\s*["'](${GUID_PATTERN})["']`, "gi")
    },
    {
      name: "HubSpot form URL",
      regex: new RegExp(`(?:hubspot|hsforms|forms)[^"'\\s]{0,250}(${GUID_PATTERN})`, "gi")
    },
    {
      name: "form context GUID",
      regex: new RegExp(`\\bform\\b[^<]{0,180}?(${GUID_PATTERN})`, "gi")
    }
  ];

  for (const pattern of explicitPatterns) {
    for (const match of html.matchAll(pattern.regex)) {
      add(match[1], pattern.name);
    }
  }

  return [...detections.values()].sort((a, b) => a.formId.localeCompare(b.formId));
}

export function detectPortalIds(html) {
  const values = new Set();

  const patterns = [
    /(?:portalId|portal_id)\s*[:=]\s*["']?(\d{4,})["']?/gi,
    /(?:data-portal-id|portal-id)\s*=\s*["'](\d{4,})["']/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      values.add(match[1]);
    }
  }

  return [...values];
}

export function isGuid(value) {
  return new RegExp(`^${GUID_PATTERN}$`, "i").test(value);
}

function findValue(object, candidates) {
  const entries = Object.entries(object);

  for (const candidate of candidates) {
    const target = candidate.toLowerCase().replace(/\s+/g, " ").trim();
    const match = entries.find(([key]) => key.toLowerCase().replace(/\s+/g, " ").trim() === target);

    if (match) {
      return String(match[1] ?? "");
    }
  }

  return "";
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
