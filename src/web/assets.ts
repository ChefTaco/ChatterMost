export const webFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#172126"/>
  <path d="M15 16h34a7 7 0 0 1 7 7v19a7 7 0 0 1-7 7H34l-11 9v-9h-8a7 7 0 0 1-7-7V23a7 7 0 0 1 7-7Z" fill="#f7f3e8"/>
  <path d="M18 21h27a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H30l-8 7v-7h-4a6 6 0 0 1-6-6V27a6 6 0 0 1 6-6Z" fill="#149a91"/>
  <circle cx="48" cy="18" r="7" fill="#e1a72f"/>
  <rect x="21" y="29" width="21" height="4" rx="2" fill="#ffffff"/>
  <rect x="21" y="37" width="14" height="4" rx="2" fill="#ffffff"/>
</svg>`;

export const webStyles = `
:root {
  color-scheme: light;
  --ink: #202426;
  --muted: #687077;
  --panel: #ffffff;
  --field: #f5f7f8;
  --line: #d8dee2;
  --rail: #172126;
  --rail-2: #25313d;
  --teal: #149a91;
  --teal-dark: #08746f;
  --amber: #e1a72f;
  --cranberry: #a63d57;
  --paper: #f7f3e8;
  --focus: #0b6fdb;
  --app-bg: #edf1f3;
  --chat-bg: #ffffff;
  --side-bg: #f8fafb;
  --composer-bg: #fbfcfd;
  --notice-bg: #fff8e7;
  --notice-text: #614b10;
  --success-bg: #e9f8f4;
  --success-text: #11584f;
  --error-bg: #fdeff2;
  --error-text: #6d1730;
  --reaction-border: #e4d9b9;
  --active-bg: #202426;
  --active-ink: #ffffff;
  --sidebar-bg: #25313d;
  --sidebar-ink: #ffffff;
  --sidebar-muted: #b7c3ca;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body.theme-dark {
  color-scheme: dark;
  --ink: #eef4f3;
  --muted: #a9bac0;
  --panel: #11181d;
  --field: #172228;
  --line: #2e3b43;
  --rail: #081015;
  --rail-2: #15222a;
  --teal: #26b7a8;
  --teal-dark: #75ddd4;
  --amber: #d4b05a;
  --cranberry: #e07291;
  --paper: #18251f;
  --focus: #68a8ff;
  --app-bg: #0f1519;
  --chat-bg: #121a1f;
  --side-bg: #10171c;
  --composer-bg: #121a1e;
  --notice-bg: #2d2412;
  --notice-text: #ffe7a3;
  --success-bg: #12342f;
  --success-text: #c3f4e9;
  --error-bg: #341824;
  --error-text: #ffc6d5;
  --reaction-border: #385041;
  --active-bg: #d4b05a;
  --active-ink: #11181d;
  --sidebar-bg: #15222a;
  --sidebar-ink: #f6fbfb;
  --sidebar-muted: #b8c9cd;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--app-bg);
  color: var(--ink);
}

button,
input,
textarea,
select {
  font: inherit;
}

button,
.icon-button {
  border: 0;
  border-radius: 6px;
  background: var(--teal);
  color: white;
  min-height: 36px;
  padding: 0 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 180ms ease, color 180ms ease, border-color 180ms ease, transform 180ms ease;
}

button:hover:not(:disabled),
.icon-button:hover:not(:disabled) {
  transform: translateY(-1px);
}

button:disabled,
.icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

button.secondary {
  background: var(--rail-2);
}

button.warning {
  background: var(--cranberry);
}

button.ghost {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--focus), white 55%);
  outline-offset: 2px;
}

a {
  color: var(--teal-dark);
}

.auth-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(280px, 440px) 1fr;
}

.auth-panel {
  background: var(--panel);
  padding: 56px;
  border-right: 1px solid var(--line);
}

.auth-panel h1,
.auth-panel h2 {
  margin: 0 0 12px;
  font-size: 34px;
  letter-spacing: 0;
}

.auth-panel p {
  color: var(--muted);
  line-height: 1.5;
}

.auth-art {
  background:
    linear-gradient(90deg, rgba(23, 33, 38, 0.92), rgba(23, 33, 38, 0.72)),
    repeating-linear-gradient(0deg, #26333a 0 1px, transparent 1px 42px),
    repeating-linear-gradient(90deg, #26333a 0 1px, transparent 1px 42px),
    var(--rail);
  color: white;
  display: grid;
  align-content: center;
  padding: 64px;
}

.switchboard {
  max-width: 760px;
}

.switchboard h2 {
  font-size: clamp(34px, 6vw, 76px);
  line-height: 0.95;
  margin: 0;
  letter-spacing: 0;
}

.switchboard p {
  color: #c5d0d5;
  max-width: 560px;
  line-height: 1.6;
}

.signal-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(70px, 1fr));
  gap: 10px;
  margin-top: 28px;
  max-width: 520px;
}

.signal {
  min-height: 76px;
  border: 1px solid rgba(255,255,255,0.18);
  display: grid;
  place-items: center;
  color: white;
  background: rgba(255,255,255,0.06);
}

.signal:nth-child(2) { border-top: 6px solid var(--teal); }
.signal:nth-child(3) { border-top: 6px solid var(--amber); }
.signal:nth-child(4) { border-top: 6px solid var(--cranberry); }

.form-stack {
  display: grid;
  gap: 14px;
  margin-top: 28px;
}

label {
  display: grid;
  gap: 6px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--line);
  background: var(--field);
  color: var(--ink);
  border-radius: 6px;
  padding: 10px 12px;
  transition: background 180ms ease, color 180ms ease, border-color 180ms ease;
}

input::placeholder,
textarea::placeholder {
  color: var(--muted);
  opacity: 1;
}

textarea {
  min-height: 82px;
  resize: vertical;
}

.app-shell {
  min-height: 100vh;
  height: 100vh;
  overflow: hidden;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) minmax(300px, 380px);
  background: var(--app-bg);
}

.team-rail {
  background: var(--rail);
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 12px 8px;
}

.team-button,
.rail-button {
  width: 48px;
  height: 48px;
  min-height: 48px;
  padding: 0;
  border-radius: 8px;
  background: var(--rail-2);
  color: white;
}

.team-button.active {
  background: var(--teal);
}

.channel-sidebar {
  background: var(--sidebar-bg);
  color: var(--sidebar-ink);
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 100vh;
}

.sidebar-head {
  padding: 16px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
  display: grid;
  gap: 10px;
}

.sidebar-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: space-between;
  min-width: 0;
}

.sidebar-head h1 {
  margin: 0;
  font-size: 18px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.admin-title-button {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.22);
  color: var(--sidebar-ink);
  font-size: 12px;
}

.profile-chip {
  width: 100%;
  min-height: 46px;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid rgba(255,255,255,0.2);
  background: rgba(255,255,255,0.06);
  color: var(--sidebar-ink);
  text-align: left;
}

.profile-chip-avatar {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--teal);
  color: white;
  font-size: 12px;
  font-weight: 900;
}

.profile-chip-name,
.profile-chip-subtitle {
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
}

.profile-chip-name {
  font-weight: 850;
}

.profile-chip-subtitle {
  color: var(--sidebar-muted);
  font-size: 12px;
  margin-top: 1px;
}

.channel-list {
  overflow: auto;
  padding: 10px 8px;
}

.mobile-channel-picker {
  display: none;
}

.channel-group {
  color: var(--sidebar-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 12px 8px 6px;
}

.channel-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-start;
  background: transparent;
  color: white;
  min-height: 32px;
  padding: 0 10px;
  text-align: left;
  font-weight: 600;
}

.channel-row-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px;
}

.channel-row-wrap .channel-row {
  min-width: 0;
}

.channel-row-wrap .row-icon-actions {
  opacity: 0.72;
}

.channel-row-wrap:hover .row-icon-actions,
.channel-row-wrap:focus-within .row-icon-actions {
  opacity: 1;
}

.channel-row.active {
  background: rgba(255,255,255,0.12);
}

.channel-row.join-row {
  color: var(--sidebar-muted);
  border: 1px dashed rgba(255,255,255,0.28);
}

.sidebar-foot {
  padding: 12px;
  display: grid;
  gap: 8px;
  border-top: 1px solid rgba(255,255,255,0.1);
}

.sidebar-foot .ghost {
  color: white;
  border-color: rgba(255,255,255,0.72);
}

.chat-pane {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--chat-bg);
  border-right: 1px solid var(--line);
  position: relative;
}

.chat-pane.gallery-open {
  grid-template-rows: auto minmax(0, 1fr);
}

.chat-pane.has-chrome {
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.chat-chrome {
  display: grid;
  min-width: 0;
}

.chat-header {
  min-height: 54px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.chat-header h2 {
  margin: 0;
  font-size: 18px;
}

.chat-header p {
  margin: 1px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.chat-title {
  min-width: 0;
}

.chat-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.theme-toggle {
  width: 40px;
  height: 40px;
  min-height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line);
  background: var(--field);
  color: var(--ink);
  font-size: 19px;
  line-height: 1;
}

.chat-actions .icon-only {
  min-width: 40px;
}

.post-history {
  position: relative;
  min-height: 0;
  display: grid;
}

.post-list {
  overflow: auto;
  padding: 10px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
}

.history-loader {
  position: relative;
  display: grid;
  grid-template-columns: minmax(18px, 1fr) auto minmax(18px, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 24px;
  margin: 2px 0 7px;
  padding: 0 4px;
  background: transparent;
  color: var(--muted);
  border: 0;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.02em;
}

.history-loader::before,
.history-loader::after {
  content: "";
  height: 1px;
  background: var(--line);
}

.history-loader:hover:not(:disabled),
.history-loader:focus-visible {
  background: color-mix(in srgb, var(--teal) 10%, transparent);
  color: var(--ink);
  transform: none;
}

.jump-to-bottom {
  position: absolute;
  right: 18px;
  bottom: 18px;
  z-index: 12;
  display: grid;
  place-items: center;
  width: 42px;
  min-width: 42px;
  height: 42px;
  min-height: 42px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  box-shadow: 0 12px 30px rgba(8, 16, 21, 0.22);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(6px);
  transition: opacity 140ms ease, transform 140ms ease, visibility 140ms ease;
}

.jump-to-bottom.visible {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0);
}

.jump-to-bottom .composer-icon svg {
  width: 22px;
  height: 22px;
}

.post {
  position: relative;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 10px;
  padding: 5px 10px 5px 8px;
  border-radius: 8px;
}

.post:hover {
  background: color-mix(in srgb, var(--ink) 4%, transparent);
}

.post.post-highlight {
  background: color-mix(in srgb, var(--amber) 24%, transparent);
}

.bot-response-indicator {
  color: var(--muted);
}

.bot-response-indicator:hover {
  background: transparent;
}

.bot-response-bubble {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  max-width: 100%;
  padding: 8px 11px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--field);
}

.bot-response-label {
  color: var(--muted);
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.typing-dots span {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--teal);
  animation: typing-dot 1.1s infinite ease-in-out;
}

.typing-dots span:nth-child(2) {
  animation-delay: 150ms;
}

.typing-dots span:nth-child(3) {
  animation-delay: 300ms;
}

@keyframes typing-dot {
  0%, 70%, 100% {
    opacity: 0.34;
    transform: translateY(0);
  }
  35% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .typing-dots span {
    animation: none;
    opacity: 0.82;
    transform: none;
  }
}

.post.grouped {
  margin-top: -1px;
}

.post.grouped .avatar {
  visibility: hidden;
  height: 0;
}

.post.grouped .post-meta {
  display: none;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--rail-2);
  color: white;
  display: grid;
  place-items: center;
  font-weight: 900;
  font-size: 12px;
  overflow: hidden;
}

.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.post-body {
  min-width: 0;
}

.post-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  row-gap: 2px;
  margin-bottom: 1px;
}

.post-author {
  font-weight: 800;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.webhook-marker {
  border: 1px solid color-mix(in srgb, var(--accent) 48%, transparent);
  border-radius: 999px;
  color: var(--accent);
  font-size: 9px;
  font-weight: 900;
  letter-spacing: .08em;
  line-height: 1;
  padding: 3px 5px;
}

.webhook-details {
  color: var(--muted);
  font-size: 11px;
}

.webhook-details summary {
  cursor: pointer;
  font-weight: 700;
}

.webhook-details span {
  display: block;
  margin-top: 3px;
}

.post-time {
  color: var(--muted);
  font-size: 11px;
}

.post-message {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.46;
  font-size: 14px;
}

.post-reactions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 5px;
}

.post-actions {
  position: absolute;
  top: -12px;
  right: 8px;
  display: flex;
  gap: 1px;
  padding: 2px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 9px;
  box-shadow: 0 6px 18px rgba(8, 16, 21, 0.16);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.post:hover .post-actions,
.post:focus-within .post-actions {
  opacity: 1;
  pointer-events: auto;
}

.post-actions button {
  background: transparent;
  color: var(--muted);
  min-height: 26px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 700;
  border-radius: 6px;
}

.post-actions button:hover:not(:disabled) {
  background: var(--field);
  color: var(--ink);
  transform: none;
}

.post-actions button.warning-action:hover:not(:disabled) {
  background: var(--error-bg);
  color: var(--error-text);
}

.post-more {
  display: none;
  position: absolute;
  top: 4px;
  right: 6px;
  background: transparent;
  color: var(--muted);
  min-height: 30px;
  min-width: 30px;
  padding: 0;
  font-size: 20px;
  line-height: 1;
  border-radius: 8px;
}

.reaction {
  background: var(--paper);
  color: var(--ink);
  min-height: 24px;
  border: 1px solid var(--reaction-border);
  padding: 0 9px;
  font-size: 12px;
  font-weight: 700;
  border-radius: 13px;
}

.reaction-emoji {
  font-size: 15px;
  line-height: 1;
}

.composer {
  border-top: 1px solid var(--line);
  padding: 12px;
  display: grid;
  gap: 8px;
  background: var(--composer-bg);
}

.command-palette {
  max-height: 286px;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--teal) 42%, var(--line));
  border-radius: 12px;
  background: color-mix(in srgb, var(--panel) 96%, var(--teal));
  box-shadow: 0 14px 32px rgba(8, 16, 21, 0.16);
}

.command-palette-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--panel) 96%, var(--teal));
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.command-palette-head span:last-child {
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}

.command-option {
  width: 100%;
  min-height: 48px;
  display: grid;
  grid-template-columns: minmax(112px, auto) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
}

.command-option:last-child { border-bottom: 0; }
.command-option:hover,
.command-option.active {
  background: color-mix(in srgb, var(--teal) 12%, var(--panel));
}

.command-token {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  color: var(--teal-dark);
  font-weight: 850;
  white-space: nowrap;
}

.command-description {
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.composer.dragging {
  background: color-mix(in srgb, var(--teal) 12%, var(--composer-bg));
  box-shadow: inset 0 0 0 2px var(--teal);
}

.composer-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.composer-icon {
  color: var(--ink);
  line-height: 1;
}

.composer-icon svg {
  width: 20px;
  height: 20px;
  display: block;
}

.icon-only {
  width: 36px;
  min-width: 36px;
  height: 36px;
  min-height: 36px;
  padding: 0;
  display: inline-grid;
  place-items: center;
}

.icon-only .composer-icon {
  display: grid;
  place-items: center;
}

.row-icon-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.row-icon-actions .icon-only {
  width: 30px;
  min-width: 30px;
  height: 30px;
  min-height: 30px;
  border-color: rgba(255,255,255,0.18);
  color: var(--sidebar-ink);
}

.file-picker {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--field);
  color: var(--ink);
  padding: 0 12px;
  font-weight: 800;
  cursor: pointer;
}

.file-picker-text {
  margin-left: 6px;
}

.file-picker input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.emoji-picker {
  position: relative;
  min-width: 0;
}

.emoji-picker .composer-icon {
  pointer-events: none;
}

.emoji-button {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 42px;
  min-height: 36px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--field);
  color: var(--ink);
}

.emoji-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 10px);
  width: min(340px, calc(100vw - 24px));
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: 0 18px 44px rgba(8, 16, 21, 0.24);
  z-index: 30;
}

.emoji-popover h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.emoji-popover-head {
  display: grid;
  gap: 8px;
  margin-bottom: 10px;
}

.emoji-popover-head h4 {
  margin: 0;
}

.emoji-section {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.emoji-section-label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}

.emoji-grid.compact {
  grid-template-columns: repeat(6, 1fr);
}

.emoji-choice {
  min-width: 0;
  min-height: 34px;
  padding: 0;
  display: grid;
  place-items: center;
  background: transparent;
  color: var(--ink);
  border: 1px solid transparent;
  font-size: 20px;
  border-radius: 8px;
}

.emoji-choice:hover:not(:disabled),
.emoji-choice:focus-visible {
  background: var(--field);
  border-color: var(--line);
  transform: none;
}

.attachment-tray {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.attachment-chip {
  max-width: 260px;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--field);
}

.attachment-thumb {
  width: 42px;
  height: 42px;
  border-radius: 6px;
  background: var(--panel);
  display: grid;
  place-items: center;
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.attachment-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.attachment-name,
.attachment-meta {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-name {
  font-size: 13px;
  font-weight: 800;
}

.attachment-meta {
  color: var(--muted);
  font-size: 12px;
}

.attachment-remove {
  min-width: 28px;
  min-height: 28px;
  padding: 0;
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 6px;
}

.side-panel {
  min-width: 0;
  min-height: 100vh;
  max-height: 100vh;
  position: relative;
  z-index: 2;
  background: var(--side-bg);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}

.panel-header {
  min-width: 0;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--line);
}

.panel-header h2 {
  margin: 0;
  font-size: 18px;
}

.panel-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid var(--line);
}

.panel-tabs button {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
  white-space: nowrap;
}

.panel-tabs button.active {
  background: var(--active-bg);
  color: var(--active-ink);
}

.panel-close {
  display: inline-grid;
  place-items: center;
  background: var(--field);
  color: var(--ink);
  border: 1px solid var(--line);
}

.panel-body {
  padding: 16px;
  overflow: auto;
}

.thread-panel {
  background: var(--side-bg);
}

.thread-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.thread-header h3 {
  margin: 0;
  font-size: 18px;
}

.thread-header p {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.thread-body {
  padding: 16px;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 14px;
}

.thread-root {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  padding: 12px;
}

.thread-label {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.thread-replies {
  display: grid;
  gap: 0;
}

.thread-reply {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}

.thread-reply:first-child {
  border-top: 0;
}

.thread-root .thread-reply {
  border-top: 0;
  padding: 0;
}

.thread-reply .avatar {
  width: 32px;
  height: 32px;
}

.thread-composer {
  display: grid;
  gap: 8px;
  padding-top: 4px;
}

.message-search {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) auto auto;
  gap: 8px;
  align-items: end;
}

.message-search label {
  min-width: 0;
}

.search-shelf {
  display: grid;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--side-bg);
  position: relative;
  z-index: 25;
}

.onboarding-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--notice-bg);
  color: var(--notice-text);
}

.onboarding-strip strong,
.onboarding-strip span {
  display: block;
}

.onboarding-strip span {
  font-size: 13px;
}

.compact-search-notice {
  margin: 0;
}

.search-results {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.search-result {
  flex: 0 0 min(360px, 86vw);
  display: grid;
  gap: 3px;
  min-height: 76px;
  padding: 9px 10px;
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--line);
  text-align: left;
}

.search-result-channel,
.search-result-meta {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.search-result-message {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gallery-view {
  min-height: 0;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 16px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--field) 80%, transparent), transparent 160px),
    var(--chat-bg);
}

.gallery-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.gallery-head h3 {
  margin: 0;
  font-size: 18px;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.gallery-item {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--ink);
  text-decoration: none;
}

.gallery-thumb {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: var(--field);
}

.gallery-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gallery-meta {
  display: grid;
  gap: 2px;
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.gallery-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
}

.section h3 {
  margin: 0;
  font-size: 17px;
}

.data-row {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  padding: 8px 0;
}

.data-row > span:first-child {
  min-width: 0;
  overflow-wrap: anywhere;
}

.admin-user-card {
  display: grid;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}

.admin-user-card.disabled {
  opacity: 0.78;
}

.admin-user-main {
  display: grid;
  gap: 2px;
}

.admin-user-name {
  font-weight: 900;
  overflow-wrap: anywhere;
}

