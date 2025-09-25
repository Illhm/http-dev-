# ReqRes DevTools Lite v3 — Input/Output & Interaction Analysis

## A. Inputs Matrix

### A1. User-Facing Controls

| Source (selector) | Type & Default | Handler & State Change | Side Effects | Visible Impact |
| --- | --- | --- | --- | --- |
| `input.mode[value=...]` | Toolbar checkboxes, all checked by default. | `change` events call `render()`. | Filter set recomputed; selection recalculated via re-render. | Rows not matching enabled modes disappear. |
| `#hideDataUrl` | Checkbox, unchecked. | `change` → `render()`. | `matchesFilters` skips `data:` URLs. | Data URLs hidden from grid and export. |
| `#filterText` | Text input, empty. | `input` → `render()`. | None. | Grid rows filter live; hidden rows deselected. |
| `#btnSelectMode` | Button, starts OFF. | Toggles `selectMode`, clears selection when disabling. | Updates select UI state. | Checkbox column toggles; footer counts update. |
| `#btnSelectAll` | Button (disabled when select mode off). | Adds all filtered IDs to `selectedIds`. | None. | All visible rows become selected. |
| `#btnClearSelection` | Button. | Clears `selectedIds`. | None. | All checkboxes cleared. |
| `#btnExportSelectedZIP` | Button. | Collects selected records, builds ZIP, triggers download. | Uses `buildZip` + `URL.createObjectURL`. | File download prompt. |
| `#btnClear` | Button. | Clears `rows` locally then sends `{cmd:'clear'}`. | Background empties `requests`, broadcasts `cleared`. | Grid empties. |
| `.detail-tabs button` | Tab buttons, “Header” default. | `click` toggles active tab classes. | None. | Right pane content switches. |
| `#btnCopyResBody` | Button. | Copies `responseBodyRaw` via Clipboard API. | None. | No change (clipboard updated). |
| `#btnSaveResBody` | Button. | Builds Blob from body, triggers download. | Handles base64 conversion. | File download prompt. |
| `tbody#gridBody tr` | Dynamic rows. | `click` toggles selection when select mode, otherwise calls `showDetail`. | Selection set updated or detail panel shown. | Row highlight/detail pane updates. |
| `.selcol input` | Row checkbox. | `click` toggles membership in `selectedIds`. | None. | Checkbox state toggles; count updates. |
| `#divider` | Draggable divider. | `mousedown` attaches move listener updating CSS `--left`; `dblclick` resets to 42%. | None. | Pane sizes change. |
| `#masterSel` | Header checkbox (hidden). | Only reset to unchecked in `updateSelUi`; no listener yet. | None. | Currently no effect. |
| `auto.html` popup script | No user input. | `auto.js` queries active tab, sends `start` + `openDash`. | Background attaches debugger and opens dashboard. | Dashboard tab appears. |

### A2. Programmatic Inputs

| Source → Input | Handler | State Change | Side Effects | UI Impact |
| --- | --- | --- | --- | --- |
| Dashboard `getAll` request | Background message handler returns snapshot `{attached, tabId, entries}`. | Dashboard sets `rows`, status text. | None. | Grid renders persisted entries. |
| Popup `start {tabId}` | `startCapture` in `bg.js`. | Sets `state.attached=true`, `tabId`, applies cache/throttle. | Attaches debugger, enables Network/Page/Runtime, broadcasts `started`. | Status footer shows attached state. |
| Popup `openDash` | `openOrFocusDashboard`. | None. | Focuses/creates dashboard tab. | Dashboard visible. |
| Toolbar `clear` command | Background clears `state.requests`, keeps `nextSeq`. | Map emptied. | Broadcast `cleared`. | Dashboard resets rows. |
| Background commands `stop`, `setThrottle`, `setCacheDisabled` | `stop` detaches debugger; throttle/cache update state. | `attached/tabId` reset on stop; throttle/cache stored. | Sends debugger commands; broadcast `stopped`. | Status shows “Idle”; throttle/cache UI (when added) reflect state. |
| Chrome Debugger `Network.*` | `onEvent` in `bg.js`. | Mutates request record fields in `state.requests`. | On completion/failure broadcasts `entry`. | Dashboard appends row, re-render. |
| Runtime port `__RRSTREAM` | Dashboard listener. | Updates `rows`, status on `started/stopped/cleared`. | None. | Live grid/status updates. |

### A3. Configuration Inputs

| Config | Default | Application | Effect |
| --- | --- | --- | --- |
| `state.throttle` | `'none'` in background. | `applyThrottle()` issues `Network.emulateNetworkConditions`. | Simulates network profile. |
| `state.cacheDisabled` | `false`. | `Network.setCacheDisabled` when attached. | Forces cache bypass. |
| Mode filters / hide data URL / text filter | Default UI states. | `matchesFilters` inside `render()`. | Determines visible/selectable rows. |
| Selection state | `selectMode=false`, empty `selectedIds`. | Toggled via toolbar/row events. | Governs export payload. |

