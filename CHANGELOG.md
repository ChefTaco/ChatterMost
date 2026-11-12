# Changelog

Notable changes to ChatterMost. Versions follow the release tags; see
[maintainer releases](docs/releases.md) for the release process.

## [Unreleased]

### Changed

- HiveXUI is now the only UI for ChatterMost and the rest of the Hive:Magnus
  product line. Old bookmarks to `/`, `/login`, `/signup` and
  `/admin/system-console` move to HiveXUI: they serve a small static page saying
  ChatterMost is managed in HiveXUI, or, when the new optional `HIVEXUI_URL`
  setting is configured, a `302` redirect to that address. `HIVEXUI_URL` must be an
  absolute `http(s)` URL without credentials or fragment; an invalid value stops
  startup.
- The Playwright suite now checks the real server's ping, login and WebSocket
  paths for the official apps instead of driving the retired web UI.

### Removed

- The standalone web UI is retired: its HTML shell, `/assets/styles.css`,
  `/assets/app.js` and `/favicon.svg` are no longer served. The official desktop
  app, which loads a server-hosted web UI, should be replaced by HiveXUI in a
  browser. `/api/v4`, the WebSocket and the browser API contracts used by HiveXUI
  are unchanged.