.admin-user-meta {
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.reset-password-form {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.policy-channel {
  color: var(--muted);
  font-weight: 900;
}

.agent-list {
  display: grid;
}

.health-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.metric-tile {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.metric-tile span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.metric-tile strong {
  overflow-wrap: anywhere;
}

.rotated-token {
  display: grid;
  gap: 8px;
}

.rotated-token textarea {
  min-height: 70px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.dm-list {
  display: grid;
  gap: 8px;
}

.dm-person {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.dm-person .avatar {
  width: 36px;
  height: 36px;
}

.dm-person-name,
.dm-person-meta {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dm-person-name {
  font-weight: 900;
}

.dm-person-meta {
  color: var(--muted);
  font-size: 12px;
}

.file-row,
.pinned-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--ink);
  text-align: left;
  text-decoration: none;
}

.pinned-row {
  grid-template-columns: minmax(0, 1fr);
}

.file-row-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--field);
}

.file-row-title,
.file-row-meta {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-row-title {
  font-weight: 900;
}

.file-row-meta {
  color: var(--muted);
  font-size: 12px;
}

.row-actions,
.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.notice {
  padding: 10px 12px;
  border-left: 4px solid var(--amber);
  background: var(--notice-bg);
  color: var(--notice-text);
}

.compact-notice {
  margin: 8px;
  font-size: 13px;
}

.success {
  border-left-color: var(--teal);
  background: var(--success-bg);
  color: var(--success-text);
}

.error {
  border-left-color: var(--cranberry);
  background: var(--error-bg);
  color: var(--error-text);
}

[data-error]:empty {
  display: none;
}

.file-previews {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.file-preview-link {
  position: relative;
  display: inline-grid;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px;
  max-width: 260px;
  background: var(--field);
  color: var(--ink);
  text-decoration: none;
}

.file-preview-link img {
  max-width: 240px;
  max-height: 180px;
  object-fit: contain;
  border-radius: 4px;
}

.file-attachment-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.file-preview-hint {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--ink);
  border: 1px solid var(--line);
  font-size: 11px;
  font-weight: 900;
  opacity: 0;
  transform: translateY(3px);
  transition: opacity 120ms ease, transform 120ms ease;
}

.file-preview-link:hover .file-preview-hint,
.file-preview-link:focus-visible .file-preview-hint {
  opacity: 1;
  transform: translateY(0);
}

.profile-preview {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.profile-preview .avatar {
  width: 56px;
  height: 56px;
}

.profile-preview strong,
.profile-preview span {
  display: block;
  overflow-wrap: anywhere;
}

.profile-preview span {
  color: var(--muted);
  font-size: 13px;
}

.check-row {
  min-height: 44px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--line);
}

.check-row input {
  width: 20px;
  height: 20px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(8, 16, 21, 0.52);
}

.modal-card {
  width: min(560px, 100%);
  max-height: min(720px, calc(100vh - 36px));
  overflow: auto;
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 24px 80px rgba(8, 16, 21, 0.34);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-head h2 {
  margin: 0;
  font-size: 18px;
}

.modal-form {
  display: grid;
  gap: 10px;
}

.inline-edit {
  display: grid;
  gap: 8px;
}

.custom-emoji-form,
.custom-emoji-manager {
  display: grid;
  gap: 10px;
}

.two-column-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(92px, 120px);
  gap: 8px;
}

.custom-emoji-list {
  display: grid;
}

@media (max-width: 980px) {
  .auth-shell {
    grid-template-columns: 1fr;
  }
  .auth-art {
    min-height: 34vh;
    padding: 32px;
  }
  .app-shell {
    grid-template-columns: minmax(210px, 260px) minmax(0, 1fr);
  }
  .side-panel {
    grid-column: 1 / 3;
    min-height: 360px;
    border-top: 1px solid var(--line);
  }
}

@media (max-width: 720px) {
  .auth-panel {
    padding: 28px;
  }
  .app-shell {
    grid-template-columns: 1fr;
    display: flex;
    flex-direction: column;
  }
  .team-rail {
    display: none;
  }
  .channel-sidebar {
    order: 1;
    min-height: auto;
    display: block;
  }
  .sidebar-head {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    padding: 7px 12px 5px;
    gap: 10px;
  }
  .sidebar-title-row {
    min-width: 0;
  }
  .sidebar-head h1 {
    font-size: 15px;
  }
  .admin-title-button {
    min-height: 28px;
    padding: 0 8px;
  }
  .profile-chip {
    width: auto;
    min-height: 34px;
    grid-template-columns: 28px;
    padding: 3px;
  }
  .profile-chip-avatar {
    width: 28px;
    height: 28px;
  }
  .profile-chip-name,
  .profile-chip-subtitle {
    display: none;
  }
  .mobile-channel-picker {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 0 12px 6px;
  }
  .mobile-channel-label {
    display: none;
  }
  .mobile-channel-picker select {
    min-height: 34px;
    min-width: 0;
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.22);
    color: var(--sidebar-ink);
    font-weight: 800;
  }
  .mobile-channel-picker .compact-notice {
    grid-column: 1 / -1;
    margin: 0;
  }
  .channel-list {
    display: none;
  }
  .sidebar-foot {
    display: flex;
    gap: 8px;
    padding: 0 12px 8px;
    border-top: 0;
  }
  .sidebar-foot button {
    flex: 1 1 0;
    min-width: 0;
    min-height: 30px;
    padding: 0 10px;
    font-size: 12px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.16);
    color: var(--sidebar-ink);
    font-weight: 700;
  }
  .chat-pane {
    order: 2;
    min-height: 72vh;
  }
  .chat-header {
    min-height: 0;
    padding: 8px 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
  .chat-header h2 {
    font-size: 17px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-header p {
    display: none;
  }
  .chat-actions {
    width: auto;
    flex-wrap: nowrap;
  }
  .chat-actions .ghost {
    min-height: 36px;
    padding: 0 12px;
  }
  .chat-actions .search-toggle {
    width: 36px;
    padding: 0;
    overflow: hidden;
    color: transparent;
    position: relative;
  }
  .chat-actions .search-toggle::before {
    content: "⌕";
    color: var(--ink);
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 19px;
  }
  .theme-toggle {
    width: 36px;
    height: 36px;
    min-height: 36px;
  }
  .search-shelf {
    padding: 8px 10px;
    z-index: 35;
  }
  .gallery-view {
    padding: 12px 10px 112px;
  }
  .gallery-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .onboarding-strip {
    display: grid;
    padding: 9px 10px;
  }
  .message-search {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .message-search .ghost {
    grid-column: 1 / -1;
  }
  .search-results {
    scroll-snap-type: x proximity;
  }
  .search-result {
    scroll-snap-align: start;
  }
  .post-list {
    min-height: 320px;
    padding: 8px 10px 112px;
    gap: 1px;
  }
  .jump-to-bottom {
    right: 14px;
    bottom: 124px;
  }
  .post {
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 10px;
    padding: 5px 42px 5px 8px;
  }
  .avatar {
    width: 34px;
    height: 34px;
  }
  .post-author {
    font-size: 15px;
  }
  .post-time {
    font-size: 11px;
  }
  .post-message {
    font-size: 15px;
  }
  .reaction {
    min-height: 28px;
    padding: 0 9px;
    font-size: 13px;
  }
  .post-more {
    display: grid;
    place-items: center;
  }
  .post-actions {
    position: static;
    display: none;
    opacity: 1;
    grid-column: 2;
    margin-top: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
    flex-wrap: wrap;
    gap: 6px;
  }
  .post.actions-open .post-actions {
    display: flex;
  }
  .post-actions button {
    min-height: 32px;
    font-size: 13px;
    background: var(--field);
    color: var(--ink);
    border: 1px solid var(--line);
  }
  .composer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 20;
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr) 42px minmax(66px, auto);
    align-items: end;
    gap: 8px;
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--line);
    box-shadow: 0 -8px 24px rgba(8, 16, 21, 0.14);
  }
  .composer .notice {
    grid-column: 1 / -1;
    grid-row: 1;
  }
  .command-palette {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: calc(82px + env(safe-area-inset-bottom));
    z-index: 22;
    max-height: min(42vh, 320px);
  }
  .command-option {
    grid-template-columns: minmax(104px, auto) minmax(0, 1fr);
  }
  .attachment-tray {
    grid-column: 1 / -1;
    grid-row: 1;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .attachment-chip {
    flex: 0 0 min(280px, 82vw);
  }
  .composer textarea {
    grid-column: 1 / 4;
    grid-row: 1;
    min-height: 42px;
    max-height: 96px;
    padding: 10px 48px;
    border-radius: 21px;
    font-size: 15px;
    line-height: 1.25;
    resize: none;
  }
  .composer-tools {
    display: contents;
  }
  .composer-tools .file-picker,
  .composer-tools .emoji-button,
  .composer-tools > button {
    min-width: 0;
    width: 100%;
  }
  .composer-tools .file-picker {
    min-height: 42px;
    padding: 0;
  }
  .composer-tools .file-picker {
    grid-column: 1;
    grid-row: 1;
    z-index: 1;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 21px;
    background: transparent;
  }
  .composer-tools .file-picker-text {
    display: none;
  }
  .composer-tools .emoji-picker {
    grid-column: 3;
    grid-row: 1;
    z-index: 1;
    position: relative;
  }
  .composer-tools .emoji-button {
    min-width: 0;
    min-height: 42px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 21px;
    background: transparent;
  }
  .composer-tools .emoji-button .composer-icon {
    transform: none;
  }
  .emoji-popover {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: calc(64px + env(safe-area-inset-bottom));
    width: auto;
    max-height: 42vh;
    overflow: auto;
  }
  .emoji-grid {
    grid-template-columns: repeat(7, 1fr);
  }
  .emoji-grid.compact {
    grid-template-columns: repeat(6, 1fr);
  }
  .emoji-choice {
    min-height: 38px;
    font-size: 22px;
  }
  .composer-tools > button {
    grid-column: 4;
    grid-row: 1;
    min-height: 42px;
    border-radius: 18px;
    padding: 0 14px;
  }
  .composer.has-attachments textarea,
  .composer.has-attachments .composer-tools .file-picker,
  .composer.has-attachments .composer-tools .emoji-picker,
  .composer.has-attachments .composer-tools > button,
  .composer.has-error:not(.has-attachments) textarea,
  .composer.has-error:not(.has-attachments) .composer-tools .file-picker,
  .composer.has-error:not(.has-attachments) .composer-tools .emoji-picker,
  .composer.has-error:not(.has-attachments) .composer-tools > button {
    grid-row: 2;
  }
  .composer.has-error.has-attachments .attachment-tray {
    grid-row: 2;
  }
  .composer.has-error.has-attachments textarea,
  .composer.has-error.has-attachments .composer-tools .file-picker,
  .composer.has-error.has-attachments .composer-tools .emoji-picker,
  .composer.has-error.has-attachments .composer-tools > button {
    grid-row: 3;
  }
  .composer.has-attachments .emoji-popover {
    bottom: calc(174px + env(safe-area-inset-bottom));
  }
  .composer.has-attachments .command-palette {
    bottom: calc(192px + env(safe-area-inset-bottom));
  }
  .composer.has-error.has-attachments .emoji-popover {
    bottom: calc(220px + env(safe-area-inset-bottom));
  }
  .composer.has-error.has-attachments .command-palette {
    bottom: calc(238px + env(safe-area-inset-bottom));
  }
  .composer.has-error:not(.has-attachments) .command-palette {
    bottom: calc(136px + env(safe-area-inset-bottom));
  }
  .side-panel {
    order: 3;
    grid-column: auto;
    display: none;
  }
  .app-shell.panel-open .side-panel {
    display: grid;
    position: fixed;
    inset: 0;
    z-index: 60;
    grid-template-rows: auto 1fr;
    overflow: hidden;
    background: var(--side-bg);
  }
  .app-shell.panel-open .panel-body,
  .app-shell.panel-open .thread-body {
    overflow: auto;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }
  .panel-tabs {
    position: sticky;
    top: 0;
    background: var(--side-bg);
  }
  .panel-tabs button {
    min-height: 32px;
    padding: 0 10px;
    font-size: 12px;
  }
  .panel-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    min-width: 34px;
    padding: 0 10px;
  }
  .health-grid {
    grid-template-columns: 1fr;
  }
  .two-column-fields {
    grid-template-columns: 1fr;
  }
}

/* Conversation-first night lounge */
:root {
  --ink: #242333;
  --muted: #6f6b7c;
  --panel: #ffffff;
  --field: #f3f1f8;
  --line: #ded9e8;
  --rail: #11101d;
  --rail-2: #26223a;
  --teal: #248f89;
  --teal-dark: #16716c;
  --amber: #a87217;
  --cranberry: #b84f5f;
  --paper: #f4efff;
  --focus: #7357db;
  --app-bg: #e9e6f0;
  --chat-bg: #fbfaff;
  --side-bg: #f7f5fb;
  --composer-bg: #f7f5fb;
  --active-bg: #7357db;
  --active-ink: #ffffff;
  --sidebar-bg: #19182a;
  --sidebar-ink: #f1effa;
  --sidebar-muted: #aaa4bd;
  --lilac: #a78bfa;
  --lagoon: #39d0c3;
  --ember: #ff8a72;
  font-family: "Avenir Next", Avenir, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
}

body.theme-dark {
  --ink: #e8e7f2;
  --muted: #aaa8bc;
  --panel: #19182a;
  --field: #211f34;
  --line: #343149;
  --rail: #0a0d17;
  --rail-2: #24213a;
  --teal: #39d0c3;
  --teal-dark: #74e5dc;
  --amber: #efbf69;
  --cranberry: #ff8a72;
  --paper: #28223d;
  --focus: #bba7ff;
  --app-bg: #0b0f1a;
  --chat-bg: #0e1320;
  --side-bg: #131727;
  --composer-bg: #101522;
  --active-bg: #a78bfa;
  --active-ink: #11101d;
  --sidebar-bg: #151424;
  --sidebar-ink: #f4f2fb;
  --sidebar-muted: #aaa5bd;
}

body {
  background:
    radial-gradient(circle at 76% 4%, color-mix(in srgb, var(--lilac) 10%, transparent), transparent 30%),
    var(--app-bg);
}

h1, h2, h3, h4, .post-author, .channel-row, button {
  font-family: "Trebuchet MS", "Avenir Next", ui-rounded, system-ui, sans-serif;
}

button, .icon-button, input, textarea, select {
  border-radius: 12px;
}

.app-shell {
  grid-template-columns: 288px minmax(0, 1fr);
  background: transparent;
}

.app-shell.panel-open {
  grid-template-columns: 288px minmax(0, 1fr) minmax(320px, 380px);
}

.app-shell.sidebar-closed {
  grid-template-columns: minmax(0, 1fr);
}

.app-shell.sidebar-closed.panel-open {
  grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
}

.app-shell.sidebar-closed .channel-sidebar {
  display: none;
}

.channel-sidebar {
  border-right: 1px solid color-mix(in srgb, var(--lilac) 16%, transparent);
}

.sidebar-head {
  padding: 20px 16px 14px;
}

.sidebar-head h1 {
  font-size: 20px;
  letter-spacing: -0.035em;
}

.admin-title-badge {
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--lilac) 44%, transparent);
  border-radius: 999px;
  color: #d9ceff;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.profile-chip {
  border: 0;
  border-radius: 15px;
  background: rgba(255,255,255,.055);
}

.profile-chip-avatar,
.team-button.active {
  background: linear-gradient(135deg, var(--lilac), var(--lagoon));
  box-shadow: 0 0 0 3px rgba(167,139,250,.13), 0 0 26px rgba(57,208,195,.12);
}

.channel-list { padding: 12px 10px; }
.channel-group { padding-top: 16px; font-size: 10px; }
.channel-row { min-height: 38px; border-radius: 11px; color: var(--sidebar-ink); }
.channel-row.active {
  background: linear-gradient(90deg, rgba(167,139,250,.22), rgba(57,208,195,.08));
  box-shadow: inset 3px 0 var(--lilac);
}

.row-icon-actions { opacity: 0; }
.channel-row-wrap:hover .row-icon-actions,
.channel-row-wrap:focus-within .row-icon-actions { opacity: 1; }

.sidebar-foot { grid-template-columns: 1fr 1fr; }
.sidebar-foot .ghost { grid-column: 1 / -1; }
.sidebar-foot button { border-radius: 12px; }

.chat-pane {
  border-right: 0;
  background:
    radial-gradient(circle at 50% -10%, color-mix(in srgb, var(--lilac) 8%, transparent), transparent 28%),
    var(--chat-bg);
}

.chat-header {
  min-height: 66px;
  padding: 11px 20px;
  background: color-mix(in srgb, var(--chat-bg) 88%, transparent);
  backdrop-filter: blur(16px);
}

.chat-header h2 { font-size: 20px; letter-spacing: -0.025em; }
.chat-header p { font-size: 12px; }
.chat-actions { flex-wrap: nowrap; }
.chat-actions .ghost, .theme-toggle, .channel-drawer-toggle {
  min-height: 38px;
  background: color-mix(in srgb, var(--field) 72%, transparent);
  color: var(--ink);
  border: 1px solid var(--line);
}

.channel-drawer-toggle {
  display: inline-grid;
  place-items: center;
  width: 38px;
  min-width: 38px;
  padding: 0;
}

.admin-mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 11px;
  border: 1px solid var(--line);
  background: var(--field);
  color: var(--muted);
}

.admin-mode-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--muted);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--muted) 10%, transparent);
}

.admin-mode-toggle.active {
  color: var(--ink);
  border-color: color-mix(in srgb, var(--lilac) 58%, var(--line));
  background: linear-gradient(135deg, color-mix(in srgb, var(--lilac) 20%, var(--field)), color-mix(in srgb, var(--lagoon) 10%, var(--field)));
}

.admin-mode-toggle.active .admin-mode-dot {
  background: var(--lagoon);
  box-shadow: 0 0 0 4px rgba(57,208,195,.14), 0 0 14px rgba(57,208,195,.62);
}

body.admin-mode .chat-header { box-shadow: inset 0 2px color-mix(in srgb, var(--lilac) 70%, transparent); }

.post-list {
  width: min(100%, 960px);
  margin-inline: auto;
  padding: 22px 28px 28px;
  gap: 2px;
}

.post {
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 12px;
  padding: 8px 14px 8px 10px;
  border-radius: 16px;
}

.post:not(.grouped) { margin-top: 10px; }
.post:hover { background: color-mix(in srgb, var(--lilac) 7%, transparent); }
.post.grouped { padding-top: 3px; padding-bottom: 3px; }
.avatar {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--rail-2), color-mix(in srgb, var(--lilac) 36%, var(--rail-2)));
}
.post:not(.grouped) .avatar { box-shadow: 0 0 0 3px color-mix(in srgb, var(--lilac) 8%, transparent); }
.post-author { font-size: 15px; letter-spacing: -.01em; }
.post-time { opacity: .72; }
.post-message { font-size: 15px; line-height: 1.55; }
.post-actions { border-radius: 13px; backdrop-filter: blur(14px); }