### A4. Request Record Population

| Field | Source Event | Notes |
| --- | --- | --- |
| `id`, `seq` | `ensure()` on first touch (requestWillBeSent). | `seq` increments `state.nextSeq`. |
| `url`, `method`, `requestHeaders`, `requestBodyText`, `_t0`, `startedDateTime`, `resourceType` | `Network.requestWillBeSent`. | `_t0` used for duration. |
| `mimeType`, `status`, `statusText`, `responseHeaders`, `timing`, `resourceType` fallback | `Network.responseReceived`. | Resource type filled if absent. |
| `responseHeaders` extras | Merge from extra info. | Preserves multiple headers. |
| `time`, `encodedDataLength`, `responseBodyRaw`, `responseBodyEncoding`, `bodySize` | `Network.loadingFinished` + `Network.getResponseBody`. | On error, body empty with `'utf-8'`. |
| `errorText`, `canceled`, `time` | `Network.loadingFailed`. | Broadcast even without body. |

## B. Data Flow & Timeline

1. **Auto Start / Action Click** → popup sends `start` + `openDash` → dashboard tab opens.
2. **Debugger Attachment** → `startCapture` attaches, enables Network/Page/Runtime, applies cache/throttle, broadcasts `started`.
3. **Network Events** → `Network.*` populate request records; `loadingFinished/loadingFailed` trigger broadcasts of completed entries.
4. **Dashboard Sync** → `getAll` snapshot on load + live `entry` messages update `rows`; `render()` rebuilds grid respecting filters/selection. Status bar reflects `started/stopped`.
5. **User Interaction** → Filters/select mode adjust `selectedIds`; clicking rows shows detail or selection. Divider adjusts layout.
6. **Export/Clear** → Export builds sorted list by `seq` and downloads ZIP; Clear wipes local and background state.

### Attached State Machine

| State | Transition | Action |
| --- | --- | --- |
| Idle (`attached=false`) | `startCapture(tabId)` success | Attach debugger, set `attached=true`, remember `tabId`, broadcast `started`. |
| Attached (`attached=true`) | `startCapture` same tab | No-op. |
|  | `startCapture` different tab | `stopCapture()` previous → attach new tab. |
|  | `stopCapture()` | Detach, reset `attached/tabId`, broadcast `stopped`. |
|  | External detach | Currently unhandled → state may be stale. |
| Error | Attach failure | Logs error, stay idle. |

### Anti-Refresh Behavior & Edge Cases

- Requests stored in `state.requests` persist until `clear` or service worker restart, so navigation doesn’t reset log.
- Events filtered by `state.tabId` prevent cross-tab bleed.
- Debugger conflicts (e.g., DevTools open) cause `attach` failure; UI only sees Idle state.
- `Network.getResponseBody` failures result in empty body with no user notification.
- Long sessions grow `state.requests` and dashboard `rows` unbounded.

## C. Outputs & Export

- **Grid Rendering**: `render()` builds table rows with columns (Name, Method, Status, MIME, Category, Size, Time). Selection checkboxes reflect `selectedIds`.
- **Details Pane**: `showDetail` populates tabs: Headers, Payload, Preview (pretty JSON), Response (raw) with Copy/Save buttons.
- **Runtime Stream**: `entry`, `started`, `stopped`, `cleared` messages adjust UI state.
- **ZIP Export**:
  - Collects selected records, sorted by `seq`.
  - Recommended layout:
    ```
    README.md
    summary/index.csv
    summary/index.md
    requests/<seq>-<method>-<slug>/
      00-meta.txt
      01-request-headers.txt
      02-request-body.<ext>
      03-response-headers.txt
      04-response-body.<ext>
      05-response-info.json
    ```
  - Binary bodies stored as base64 or raw bytes with metadata note; text saved UTF-8.
  - Selection tracked via `selectedIds` set; `btnSelectAll` uses filtered rows list before export.

## D. Permissions & Manifest Checklist

- `debugger`: attach to tab debugger for Network events.
- `tabs`: query active tab, open/focus dashboard.
- `downloads`: initiate ZIP/body downloads.
- `storage`: (future) persist settings.
- `host_permissions: <all_urls>`: debugger access across hosts.
- MV3 worker limits: service worker sleeps when idle; debugger events keep it alive. Consider alarms if longer keepalive needed.
- Minimal manifest snippet in Appendix.

## E. UX, Performance, Safety Review

- **UX**: Selection mode hidden; add hints/tooltips. Empty state lacks guidance. Toolbar dense on narrow widths; consider responsive layout. Keyboard shortcuts could speed filtering.
- **Performance**: Unbounded `requests` Map and full re-render each update → memory/CPU risk; consider pruning or virtualization. Export of large binaries may exhaust memory; add size guards.
- **Safety**: Handle debugger conflicts gracefully; add user warning. Implement `chrome.debugger.onDetach` to reset state. Remind users about sensitive data. Provide feedback when body fetch fails.

## F. Improvements (Prioritized)

