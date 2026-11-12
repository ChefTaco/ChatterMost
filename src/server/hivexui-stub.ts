import type { Context } from 'hono';

// The standalone web UI is retired: HiveXUI is the UI for the Hive:Magnus product line.
// Old UI paths answer with this static page, or redirect to HIVEXUI_URL when it is configured.

export const HIVEXUI_STUB_PATHS = ['/', '/login', '/signup', '/admin/system-console'] as const;

export const HIVEXUI_URL_ERROR = 'HIVEXUI_URL must be an absolute http(s) URL';

export const HIVEXUI_STUB_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

// Returns the normalized URL, or undefined when the value is not an acceptable HiveXUI address.
export function parseHiveXuiUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (url.username !== '' || url.password !== '') return undefined;
  if (url.hash !== '' || value.includes('#')) return undefined;
  return url.toString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

export function renderHiveXuiStub(product: string, url?: string): string {
  const paragraph = url
    ? `<p><a href="${escapeHtml(url)}">Open HiveXUI</a> to manage ${product}.</p>`
    : `<p>Open HiveXUI to manage ${product}. Operators can set HIVEXUI_URL so this address redirects there.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${product} is managed in HiveXUI</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}</style>
</head>
<body>
<main>
<h1>${product} is managed in HiveXUI</h1>
${paragraph}
</main>
</body>
</html>
`;
}

export function hiveXuiStubResponse(c: Context, product: string, url?: string): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': HIVEXUI_STUB_CSP,
    'X-Content-Type-Options': 'nosniff'
  };
  if (url) headers.Location = url;
  return c.body(renderHiveXuiStub(product, url), url ? 302 : 200, headers);
}