.composer {
  width: min(calc(100% - 32px), 928px);
  min-width: 0;
  max-width: calc(100% - 32px);
  margin: 0 auto 16px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: color-mix(in srgb, var(--composer-bg) 90%, transparent);
  box-shadow: 0 16px 46px rgba(5,7,15,.18);
}
.composer textarea { border-radius: 14px; }
.composer-tools > button { margin-left: auto; background: linear-gradient(135deg, #8e70ec, #238f88); }

.side-panel { display: none; border-left: 1px solid var(--line); }
.app-shell.panel-open .side-panel { display: grid; }
.app-shell.panel-open .chat-actions { min-width: 0; flex-wrap: wrap; }
.panel-header { min-height: 66px; }
.panel-tabs { gap: 7px; padding: 12px; }
.panel-tabs button { border-radius: 999px; }
.panel-tabs button.active {
  background-color: var(--active-bg);
  background-image: linear-gradient(135deg, var(--lilac), var(--lagoon));
}

.modal-card, .file-preview-link, .file-row, .pinned-row, .profile-preview { border-radius: 16px; }

@media (max-width: 980px) {
  .app-shell, .app-shell.panel-open { grid-template-columns: minmax(220px, 260px) minmax(0, 1fr); }
  .app-shell.sidebar-closed, .app-shell.sidebar-closed.panel-open { grid-template-columns: minmax(0, 1fr); }
  .app-shell.panel-open .side-panel {
    position: fixed;
    inset: 0 0 0 auto;
    z-index: 60;
    width: min(420px, 100vw);
    box-shadow: -24px 0 80px rgba(5,7,15,.38);
  }
}

@media (max-width: 720px) {
  .app-shell, .app-shell.panel-open, .app-shell.sidebar-closed, .app-shell.sidebar-closed.panel-open { display: flex; }
  .app-shell.sidebar-closed .channel-sidebar { display: block; }
  .channel-drawer-toggle { display: none; }
  .admin-title-badge { display: none; }
  .admin-mode-toggle { min-width: 38px; width: 38px; padding: 0; justify-content: center; }
  .admin-mode-dot {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    color: var(--chat-bg);
    font-size: 11px;
    font-weight: 900;
  }
  .admin-mode-dot::after { content: "A"; }
  .admin-mode-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
  .chat-actions { gap: 6px; }
  .chat-actions .ghost { padding-inline: 10px; }
  .chat-actions .search-toggle {
    width: 38px;
    min-width: 38px;
    padding: 0;
    color: transparent;
  }
  .chat-actions .search-toggle::before { color: var(--ink); }
  .chat-actions .gallery-toggle { display: none; }
  .post-list { width: 100%; padding: 12px 10px 112px; }
  .post { grid-template-columns: 36px minmax(0, 1fr); padding: 7px 40px 7px 7px; }
  .avatar { width: 36px; height: 36px; border-radius: 12px; }
  .composer { width: auto; margin: 0; border-width: 1px 0 0; border-radius: 0; }
  .app-shell.panel-open .side-panel { width: 100vw; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`;

export const webClient = `
function initialTheme() {
  const stored = localStorage.getItem('chattermost-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return 'dark';
}

function readStoredList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const hermesCommandPalette = [
  ['help', '', 'Show available Hermes commands'],
  ['commands', '[page]', 'Browse all commands and installed skills'],
  ['new', '[name]', 'Start a fresh Hermes session'],
  ['reset', '[now]', 'Reset the current Hermes conversation'],
  ['status', '', 'Show session, model, token, and context information'],
  ['model', '[provider:model]', 'Show or switch the session model'],
  ['reasoning', '[level]', 'Show or change reasoning effort'],
  ['fast', '[normal|fast|status]', 'Show or change fast mode'],
  ['usage', '', 'Show token usage and provider limits'],
  ['stop', '', 'Stop the running Hermes task'],
  ['background', '<prompt>', 'Run a prompt in the background'],
  ['queue', '<prompt>', 'Queue a prompt for the next turn'],
  ['steer', '<prompt>', 'Guide the running task after its next tool call'],
  ['sessions', '', 'Browse saved Hermes sessions'],
  ['resume', '[name]', 'Resume a named Hermes session'],
  ['skills', '[action]', 'Search, inspect, install, or manage skills'],
  ['reload-skills', '', 'Reload installed Hermes skills'],
  ['reload-mcp', '', 'Reload configured MCP servers'],
  ['sethome', '', 'Set this conversation as the Hermes home channel'],
  ['whoami', '', 'Show your Hermes command access level']
];

const state = {
  me: null,
  teams: [],
  channels: [],
  publicChannels: [],
  channelMembers: [],
  users: [],
  adminUsers: [],
  invites: [],
  bots: [],
  hermesHealth: null,
  agents: [],
  posts: [],
  reactions: {},
  customEmoji: [],
  searchTerm: '',
  searchResults: [],
  searchStatus: '',
  searchOpen: false,
  galleryOpen: false,
  channelAgentPolicy: {},
  channelPolicyFeedback: '',
  channelPolicyError: '',
  uploadStatus: '',
  rotatedBotToken: '',
  cleanupResult: null,
  resetUserId: '',
  resetPasswordDrafts: {},
  userModalMode: '',
  userModalId: '',
  adminUserDraft: {},
  profileDraft: null,
  profileImageDraft: null,
  channelModalMode: '',
  channelModalId: '',
  channelDraft: {},
  botResponseIndicators: {},
  showOnboarding: localStorage.getItem('chattermost-new-user') === '1',
  clientConfig: null,
  activeTeamId: '',
  activeChannelId: '',
  activeThreadId: '',
  editingPostId: '',
  editDraft: '',
  editError: '',
  socket: null,
  lastInviteCode: '',
  drafts: {},
  pendingFiles: {},
  sendingChannels: {},
  threadDrafts: {},
  threadError: '',
  composerError: '',
  commandPaletteIndex: 0,
  commandPaletteHidden: false,
  createChannelError: '',
  newChannelName: '',
  newChannelType: 'O',
  directMessageError: '',
  directMessageSearch: '',
  memberError: '',
  joinChannelError: '',
  panelFeedback: {},
  theme: initialTheme(),
  adminMode: false,
  sidebarOpen: true,
  panel: 'members',
  sidePanelOpen: false,
  emojiPickerOpen: false,
  emojiSearch: '',
  recentEmoji: readStoredList('chattermost-recent-emoji'),
  visiblePostCounts: {},
  showJumpToBottom: false,
  socketManualClose: false,
  socketReconnectDelay: 1000
};

const botResponseTimers = {};
const botResponsePollTimers = {};
let socketReconnectTimer = null;
let reloadInFlight = false;
let reloadQueued = false;
const postHistoryPageSize = 50;

const $ = (selector) => document.querySelector(selector);
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value' && 'value' in node) node.value = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== false && value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of children) node.append(child);
  return node;
};

const iconSvg = {
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.3 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01"/><path d="M15.5 10h.01"/><path d="M8.5 14.5c1.1 1.2 2.2 1.8 3.5 1.8s2.4-.6 3.5-1.8"/></svg>',
  arrowDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m21 15-4.2-4.2a2 2 0 0 0-2.8 0L5 19"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  userPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>'
};

const emojiChoices = [
  '😀', '😄', '😂', '😊', '😍', '🥳', '😎', '🤔',
  '😅', '🙌', '👏', '👍', '👀', '🔥', '✨', '✅',
  '🚀', '❤️', '💜', '🎉', '🙏', '💡', '📌', '⚠️',
  '❓', '☕', '💬', '🧠', '🛠️', '📎', '📣', '🌟',
  '😮', '😢', '😡', '😴', '🤝', '👌', '👎', '🤞',
  '🧪', '🔒', '🔑', '🟢', '🟡', '🔴', '📄', '🧵',
  '🗂️', '📷', '🎧', '💻', '🧭', '📝', '🏁', '⭐'
];

const emojiNames = {
  '😀': 'grinning smile happy',
  '😄': 'smile laugh',
  '😂': 'joy laugh',
  '😊': 'blush happy',
  '😍': 'heart eyes love',
  '🥳': 'party celebration',
  '😎': 'cool sunglasses',
  '🤔': 'thinking',
  '😅': 'sweat relief',
  '🙌': 'raise hands',
  '👏': 'clap applause',
  '👍': 'thumbs up approve',
  '👎': 'thumbs down',
  '👀': 'eyes looking',
  '🔥': 'fire hot',
  '✨': 'sparkles',
  '✅': 'check done',
  '🚀': 'rocket launch',
  '❤️': 'heart love',
  '💜': 'purple heart',
  '🎉': 'tada celebration',
  '🙏': 'pray thanks',
  '💡': 'idea light',
  '📌': 'pin',
  '⚠️': 'warning',
  '❓': 'question',
  '☕': 'coffee',
  '💬': 'chat message',
  '🧠': 'brain',
  '🛠️': 'tools',
  '📎': 'paperclip attach',
  '📣': 'announcement',
  '🌟': 'star',
  '🧪': 'test lab',
  '🔒': 'lock secure',
  '🔑': 'key token',
  '🟢': 'green online ok',
  '🟡': 'yellow caution',
  '🔴': 'red stop',
  '📄': 'document file',
  '🧵': 'thread',
  '🗂️': 'folder files',
  '📷': 'camera image',
  '🎧': 'support audio',
  '💻': 'computer',
  '🧭': 'compass',
  '📝': 'notes edit',
  '🏁': 'finish',
  '⭐': 'favorite star'
};

const emojiNameSymbols = {
  grinning: '😀',
  smile: '😄',
  joy: '😂',
  blush: '😊',
  heart_eyes: '😍',
  partying_face: '🥳',
  sunglasses: '😎',
  thinking_face: '🤔',
  sweat_smile: '😅',
  raised_hands: '🙌',
  clap: '👏',
  thumbs_up: '👍',
  '+1': '👍',
  thumbsup: '👍',
  thumbs_down: '👎',
  '-1': '👎',
  thumbsdown: '👎',
  eyes: '👀',
  fire: '🔥',
  sparkles: '✨',
  white_check_mark: '✅',
  rocket: '🚀',
  heart: '❤️',
  purple_heart: '💜',
  tada: '🎉',
  pray: '🙏',
  bulb: '💡',
  pushpin: '📌',
  warning: '⚠️',
  question: '❓',
  coffee: '☕',
  speech_balloon: '💬',
  brain: '🧠',
  hammer_and_wrench: '🛠️',
  paperclip: '📎',
  loudspeaker: '📣',
  star2: '🌟',
  slightly_smiling_face: '🙂',
  open_mouth: '😮',
  cry: '😢',
  angry: '😡',
  sleeping: '😴',
  handshake: '🤝',
  ok_hand: '👌',
  crossed_fingers: '🤞',
  test_tube: '🧪',
  lock: '🔒',
  key: '🔑',
  green_circle: '🟢',
  yellow_circle: '🟡',
  red_circle: '🔴',
  page_facing_up: '📄',
  thread: '🧵',
  card_file_box: '🗂️',
  camera: '📷',
  headphones: '🎧',
  computer: '💻',
  compass: '🧭',
  memo: '📝',
  checkered_flag: '🏁',
  star: '⭐'
};

function emojiSymbolForName(name) {
  if (emojiChoices.includes(name)) return name;
  const custom = state.customEmoji.find((emoji) => emoji.name === name || emoji.emoji === name);
  return custom?.emoji || emojiNameSymbols[name] || ':' + name + ':';
}

function uiIcon(name) {
  const node = el('span', { class: 'composer-icon', 'data-icon': name, 'aria-hidden': 'true' });
  node.innerHTML = iconSvg[name] || '';
  return node;
}

function iconButton(name, label, attrs = {}) {
  return el('button', {
    type: 'button',
    title: label,
    'aria-label': label,
    ...attrs,
    class: (attrs.class ? attrs.class + ' ' : '') + 'icon-only'
  }, [uiIcon(name)]);
}

function pendingFilesForChannel(channelId = state.activeChannelId) {
  return state.pendingFiles[channelId] || [];
}

function addPendingFiles(files, channelId = state.activeChannelId) {
  if (!channelId || files.length === 0) return;
  const existing = pendingFilesForChannel(channelId);
  const additions = files
    .filter((file) => file instanceof File && file.size > 0)
    .map((file) => ({
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2),
      file,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
    }));
  if (additions.length === 0) return;
  state.pendingFiles[channelId] = existing.concat(additions);
}

function removePendingFile(fileId, channelId = state.activeChannelId) {
  const files = pendingFilesForChannel(channelId);
  const next = [];
  for (const item of files) {
    if (item.id === fileId) {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    } else {
      next.push(item);
    }
  }
  if (next.length) state.pendingFiles[channelId] = next;
  else delete state.pendingFiles[channelId];
  renderApp();
}

function clearPendingFiles(channelId = state.activeChannelId) {
  for (const item of pendingFilesForChannel(channelId)) {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }
  delete state.pendingFiles[channelId];
}

function formatFileSize(size) {
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
  return (size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
}

function fileBadge(name) {
  const parts = name.split('.');
  if (parts.length > 1) return parts.pop().slice(0, 4);
  return 'file';
}

function insertEmoji(emoji) {
  const textarea = document.querySelector('.composer textarea[name="message"]');
  const draft = textarea instanceof HTMLTextAreaElement ? textarea.value : state.drafts[state.activeChannelId] || '';
  const start = textarea instanceof HTMLTextAreaElement ? textarea.selectionStart : draft.length;
  const end = textarea instanceof HTMLTextAreaElement ? textarea.selectionEnd : draft.length;
  const next = draft.slice(0, start) + emoji + draft.slice(end);
  const caret = start + emoji.length;
  state.drafts[state.activeChannelId] = next;
  if (textarea instanceof HTMLTextAreaElement) textarea.value = next;
  state.recentEmoji = [emoji].concat(state.recentEmoji.filter((item) => item !== emoji)).slice(0, 12);
  localStorage.setItem('chattermost-recent-emoji', JSON.stringify(state.recentEmoji));
  state.emojiPickerOpen = false;
  state.emojiSearch = '';
  renderApp();
  requestAnimationFrame(() => {
    const nextTextarea = document.querySelector('.composer textarea[name="message"]');
    if (nextTextarea instanceof HTMLTextAreaElement) {
      nextTextarea.focus();
      nextTextarea.setSelectionRange(caret, caret);
    }
  });
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-ChatterMost-Web', 'true');
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const error = await response.json();
      message = error.message || message;
    } catch {}
    throw new Error(message);
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return response;
  return response.json();
}

function showError(error) {
  const target = $('[data-error]');
  if (target) target.textContent = error.message || String(error);
}

function setPanelFeedback(panel, type, text) {
  state.panelFeedback[panel] = { type, text };
}

function clearPanelFeedback(panel) {
  delete state.panelFeedback[panel];
}

function renderPanelFeedback(panel) {
  const feedback = state.panelFeedback[panel];
  if (!feedback) return null;
  return el('div', { class: 'notice ' + (feedback.type === 'error' ? 'error' : 'success'), text: feedback.text });
}

function applyTheme() {
  const dark = state.theme === 'dark';
  document.body.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-light', !dark);
  document.body.classList.toggle('admin-mode', isAdminMode());
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('chattermost-theme', state.theme);
  applyTheme();
  renderApp();
}

function renderAuth(kind) {
  document.body.innerHTML = '';
  applyTheme();
  const isSignup = kind === 'signup';
  const invite = new URL(location.href).searchParams.get('invite') || '';
  const form = el('form', { class: 'form-stack' }, [
    el('div', { class: 'notice error', 'data-error': '', text: '' }),
    isSignup ? el('label', { text: 'Invite code' }, [el('input', { name: 'invite_code', value: invite, required: true })]) : null,
    isSignup ? el('label', { text: 'Email' }, [el('input', { name: 'email', type: 'email', required: true })]) : null,
    el('label', { text: isSignup ? 'Username' : 'Username or email' }, [el('input', { name: 'login_id', required: true, autocomplete: 'username' })]),
    el('label', { text: 'Password' }, [el('input', { name: 'password', type: 'password', required: true, autocomplete: isSignup ? 'new-password' : 'current-password' })]),
    el('button', { text: isSignup ? 'Create account' : 'Sign in' })
  ].filter(Boolean));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      if (isSignup) {
        await api('/api/v4/users', { method: 'POST', body: { invite_code: data.invite_code, username: data.login_id, email: data.email, password: data.password } });
        localStorage.setItem('chattermost-new-user', '1');
        state.showOnboarding = true;
      }
      await api('/api/v4/users/login', { method: 'POST', body: { login_id: data.login_id, password: data.password } });
      history.replaceState(null, '', '/');
      await bootApp();
    } catch (error) {
      showError(error);
    }
  });
  document.body.append(el('main', { class: 'auth-shell' }, [
    el('section', { class: 'auth-panel' }, [
      el('h1', { text: isSignup ? 'Join ChatterMost' : 'ChatterMost' }),
      el('p', { text: isSignup ? 'Use your invite to join the supervised Mattermost-compatible workspace.' : 'Sign in to the supervised Mattermost-compatible switchboard.' }),
      form,
      el('p', {}, [isSignup ? link('/login', 'Already have an account? Sign in') : link('/signup', 'Have an invite? Create an account')])
    ]),
    el('section', { class: 'auth-art' }, [
      el('div', { class: 'switchboard' }, [
        el('h2', { text: 'Human chat and agent traffic on one board.' }),
        el('p', { text: 'Channels, DMs, threads, files, reactions, supervision, and Hermes-compatible bot access are routed through the same Mattermost-compatible API surface.' }),
        el('div', { class: 'signal-row' }, [
          el('div', { class: 'signal', text: 'REST' }),
          el('div', { class: 'signal', text: 'WSS' }),
          el('div', { class: 'signal', text: 'TLS' }),
          el('div', { class: 'signal', text: 'AI' })
        ])
      ])
    ])
  ]));
}

function link(href, text) {
  const a = el('a', { href, text });
  a.addEventListener('click', (event) => {
    event.preventDefault();
    history.pushState(null, '', href);
    route();
  });
  return a;
}

async function bootApp() {
  try {
    state.me = await api('/api/v4/users/me');
    restoreAdminMode();
    await loadData();
    connectSocket();
    renderApp();
    scrollPostListToBottom();
  } catch {
    history.replaceState(null, '', '/login');
    renderAuth('login');
  }
}

async function loadData() {
  state.teams = await api('/api/v4/users/me/teams');
  state.activeTeamId = state.activeTeamId || state.teams[0]?.id || '';
  const scopedChannels = state.activeTeamId ? await api('/api/v4/users/me/teams/' + state.activeTeamId + '/channels') : await api('/api/v4/users/me/channels');
  const allUserChannels = await api('/api/v4/users/me/channels');
  const channelIds = new Set(scopedChannels.map((channel) => channel.id));
  state.channels = scopedChannels.concat(allUserChannels.filter((channel) => (channel.type === 'D' || channel.type === 'G') && !channelIds.has(channel.id)));
  state.activeChannelId = state.activeChannelId && state.channels.some((channel) => channel.id === state.activeChannelId) ? state.activeChannelId : state.channels[0]?.id || '';
  state.users = await api('/api/v4/users/search', { method: 'POST', body: { term: '' } });
  const joinedIds = new Set(state.channels.map((channel) => channel.id));
  const teamChannels = state.activeTeamId ? await api('/api/v4/teams/' + state.activeTeamId + '/channels') : [];
  state.publicChannels = teamChannels.filter((channel) => channel.type === 'O' && !joinedIds.has(channel.id));
  state.clientConfig = await api('/api/v4/config/client');
  await loadPosts();
  await loadChannelMembers();
  await loadChannelPolicy();
  if (isSystemAdmin()) await loadAdminData();
}

async function loadClientConfig() {
  state.clientConfig = await api('/api/v4/config/client');
}

async function loadPosts() {
  if (!state.activeChannelId) {
    state.posts = [];
    state.reactions = {};
    return;
  }
  const list = await api('/api/v4/channels/' + state.activeChannelId + '/posts');
  const seen = new Set();
  const orderedPosts = [];
  for (const id of list.order) {
    const post = list.posts[id];
    if (post && !seen.has(post.id)) {
      seen.add(post.id);
      orderedPosts.push(post);
    }
  }
  state.posts = orderedPosts;
  state.visiblePostCounts[state.activeChannelId] = Math.max(state.visiblePostCounts[state.activeChannelId] || postHistoryPageSize, postHistoryPageSize);
  state.reactions = await api('/api/v4/posts/ids/reactions', { method: 'POST', body: state.posts.map((post) => post.id) });
  state.customEmoji = await api('/api/v4/emoji').catch(() => []);
  clearBotIndicatorsResolvedByPosts(state.posts);
}

async function loadChannelMembers() {
  if (!state.activeChannelId) {
    state.channelMembers = [];
    return;
  }
  state.channelMembers = await api('/api/v4/channels/' + state.activeChannelId + '/members');
}

async function loadChannelPolicy() {
  if (!state.activeChannelId) {
    state.channelAgentPolicy = {};
    return;
  }
  state.channelAgentPolicy = await api('/api/v4/channels/' + state.activeChannelId + '/agent-policy').catch(() => ({}));
}

async function loadAdminData() {
  const [adminUsers, invites, bots, hermesHealth, agents] = await Promise.all([
    api('/admin/users').catch(() => state.adminUsers),
    api('/admin/invites').catch(() => state.invites),
    api('/admin/bots').catch(() => state.bots),
    api('/admin/hermes/health').catch(() => state.hermesHealth),
    api('/api/v4/agents').catch(() => state.agents)
  ]);
  state.adminUsers = adminUsers;
  state.invites = invites;
  state.bots = bots;
  state.hermesHealth = hermesHealth;
  state.agents = agents;
}

function connectSocket() {
  if (socketReconnectTimer) {
    clearTimeout(socketReconnectTimer);
    socketReconnectTimer = null;
  }
  if (state.socket) {
    state.socketManualClose = true;
    try { state.socket.close(); } catch {}
    state.socket = null;
  }
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/v4/websocket';
  let socket;
  try {
    socket = new WebSocket(url);
  } catch {
    scheduleSocketReconnect();
    return;
  }
  state.socketManualClose = false;
  socket.addEventListener('open', () => {
    state.socketReconnectDelay = 1000;
  });
  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    void handleRealtimeMessage(message);
  });
  socket.addEventListener('close', () => {
    if (state.socket === socket) state.socket = null;
    if (!state.socketManualClose) scheduleSocketReconnect();
  });
  socket.addEventListener('error', () => {
    try { socket.close(); } catch {}
  });
  state.socket = socket;
}

async function handleRealtimeMessage(message) {
  handleSocketMessage(message);
  if (!shouldReloadForSocket(message)) return;
  if (hasSelectedFileInput()) return;
  await reloadFromSocket();
}

// Bursts of WebSocket events (fanout across many members) must not stack
// overlapping full reloads and re-renders. Serialize them: while one reload is
// in flight, remember that another is needed and run exactly one follow-up.
async function reloadFromSocket() {
  if (reloadInFlight) {
    reloadQueued = true;
    return;
  }
  reloadInFlight = true;
  try {
    const wasNearBottom = isPostListNearBottom();
    await loadData();
    renderApp();
    if (wasNearBottom) scrollPostListToBottom();
  } catch {
    // Ignore transient reload failures; the next event or reconnect retries.
  } finally {
    reloadInFlight = false;
    if (reloadQueued) {
      reloadQueued = false;
      void reloadFromSocket();
    }
  }
}

function scheduleSocketReconnect() {
  if (socketReconnectTimer || !state.me) return;
  const delay = Math.min(state.socketReconnectDelay || 1000, 15000);
  state.socketReconnectDelay = Math.min(delay * 2, 15000);
  socketReconnectTimer = setTimeout(() => {
    socketReconnectTimer = null;
    if (state.me) connectSocket();
  }, delay);
}