1. **Persist Dashboard Settings** (`modes`, `hideDataUrl`, `filterText`, `selectMode`, throttle/cache).
   ```diff
   +const SETTINGS_KEY = 'rrdashSettings_v1';
   +async function loadSettings(){
   +  const stored = await chrome.storage.local.get(SETTINGS_KEY);
   +  const cfg = stored[SETTINGS_KEY] || {};
   +  modeCbs.forEach(cb => cb.checked = cfg.modes ? cfg.modes.includes(cb.value) : cb.defaultChecked);
   +  hideDataUrl.checked = cfg.hideDataUrl ?? hideDataUrl.defaultChecked;
   +  filterText.value = cfg.filterText || '';
   +  if (cfg.selectMode) toggleSelectMode();
   +}
   +function persistSettings(){
   +  const payload = {
   +    modes: modeCbs.filter(cb => cb.checked).map(cb => cb.value),
   +    hideDataUrl: hideDataUrl.checked,
   +    filterText: filterText.value,
   +    selectMode,
   +  };
   +  chrome.storage.local.set({ [SETTINGS_KEY]: payload }).catch(()=>{});
   +}
   -filterText.addEventListener('input', render);
   +filterText.addEventListener('input', () => { render(); persistSettings(); });
   ```
   - Apply similar persistence for throttle/cache toggles in background.

2. **Robust Auto-Start** (action click fallback, start without tabId).
   ```diff
   +chrome.action.onClicked.addListener(async (tab) => {
   +  const target = tab?.id ?? (await chrome.tabs.query({active:true,currentWindow:true}))[0]?.id;
   +  if (!target) return;
   +  const ok = await startCapture(target);
   +  if (ok) await openOrFocusDashboard();
   +});
   +else if (cmd === 'start') {
   +  const target = payload?.tabId ?? (await chrome.tabs.query({active:true,currentWindow:true}))[0]?.id;
   +  startCapture(target).then(ok => sendResponse(ok));
   +  return true;
   +}
   ```

3. **Selection Mode Enhancements** (range-select, master checkbox, select filtered).
   ```diff
   +let lastSelectedId = null;
   +function visibleRowIds(){
   +  return rows.filter(matchesFilters).map(r => r.id);
   +}
   +function toggleRowSelection(id, range){
   +  if (range && lastSelectedId){
   +    const ids = visibleRowIds();
   +    const start = ids.indexOf(lastSelectedId);
   +    const end = ids.indexOf(id);
   +    if (start >= 0 && end >= 0){
   +      ids.slice(Math.min(start,end), Math.max(start,end)+1).forEach(i => selectedIds.add(i));
   +    }
   +  } else {
   +    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
   +  }
   +  lastSelectedId = id;
   +  updateSelUi();
   +  render();
   +}
   -tr.addEventListener('click', () => {
   -  if (selectMode) { ... }
   -});
   +tr.addEventListener('click', (ev) => {
   +  if (selectMode) toggleRowSelection(r.id, ev.shiftKey);
   +  else showDetail(r.id);
   +});
   +masterSel.addEventListener('change', () => {
   +  const ids = visibleRowIds();
   +  if (masterSel.checked) ids.forEach(id => selectedIds.add(id));
   +  else ids.forEach(id => selectedIds.delete(id));
   +  updateSelUi();
   +  render();
   +});
   ```

4. Export ZIP metadata/encoding polish.
5. Error handling for `Network.getResponseBody` with UI hint.
6. Large body inclusion toggle/limit.
7. Toolbar throttle/cache controls.

## G. Test Plan

- Start/stop capture on same tab, then switch tabs ensuring detachment/re-attachment works.
- Navigate within target tab; verify log persists until manual Clear.
- Text filter + Select-All picks only visible rows; range-select works; master checkbox toggles filtered set.
- Export ZIP ordered by `seq`; archive opens on another machine (verify metadata, encoding flags).
- Binary bodies (e.g., images) exported correctly, honoring base64 flags and MIME-derived extensions.
- Throttle/cache toggles (after UI wired) take effect immediately via debugger commands.

## Appendix

### Request Record Interface

```ts
interface ReqResRecord {
  id: string;
  seq: number;
  url?: string;
  method?: string;
  startedDateTime?: string;
  resourceType?: string | null;
  requestHeaders?: { name: string; value: string }[];
  requestBodyText?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  responseHeaders?: { name: string; value: string }[];
  timing?: chrome.devtools.network.RequestTiming | null;
  time?: number;
  encodedDataLength?: number;
  bodySize?: number;
  responseBodyRaw?: string;
  responseBodyEncoding?: 'utf-8' | 'base64';
  errorText?: string;
  canceled?: boolean;
}
```

### Minimal `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "ReqRes DevTools Lite v3",
  "version": "1.5.0",
  "action": { "default_popup": "auto.html" },
  "background": { "service_worker": "bg.js", "type": "module" },
  "permissions": ["debugger", "downloads", "storage", "tabs"],
  "host_permissions": ["<all_urls>"],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```