function hasSelectedFileInput() {
  const hasPendingFiles = Object.values(state.pendingFiles).some((files) => Array.isArray(files) && files.length > 0);
  return state.profileImageDraft instanceof File || hasPendingFiles || Array.from(document.querySelectorAll('input[type="file"]')).some((input) => input instanceof HTMLInputElement && (input.files?.length || 0) > 0);
}

function handleSocketMessage(message) {
  const data = message.data || {};
  if (message.event === 'typing') {
    showBotResponding(data.channel_id || '', data.user_id || '', 6500, {
      isBot: data.is_bot === true,
      name: data.sender_name || ''
    });
    return;
  }
  if (message.event === 'posted') {
    const post = parseSocketPost(data.post);
    if (post && userById(post.user_id)?.is_bot) {
      clearBotResponding(post.channel_id || data.channel_id || '', post.user_id);
    }
  }
}

function parseSocketPost(rawPost) {
  if (typeof rawPost !== 'string') return null;
  try {
    return JSON.parse(rawPost);
  } catch {
    return null;
  }
}

function shouldReloadForSocket(message) {
  const data = message.data || {};
  const channelId = data.channel_id || '';
  if (['user_updated', 'config_changed'].includes(message.event)) return true;
  if (['posted', 'post_edited', 'post_deleted', 'reaction_added', 'reaction_removed'].includes(message.event)) {
    return !channelId || channelId === state.activeChannelId;
  }
  if (['channel_created', 'channel_deleted'].includes(message.event)) {
    return true;
  }
  if (['channel_updated', 'channel_deleted', 'user_added', 'user_removed'].includes(message.event)) {
    return channelId === state.activeChannelId;
  }
  return false;
}

function renderApp() {
  const activeComposer = document.querySelector('.composer textarea[name="message"]');
  const composerChannelId = activeComposer?.closest('.composer')?.getAttribute('data-channel-id') || '';
  const composerSelection = activeComposer instanceof HTMLTextAreaElement && document.activeElement === activeComposer
    ? { start: activeComposer.selectionStart, end: activeComposer.selectionEnd, direction: activeComposer.selectionDirection }
    : null;
  if (activeComposer instanceof HTMLTextAreaElement && composerChannelId) {
    state.drafts[composerChannelId] = activeComposer.value;
  }
  document.body.innerHTML = '';
  applyTheme();
  const shellClass = 'app-shell' + (state.sidePanelOpen || state.panel === 'thread' ? ' panel-open' : '') + (state.sidebarOpen ? '' : ' sidebar-closed');
  document.body.append(el('main', { class: shellClass }, [
    renderSidebar(),
    renderChat(),
    renderPanel()
  ]));
  const modal = renderModal();
  if (modal) document.body.append(modal);
  // Restore focus synchronously so a refresh between modifier and character keys
  // keeps keyboard input and the caret in the same conversation.
  if (!modal && composerSelection) {
    const nextComposer = document.querySelector('.composer textarea[name="message"]');
    if (nextComposer instanceof HTMLTextAreaElement && nextComposer.closest('.composer')?.getAttribute('data-channel-id') === composerChannelId) {
      nextComposer.focus({ preventScroll: true });
      nextComposer.setSelectionRange(composerSelection.start, composerSelection.end, composerSelection.direction);
    }
  }
  requestAnimationFrame(() => {
    const list = document.querySelector('.post-list');
    if (list instanceof HTMLElement) updateJumpToBottomButton(list);
  });
}

function openPanel(name) {
  if (name !== 'profile') {
    state.profileDraft = null;
    state.profileImageDraft = null;
  }
  if (name === 'profile' && state.profileDraft === null && state.me) {
    state.profileDraft = profileDraftFromUser(state.me);
  }
  state.panel = name;
  state.sidePanelOpen = true;
  state.emojiPickerOpen = false;
  renderApp();
}

function isSystemAdmin() {
  return Boolean(state.me?.roles?.includes('system_admin'));
}

function adminModeStorageKey() {
  return state.me?.id ? 'chattermost-admin-mode:' + state.me.id : '';
}

function restoreAdminMode() {
  const key = adminModeStorageKey();
  state.adminMode = Boolean(isSystemAdmin() && key && localStorage.getItem(key) === '1');
}

function isAdminMode() {
  return Boolean(isSystemAdmin() && state.adminMode);
}

function toggleAdminMode() {
  if (!isSystemAdmin()) return;
  state.adminMode = !state.adminMode;
  const key = adminModeStorageKey();
  if (key) localStorage.setItem(key, state.adminMode ? '1' : '0');
  if (state.adminMode) {
    state.panel = 'admin';
    state.sidePanelOpen = true;
  } else if (new Set(['admin', 'system', 'supervision', 'agents', 'hermes']).has(state.panel)) {
    state.panel = 'members';
    state.sidePanelOpen = false;
  }
  renderApp();
}

function avatarSrc(userId) {
  const user = state.users.find((item) => item.id === userId) || (state.me && state.me.id === userId ? state.me : null);
  const version = user?.last_picture_update || 0;
  return '/api/v4/users/' + userId + '/image' + (version > 0 ? '?v=' + version : '');
}

function userDisplayName(user) {
  return user.nickname || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
}

function directChannelUsers(channel) {
  return channel.name
    .split('__')
    .map((id) => state.users.find((user) => user.id === id))
    .filter(Boolean);
}

function directChannelLabel(channel) {
  const participants = directChannelUsers(channel).filter((user) => user.id !== state.me?.id);
  if (channel.type === 'D') {
    const user = participants[0];
    return user ? '@' + user.username : 'DM';
  }
  if (participants.length > 0) {
    return participants.map((user) => '@' + user.username).join(', ');
  }
  return 'Group DM';
}

function directChannelForUser(userId) {
  return state.channels.find((channel) => channel.type === 'D' && directChannelUsers(channel).some((user) => user.id === userId)) || null;
}

function botIndicatorKey(channelId, userId) {
  return channelId + ':' + userId;
}

function userById(userId) {
  return state.users.find((user) => user.id === userId) || (state.me?.id === userId ? state.me : null);
}

function botResponseName(user) {
  const name = user.bot_description || userDisplayName(user);
  return name.startsWith('@') ? name.slice(1) : name;
}

function botUsersForChannel(channel) {
  if (!channel) return [];
  if (channel.type === 'D' || channel.type === 'G') {
    return directChannelUsers(channel).filter((user) => user.id !== state.me?.id && user.is_bot);
  }
  const memberIds = new Set(state.channelMembers.map((member) => member.user_id));
  return state.users.filter((user) => user.is_bot && memberIds.has(user.id));
}

function commandSuggestions(channel, draft) {
  if (state.commandPaletteHidden || botUsersForChannel(channel).length === 0 || !draft.startsWith('/')) return [];
  const firstWhitespace = draft.search(/\\s/u);
  if (firstWhitespace >= 0) return [];
  const needle = draft.slice(1).toLowerCase();
  return hermesCommandPalette.filter(([trigger]) => trigger.startsWith(needle)).slice(0, 8);
}

function applyCommandSuggestion(command) {
  const [trigger, hint] = command;
  const next = '/' + trigger + (hint ? ' ' : '');
  state.drafts[state.activeChannelId] = next;
  const activeComposer = document.querySelector('.composer textarea[name="message"]');
  if (activeComposer instanceof HTMLTextAreaElement) activeComposer.value = next;
  state.commandPaletteHidden = false;
  state.commandPaletteIndex = 0;
  renderApp();
  requestAnimationFrame(() => {
    const textarea = document.querySelector('.composer textarea[name="message"]');
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus();
      textarea.setSelectionRange(next.length, next.length);
    }
  });
}

function renderCommandPalette(channel, draft) {
  const suggestions = commandSuggestions(channel, draft);
  if (suggestions.length === 0) return null;
  state.commandPaletteIndex = Math.min(state.commandPaletteIndex, suggestions.length - 1);
  return el('div', { class: 'command-palette', role: 'listbox', 'aria-label': 'Hermes commands' }, [
    el('div', { class: 'command-palette-head' }, [
      el('span', { text: 'Hermes commands' }),
      el('span', { text: 'Tab completes · /commands shows skills' })
    ]),
    ...suggestions.map((command, index) => el('button', {
      class: 'command-option' + (index === state.commandPaletteIndex ? ' active' : ''),
      type: 'button',
      role: 'option',
      'aria-selected': String(index === state.commandPaletteIndex),
      onclick: () => applyCommandSuggestion(command)
    }, [
      el('span', { class: 'command-token', text: '/' + command[0] + (command[1] ? ' ' + command[1] : '') }),
      el('span', { class: 'command-description', text: command[2] })
    ]))
  ]);
}

function botTargetsForOutgoingMessage(channel, message) {
  const bots = botUsersForChannel(channel);
  if (channel?.type === 'D' || channel?.type === 'G') return bots;
  const normalized = message.toLowerCase();
  return bots.filter((bot) => normalized.includes('@' + bot.username.toLowerCase()));
}

function clearExpiredBotIndicators() {
  const now = Date.now();
  for (const [key, indicator] of Object.entries(state.botResponseIndicators)) {
    if (indicator.expiresAt <= now) {
      delete state.botResponseIndicators[key];
      if (botResponseTimers[key]) {
        clearTimeout(botResponseTimers[key]);
        delete botResponseTimers[key];
      }
    }
  }
}

function showBotResponding(channelId, userId, timeoutMs, options = {}) {
  if (!channelId || !userId || userId === state.me?.id) return;
  const user = userById(userId);
  if (!user?.is_bot && options.isBot !== true) return;
  const key = botIndicatorKey(channelId, userId);
  if (botResponseTimers[key]) clearTimeout(botResponseTimers[key]);
  const now = Date.now();
  const startedAt = Number.isFinite(options.startedAt) ? options.startedAt : now;
  state.botResponseIndicators[key] = { channelId, userId, name: options.name || '', startedAt, expiresAt: now + timeoutMs };
  botResponseTimers[key] = setTimeout(() => {
    delete state.botResponseIndicators[key];
    delete botResponseTimers[key];
    if (state.activeChannelId === channelId) renderApp();
  }, timeoutMs + 50);
  scheduleBotResponsePoll(channelId);
  if (state.activeChannelId === channelId) renderApp();
}

function clearBotResponding(channelId, userId) {
  if (!channelId || !userId) return;
  const key = botIndicatorKey(channelId, userId);
  delete state.botResponseIndicators[key];
  if (botResponseTimers[key]) {
    clearTimeout(botResponseTimers[key]);
    delete botResponseTimers[key];
  }
}

function channelHasBotResponseIndicator(channelId) {
  return Object.values(state.botResponseIndicators).some((indicator) => indicator.channelId === channelId);
}

function scheduleBotResponsePoll(channelId) {
  if (botResponsePollTimers[channelId]) return;
  botResponsePollTimers[channelId] = setTimeout(async () => {
    delete botResponsePollTimers[channelId];
    clearExpiredBotIndicators();
    if (!channelHasBotResponseIndicator(channelId)) return;
    if (state.activeChannelId !== channelId || hasSelectedFileInput()) {
      scheduleBotResponsePoll(channelId);
      return;
    }
    try {
      await loadPosts();
      renderApp();
    } catch {
      scheduleBotResponsePoll(channelId);
      return;
    }
    if (channelHasBotResponseIndicator(channelId)) scheduleBotResponsePoll(channelId);
  }, 1800);
}

function clearBotIndicatorsResolvedByPosts(posts) {
  for (const indicator of Object.values(state.botResponseIndicators)) {
    const resolved = posts.some(
      (post) =>
        post.channel_id === indicator.channelId &&
        post.user_id === indicator.userId &&
        post.create_at >= (indicator.startedAt || 0)
    );
    if (resolved) clearBotResponding(indicator.channelId, indicator.userId);
  }
}

function markBotRespondingForOutgoingMessage(channelId, message, startedAt = Date.now()) {
  const channel = state.channels.find((item) => item.id === channelId);
  for (const bot of botTargetsForOutgoingMessage(channel, message)) {
    showBotResponding(channelId, bot.id, 45000, { startedAt });
  }
}

function openDirectPanel() {
  state.panel = 'direct';
  state.sidePanelOpen = true;
  state.directMessageError = '';
  state.emojiPickerOpen = false;
  renderApp();
}

function renderTeamRail() {
  const rail = el('nav', { class: 'team-rail', 'aria-label': 'Teams' });
  for (const team of state.teams) {
    rail.append(el('button', { class: 'team-button ' + (team.id === state.activeTeamId ? 'active' : ''), title: team.display_name, text: team.display_name.slice(0, 2).toUpperCase(), onclick: async () => {
      state.activeTeamId = team.id;
      state.activeChannelId = '';
      await loadData();
      renderApp();
    }}));
  }
  if (isAdminMode()) {
    rail.append(el('button', { class: 'rail-button', title: 'System console', 'aria-label': 'System console', text: '⚙', onclick: () => openPanel('system') }));
  }
  return rail;
}

function renderSidebar() {
  const groups = {
    'Public': state.channels.filter((channel) => channel.type === 'O'),
    'Private': state.channels.filter((channel) => channel.type === 'P'),
    'Direct': state.channels.filter((channel) => channel.type === 'D' || channel.type === 'G')
  };
  const list = el('div', { class: 'channel-list' });
  for (const [name, channels] of Object.entries(groups)) {
    if (channels.length === 0) continue;
    list.append(el('div', { class: 'channel-group', text: name }));
    for (const channel of channels) {
      list.append(renderChannelRow(channel));
    }
  }
  if (state.publicChannels.length > 0) {
    list.append(el('div', { class: 'channel-group', text: 'Browse public' }));
    for (const channel of state.publicChannels) {
      list.append(el('button', { class: 'channel-row join-row', text: '+ ' + channelLabel(channel), title: 'Join ' + channelLabel(channel), onclick: () => joinPublicChannel(channel.id) }));
    }
  }
  if (state.joinChannelError) {
    list.append(el('div', { class: 'notice error compact-notice', text: state.joinChannelError }));
  }
  return el('aside', { class: 'channel-sidebar' }, [
    el('div', { class: 'sidebar-head' }, [
      el('div', { class: 'sidebar-title-row' }, [
        el('h1', { text: 'ChatterMost' })
      ].filter(Boolean)),
      renderProfileChip()
    ]),
    renderMobileChannelPicker(),
    list,
    el('div', { class: 'sidebar-foot' }, [
      el('button', { class: 'secondary', text: '+ Channel', onclick: () => {
        state.panel = 'new-channel';
        state.sidePanelOpen = true;
        state.createChannelError = '';
        state.newChannelName = '';
        state.newChannelType = 'O';
        renderApp();
      } }),
      el('button', { class: 'secondary', text: '+ DM', onclick: openDirectPanel }),
      el('button', { class: 'ghost', text: 'Log out', onclick: logout })
    ])
  ]);
}

function renderChannelRow(channel) {
  const row = el('button', {
    class: 'channel-row ' + (channel.id === state.activeChannelId ? 'active' : ''),
    'data-channel-id': channel.id,
    text: channelLabel(channel),
    onclick: () => selectChannel(channel.id)
  });
  if (!isAdminMode() || channel.type !== 'O') return row;
  return el('div', { class: 'channel-row-wrap' }, [
    row,
    el('span', { class: 'row-icon-actions' }, [
      iconButton('edit', 'Edit public channel ' + channel.display_name, { class: 'ghost', onclick: () => openChannelModal('edit', channel) }),
      iconButton('trash', 'Delete public channel ' + channel.display_name, { class: 'ghost', onclick: () => deletePublicChannel(channel) })
    ])
  ]);
}

function renderProfileChip() {
  const username = state.me?.username || '';
  const initials = username.slice(0, 2).toUpperCase() || 'ME';
  return el('button', { class: 'profile-chip', type: 'button', 'aria-label': 'Profile', title: 'Open profile settings', onclick: () => openPanel('profile') }, [
    el('span', { class: 'profile-chip-avatar', 'aria-hidden': 'true', text: initials }),
    el('span', {}, [
      el('span', { class: 'profile-chip-name', text: username ? '@' + username : 'Profile' }),
      el('span', { class: 'profile-chip-subtitle', text: 'Profile settings' })
    ])
  ]);
}

function renderMobileChannelPicker() {
  const joinedOptions = state.channels.map((channel) => el('option', { value: channel.id, text: channelLabel(channel), selected: channel.id === state.activeChannelId }));
  const browseOptions = state.publicChannels.map((channel) => el('option', { value: 'join:' + channel.id, text: 'Join ' + channelLabel(channel) }));
  const select = el('select', { 'aria-label': 'Channel' }, [
    joinedOptions.length ? el('optgroup', { label: 'Channels' }, joinedOptions) : null,
    browseOptions.length ? el('optgroup', { label: 'Browse public' }, browseOptions) : null
  ].filter(Boolean));
  select.addEventListener('change', async (event) => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.value.startsWith('join:')) {
      await joinPublicChannel(target.value.slice(5));
    } else {
      await selectChannel(target.value);
    }
  });
  return el('div', { class: 'mobile-channel-picker' }, [
    el('span', { class: 'mobile-channel-label', text: 'Channel' }),
    select,
    state.joinChannelError ? el('div', { class: 'notice error compact-notice', text: state.joinChannelError }) : null
  ].filter(Boolean));
}

function channelLabel(channel) {
  if (channel.type === 'D' || channel.type === 'G') return directChannelLabel(channel);
  return '#' + channel.display_name;
}

function renderChat() {
  const channel = state.channels.find((item) => item.id === state.activeChannelId);
  const chrome = !state.galleryOpen ? renderChatChrome() : null;
  return el('section', { class: 'chat-pane' + (state.galleryOpen ? ' gallery-open' : '') + (chrome ? ' has-chrome' : '') }, [
    el('header', { class: 'chat-header' }, [
      el('div', { class: 'chat-title' }, [
        el('h2', { text: channel ? channelLabel(channel) : 'No channel' }),
        el('p', { text: channel?.purpose || channel?.header || 'Supervised team conversation' })
      ]),
      el('div', { class: 'chat-actions' }, [
        el('button', {
          class: 'channel-drawer-toggle',
          type: 'button',
          'aria-label': state.sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
          title: state.sidebarOpen ? 'Hide channels' : 'Show channels',
          onclick: () => { state.sidebarOpen = !state.sidebarOpen; renderApp(); }
        }, [uiIcon('menu')]),
        isSystemAdmin() ? el('button', {
          class: 'admin-mode-toggle' + (isAdminMode() ? ' active' : ''),
          type: 'button',
          role: 'switch',
          'aria-label': 'Admin mode',
          'aria-checked': String(isAdminMode()),
          title: isAdminMode() ? 'Leave Admin mode' : 'Enter Admin mode',
          onclick: toggleAdminMode
        }, [
          el('span', { class: 'admin-mode-dot', 'aria-hidden': 'true' }),
          el('span', { class: 'admin-mode-label', text: 'Admin mode' })
        ]) : null,
        el('button', { class: 'ghost search-toggle', type: 'button', text: state.searchOpen ? 'Close search' : 'Search', onclick: () => {
          state.searchOpen = !state.searchOpen;
          state.galleryOpen = false;
          state.sidePanelOpen = false;
          if (state.panel === 'thread') {
            state.panel = 'members';
            state.activeThreadId = '';
          }
          renderApp();
        } }),
        el('button', { class: 'ghost gallery-toggle', type: 'button', text: 'Gallery', disabled: !channel, onclick: () => {
          state.galleryOpen = true;
          state.searchOpen = false;
          state.sidePanelOpen = false;
          if (state.panel === 'thread') {
            state.panel = 'members';
            state.activeThreadId = '';
          }
          renderApp();
        } }),
        el('button', { class: 'ghost members-toggle', text: 'Members', onclick: () => openPanel('members') }),
        renderThemeToggle()
      ].filter(Boolean))
    ]),
    chrome,
    state.galleryOpen ? renderGallery(channel) : channel ? renderPosts() : renderNoChannel(),
    state.galleryOpen || !channel ? null : renderComposer()
  ].filter(Boolean));
}

function renderChatChrome() {
  const children = [
    state.showOnboarding ? renderOnboardingStrip() : null,
    state.searchOpen ? renderMessageSearch() : null
  ].filter(Boolean);
  return children.length ? el('div', { class: 'chat-chrome' }, children) : null;
}

function renderNoChannel() {
  return el('div', { class: 'post-history' }, [
    el('div', { class: 'post-list', 'data-testid': 'post-list' }, [
      el('div', { class: 'notice', text: 'No channel is selected. Choose a channel or create a new public channel.' })
    ])
  ]);
}

function renderGallery(channel) {
  const images = channel ? channelImages() : [];
  const box = el('div', { class: 'gallery-view', 'data-testid': 'channel-gallery' }, [
    el('div', { class: 'gallery-head' }, [
      el('div', {}, [
        el('h3', { text: 'Gallery' }),
        el('span', { class: 'file-row-meta', text: channel ? channelLabel(channel) : 'No channel' })
      ]),
      iconButton('close', 'Close gallery', { class: 'ghost', onclick: () => { state.galleryOpen = false; renderApp(); } })
    ])
  ]);
  if (images.length === 0) {
    box.append(el('div', { class: 'notice', text: 'No images in this channel yet.' }));
    return box;
  }
  box.append(el('div', { class: 'gallery-grid' }, images.map((item) => {
    const user = state.users.find((candidate) => candidate.id === item.post.user_id);
    return el('a', { class: 'gallery-item', href: '/api/v4/files/' + item.fileId, target: '_blank' }, [
      el('span', { class: 'gallery-thumb' }, [
        el('img', { src: '/api/v4/files/' + item.fileId + '/preview', alt: item.post.message || 'Channel image' })
      ]),
      el('span', { class: 'gallery-meta' }, [
        el('span', { text: item.post.message || 'Image attachment' }),
        el('span', { text: (user ? '@' + user.username : 'unknown') + ' · ' + new Date(item.post.create_at).toLocaleString() })
      ])
    ]);
  })));
  return box;
}

function channelImages() {
  return state.posts
    .filter((post) => !post.delete_at)
    .flatMap((post) => (post.file_ids || []).map((fileId) => ({ post, fileId })))
    .reverse();
}

function renderOnboardingStrip() {
  const joinable = state.publicChannels[0];
  return el('div', { class: 'onboarding-strip' }, [
    el('div', {}, [
      el('strong', { text: 'Welcome to ChatterMost' }),
      el('span', { text: 'Set up your profile, find people, or join a public channel.' })
    ]),
    el('div', { class: 'button-row' }, [
      el('button', { class: 'ghost', type: 'button', text: 'Profile', onclick: () => openPanel('profile') }),
      el('button', { class: 'ghost', type: 'button', text: 'DMs', onclick: openDirectPanel }),
      joinable ? el('button', { type: 'button', text: 'Join ' + channelLabel(joinable), onclick: () => joinPublicChannel(joinable.id) }) : null,
      el('button', { class: 'ghost', type: 'button', text: 'Dismiss', onclick: dismissOnboarding })
    ].filter(Boolean))
  ]);
}

function dismissOnboarding() {
  state.showOnboarding = false;
  localStorage.removeItem('chattermost-new-user');
  renderApp();
}

function renderMessageSearch() {
  const form = el('form', { class: 'message-search', role: 'search' }, [
    el('label', { text: 'Search messages' }, [
      el('input', { name: 'terms', placeholder: 'Search this workspace', value: state.searchTerm, autocomplete: 'off' })
    ]),
    el('button', { text: 'Search' }),
    state.searchTerm ? el('button', { class: 'ghost', type: 'button', text: 'Clear', onclick: clearMessageSearch }) : null
  ].filter(Boolean));
  form.addEventListener('input', () => {
    const input = form.elements.namedItem('terms');
    if (input instanceof HTMLInputElement) state.searchTerm = input.value;
  });
  form.addEventListener('submit', searchMessages);
  const box = el('div', { class: 'search-shelf' }, [
    form,
    state.searchStatus ? el('div', { class: 'notice compact-search-notice ' + (state.searchStatus.startsWith('No') ? '' : state.searchStatus.startsWith('Search failed') ? 'error' : 'success'), text: state.searchStatus }) : null
  ].filter(Boolean));
  if (state.searchResults.length > 0) {
    box.append(el('div', { class: 'search-results' }, state.searchResults.map((post) => {
      const channel = state.channels.concat(state.publicChannels).find((item) => item.id === post.channel_id);
      const user = state.users.find((item) => item.id === post.user_id);
      return el('button', { class: 'search-result', type: 'button', onclick: () => jumpToSearchResult(post) }, [
        el('span', { class: 'search-result-channel', text: channel ? channelLabel(channel) : 'Channel' }),
        el('span', { class: 'search-result-message', text: post.message || 'Attachment post' }),
        el('span', { class: 'search-result-meta', text: (user ? '@' + user.username : 'unknown') + ' · ' + new Date(post.create_at).toLocaleString() })
      ]);
    })));
  }
  return box;
}

function renderThemeToggle() {
  const dark = state.theme === 'dark';
  return el('button', {
    class: 'theme-toggle ' + (dark ? 'dark' : 'light'),
    type: 'button',
    title: dark ? 'Switch to light mode' : 'Switch to dark mode',
    'aria-label': dark ? 'Switch to light mode' : 'Switch to dark mode',
    'aria-pressed': String(dark),
    onclick: toggleTheme
  }, [el('span', { 'aria-hidden': 'true', text: dark ? '☀' : '☾' })]);
}

function renderPosts() {
  clearExpiredBotIndicators();
  const list = el('div', { class: 'post-list', 'data-testid': 'post-list' });
  list.addEventListener('scroll', () => updateJumpToBottomButton(list));
  if (state.posts.length === 0) {
    list.append(el('div', { class: 'notice', text: 'No posts here yet.' }));
  }
  const visibleCount = visiblePostCount();
  const hiddenCount = Math.max(state.posts.length - visibleCount, 0);
  const visiblePosts = hiddenCount > 0 ? state.posts.slice(hiddenCount) : state.posts;
  if (hiddenCount > 0) {
    list.append(el('button', {
      class: 'history-loader',
      type: 'button',
      'aria-label': 'Load 50 older messages',
      text: 'Load 50 older messages',
      onclick: loadOlderPosts
    }));
  }
  let previous = null;
  for (const post of visiblePosts) {
    const grouped = Boolean(
      previous &&
      previous.user_id === post.user_id &&
      previous.props?.from_webhook !== 'true' &&
      post.props?.from_webhook !== 'true' &&
      !previous.delete_at &&
      !post.delete_at &&
      state.editingPostId !== post.id &&
      state.editingPostId !== previous.id &&
      (post.create_at - previous.create_at) < 5 * 60 * 1000
    );
    list.append(renderPost(post, grouped));
    previous = post;
  }
  const botIndicator = renderBotResponseIndicator();
  if (botIndicator) list.append(botIndicator);
  const jumpButton = el('button', {
    class: 'jump-to-bottom' + (state.showJumpToBottom ? ' visible' : ''),
    type: 'button',
    title: 'Jump to latest',
    'aria-label': 'Jump to latest',
    'aria-hidden': String(!state.showJumpToBottom),
    tabindex: state.showJumpToBottom ? '0' : '-1',
    onclick: jumpToBottom
  }, [uiIcon('arrowDown')]);
  return el('div', { class: 'post-history' }, [list, jumpButton]);
}

function visiblePostCount() {
  if (!state.activeChannelId) return postHistoryPageSize;
  return Math.max(state.visiblePostCounts[state.activeChannelId] || postHistoryPageSize, postHistoryPageSize);
}

function loadOlderPosts() {
  if (!state.activeChannelId) return;
  const list = document.querySelector('.post-list');
  const previousHeight = list instanceof HTMLElement ? list.scrollHeight : 0;
  const previousTop = list instanceof HTMLElement ? list.scrollTop : 0;
  state.visiblePostCounts[state.activeChannelId] = Math.min(visiblePostCount() + postHistoryPageSize, state.posts.length);
  renderApp();
  requestAnimationFrame(() => {
    const nextList = document.querySelector('.post-list');
    if (!(nextList instanceof HTMLElement)) return;
    nextList.scrollTop = Math.max(nextList.scrollHeight - previousHeight + previousTop, 0);
    updateJumpToBottomButton(nextList);
  });
}

function updateJumpToBottomButton(list) {
  const shouldShow = list.scrollHeight - list.clientHeight - list.scrollTop > 90;
  state.showJumpToBottom = shouldShow;
  const button = document.querySelector('.jump-to-bottom');
  if (!(button instanceof HTMLElement)) return;
  button.classList.toggle('visible', shouldShow);
  button.setAttribute('aria-hidden', String(!shouldShow));
  button.setAttribute('tabindex', shouldShow ? '0' : '-1');
}

function isPostListNearBottom() {
  const list = document.querySelector('.post-list');
  if (!(list instanceof HTMLElement)) return true;
  return list.scrollHeight - list.clientHeight - list.scrollTop <= 90;
}

function jumpToBottom() {
  scrollPostListToBottom();
}

function scrollPostListToBottom() {
  requestAnimationFrame(() => {
    const list = document.querySelector('.post-list');
    if (!(list instanceof HTMLElement)) return;
    list.scrollTop = list.scrollHeight;
    updateJumpToBottomButton(list);
  });
}

function renderBotResponseIndicator() {
  const responders = Object.values(state.botResponseIndicators)
    .filter((indicator) => indicator.channelId === state.activeChannelId)
    .map((indicator) => ({ indicator, user: userById(indicator.userId) }))
    .filter((entry) => entry.user?.is_bot || entry.indicator.name);
  if (responders.length === 0) return null;
  const names = responders.map((entry) => entry.user ? botResponseName(entry.user) : entry.indicator.name);
  const label = names.length === 1 ? names[0] + ' is responding' : names.length + ' bots are responding';
  const first = responders[0]?.user;
  return el('article', { class: 'post bot-response-indicator', 'data-testid': 'bot-response-indicator', role: 'status', 'aria-label': label }, [
    el('div', { class: 'avatar' }, first ? [el('img', { src: avatarSrc(first.id), alt: '' })] : []),
    el('div', { class: 'post-body' }, [
      el('div', { class: 'bot-response-bubble' }, [
        el('span', { class: 'bot-response-label', text: label }),
        el('span', { class: 'typing-dots', 'aria-hidden': 'true' }, [
          el('span'),
          el('span'),
          el('span')
        ])
      ])
    ])
  ]);
}

function togglePostActions(event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const post = target.closest('.post');
  if (post) post.classList.toggle('actions-open');
}

function renderPost(post, grouped) {
  const user = state.users.find((item) => item.id === post.user_id) || { username: 'unknown' };
  const webhook = webhookPostIdentity(post, user);
  const reactions = state.reactions[post.id] || [];
  const threadRootId = post.root_id || post.id;
  const threadLabel = post.root_id ? 'View thread' : 'Reply in thread' + (post.reply_count ? ' ' + post.reply_count : '');
  const counts = reactions.reduce((acc, reaction) => {
    acc[reaction.emoji_name] = (acc[reaction.emoji_name] || 0) + 1;
    return acc;
  }, {});
  const metadataFiles = Array.isArray(post.metadata?.files) ? post.metadata.files : [];
  const files = (post.file_ids || []).map((id) => {
    const fileInfo = metadataFiles.find((file) => file && typeof file === 'object' && file.id === id);
    const fileName = typeof fileInfo?.name === 'string' && fileInfo.name ? fileInfo.name : 'Attachment ' + id.slice(0, 8);
    const isImage = typeof fileInfo?.mime_type === 'string' && fileInfo.mime_type.startsWith('image/');
    return el('a', {
      class: 'file-preview-link',
      href: '/api/v4/files/' + id,
      target: '_blank',
      title: 'Open attachment',
      'aria-label': isImage ? 'Open attachment preview' : 'Attachment ' + fileName
    }, isImage ? [
      el('img', { src: '/api/v4/files/' + id + '/preview', alt: 'Attachment preview' }),
      el('span', { class: 'file-preview-hint', text: 'Open' })
    ] : [
      el('span', { class: 'file-attachment-label', text: '📎 ' + fileName })
    ]);
  });
  const editing = state.editingPostId === post.id;
  const reactionPills = Object.entries(counts).map(([emoji, count]) => el('button', {
    class: 'reaction',
    'aria-label': emojiSymbolForName(emoji) + ' reaction ' + count,
    title: ':' + emoji + ':',
    onclick: () => removeReaction(post.id, emoji)
  }, [
    el('span', { class: 'reaction-emoji', 'aria-hidden': 'true', text: emojiSymbolForName(emoji) }),
    document.createTextNode(' ' + count)
  ]));
  return el('article', { class: 'post' + (grouped ? ' grouped' : ''), 'data-testid': 'post', 'data-post-id': post.id }, [
    el('div', { class: 'avatar' }, [el('img', { src: avatarSrc(post.user_id), alt: '' })]),
    el('div', { class: 'post-body' }, [
      el('div', { class: 'post-meta' }, [
        el('span', { class: 'post-author', text: webhook?.displayName || user.username }),
        webhook ? el('span', { class: 'webhook-marker', text: 'WEBHOOK', title: 'Posted by an incoming webhook' }) : null,
        el('span', { class: 'post-time', text: new Date(post.create_at).toLocaleString() }),
        post.edit_at ? el('span', { class: 'post-time', text: 'edited' }) : null
      ].filter(Boolean)),
      webhook ? el('details', { class: 'webhook-details' }, [
        el('summary', { text: 'Message details' }),
        el('span', { text: 'Webhook: ' + webhook.label + ' · Owner: @' + webhook.ownerUsername })
      ]) : null,
      editing ? renderPostEditor(post) : el('div', { class: 'post-message', text: post.delete_at ? 'message deleted' : post.message }),
      files.length ? el('div', { class: 'file-previews' }, files) : null,
      !editing && reactionPills.length ? el('div', { class: 'post-reactions' }, reactionPills) : null
    ].filter(Boolean)),
    editing ? null : el('button', { class: 'post-more', type: 'button', 'aria-label': 'More actions', title: 'More actions', text: '⋯', onclick: togglePostActions }),
    editing ? null : el('div', { class: 'post-actions' }, [
      el('button', { text: '+ 🙂', onclick: () => addReaction(post.id, 'slightly_smiling_face') }),
      el('button', { text: threadLabel, onclick: () => openThread(threadRootId) }),
      el('button', { text: post.is_pinned ? 'Unpin' : 'Pin', onclick: () => togglePin(post) }),
      el('button', { text: 'Edit', onclick: () => editPost(post) }),
      el('button', { class: 'warning-action', text: 'Delete', onclick: () => deletePost(post.id) })
    ])
  ].filter(Boolean));
}

function webhookPostIdentity(post, fallbackUser) {
  if (post.props?.from_webhook !== 'true') return null;
  const owner = state.users.find((item) => item.id === post.props.webhook_owner_id);
  return {
    displayName: typeof post.props.override_username === 'string' && post.props.override_username.trim()
      ? post.props.override_username.trim()
      : fallbackUser.username,
    label: typeof post.props.webhook_label === 'string' && post.props.webhook_label.trim()
      ? post.props.webhook_label.trim()
      : 'Incoming webhook',
    ownerUsername: owner?.username || (
      typeof post.props.webhook_owner_username === 'string' && post.props.webhook_owner_username.trim()
        ? post.props.webhook_owner_username.trim()
        : fallbackUser.username
    )
  };
}

function renderPostEditor(post) {
  const form = el('form', { class: 'inline-edit' }, [
    state.editError ? el('div', { class: 'notice error', text: state.editError }) : null,
    el('label', { text: 'Edit message' }, [el('textarea', { name: 'message', required: true, value: state.editDraft })]),
    el('div', { class: 'button-row' }, [
      el('button', { text: 'Save edit' }),
      el('button', { class: 'ghost', type: 'button', text: 'Cancel', onclick: cancelPostEdit })
    ])
  ].filter(Boolean));
  form.addEventListener('input', () => {
    const message = form.elements.namedItem('message');
    if (message instanceof HTMLTextAreaElement) state.editDraft = message.value;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = String(new FormData(form).get('message') || '').trim();
    if (!message) {
      state.editError = 'Message cannot be empty.';
      renderApp();
      return;
    }
    try {
      await api('/api/v4/posts/' + post.id + '/patch', { method: 'PUT', body: { message } });
      state.editingPostId = '';
      state.editDraft = '';
      state.editError = '';
      await loadPosts();
      renderApp();
    } catch (error) {
      state.editError = error.message || String(error);
      renderApp();
    }
  });
  return form;
}

function renderComposer() {
  const channel = state.channels.find((item) => item.id === state.activeChannelId);
  const composerChannelId = channel?.id || state.activeChannelId;
  const draft = state.drafts[composerChannelId] || '';
  const hasAttachments = pendingFilesForChannel(composerChannelId).length > 0;
  const composerClass = 'composer' + (hasAttachments ? ' has-attachments' : '') + (state.composerError ? ' has-error' : '');
  const form = el('form', { class: composerClass, 'data-channel-id': composerChannelId }, [
    state.composerError ? el('div', { class: 'notice error', 'data-error': '', text: state.composerError }) : null,
    state.uploadStatus ? el('div', { class: 'notice success upload-status', text: state.uploadStatus }) : null,
    renderAttachmentTray(composerChannelId),
    renderCommandPalette(channel, draft),
    el('textarea', { name: 'message', 'aria-label': 'Message', placeholder: 'Message', value: draft }),
    el('div', { class: 'composer-tools' }, [
      el('label', { class: 'file-picker', title: 'Attach files' }, [
        uiIcon('paperclip'),
        el('span', { class: 'file-picker-text', text: 'Attach files' }),
        el('input', { name: 'files', type: 'file', multiple: true, 'aria-label': 'Attach files' })
      ]),
      renderEmojiPicker(),
      el('button', { type: 'submit', text: 'Send' })
    ])
  ].filter(Boolean));
  const fileInput = form.elements.namedItem('files');
  if (fileInput instanceof HTMLInputElement) {
    fileInput.addEventListener('change', () => {
      addPendingFiles(Array.from(fileInput.files || []), composerChannelId);
      fileInput.value = '';
      state.composerError = '';
      renderApp();
    });
  }
  const messageInput = form.elements.namedItem('message');
  if (messageInput instanceof HTMLTextAreaElement) {
    messageInput.addEventListener('keydown', (event) => {
      const suggestions = commandSuggestions(channel, messageInput.value);
      if (suggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        state.commandPaletteIndex = (state.commandPaletteIndex + direction + suggestions.length) % suggestions.length;
        renderApp();
        requestAnimationFrame(() => {
          const nextInput = document.querySelector('.composer textarea[name="message"]');
          if (nextInput instanceof HTMLTextAreaElement) nextInput.focus();
        });
        return;
      }
      if (suggestions.length > 0 && event.key === 'Tab') {
        event.preventDefault();
        const selected = suggestions[state.commandPaletteIndex];
        if (selected) applyCommandSuggestion(selected);
        return;
      }
      if (suggestions.length > 0 && event.key === 'Escape') {
        event.preventDefault();
        state.commandPaletteHidden = true;
        renderApp();
        requestAnimationFrame(() => {
          const nextInput = document.querySelector('.composer textarea[name="message"]');
          if (nextInput instanceof HTMLTextAreaElement) nextInput.focus();
        });
        return;
      }
      if (event.key !== 'Enter' || event.isComposing) return;
      if (event.shiftKey) {
        event.preventDefault();
        const start = messageInput.selectionStart;
        const end = messageInput.selectionEnd;
        const next = messageInput.value.slice(0, start) + '\\n' + messageInput.value.slice(end);
        messageInput.value = next;
        messageInput.setSelectionRange(start + 1, start + 1);
        state.drafts[composerChannelId] = next;
        return;
      }
      event.preventDefault();
      form.requestSubmit();
    });
  }
  form.addEventListener('input', () => {
    const message = form.elements.namedItem('message');
    if (message instanceof HTMLTextAreaElement) {
      state.drafts[composerChannelId] = message.value;
      state.commandPaletteHidden = false;
      state.commandPaletteIndex = 0;
    }
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      state.socket.send(JSON.stringify({ seq: Date.now(), action: 'user_typing', data: { channel_id: composerChannelId } }));
    }
    if (message instanceof HTMLTextAreaElement && botUsersForChannel(channel).length > 0 && (message.value.startsWith('/') || document.querySelector('.command-palette'))) {
      const selectionStart = message.selectionStart;
      renderApp();
      requestAnimationFrame(() => {
        const nextInput = document.querySelector('.composer textarea[name="message"]');
        if (nextInput instanceof HTMLTextAreaElement) {
          nextInput.focus();
          nextInput.setSelectionRange(selectionStart, selectionStart);
        }
      });
    }
  });
  form.addEventListener('paste', (event) => {
    if (state.sendingChannels[composerChannelId]) return;
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length > 0) {
      addPendingFiles(files, composerChannelId);
      state.composerError = '';
      renderApp();
    }
  });
  form.addEventListener('dragover', (event) => {
    event.preventDefault();
    form.classList.add('dragging');
  });
  form.addEventListener('dragleave', () => {
    form.classList.remove('dragging');
  });
  form.addEventListener('drop', (event) => {
    event.preventDefault();
    form.classList.remove('dragging');
    if (state.sendingChannels[composerChannelId]) return;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 0) {
      addPendingFiles(files, composerChannelId);
      state.composerError = '';
      renderApp();
    }
  });
  if (state.sendingChannels[composerChannelId]) {
    form.querySelectorAll('input, textarea, button').forEach((control) => { control.disabled = true; });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.sendingChannels[composerChannelId]) return;
    state.sendingChannels[composerChannelId] = true;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const data = new FormData(form);
      let fileIds = [];
      const pendingFiles = pendingFilesForChannel(composerChannelId).map((item) => item.file);
      const formFiles = data.getAll('files').filter((item) => item instanceof File && item.size > 0);
      const files = pendingFiles.length ? pendingFiles : formFiles;
      const messageField = form.elements.namedItem('message');
      const message = String((messageField instanceof HTMLTextAreaElement ? messageField.value : '') || state.drafts[composerChannelId] || '').trim();
      if (!message && files.length === 0) {
        state.composerError = 'Write a message or attach a file.';
        renderApp();
        return;
      }
      if (message.startsWith('/') && files.length > 0) {
        state.composerError = 'Slash commands cannot include attachments. Remove the attachments or send them as a separate message.';
        renderApp();
        return;
      }
      form.querySelectorAll('input, textarea, button').forEach((control) => { control.disabled = true; });
      if (files.length) {
        state.uploadStatus = 'Uploading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '...';
        renderApp();
        const upload = new FormData();
        upload.set('channel_id', composerChannelId);
        files.forEach((file) => upload.append('files', file));
        const result = await api('/api/v4/files', { method: 'POST', body: upload });
        fileIds = result.file_infos.map((file) => file.id);
      }
      let createdAt = Date.now();
      if (message.startsWith('/')) {
        await api('/api/v4/commands/execute', { method: 'POST', body: { channel_id: composerChannelId, command: message } });
      } else {
        const createdPost = await api('/api/v4/posts', { method: 'POST', body: { channel_id: composerChannelId, message, file_ids: fileIds } });
        createdAt = createdPost.create_at || createdAt;
      }
      markBotRespondingForOutgoingMessage(composerChannelId, message, createdAt);
      state.drafts[composerChannelId] = '';
      state.commandPaletteHidden = false;
      state.commandPaletteIndex = 0;
      state.composerError = '';
      state.uploadStatus = '';
      state.emojiPickerOpen = false;
      clearPendingFiles(composerChannelId);
      form.reset();
      const activeComposer = document.querySelector('.composer textarea[name="message"]');
      if (state.activeChannelId === composerChannelId && activeComposer instanceof HTMLTextAreaElement) activeComposer.value = '';
      await loadPosts();
      renderApp();
      scrollPostListToBottom();
    } catch (error) {
      state.uploadStatus = '';
      state.composerError = error.message || String(error);
      renderApp();
    } finally {
      delete state.sendingChannels[composerChannelId];
      if (submit) submit.disabled = false;
      renderApp();
    }
  });
  return form;
}

function renderAttachmentTray(channelId = state.activeChannelId) {
  const files = pendingFilesForChannel(channelId);
  if (files.length === 0) return null;
  return el('div', { class: 'attachment-tray', 'aria-label': 'Selected attachments' }, files.map((item) => el('div', { class: 'attachment-chip' }, [
    el('span', { class: 'attachment-thumb' }, item.previewUrl ? [
      el('img', { src: item.previewUrl, alt: '' })
    ] : [
      el('span', { text: fileBadge(item.file.name).toUpperCase() })
    ]),
    el('span', {}, [
      el('span', { class: 'attachment-name', text: item.file.name }),
      el('span', { class: 'attachment-meta', text: formatFileSize(item.file.size) })
    ]),
    el('button', { class: 'attachment-remove', type: 'button', 'aria-label': 'Remove ' + item.file.name, title: 'Remove attachment', text: 'x', onclick: () => removePendingFile(item.id, channelId) })
  ])));
}

function renderEmojiPicker() {
  const term = state.emojiSearch.trim().toLowerCase();
  const customChoices = state.customEmoji.map((item) => ({ symbol: item.emoji, name: item.name }));
  const choices = emojiChoices.filter((emoji) => !term || emoji.includes(term) || (emojiNames[emoji] || '').includes(term));
  const matchingCustom = customChoices.filter((emoji) => !term || emoji.symbol.includes(term) || emoji.name.includes(term));
  const recent = state.recentEmoji.filter((emoji) => emojiChoices.includes(emoji));
  const emojiButton = (emoji) => el('button', {
    class: 'emoji-choice',
    type: 'button',
    'aria-label': 'Add emoji ' + emoji,
    text: emoji,
    onclick: () => insertEmoji(emoji)
  });
  return el('div', { class: 'emoji-picker' }, [
    el('button', {
      class: 'emoji-button',
      type: 'button',
      title: 'Emoji',
      'aria-label': 'Emoji',
      'aria-expanded': String(state.emojiPickerOpen),
      onclick: () => {
        state.emojiPickerOpen = !state.emojiPickerOpen;
        renderApp();
      }
    }, [uiIcon('smile')]),
    state.emojiPickerOpen ? el('div', { class: 'emoji-popover', role: 'dialog', 'aria-label': 'Emoji picker' }, [
      el('div', { class: 'emoji-popover-head' }, [
        el('h4', { text: 'Emoji' }),
        el('input', { name: 'emoji_search', placeholder: 'Search', value: state.emojiSearch, autocomplete: 'off', oninput: (event) => {
          state.emojiSearch = event.currentTarget.value;
          renderApp();
          requestAnimationFrame(() => {
            const input = document.querySelector('input[name="emoji_search"]');
            if (input instanceof HTMLInputElement) {
              input.focus();
              input.setSelectionRange(input.value.length, input.value.length);
            }
          });
        } })
      ]),
      recent.length ? el('div', { class: 'emoji-section' }, [
        el('span', { class: 'emoji-section-label', text: 'Recent' }),
        el('div', { class: 'emoji-grid compact', }, recent.map(emojiButton))
      ]) : null,
      el('div', { class: 'emoji-section' }, [
        el('span', { class: 'emoji-section-label', text: term ? 'Matches' : 'Common' }),
        choices.length ? el('div', { class: 'emoji-grid' }, choices.map(emojiButton)) : el('div', { class: 'notice', text: 'No emoji found.' })
      ]),
      matchingCustom.length ? el('div', { class: 'emoji-section' }, [
        el('span', { class: 'emoji-section-label', text: 'Custom' }),
        el('div', { class: 'emoji-grid' }, matchingCustom.map((emoji) => el('button', {
          class: 'emoji-choice',
          type: 'button',
          title: ':' + emoji.name + ':',
          'aria-label': 'Add emoji ' + emoji.name,
          text: emoji.symbol,
          onclick: () => insertEmoji(emoji.symbol)
        })))
      ]) : null
    ].filter(Boolean)) : null
  ].filter(Boolean));
}

function renderPanel() {
  if (state.panel === 'thread' && state.activeThreadId) {
    return renderThreadPanel();
  }
  const tabs = [
    ['members', 'Members'],
    ['files', 'Files'],
    ['pins', 'Pinned'],
    ['policy', 'Policy'],
    ['direct', 'DMs'],
    ['new-channel', 'New'],
    ['profile', 'Profile']
  ];
  if (isAdminMode()) {
    tabs.push(
      ['admin', 'Users'],
      ['system', 'System'],
      ['supervision', 'Supervision'],
      ['agents', 'Agents'],
      ['hermes', 'Hermes']
    );
  }
  if (!tabs.some(([name]) => name === state.panel)) {
    state.panel = 'members';
  }
  const adminPanels = new Set(['admin', 'system', 'supervision', 'agents', 'hermes']);
  return el('aside', { class: 'side-panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', { text: adminPanels.has(state.panel) ? 'Admin' : 'Panel' }),
      iconButton('close', 'Close panel', { class: 'ghost panel-close', onclick: closeSidePanel })
    ]),
    el('div', { class: 'panel-tabs' }, [
      ...tabs.map(([name, label]) => tab(name, label))
    ]),
    el('div', { class: 'panel-body' }, [renderPanelBody()])
  ]);
}

function closeSidePanel() {
  state.profileDraft = null;
  state.profileImageDraft = null;
  state.sidePanelOpen = false;
  renderApp();
}

function closeModal() {
  state.userModalMode = '';
  state.userModalId = '';
  state.adminUserDraft = {};
  state.channelModalMode = '';
  state.channelModalId = '';
  state.channelDraft = {};
  state.createChannelError = '';
  renderApp();
}

function renderModal() {
  if (state.userModalMode) return renderUserModal();
  if (state.channelModalMode) return renderChannelModal();
  return null;
}

function openUserModal(mode, user = null) {
  state.userModalMode = mode;
  state.userModalId = user?.id || '';
  state.adminUserDraft = user ? {
    username: user.username || '',
    email: user.email || '',
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    nickname: user.nickname || '',
    position: user.position || '',
    role: user.roles || 'system_user'
  } : {
    username: '',
    email: '',
    password: '',
    first_name: '',
    last_name: '',
    nickname: '',
    position: '',
    role: 'system_user'
  };
  clearPanelFeedback('admin');
  renderApp();
}

function renderUserModal() {
  const creating = state.userModalMode === 'create';
  const draft = state.adminUserDraft || {};
  const form = el('form', { class: 'modal-form' }, [
    el('div', { class: 'modal-head' }, [
      el('h2', { text: creating ? 'Create user' : 'Edit user' }),
      iconButton('close', 'Close user dialog', { class: 'ghost', onclick: closeModal })
    ]),
    renderPanelFeedback('admin'),
    el('label', { text: 'Username' }, [el('input', { name: 'username', required: true, autocomplete: 'off', value: draft.username || '', disabled: !creating })]),
    el('label', { text: 'Email' }, [el('input', { name: 'email', type: 'email', required: true, autocomplete: 'off', value: draft.email || '', disabled: !creating })]),
    creating ? el('label', { text: 'Password' }, [el('input', { name: 'password', type: 'password', minlength: '10', required: true, autocomplete: 'new-password', value: draft.password || '' })]) : null,
    el('div', { class: 'two-column-fields' }, [
      el('label', { text: 'First name' }, [el('input', { name: 'first_name', value: draft.first_name || '', autocomplete: 'off' })]),
      el('label', { text: 'Last name' }, [el('input', { name: 'last_name', value: draft.last_name || '', autocomplete: 'off' })])
    ]),
    el('label', { text: 'Nickname' }, [el('input', { name: 'nickname', value: draft.nickname || '', autocomplete: 'off' })]),
    el('label', { text: 'Position' }, [el('input', { name: 'position', value: draft.position || '', autocomplete: 'off' })]),
    creating ? el('label', { text: 'Role' }, [
      el('select', { name: 'role' }, [
        el('option', { value: 'system_user', text: 'User', selected: draft.role !== 'system_admin system_user' }),
        el('option', { value: 'system_admin system_user', text: 'System admin', selected: draft.role === 'system_admin system_user' })
      ])
    ]) : null,
    el('div', { class: 'button-row' }, [
      el('button', { type: 'submit', text: creating ? 'Create user' : 'Save user' }),
      el('button', { class: 'ghost', type: 'button', text: 'Cancel', onclick: closeModal })
    ])
  ].filter(Boolean));
  form.addEventListener('input', () => {
    state.adminUserDraft = Object.fromEntries(new FormData(form).entries());
  });
  form.addEventListener('submit', saveUserModal);
  return el('div', { class: 'modal-backdrop', role: 'presentation' }, [
    el('section', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': creating ? 'Create user' : 'Edit user' }, [form])
  ]);
}

async function saveUserModal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const data = Object.fromEntries(new FormData(form).entries());
  clearPanelFeedback('admin');
  try {
    if (state.userModalMode === 'create') {
      await api('/admin/users', {
        method: 'POST',
        body: {
          username: data.username,
          email: data.email,
          password: data.password,
          role: data.role || 'system_user',
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          nickname: data.nickname || '',
          position: data.position || ''
        }
      });
      setPanelFeedback('admin', 'success', 'User created.');
    } else {
      await api('/api/v4/users/' + state.userModalId + '/patch', {
        method: 'PUT',
        body: {
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          nickname: data.nickname || '',
          position: data.position || ''
        }
      });
      setPanelFeedback('admin', 'success', 'User saved.');
    }
    state.userModalMode = '';
    state.userModalId = '';
    state.adminUserDraft = {};
    await loadData();
    state.panel = 'admin';
    state.sidePanelOpen = true;
    renderApp();
  } catch (error) {
    setPanelFeedback('admin', 'error', error.message || String(error));
    renderApp();
  }
}

function openChannelModal(mode, channel = null) {
  state.channelModalMode = mode;
  state.channelModalId = channel?.id || '';
  state.channelDraft = channel ? {
    display_name: channel.display_name || '',
    header: channel.header || '',
    purpose: channel.purpose || ''
  } : {};
  renderApp();
}

function renderChannelModal() {
  const channel = state.channels.concat(state.publicChannels).find((item) => item.id === state.channelModalId);
  const draft = state.channelDraft || {};
  const form = el('form', { class: 'modal-form' }, [
    el('div', { class: 'modal-head' }, [
      el('h2', { text: 'Edit public channel' }),
      iconButton('close', 'Close channel dialog', { class: 'ghost', onclick: closeModal })
    ]),
    state.createChannelError ? el('div', { class: 'notice error', text: state.createChannelError }) : null,
    el('label', { text: 'Channel name' }, [el('input', { name: 'display_name', required: true, value: draft.display_name || channel?.display_name || '', autocomplete: 'off' })]),
    el('label', { text: 'Header' }, [el('input', { name: 'header', value: draft.header || channel?.header || '', autocomplete: 'off' })]),
    el('label', { text: 'Purpose' }, [el('textarea', { name: 'purpose', value: draft.purpose || channel?.purpose || '' })]),
    el('div', { class: 'button-row' }, [
      el('button', { type: 'submit', text: 'Save channel' }),
      el('button', { class: 'ghost', type: 'button', text: 'Cancel', onclick: closeModal })
    ])
  ].filter(Boolean));
  form.addEventListener('input', () => {
    state.channelDraft = Object.fromEntries(new FormData(form).entries());
  });
  form.addEventListener('submit', saveChannelModal);
  return el('div', { class: 'modal-backdrop', role: 'presentation' }, [
    el('section', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit public channel' }, [form])
  ]);
}

async function saveChannelModal(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const displayName = String(data.display_name || '').trim();
  if (!displayName) {
    state.createChannelError = 'Channel name is required.';
    renderApp();
    return;
  }
  try {
    state.createChannelError = '';
    await api('/api/v4/channels/' + state.channelModalId + '/patch', {
      method: 'PUT',
      body: {
        display_name: displayName,
        header: data.header || '',
        purpose: data.purpose || ''
      }
    });
    closeModalStateOnly();
    await loadData();
    renderApp();
  } catch (error) {
    state.createChannelError = error.message || String(error);
    renderApp();
  }
}

function closeModalStateOnly() {
  state.userModalMode = '';
  state.userModalId = '';
  state.adminUserDraft = {};
  state.channelModalMode = '';
  state.channelModalId = '';
  state.channelDraft = {};
  state.createChannelError = '';
}

function tab(name, label) {
  return el('button', { class: state.panel === name ? 'active' : '', text: label, onclick: () => openPanel(name) });
}

function renderPanelBody() {
  if (state.panel === 'members') return renderChannelMembers();
  if (state.panel === 'files') return renderChannelFiles();
  if (state.panel === 'pins') return renderPinnedMessages();
  if (state.panel === 'policy') return renderChannelPolicy();
  if (state.panel === 'direct') return renderDirectMessages();
  if (state.panel === 'new-channel') return renderNewChannel();
  if (state.panel === 'profile') return renderProfile();
  if (state.panel === 'admin') return renderAdminUsers();
  if (state.panel === 'system') return renderSystemConsole();
  if (state.panel === 'supervision') return renderSupervision();
  if (state.panel === 'agents') return renderAgents();
  if (state.panel === 'hermes') return renderHermesHealth();
  return renderChannelMembers();
}

function renderChannelMembers() {
  const channel = state.channels.find((item) => item.id === state.activeChannelId);
  const memberIds = new Set(state.channelMembers.map((member) => member.user_id));
  const currentMembers = state.users.filter((user) => memberIds.has(user.id));
  const availableUsers = state.users.filter((user) => !memberIds.has(user.id) && user.delete_at === 0 && !user.is_bot);
  const isFixedConversation = channel?.type === 'D' || channel?.type === 'G';
  const box = el('div', { class: 'section' }, [
    el('h3', { text: isFixedConversation ? 'Conversation members' : 'Channel members' }),
    channel && channel.type === 'P' ? el('div', { class: 'notice', text: 'Private channel: only listed members can read and post here.' }) : null,
    state.memberError ? el('div', { class: 'notice error', text: state.memberError }) : null
  ].filter(Boolean));
  if (!channel) {
    box.append(el('p', { text: 'Select a channel to manage members.' }));
    return box;
  }
  box.append(el('div', { class: 'channel-group', text: isFixedConversation ? 'In conversation' : 'In channel' }));
  if (currentMembers.length === 0) {
    box.append(el('div', { class: 'notice', text: 'No members yet.' }));
  }
  for (const user of currentMembers) {
    const member = state.channelMembers.find((item) => item.user_id === user.id);
    box.append(el('div', { class: 'data-row' }, [
      el('span', { text: '@' + user.username }),
      el('span', { text: member?.roles?.includes('channel_admin') ? 'channel admin' : 'member' })
    ]));
  }
  if (isFixedConversation) {
    return box;
  }
  box.append(el('div', { class: 'channel-group', text: 'Add users' }));
  if (availableUsers.length === 0) {
    box.append(el('div', { class: 'notice', text: 'Everyone available is already in this channel.' }));
  }
  for (const user of availableUsers) {
    box.append(el('div', { class: 'data-row' }, [
      el('span', { text: '@' + user.username }),
      el('button', { class: 'ghost', type: 'button', text: 'Add', title: 'Add @' + user.username, 'aria-label': 'Add @' + user.username, onclick: () => addChannelMember(user.id) })
    ]));
  }
  return box;
}

function renderChannelFiles() {
  const attachments = state.posts.flatMap((post) =>
    (post.file_ids || []).map((fileId) => ({ post, fileId }))
  );
  const box = el('div', { class: 'section' }, [
    el('h3', { text: 'Files' })
  ]);
  if (attachments.length === 0) {
    box.append(el('div', { class: 'notice', text: 'No files in this conversation yet.' }));
    return box;
  }
  for (const attachment of attachments.reverse()) {
    const user = state.users.find((item) => item.id === attachment.post.user_id);
    box.append(el('a', { class: 'file-row', href: '/api/v4/files/' + attachment.fileId, target: '_blank' }, [
      el('span', { class: 'file-row-icon', text: '📎' }),
      el('span', {}, [
        el('span', { class: 'file-row-title', text: 'Attachment ' + attachment.fileId.slice(0, 8) }),
        el('span', { class: 'file-row-meta', text: (user ? '@' + user.username : 'unknown') + ' · ' + new Date(attachment.post.create_at).toLocaleString() })
      ])
    ]));
  }
  return box;
}

function renderPinnedMessages() {
  const pinned = state.posts.filter((post) => post.is_pinned && !post.delete_at).reverse();
  const box = el('div', { class: 'section' }, [
    el('h3', { text: 'Pinned messages' })
  ]);
  if (pinned.length === 0) {
    box.append(el('div', { class: 'notice', text: 'No pinned messages yet.' }));
    return box;
  }
  for (const post of pinned) {
    const user = state.users.find((item) => item.id === post.user_id);
    box.append(el('button', { class: 'pinned-row', type: 'button', onclick: () => jumpToSearchResult(post) }, [
      el('span', { class: 'file-row-title', text: post.message || 'Attachment post' }),
      el('span', { class: 'file-row-meta', text: (user ? '@' + user.username : 'unknown') + ' · ' + new Date(post.create_at).toLocaleString() })
    ]));
  }
  return box;
}

function renderChannelPolicy() {
  const channel = state.channels.find((item) => item.id === state.activeChannelId);
  const policy = state.channelAgentPolicy || {};
  const form = el('form', { class: 'section' }, [
    el('h3', { text: 'Channel policy' }),
    channel ? el('div', { class: 'policy-channel', text: channelLabel(channel) }) : null,
    state.channelPolicyFeedback ? el('div', { class: 'notice success', text: state.channelPolicyFeedback }) : null,
    state.channelPolicyError ? el('div', { class: 'notice error', text: state.channelPolicyError }) : null,
    checkboxInput('agents_allowed', 'Allow agent replies', policy.agents_allowed !== false),
    checkboxInput('mention_required', 'Require @mention', policy.mention_required === true),
    checkboxInput('direct_messages_enabled', 'Allow agent DMs', policy.direct_messages_enabled !== false),
    el('label', { text: 'Retention days' }, [
      el('input', { name: 'retention_days', type: 'number', min: '0', placeholder: 'Workspace default', value: policy.retention_days === undefined || policy.retention_days === null ? '' : String(policy.retention_days) })
    ]),
    el('label', { text: 'Allowed agent usernames' }, [
      el('input', { name: 'allowed_agents', placeholder: 'hermes, research-agent', value: Array.isArray(policy.allowed_agents) ? policy.allowed_agents.join(', ') : '' })
    ]),
    el('button', { text: 'Save policy' })
  ].filter(Boolean));
  form.addEventListener('submit', saveChannelPolicy);
  return form;
}

function checkboxInput(name, text, checked) {
  return el('label', { class: 'check-row' }, [el('span', { text }), el('input', { type: 'checkbox', name, checked })]);
}

async function saveChannelPolicy(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const data = new FormData(form);
  const retentionValue = String(data.get('retention_days') || '').trim();
  const allowedAgents = String(data.get('allowed_agents') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const policy = {
    agents_allowed: data.get('agents_allowed') === 'on',
    mention_required: data.get('mention_required') === 'on',
    direct_messages_enabled: data.get('direct_messages_enabled') === 'on',
    allowed_agents: allowedAgents
  };
  if (retentionValue) policy.retention_days = Number(retentionValue);
  try {
    state.channelPolicyError = '';
    state.channelPolicyFeedback = '';
    state.channelAgentPolicy = await api('/api/v4/channels/' + state.activeChannelId + '/agent-policy', { method: 'PUT', body: policy });
    state.channelPolicyFeedback = 'Policy saved.';
    state.panel = 'policy';
    renderApp();
  } catch (error) {
    state.channelPolicyError = error.message || String(error);
    state.panel = 'policy';
    renderApp();
  }
}

function renderDirectMessages() {
  const term = state.directMessageSearch.trim().toLowerCase();
  const matchesTerm = (values) => {
    if (!term) return true;
    return values.filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
  };
  const directChannels = state.channels
    .filter((channel) => channel.type === 'D' || channel.type === 'G')
    .filter((channel) => matchesTerm([channelLabel(channel), ...directChannelUsers(channel).map((user) => user.username)]));
  const people = state.users
    .filter((user) => user.id !== state.me.id && user.delete_at === 0)
    .filter((user) => directChannelForUser(user.id) === null)
    .filter((user) => matchesTerm([user.username, user.nickname, user.first_name, user.last_name, user.position, user.bot_description]))
    .sort((a, b) => a.username.localeCompare(b.username));
  const box = el('div', { class: 'section' }, [
    el('h3', { text: 'Direct messages' }),
    state.directMessageError ? el('div', { class: 'notice error', text: state.directMessageError }) : null,
    el('label', { text: 'Find people' }, [el('input', { name: 'direct_search', placeholder: 'Search by name or username', value: state.directMessageSearch, autocomplete: 'off' })])
  ].filter(Boolean));
  const search = box.querySelector('input[name="direct_search"]');
  if (search instanceof HTMLInputElement) {
    search.addEventListener('input', () => {
      state.directMessageSearch = search.value;
      renderApp();
      requestAnimationFrame(() => {
        const nextSearch = document.querySelector('input[name="direct_search"]');
        if (nextSearch instanceof HTMLInputElement) {
          nextSearch.focus();
          nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
        }
      });
    });
  }
  if (directChannels.length > 0) {
    box.append(el('div', { class: 'channel-group', text: 'Open conversations' }));
    const list = el('div', { class: 'dm-list' });
    for (const channel of directChannels) {
      const users = directChannelUsers(channel).filter((user) => user.id !== state.me.id);
      const user = users[0];
      list.append(renderDmPerson({
        label: channelLabel(channel),
        meta: channel.type === 'G' ? users.length + ' people' : user?.is_bot ? 'Bot account' : 'Direct message',
        avatarUserId: user?.id || state.me.id,
        actionLabel: channel.id === state.activeChannelId ? 'Open' : 'Open',
        onclick: () => selectChannel(channel.id)
      }));
    }
    box.append(list);
  }
  if (people.length === 0) {
    if (directChannels.length === 0) {
      box.append(el('div', { class: 'notice', text: term ? 'No matching people.' : 'No one else is available.' }));
    }
    return box;
  }
  box.append(el('div', { class: 'channel-group', text: 'People' }));
  const peopleList = el('div', { class: 'dm-list' });
  for (const user of people) {
    const existingDirect = directChannelForUser(user.id);
    peopleList.append(renderDmPerson({
      label: '@' + user.username,
      meta: (user.is_bot ? 'Bot account' : userDisplayName(user)) + (user.position ? ' · ' + user.position : ''),
      avatarUserId: user.id,
      actionLabel: existingDirect ? 'Open' : 'Message',
      onclick: existingDirect ? () => selectChannel(existingDirect.id) : () => startDirectMessage(user.id)
    }));
  }
  box.append(peopleList);
  return box;
}

function renderDmPerson({ label, meta, avatarUserId, actionLabel, onclick }) {
  return el('div', { class: 'dm-person' }, [
    el('div', { class: 'avatar' }, [el('img', { src: avatarSrc(avatarUserId), alt: '' })]),
    el('span', {}, [
      el('span', { class: 'dm-person-name', text: label }),
      el('span', { class: 'dm-person-meta', text: meta })
    ]),
    el('button', { class: 'ghost', type: 'button', text: actionLabel, onclick })
  ]);
}

function renderNewChannel() {
  const form = el('form', { class: 'section' }, [
    el('h3', { text: 'Create channel' }),
    state.createChannelError ? el('div', { class: 'notice error', text: state.createChannelError }) : null,
    el('label', { text: 'Channel name' }, [el('input', { name: 'display_name', placeholder: 'Project launch', required: true, autocomplete: 'off', value: state.newChannelName })]),
    el('label', { text: 'Visibility' }, [
      el('select', { name: 'type' }, [
        el('option', { value: 'O', text: 'Public', selected: state.newChannelType === 'O' }),
        el('option', { value: 'P', text: 'Private', selected: state.newChannelType === 'P' })
      ])
    ]),
    el('div', { class: 'composer-tools' }, [
      el('button', { text: 'Create channel' }),
      el('button', { class: 'ghost', type: 'button', text: 'Cancel', onclick: () => { state.panel = 'members'; state.sidePanelOpen = false; renderApp(); } })
    ])
  ].filter(Boolean));
  const syncDraft = () => {
    const name = form.elements.namedItem('display_name');
    const type = form.elements.namedItem('type');
    if (name instanceof HTMLInputElement) state.newChannelName = name.value;
    if (type instanceof HTMLSelectElement) state.newChannelType = type.value;
  };
  form.addEventListener('input', syncDraft);
  form.addEventListener('change', syncDraft);
  form.addEventListener('submit', createChannelFromForm);
  return form;
}

function renderThreadPanel() {
  const root = state.posts.find((post) => post.id === state.activeThreadId);
  const replies = root ? state.posts.filter((post) => post.root_id === root.id) : [];
  const rootUser = root ? state.users.find((item) => item.id === root.user_id) || { username: 'unknown' } : null;
  return el('aside', { class: 'side-panel thread-panel' }, [
    el('div', { class: 'thread-header' }, [
      el('div', {}, [
        el('h3', { text: 'Thread' }),
        el('p', { text: root && rootUser ? 'Started by @' + rootUser.username + ' · ' + replies.length + (replies.length === 1 ? ' reply' : ' replies') : 'No message selected' })
      ]),
      el('button', { class: 'ghost', type: 'button', text: 'Close', onclick: closeThread })
    ]),
    renderThreadBody(root, replies)
  ]);
}

function renderThreadBody(root, replies) {
  const box = el('div', { class: 'thread-body' });
  if (!root) {
    box.append(el('div', { class: 'notice', text: 'The selected thread is no longer available.' }));
    return box;
  }
  box.append(el('div', { class: 'thread-root' }, [
    el('p', { class: 'thread-label', text: 'Original message' }),
    renderThreadMessage(root)
  ]));
  if (replies.length) {
    box.append(el('div', { class: 'thread-replies' }, replies.map((reply) => renderThreadMessage(reply))));
  } else {
    box.append(el('div', { class: 'notice', text: 'No replies yet.' }));
  }
  const form = el('form', { class: 'thread-composer' }, [
    state.threadError ? el('div', { class: 'notice error', text: state.threadError }) : null,
    el('textarea', { name: 'message', placeholder: 'Reply in thread', required: true, value: state.threadDrafts[root.id] || '' }),
    el('button', { text: 'Reply' })
  ].filter(Boolean));
  form.addEventListener('input', () => {
    const message = form.elements.namedItem('message');
    if (message instanceof HTMLTextAreaElement) state.threadDrafts[root.id] = message.value;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = String(new FormData(form).get('message') || '').trim();
    if (!message) {
      state.threadError = 'Reply cannot be empty.';
      renderApp();
      return;
    }
    try {
      await api('/api/v4/posts', { method: 'POST', body: { channel_id: state.activeChannelId, root_id: root.id, message } });
      state.threadDrafts[root.id] = '';
      state.threadError = '';
      await loadPosts();
      renderApp();
    } catch (error) {
      state.threadError = error.message || String(error);
      renderApp();
    }
  });
  box.append(form);
  return box;
}

function renderThreadMessage(post) {
  const user = state.users.find((item) => item.id === post.user_id) || { username: 'unknown' };
  const webhook = webhookPostIdentity(post, user);
  return el('article', { class: 'thread-reply' }, [
    el('div', { class: 'avatar' }, [el('img', { src: avatarSrc(post.user_id), alt: '' })]),
    el('div', { class: 'post-body' }, [
      el('div', { class: 'post-meta' }, [
        el('span', { class: 'post-author', text: webhook?.displayName || user.username }),
        webhook ? el('span', { class: 'webhook-marker', text: 'WEBHOOK', title: 'Posted by an incoming webhook' }) : null,
        el('span', { class: 'post-time', text: new Date(post.create_at).toLocaleString() })
      ]),
      webhook ? el('details', { class: 'webhook-details' }, [
        el('summary', { text: 'Message details' }),
        el('span', { text: 'Webhook: ' + webhook.label + ' · Owner: @' + webhook.ownerUsername })
      ]) : null,
      el('div', { class: 'post-message', text: post.delete_at ? 'message deleted' : post.message })
    ])
  ]);
}

function renderProfile() {
  if (state.profileDraft === null) state.profileDraft = profileDraftFromUser(state.me);
  const draft = state.profileDraft;
  const displayName = state.me.nickname || [state.me.first_name, state.me.last_name].filter(Boolean).join(' ') || state.me.username;
  const form = el('form', { class: 'section' }, [
    el('h3', { text: 'Profile settings' }),
    renderPanelFeedback('profile'),
    el('div', { class: 'profile-preview' }, [
      el('div', { class: 'avatar' }, [el('img', { src: avatarSrc(state.me.id), alt: '' })]),
      el('div', {}, [
        el('strong', { text: displayName }),
        el('span', { text: '@' + state.me.username }),
        state.me.position ? el('span', { text: state.me.position }) : null
      ].filter(Boolean))
    ]),
    el('label', { text: 'First name' }, [el('input', { name: 'first_name', value: draft.first_name, autocomplete: 'given-name' })]),
    el('label', { text: 'Last name' }, [el('input', { name: 'last_name', value: draft.last_name, autocomplete: 'family-name' })]),
    el('label', { text: 'Nickname' }, [el('input', { name: 'nickname', value: draft.nickname })]),
    el('label', { text: 'Position' }, [el('input', { name: 'position', value: draft.position })]),
    el('label', { text: 'Locale' }, [
      el('select', { name: 'locale' }, [
        el('option', { value: 'en', text: 'English', selected: draft.locale === 'en' }),
        el('option', { value: 'es', text: 'Spanish', selected: draft.locale === 'es' }),
        el('option', { value: 'fr', text: 'French', selected: draft.locale === 'fr' })
      ])
    ]),
    el('label', { text: 'Photo' }, [el('input', { name: 'image', type: 'file', accept: 'image/*' })]),
    el('div', { class: 'button-row' }, [
      el('button', { text: 'Save profile' }),
      el('button', { class: 'ghost', type: 'button', text: 'Reset photo', onclick: resetProfileImage })
    ])
  ].filter(Boolean));
  form.addEventListener('input', () => {
    const data = new FormData(form);
    const image = data.get('image');
    if (image instanceof File && image.size > 0) state.profileImageDraft = image;
    state.profileDraft = {
      first_name: String(data.get('first_name') || ''),
      last_name: String(data.get('last_name') || ''),
      nickname: String(data.get('nickname') || ''),
      position: String(data.get('position') || ''),
      locale: String(data.get('locale') || 'en')
    };
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearPanelFeedback('profile');
    const submit = form.querySelector('button');
    if (submit) submit.disabled = true;
    const data = new FormData(form);
    try {
      const updatedUser = await api('/api/v4/users/' + state.me.id + '/patch', {
        method: 'PUT',
        body: {
          first_name: data.get('first_name'),
          last_name: data.get('last_name'),
          nickname: data.get('nickname'),
          position: data.get('position'),
          locale: data.get('locale')
        }
      });
      const selectedImage = data.get('image');
      const image = selectedImage instanceof File && selectedImage.size > 0 ? selectedImage : state.profileImageDraft;
      if (image instanceof File && image.size > 0) {
        const upload = new FormData();
        upload.set('image', image);
        await api('/api/v4/users/' + state.me.id + '/image', { method: 'POST', body: upload });
      }
      state.me = updatedUser;
      state.profileDraft = null;
      state.profileImageDraft = null;
      await loadData();
      state.panel = 'profile';
      setPanelFeedback('profile', 'success', 'Profile saved.');
      renderApp();
    } catch (error) {
      setPanelFeedback('profile', 'error', error.message || String(error));
      renderApp();
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  return form;
}

function profileDraftFromUser(user) {
  return {
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    nickname: user.nickname || '',
    position: user.position || '',
    locale: user.locale || 'en'
  };
}

function renderAdminUsers() {
  const box = el('div', { class: 'section' }, [
    el('h3', { text: 'Admin users and invites' }),
    renderPanelFeedback('admin'),
    el('div', { class: 'button-row' }, [
      el('button', { type: 'button', text: 'New user', onclick: () => openUserModal('create') }),
      el('button', { text: 'Create one-use invite', onclick: createInvite }),
      el('button', { class: 'ghost', type: 'button', text: 'Dry-run cleanup', onclick: () => cleanupTestArtifacts(true) })
    ]),
    state.lastInviteCode ? el('div', { class: 'notice', text: 'Invite: ' + state.lastInviteCode }) : null
  ].filter(Boolean));
  if (state.cleanupResult) {
    box.append(el('div', { class: 'notice', text: 'Cleanup dry run: ' + state.cleanupResult.matched_user_count + ' users, ' + state.cleanupResult.matched_channel_count + ' channels.' }));
    if ((state.cleanupResult.matched_user_count || 0) + (state.cleanupResult.matched_channel_count || 0) > 0) {
      box.append(el('button', { class: 'warning', type: 'button', text: 'Apply cleanup', onclick: () => cleanupTestArtifacts(false) }));
    }
  }
  box.append(renderAdminPublicChannels());
  box.append(el('div', { class: 'channel-group', text: 'Users' }));
  const adminUsers = state.adminUsers.length ? state.adminUsers : state.users;
  adminUsers.forEach((user) => {
    const disabled = user.delete_at > 0;
    box.append(el('div', { class: 'admin-user-card ' + (disabled ? 'disabled' : '') }, [
      el('div', { class: 'admin-user-main' }, [
        el('span', { class: 'admin-user-name', text: '@' + user.username + (user.id === state.me.id ? ' you' : '') + (user.is_bot ? ' bot' : '') }),
        el('span', { class: 'admin-user-meta', text: disabled ? 'deactivated' : user.roles })
      ]),
      el('div', { class: 'row-actions' }, [
        el('button', { class: 'ghost', type: 'button', text: 'Edit', onclick: () => openUserModal('edit', user) }),
        el('button', { class: 'ghost', type: 'button', text: 'Reset password', disabled: user.is_bot, onclick: () => {
          state.resetUserId = state.resetUserId === user.id ? '' : user.id;
          renderApp();
        } }),
        el('button', { class: 'ghost', type: 'button', text: 'Revoke sessions', disabled: user.id === state.me.id || disabled, onclick: () => adminUserAction(user, 'revoke') }),
        disabled
          ? el('button', { class: 'secondary', type: 'button', text: 'Reactivate', onclick: () => adminUserAction(user, 'reactivate') })
          : el('button', { class: 'warning', type: 'button', text: 'Deactivate', disabled: user.id === state.me.id || user.is_bot, onclick: () => adminUserAction(user, 'deactivate') })
      ]),
      state.resetUserId === user.id ? renderResetPasswordForm(user) : null
    ].filter(Boolean)));
  });
  box.append(el('div', { class: 'channel-group', text: 'Invites' }));
  if (state.invites.length === 0) {
    box.append(el('div', { class: 'notice', text: 'No active invites.' }));
  }
  state.invites.forEach((invite) => box.append(el('div', { class: 'data-row' }, [
    el('span', { text: invite.code_preview + ' · ' + invite.uses + '/' + invite.max_uses + ' used' }),
    el('button', { class: 'ghost', type: 'button', text: 'Revoke', onclick: () => revokeInvite(invite.id) })
  ])));
  return box;
}

function renderAdminPublicChannels() {
  const publicChannels = state.channels
    .concat(state.publicChannels)
    .filter((channel) => channel.type === 'O')
    .filter((channel, index, list) => list.findIndex((item) => item.id === channel.id) === index)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const section = el('div', { class: 'section' }, [
    el('div', { class: 'data-row' }, [
      el('span', { class: 'admin-user-name', text: 'Public channels' }),
      iconButton('plus', 'Create public channel', { onclick: () => {
        state.panel = 'new-channel';
        state.sidePanelOpen = true;
        state.newChannelType = 'O';
        state.createChannelError = '';
        renderApp();
      } })
    ])
  ]);
  if (publicChannels.length === 0) {
    section.append(el('div', { class: 'notice', text: 'No public channels yet.' }));
    return section;
  }
  for (const channel of publicChannels) {
    section.append(el('div', { class: 'data-row' }, [
      el('span', { text: channelLabel(channel) }),
      el('span', { class: 'row-actions' }, [
        iconButton('edit', 'Edit public channel ' + channel.display_name, { class: 'ghost', onclick: () => openChannelModal('edit', channel) }),
        iconButton('trash', 'Delete public channel ' + channel.display_name, { class: 'ghost', onclick: () => deletePublicChannel(channel) })
      ])
    ]));
  }
  return section;
}

function renderResetPasswordForm(user) {
  const draft = state.resetPasswordDrafts[user.id] || '';
  const form = el('form', { class: 'inline-edit reset-password-form' }, [
    el('label', { text: 'New password for @' + user.username }, [
      el('input', {
        name: 'new_password',
        type: 'password',
        minlength: '10',
        autocomplete: 'new-password',
        value: draft,
        required: true,
        oninput: (event) => {
          state.resetPasswordDrafts[user.id] = event.target.value;
        }
      })
    ]),
    el('div', { class: 'button-row' }, [
      el('button', { type: 'submit', text: 'Save password' }),
      el('button', { class: 'ghost', type: 'button', text: 'Cancel', onclick: () => { state.resetUserId = ''; delete state.resetPasswordDrafts[user.id]; renderApp(); } })
    ])
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = String(new FormData(form).get('new_password') || state.resetPasswordDrafts[user.id] || '');
    await adminResetPassword(user, password);
  });
  return form;
}

async function adminUserAction(user, action) {
  clearPanelFeedback('admin');
  try {
    if (action === 'revoke') {
      await api('/admin/users/' + user.id + '/revoke-sessions', { method: 'POST' });
      setPanelFeedback('admin', 'success', 'Sessions revoked for @' + user.username + '.');
    } else if (action === 'reactivate') {
      await api('/admin/users/' + user.id + '/reactivate', { method: 'POST' });
      setPanelFeedback('admin', 'success', '@' + user.username + ' reactivated.');
      await loadData();
    } else {
      await api('/admin/users/' + user.id + '/deactivate', { method: 'POST' });
      setPanelFeedback('admin', 'success', '@' + user.username + ' deactivated.');
      await loadData();
    }
    state.panel = 'admin';
    renderApp();
  } catch (error) {
    setPanelFeedback('admin', 'error', error.message || String(error));
    renderApp();
  }
}

async function adminResetPassword(user, password) {
  clearPanelFeedback('admin');
  try {
    await api('/admin/users/' + user.id + '/reset-password', { method: 'POST', body: { new_password: password } });
    state.resetUserId = '';
    delete state.resetPasswordDrafts[user.id];
    setPanelFeedback('admin', 'success', 'Password reset for @' + user.username + '.');
    await loadAdminData();
    renderApp();
  } catch (error) {
    setPanelFeedback('admin', 'error', error.message || String(error));
    renderApp();
  }
}

async function revokeInvite(inviteId) {
  clearPanelFeedback('admin');
  try {
    await api('/admin/invites/' + inviteId, { method: 'DELETE' });
    setPanelFeedback('admin', 'success', 'Invite revoked.');
    await loadAdminData();
    renderApp();
  } catch (error) {
    setPanelFeedback('admin', 'error', error.message || String(error));
    renderApp();
  }
}

async function cleanupTestArtifacts(dryRun) {
  clearPanelFeedback('admin');
  try {
    const result = await api('/admin/test-artifacts/cleanup', {
      method: 'POST',
      body: {
        dry_run: dryRun,
        username_prefix: 'testotron-',
        channel_name_prefix: 'Test',
        older_than_hours: 0,
        confirm: dryRun ? '' : 'cleanup test artifacts'
      }
    });
    state.cleanupResult = result;
    setPanelFeedback('admin', dryRun ? 'success' : 'success', dryRun ? 'Cleanup preview ready.' : 'Test artifacts cleaned.');
    await loadAdminData();
    renderApp();
  } catch (error) {
    setPanelFeedback('admin', 'error', error.message || String(error));
    renderApp();
  }
}

function renderSystemConsole() {
  const form = el('form', { class: 'section' }, [
    el('h3', { text: 'System console' }),
    renderPanelFeedback('system'),
    checkbox('EnableTelemetry', 'Telemetry sharing'),
    checkbox('EnableDiagnostics', 'Diagnostics'),
    checkbox('EnableSecurityAlerts', 'Security alert checks'),
    checkbox('ShowEmailAddress', 'Show email to non-admins'),
    checkbox('ShowFullName', 'Show full names'),
    checkbox('EnableFileAttachments', 'File upload'),
    checkbox('EnablePublicFileLinks', 'Public file links'),
    checkbox('EnableCustomEmoji', 'Custom emoji'),
    checkbox('EnableBotAccountCreation', 'Bot account creation'),
    el('button', { text: 'Save settings' })
  ].filter(Boolean));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearPanelFeedback('system');
    const submit = form.querySelector('button');
    if (submit) submit.disabled = true;
    const data = new FormData(form);
    const patch = {};
    for (const key of ['EnableTelemetry','EnableDiagnostics','EnableSecurityAlerts','ShowEmailAddress','ShowFullName','EnableFileAttachments','EnablePublicFileLinks','EnableCustomEmoji','EnableBotAccountCreation']) {
      patch[key] = data.get(key) === 'on';
    }
    try {
      await api('/api/v4/config/patch', { method: 'PUT', body: { PrivacySettings: patch } });
      await loadClientConfig();
      setPanelFeedback('system', 'success', 'Settings saved.');
      renderApp();
    } catch (error) {
      setPanelFeedback('system', 'error', error.message || String(error));
      renderApp();
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  return el('div', { class: 'section' }, [form, renderCustomEmojiManager()]);
}

function renderCustomEmojiManager() {
  const form = el('form', { class: 'custom-emoji-form' }, [
    el('h3', { text: 'Custom emoji' }),
    el('div', { class: 'two-column-fields' }, [
      el('label', { text: 'Name' }, [el('input', { name: 'name', placeholder: 'ship_it', autocomplete: 'off' })]),
      el('label', { text: 'Emoji' }, [el('input', { name: 'emoji', placeholder: '🚢', autocomplete: 'off' })])
    ]),
    el('button', { text: 'Add emoji' })
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearPanelFeedback('system');
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await api('/admin/custom-emoji', { method: 'POST', body: { name: data.name, emoji: data.emoji } });
      await loadPosts();
      setPanelFeedback('system', 'success', 'Custom emoji added.');
      state.panel = 'system';
      renderApp();
    } catch (error) {
      setPanelFeedback('system', 'error', error.message || String(error));
      renderApp();
    }
  });
  const box = el('div', { class: 'section custom-emoji-manager' }, [
    form,
    state.customEmoji.length ? el('div', { class: 'custom-emoji-list' }, state.customEmoji.map((emoji) => el('div', { class: 'data-row' }, [
      el('span', { text: emoji.emoji + ' :' + emoji.name + ':' }),
      el('button', { class: 'ghost', type: 'button', text: 'Remove', onclick: () => removeCustomEmoji(emoji.id) })
    ]))) : el('div', { class: 'notice', text: 'No custom emoji yet.' })
  ]);
  return box;
}

async function removeCustomEmoji(emojiId) {
  clearPanelFeedback('system');
  try {
    await api('/admin/custom-emoji/' + emojiId, { method: 'DELETE' });
    await loadPosts();
    setPanelFeedback('system', 'success', 'Custom emoji removed.');
    state.panel = 'system';
    renderApp();
  } catch (error) {
    setPanelFeedback('system', 'error', error.message || String(error));
    renderApp();
  }
}

function renderSupervision() {
  const box = el('div', { class: 'section' }, [
    el('h3', { text: 'Supervision dashboard' }),
    renderPanelFeedback('supervision'),
    el('div', { class: 'button-row' }, [
      el('button', { text: 'Audit only', onclick: () => setSupervisionPolicy('audit_only') }),
      el('button', { class: 'secondary', text: 'Pre-moderation', onclick: () => setSupervisionPolicy('pre_moderation') })
    ])
  ].filter(Boolean));
  api('/admin/supervision/events').then((events) => {
    events.forEach((event) => box.append(el('div', { class: 'data-row' }, [el('span', { text: event.action }), el('span', { text: event.state })])));
  }).catch(() => {});
  return box;
}

async function setSupervisionPolicy(mode) {
  clearPanelFeedback('supervision');
  try {
    const body = mode === 'pre_moderation' ? { mode, blockedTerms: ['hold'] } : { mode };
    await api('/admin/supervision/policy', { method: 'PUT', body });
    setPanelFeedback('supervision', 'success', mode === 'pre_moderation' ? 'Pre-moderation enabled.' : 'Audit-only mode enabled.');
    renderApp();
  } catch (error) {
    setPanelFeedback('supervision', 'error', error.message || String(error));
    renderApp();
  }
}

function renderAgents() {
  const current = state.agents[0] || {};
  const form = el('form', { class: 'section' }, [
    el('h3', { text: 'Agent registry' }),
    renderPanelFeedback('agents'),
    state.agents.length ? el('div', { class: 'agent-list' }, state.agents.map((agent) => el('div', { class: 'data-row' }, [
      el('span', { text: agent.name + ' · @' + agent.username }),
      el('span', { text: agent.verified ? 'verified' : 'draft' })
    ]))) : el('div', { class: 'notice', text: 'No agents registered yet.' }),
    el('label', { text: 'Agent name' }, [el('input', { name: 'name', value: current.name || 'Hermes Agent' })]),
    el('label', { text: 'Username' }, [el('input', { name: 'username', value: current.username || 'hermes' })]),
    checkboxInput('verified', 'Verified agent', current.verified === true),
    checkboxInput('can_post', 'Can post messages', current.permissions?.post !== false),
    checkboxInput('can_files', 'Can attach files', current.permissions?.files !== false),
    checkboxInput('can_webhooks', 'Can use webhooks', current.permissions?.webhooks !== false),
    el('label', { text: 'Allowed users' }, [
      el('input', { name: 'allowed_users', placeholder: 'user IDs or usernames, comma separated', value: Array.isArray(current.userAllowlists?.users) ? current.userAllowlists.users.join(', ') : '' })
    ]),
    el('label', { text: 'No-memory channels' }, [
      el('input', { name: 'no_memory_channels', placeholder: 'channel IDs, comma separated', value: Array.isArray(current.memoryPolicy?.no_memory_channels) ? current.memoryPolicy.no_memory_channels.join(', ') : '' })
    ]),
    el('div', { class: 'button-row' }, [
      el('button', { text: 'Save agent' }),
      el('button', { class: 'secondary', type: 'button', text: 'Simulate policy', onclick: simulateAgentPolicy })
    ])
  ].filter(Boolean));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearPanelFeedback('agents');
    try {
      const data = Object.fromEntries(new FormData(form).entries());
      const allowedUsers = String(data.allowed_users || '').split(',').map((item) => item.trim()).filter(Boolean);
      const noMemoryChannels = String(data.no_memory_channels || '').split(',').map((item) => item.trim()).filter(Boolean);
      await api('/api/v4/agents', {
        method: 'POST',
        body: {
          id: current.id,
          name: data.name,
          username: data.username,
          verified: data.verified === 'on',
          permissions: {
            post: data.can_post === 'on',
            files: data.can_files === 'on',
            webhooks: data.can_webhooks === 'on'
          },
          userAllowlists: { users: allowedUsers },
          memoryPolicy: { no_memory_channels: noMemoryChannels, ephemeral_channels: [] },
          channelRouting: { default_channel_id: state.activeChannelId }
        }
      });
      setPanelFeedback('agents', 'success', 'Agent saved.');
      await loadAdminData();
      renderApp();
    } catch (error) {
      setPanelFeedback('agents', 'error', error.message || String(error));
      renderApp();
    }
  });
  return form;
}

function renderHermesHealth() {
  const health = state.hermesHealth || {};
  const box = el('div', { class: 'section' }, [
    el('h3', { text: 'Hermes health' }),
    renderPanelFeedback('hermes'),
    state.rotatedBotToken ? el('div', { class: 'notice success rotated-token' }, [
      el('strong', { text: 'New bot token' }),
      el('textarea', { readonly: true, value: state.rotatedBotToken }),
      el('button', { type: 'button', text: 'Copy token', onclick: () => copyRotatedToken() })
    ]) : null,
    el('div', { class: 'health-grid' }, [
      metricTile('Bot token', health.token_configured ? 'Configured' : 'Missing'),
      metricTile('Bot accounts', String(health.bot_count || 0)),
      metricTile('WSS clients', String(health.websocket_connections || 0)),
      metricTile('Last bot post', health.last_bot_post_at ? new Date(health.last_bot_post_at).toLocaleString() : 'None')
    ])
  ].filter(Boolean));
  box.append(el('div', { class: 'channel-group', text: 'Bot accounts' }));
  const bots = state.bots || [];
  if (bots.length === 0) {
    box.append(el('div', { class: 'notice', text: 'No Hermes bot token is configured.' }));
  }
  bots.forEach((bot) => box.append(el('div', { class: 'data-row' }, [
    el('span', { text: bot.display_name + ' · ' + bot.user_id.slice(0, 8) }),
    el('button', { class: 'warning', type: 'button', text: 'Rotate token', onclick: () => rotateBotToken(bot.user_id) })
  ])));
  box.append(el('div', { class: 'channel-group', text: 'Recent agent events' }));
  const events = health.recent_agent_events || [];
  if (events.length === 0) {
    box.append(el('div', { class: 'notice', text: 'No recent agent events.' }));
  }
  events.forEach((event) => box.append(el('div', { class: 'data-row' }, [
    el('span', { text: event.action + ' · ' + event.state }),
    el('span', { text: new Date(event.create_at).toLocaleString() })
  ])));
  box.append(el('button', { class: 'ghost', type: 'button', text: 'Refresh health', onclick: refreshHermesHealth }));
  return box;
}

function metricTile(label, value) {
  return el('div', { class: 'metric-tile' }, [
    el('span', { text: label }),
    el('strong', { text: value })
  ]);
}

async function refreshHermesHealth() {
  clearPanelFeedback('hermes');
  try {
    await loadAdminData();
    setPanelFeedback('hermes', 'success', 'Health refreshed.');
    renderApp();
  } catch (error) {
    setPanelFeedback('hermes', 'error', error.message || String(error));
    renderApp();
  }
}

async function rotateBotToken(userId) {
  clearPanelFeedback('hermes');
  try {
    const result = await api('/admin/bots/' + userId + '/regenerate-token', { method: 'POST' });
    state.rotatedBotToken = result.token;
    await loadAdminData();
    setPanelFeedback('hermes', 'success', 'Bot token rotated. Update Hermes with the new token now; it will not be shown again.');
    state.panel = 'hermes';
    renderApp();
  } catch (error) {
    setPanelFeedback('hermes', 'error', error.message || String(error));
    renderApp();
  }
}

async function copyRotatedToken() {
  try {
    await navigator.clipboard.writeText(state.rotatedBotToken);
    setPanelFeedback('hermes', 'success', 'Token copied.');
  } catch {
    setPanelFeedback('hermes', 'error', 'Copy failed. Select the token and copy it manually.');
  }
  renderApp();
}

async function simulateAgentPolicy() {
  clearPanelFeedback('agents');
  try {
    const result = await api('/api/v4/admin/policy-simulator', { method: 'POST', body: { channel_id: state.activeChannelId } });
    setPanelFeedback('agents', result.allowed ? 'success' : 'error', result.allowed ? 'Simulation allowed.' : 'Simulation blocked.');
    renderApp();
  } catch (error) {
    setPanelFeedback('agents', 'error', error.message || String(error));
    renderApp();
  }
}

function privacyValue(name) {
  const privacy = state.clientConfig?.PrivacySettings || {};
  return privacy[name] === true;
}

function checkbox(name, text) {
  return el('label', { class: 'check-row' }, [el('span', { text }), el('input', { type: 'checkbox', name, checked: privacyValue(name) })]);
}

async function createInvite() {
  clearPanelFeedback('admin');
  try {
    const result = await api('/admin/invites', { method: 'POST', body: { max_uses: 1, expires_in_hours: 48 } });
    state.lastInviteCode = result.code;
    setPanelFeedback('admin', 'success', 'Invite created.');
    await loadAdminData();
    renderApp();
  } catch (error) {
    setPanelFeedback('admin', 'error', error.message || String(error));
    renderApp();
  }
}

function channelSlug(displayName) {
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || 'channel-' + Date.now();
}

async function createChannelFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  const data = new FormData(form);
  const displayName = String(data.get('display_name') || '').trim();
  if (!displayName) {
    state.createChannelError = 'Channel name is required.';
    renderApp();
    return;
  }
  try {
    const channel = await api('/api/v4/channels', {
      method: 'POST',
      body: {
        team_id: state.activeTeamId,
        name: channelSlug(displayName),
        display_name: displayName,
        type: String(data.get('type') || 'O')
      }
    });
    state.activeChannelId = channel.id;
    state.activeThreadId = '';
    state.threadError = '';
    state.composerError = '';
    state.createChannelError = '';
    state.newChannelName = '';
    state.newChannelType = 'O';
    state.memberError = '';
    state.panel = 'members';
    state.sidePanelOpen = true;
    await loadData();
    renderApp();
  } catch (error) {
    state.createChannelError = error.message || String(error);
    renderApp();
  }
}

async function deletePublicChannel(channel) {
  if (!isSystemAdmin() || channel.type !== 'O') return;
  const label = channelLabel(channel);
  if (!window.confirm('Delete ' + label + '?')) return;
  try {
    await api('/api/v4/channels/' + channel.id, { method: 'DELETE' });
    if (state.activeChannelId === channel.id) {
      state.activeChannelId = '';
      state.posts = [];
      state.galleryOpen = false;
      state.composerError = '';
    }
    await loadData();
    renderApp();
  } catch (error) {
    state.joinChannelError = 'Could not delete channel: ' + (error.message || String(error));
    renderApp();
  }
}

async function addChannelMember(userId) {
  try {
    await api('/api/v4/channels/' + state.activeChannelId + '/members', { method: 'POST', body: { user_id: userId } });
    state.memberError = '';
    await loadData();
    state.panel = 'members';
    renderApp();
  } catch (error) {
    state.memberError = error.message || String(error);
    renderApp();
  }
}

async function startDirectMessage(userId) {
  try {
    state.directMessageError = '';
    const channel = await api('/api/v4/channels/direct', { method: 'POST', body: [userId] });
    state.activeChannelId = channel.id;
    state.activeThreadId = '';
    state.threadError = '';
    state.composerError = '';
    state.memberError = '';
    state.joinChannelError = '';
    state.emojiPickerOpen = false;
    state.galleryOpen = false;
    state.sidePanelOpen = false;
    await loadData();
    renderApp();
  } catch (error) {
    state.directMessageError = error.message || String(error);
    state.panel = 'direct';
    state.sidePanelOpen = true;
    renderApp();
  }
}

async function selectChannel(channelId) {
  state.activeChannelId = channelId;
  const wasViewingThread = state.panel === 'thread';
  state.activeThreadId = '';
  state.threadError = '';
  state.editingPostId = '';
  state.editDraft = '';
  state.editError = '';
  state.composerError = '';
  state.memberError = '';
  state.joinChannelError = '';
  state.emojiPickerOpen = false;
  state.galleryOpen = false;
  if (wasViewingThread) state.panel = 'members';
  state.sidePanelOpen = false;
  await loadPosts();
  await loadChannelMembers();
  await loadChannelPolicy();
  renderApp();
  scrollPostListToBottom();
}

async function joinPublicChannel(channelId) {
  try {
    await api('/api/v4/channels/' + channelId + '/members', { method: 'POST', body: { user_id: state.me.id } });
    state.activeChannelId = channelId;
    state.activeThreadId = '';
    state.threadError = '';
    state.sidePanelOpen = false;
    state.joinChannelError = '';
    state.emojiPickerOpen = false;
    state.galleryOpen = false;
    await loadData();
    renderApp();
    scrollPostListToBottom();
  } catch (error) {
    state.joinChannelError = error.message || String(error);
    renderApp();
  }
}

async function searchMessages(event) {
  event.preventDefault();
  const terms = state.searchTerm.trim();
  if (!terms) {
    state.searchResults = [];
    state.searchStatus = 'Enter a term to search messages.';
    renderApp();
    return;
  }
  state.searchStatus = 'Searching...';
  renderApp();
  try {
    const result = await api('/api/v4/teams/' + state.activeTeamId + '/posts/search', { method: 'POST', body: { terms } });
    state.searchResults = result.order.map((id) => result.posts[id]).filter(Boolean).reverse();
    state.searchStatus = state.searchResults.length ? state.searchResults.length + ' result' + (state.searchResults.length === 1 ? '' : 's') : 'No messages found.';
    state.searchOpen = true;
    renderApp();
  } catch (error) {
    state.searchStatus = 'Search failed: ' + (error.message || String(error));
    state.searchResults = [];
    state.searchOpen = true;
    renderApp();
  }
}

function clearMessageSearch() {
  state.searchTerm = '';
  state.searchResults = [];
  state.searchStatus = '';
  renderApp();
}

async function jumpToSearchResult(post) {
  if (post.channel_id !== state.activeChannelId) {
    await selectChannel(post.channel_id);
  }
  state.searchOpen = true;
  requestAnimationFrame(() => {
    const rows = Array.from(document.querySelectorAll('[data-post-id]'));
    const target = rows.find((node) => node.getAttribute('data-post-id') === post.id);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('post-highlight');
      setTimeout(() => target.classList.remove('post-highlight'), 1600);
    }
  });
}

async function addReaction(postId, emoji) {
  try {
    await api('/api/v4/reactions', { method: 'POST', body: { post_id: postId, emoji_name: emoji } });
    state.composerError = '';
    await loadPosts();
    renderApp();
  } catch (error) {
    state.composerError = 'Could not add reaction: ' + (error.message || String(error));
    renderApp();
  }
}

async function removeReaction(postId, emoji) {
  try {
    await api('/api/v4/users/' + state.me.id + '/posts/' + postId + '/reactions/' + emoji, { method: 'DELETE' });
    state.composerError = '';
    await loadPosts();
    renderApp();
  } catch (error) {
    state.composerError = 'Could not remove reaction: ' + (error.message || String(error));
    renderApp();
  }
}

async function togglePin(post) {
  try {
    await api('/api/v4/posts/' + post.id + (post.is_pinned ? '/unpin' : '/pin'), { method: 'POST' });
    state.composerError = '';
    await loadPosts();
    renderApp();
  } catch (error) {
    state.composerError = 'Could not update pin: ' + (error.message || String(error));
    renderApp();
  }
}

function editPost(post) {
  state.editingPostId = post.id;
  state.editDraft = post.message;
  state.editError = '';
  renderApp();
}

function cancelPostEdit() {
  state.editingPostId = '';
  state.editDraft = '';
  state.editError = '';
  renderApp();
}

function openThread(postId) {
  state.activeThreadId = postId;
  state.threadError = '';
  state.panel = 'thread';
  state.sidePanelOpen = true;
  renderApp();
}

function closeThread() {
  state.activeThreadId = '';
  state.threadError = '';
  state.panel = 'members';
  state.sidePanelOpen = false;
  renderApp();
}

async function deletePost(postId) {
  try {
    await api('/api/v4/posts/' + postId, { method: 'DELETE' });
    state.composerError = '';
    await loadPosts();
    renderApp();
  } catch (error) {
    state.composerError = 'Could not delete message: ' + (error.message || String(error));
    renderApp();
  }
}

async function resetProfileImage() {
  clearPanelFeedback('profile');
  try {
    await api('/api/v4/users/' + state.me.id + '/image', { method: 'DELETE' });
    state.me = await api('/api/v4/users/me');
    await loadData();
    state.panel = 'profile';
    setPanelFeedback('profile', 'success', 'Profile photo reset.');
    renderApp();
  } catch (error) {
    setPanelFeedback('profile', 'error', error.message || String(error));
    renderApp();
  }
}

async function logout() {
  state.socketManualClose = true;
  if (socketReconnectTimer) {
    clearTimeout(socketReconnectTimer);
    socketReconnectTimer = null;
  }
  if (state.socket) {
    try { state.socket.close(); } catch {}
    state.socket = null;
  }
  state.me = null;
  try {
    await api('/api/v4/users/logout', { method: 'POST' });
  } catch {}
  history.replaceState(null, '', '/login');
  renderAuth('login');
}

function route() {
  if (location.pathname.startsWith('/signup')) renderAuth('signup');
  else if (location.pathname.startsWith('/login')) renderAuth('login');
  else bootApp();
}

window.addEventListener('popstate', route);
route();
`;

export function renderShell(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ChatterMost</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/styles.css">
  </head>
  <body>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>`;
}
