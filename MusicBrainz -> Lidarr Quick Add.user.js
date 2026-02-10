// ==UserScript==
// @name         MusicBrainz -> Lidarr Quick Add
// @namespace    https://musicbrainz.org/
// @version      1.0.0
// @description  Add artists from MusicBrainz to Lidarr without copy/paste.
// @match        https://musicbrainz.org/*
// @match        https://lidarr.example.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
Replace the placeholder Lidarr @match line with your actual Lidarr URL before use.
Example:
// @match https://lidarr.my-domain.com/*
*/

(function () {
  "use strict";

  const MB_HOST = "musicbrainz.org";
  const PAYLOAD_PARAM = "mb2l";
  const PAYLOAD_VERSION = 1;
  const PAYLOAD_MAX_AGE_MS = 30 * 60 * 1000;
  const MB_SETTINGS_KEY = "mb2l.mbSettings";
  const LIDARR_SETTINGS_KEY = "mb2l.lidarrSettings";
  const BTN_GROUP_ATTR = "data-mb2l-button-group";
  const BOUND_ATTR = "data-mb2l-bound";
  const MBID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ARTIST_LINK_RE =
    /\/artist\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[/?#]|$)/i;
  const RELEASE_GROUP_LINK_RE =
    /\/release-group\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:[/?#]|$)/i;
  const inFlightMbids = new Set();
  let stylesInjected = false;
  let scanQueued = false;

  function injectStyles() {
    if (stylesInjected) {
      return;
    }
    stylesInjected = true;

    const style = document.createElement("style");
    style.id = "mb2l-styles";
    style.textContent = `
      .mb2l-btn-wrap {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
        margin-left: 0.5rem;
        flex-wrap: wrap;
      }
      .mb2l-btn {
        border: 1px solid #2f5f0f;
        background: #3f7f13;
        color: #fff;
        border-radius: 4px;
        padding: 0.2rem 0.5rem;
        font-size: 0.8rem;
        cursor: pointer;
        line-height: 1.3;
      }
      .mb2l-btn:hover {
        background: #2f5f0f;
      }
      .mb2l-btn-api {
        border-color: #0f4f6f;
        background: #176b95;
      }
      .mb2l-btn-api:hover {
        background: #0f4f6f;
      }
      .mb2l-settings-launcher {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 2147483644;
        border: 1px solid #444;
        background: #1f1f1f;
        color: #fff;
        border-radius: 6px;
        padding: 0.35rem 0.55rem;
        font-size: 12px;
        cursor: pointer;
      }
      .mb2l-settings-launcher:hover {
        background: #111;
      }
      .mb2l-toast-box {
        position: fixed;
        right: 14px;
        top: 14px;
        z-index: 2147483645;
        display: grid;
        gap: 8px;
        max-width: 360px;
      }
      .mb2l-toast {
        border-radius: 6px;
        border: 1px solid #444;
        background: #1e1e1e;
        color: #f6f6f6;
        padding: 0.55rem 0.7rem;
        font-size: 13px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
      }
      .mb2l-toast-info { border-left: 3px solid #3e8dd1; }
      .mb2l-toast-success { border-left: 3px solid #2e9e62; }
      .mb2l-toast-error { border-left: 3px solid #cc4949; }
      .mb2l-modal-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        background: rgba(0, 0, 0, 0.42);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      }
      .mb2l-modal {
        width: min(520px, 94vw);
        background: #fff;
        border-radius: 10px;
        border: 1px solid #c8c8c8;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.24);
        color: #111;
      }
      .mb2l-modal h2 {
        margin: 0;
        padding: 1rem 1rem 0.5rem;
        font-size: 1.08rem;
      }
      .mb2l-modal p {
        margin: 0;
        padding: 0 1rem 0.85rem;
        font-size: 0.92rem;
        color: #444;
      }
      .mb2l-modal-form {
        padding: 0 1rem 1rem;
        display: grid;
        gap: 0.75rem;
      }
      .mb2l-modal-field {
        display: grid;
        gap: 0.3rem;
      }
      .mb2l-modal-field label {
        font-size: 0.86rem;
        font-weight: 600;
      }
      .mb2l-modal-field input,
      .mb2l-modal-field select {
        width: 100%;
        border: 1px solid #bcbcbc;
        border-radius: 6px;
        padding: 0.45rem 0.55rem;
        font-size: 0.9rem;
      }
      .mb2l-modal-field input[type="checkbox"] {
        width: auto;
      }
      .mb2l-modal-status {
        font-size: 0.82rem;
        color: #444;
        min-height: 1.1rem;
      }
      .mb2l-modal-status.error {
        color: #b23030;
      }
      .mb2l-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
        padding: 0.9rem 1rem 1rem;
        border-top: 1px solid #ededed;
      }
      .mb2l-modal-btn {
        border: 1px solid #a1a1a1;
        background: #fff;
        color: #111;
        border-radius: 6px;
        padding: 0.45rem 0.8rem;
        font-size: 0.88rem;
        cursor: pointer;
      }
      .mb2l-modal-btn:hover {
        background: #f2f2f2;
      }
      .mb2l-modal-btn.primary {
        border-color: #22649d;
        background: #2977bc;
        color: #fff;
      }
      .mb2l-modal-btn.primary:hover {
        background: #22649d;
      }
      .mb2l-inline-row {
        display: flex;
        gap: 0.6rem;
        align-items: center;
      }
      .mb2l-inline-row > * {
        flex: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function getToastRoot() {
    let root = document.querySelector(".mb2l-toast-box");
    if (!root) {
      root = document.createElement("div");
      root.className = "mb2l-toast-box";
      document.body.appendChild(root);
    }
    return root;
  }

  function showToast(message, type = "info", ttlMs = 3500) {
    injectStyles();
    const root = getToastRoot();
    const toast = document.createElement("div");
    toast.className = `mb2l-toast mb2l-toast-${type}`;
    toast.textContent = message;
    root.appendChild(toast);
    window.setTimeout(() => toast.remove(), ttlMs);
  }

  function readJsonStorage(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function writeJsonStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function sanitizeBaseUrl(input) {
    const parsed = new URL(input);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  }

  function isValidMbid(value) {
    return typeof value === "string" && MBID_RE.test(value);
  }

  function extractMbidFromHref(href) {
    const match = href.match(ARTIST_LINK_RE);
    if (!match) {
      return null;
    }
    return match[1].toLowerCase();
  }

  function extractReleaseGroupMbidFromHref(href) {
    const match = href.match(RELEASE_GROUP_LINK_RE);
    if (!match) {
      return null;
    }
    return match[1].toLowerCase();
  }

  function extractEntityFromHref(href) {
    const releaseGroupMbid = extractReleaseGroupMbidFromHref(href);
    if (releaseGroupMbid) {
      return { entityType: "release-group", mbid: releaseGroupMbid };
    }
    const artistMbid = extractMbidFromHref(href);
    if (artistMbid) {
      return { entityType: "artist", mbid: artistMbid };
    }
    return null;
  }

  function normalizeArtistName(name) {
    if (!name || typeof name !== "string") {
      return "Unknown Artist";
    }
    const normalized = name.replace(/\s+/g, " ").trim();
    return normalized || "Unknown Artist";
  }

  function toBase64Url(input) {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function fromBase64Url(input) {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    const remainder = padded.length % 4;
    const normalized = remainder ? padded + "=".repeat(4 - remainder) : padded;
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  function encodePayload(payload) {
    return toBase64Url(JSON.stringify(payload));
  }

  function decodePayload(raw) {
    try {
      const decoded = JSON.parse(fromBase64Url(raw));
      if (!decoded || typeof decoded !== "object") {
        return null;
      }
      return decoded;
    } catch (_error) {
      return null;
    }
  }

  function getPayloadParam() {
    const params = new URLSearchParams(window.location.search);
    return params.get(PAYLOAD_PARAM);
  }

  function removePayloadParamFromUrl() {
    const url = new URL(window.location.href);
    let changed = false;
    if (url.searchParams.has(PAYLOAD_PARAM)) {
      url.searchParams.delete(PAYLOAD_PARAM);
      changed = true;
    }
    if (!changed) {
      return;
    }
    const next = `${url.pathname}${url.search}${url.hash}`;
    history.replaceState({}, "", next);
  }

  function isMbSettingsValid(settings) {
    if (!settings || typeof settings !== "object") {
      return false;
    }
    if (!settings.lidarrBaseUrl || typeof settings.lidarrBaseUrl !== "string") {
      return false;
    }
    if (settings.defaultMode !== "ui" && settings.defaultMode !== "api") {
      return false;
    }
    try {
      sanitizeBaseUrl(settings.lidarrBaseUrl);
    } catch (_error) {
      return false;
    }
    return true;
  }

  function isLidarrSettingsValid(settings) {
    if (!settings || typeof settings !== "object") {
      return false;
    }
    if (!settings.rootFolderPath || typeof settings.rootFolderPath !== "string") {
      return false;
    }
    if (!Number.isFinite(Number(settings.qualityProfileId))) {
      return false;
    }
    if (!Number.isFinite(Number(settings.metadataProfileId))) {
      return false;
    }
    return true;
  }

  function withDefaultsMbSettings(settings) {
    return {
      lidarrBaseUrl: sanitizeBaseUrl(settings.lidarrBaseUrl),
      defaultMode: settings.defaultMode === "api" ? "api" : "ui",
      openInNewTab: true,
    };
  }

  function withDefaultsLidarrSettings(settings) {
    return {
      apiKey: settings.apiKey ? String(settings.apiKey).trim() : "",
      rootFolderPath: String(settings.rootFolderPath),
      qualityProfileId: Number(settings.qualityProfileId),
      metadataProfileId: Number(settings.metadataProfileId),
      monitored: true,
      searchForMissingAlbums: true,
    };
  }

  function createModalShell(title, description) {
    injectStyles();
    const overlay = document.createElement("div");
    overlay.className = "mb2l-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "mb2l-modal";

    const heading = document.createElement("h2");
    heading.textContent = title;
    modal.appendChild(heading);

    if (description) {
      const desc = document.createElement("p");
      desc.textContent = description;
      modal.appendChild(desc);
    }

    const form = document.createElement("div");
    form.className = "mb2l-modal-form";
    modal.appendChild(form);

    const actions = document.createElement("div");
    actions.className = "mb2l-modal-actions";
    modal.appendChild(actions);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function destroy() {
      overlay.remove();
    }

    return { overlay, modal, form, actions, destroy };
  }

  function createField(labelText, inputEl) {
    const field = document.createElement("div");
    field.className = "mb2l-modal-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    field.appendChild(label);
    field.appendChild(inputEl);
    return field;
  }

  async function openMbSettingsModal(existingSettings, required) {
    return new Promise((resolve) => {
      const shell = createModalShell(
        "MusicBrainz -> Lidarr Setup",
        "Set your Lidarr URL and default action mode."
      );

      const baseUrlInput = document.createElement("input");
      baseUrlInput.type = "url";
      baseUrlInput.placeholder = "https://lidarr.example.com";
      baseUrlInput.value = existingSettings?.lidarrBaseUrl || "";
      shell.form.appendChild(createField("Lidarr Base URL", baseUrlInput));

      const modeSelect = document.createElement("select");
      const uiOpt = document.createElement("option");
      uiOpt.value = "ui";
      uiOpt.textContent = "UI Auto-Search";
      const apiOpt = document.createElement("option");
      apiOpt.value = "api";
      apiOpt.textContent = "Direct API Add";
      modeSelect.appendChild(uiOpt);
      modeSelect.appendChild(apiOpt);
      modeSelect.value = existingSettings?.defaultMode === "api" ? "api" : "ui";
      shell.form.appendChild(createField("Default Button Mode", modeSelect));

      const info = document.createElement("div");
      info.className = "mb2l-modal-status";
      shell.form.appendChild(info);

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "mb2l-modal-btn";
      cancelBtn.textContent = "Cancel";
      if (!required) {
        shell.actions.appendChild(cancelBtn);
      }

      const saveBtn = document.createElement("button");
      saveBtn.className = "mb2l-modal-btn primary";
      saveBtn.textContent = "Save";
      shell.actions.appendChild(saveBtn);

      cancelBtn.addEventListener("click", () => {
        shell.destroy();
        resolve(null);
      });

      saveBtn.addEventListener("click", () => {
        const enteredUrl = baseUrlInput.value.trim();
        if (!enteredUrl) {
          info.classList.add("error");
          info.textContent = "Lidarr URL is required.";
          return;
        }
        try {
          const settings = withDefaultsMbSettings({
            lidarrBaseUrl: enteredUrl,
            defaultMode: modeSelect.value,
          });
          writeJsonStorage(MB_SETTINGS_KEY, settings);
          shell.destroy();
          resolve(settings);
        } catch (_error) {
          info.classList.add("error");
          info.textContent = "Invalid Lidarr URL. Use http:// or https://.";
        }
      });

      shell.overlay.addEventListener("click", (event) => {
        if (event.target === shell.overlay && !required) {
          shell.destroy();
          resolve(null);
        }
      });

      baseUrlInput.focus();
    });
  }

  function populateSelect(select, values, toValue, toLabel, selected) {
    select.innerHTML = "";
    for (const item of values) {
      const option = document.createElement("option");
      option.value = String(toValue(item));
      option.textContent = toLabel(item);
      if (selected != null && String(selected) === option.value) {
        option.selected = true;
      }
      select.appendChild(option);
    }
  }

  function mapErrorMessage(error) {
    if (!error) {
      return "Unknown error";
    }
    if (error.payload && typeof error.payload === "string") {
      return error.payload;
    }
    if (error.payload && typeof error.payload === "object") {
      if (typeof error.payload.message === "string") {
        return error.payload.message;
      }
      if (Array.isArray(error.payload)) {
        const joined = error.payload
          .map((item) =>
            item && typeof item.errorMessage === "string" ? item.errorMessage : ""
          )
          .filter(Boolean)
          .join(" ");
        if (joined) {
          return joined;
        }
      }
    }
    if (typeof error.message === "string") {
      return error.message;
    }
    return "Request failed";
  }

  async function lidarrApi(path, options = {}) {
    const method = options.method || "GET";
    const headers = { Accept: "application/json" };
    if (options.apiKey) {
      headers["X-Api-Key"] = options.apiKey;
    }
    if (options.body != null) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(`${window.location.origin}/api/v1/${path}`, {
      method,
      headers,
      body: options.body != null ? JSON.stringify(options.body) : undefined,
      credentials: "include",
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        payload = text;
      }
    }

    if (!response.ok) {
      const err = new Error(`API ${method} /api/v1/${path} failed (${response.status})`);
      err.status = response.status;
      err.payload = payload;
      throw err;
    }

    return payload;
  }

  async function fetchLidarrSetupOptions(apiKey) {
    const [rootFolders, qualityProfiles, metadataProfiles] = await Promise.all([
      lidarrApi("rootfolder", { apiKey }),
      lidarrApi("qualityprofile", { apiKey }),
      lidarrApi("metadataprofile", { apiKey }),
    ]);
    return {
      rootFolders: Array.isArray(rootFolders) ? rootFolders : [],
      qualityProfiles: Array.isArray(qualityProfiles) ? qualityProfiles : [],
      metadataProfiles: Array.isArray(metadataProfiles) ? metadataProfiles : [],
    };
  }

  async function openLidarrSettingsModal(existingSettings) {
    return new Promise((resolve) => {
      const shell = createModalShell(
        "Lidarr API Setup",
        "Pick root folder and profiles for Quick Add mode."
      );

      const apiKeyInput = document.createElement("input");
      apiKeyInput.type = "password";
      apiKeyInput.placeholder = "Optional API key";
      apiKeyInput.value = existingSettings?.apiKey || "";
      shell.form.appendChild(createField("API Key (optional)", apiKeyInput));

      const rootSelect = document.createElement("select");
      shell.form.appendChild(createField("Root Folder", rootSelect));

      const qualitySelect = document.createElement("select");
      shell.form.appendChild(createField("Quality Profile", qualitySelect));

      const metadataSelect = document.createElement("select");
      shell.form.appendChild(createField("Metadata Profile", metadataSelect));

      const status = document.createElement("div");
      status.className = "mb2l-modal-status";
      shell.form.appendChild(status);

      const actionsRow = document.createElement("div");
      actionsRow.className = "mb2l-inline-row";
      shell.form.appendChild(actionsRow);

      const reloadBtn = document.createElement("button");
      reloadBtn.className = "mb2l-modal-btn";
      reloadBtn.textContent = "Reload Options";
      actionsRow.appendChild(reloadBtn);

      const cancelBtn = document.createElement("button");
      cancelBtn.className = "mb2l-modal-btn";
      cancelBtn.textContent = "Cancel";
      shell.actions.appendChild(cancelBtn);

      const saveBtn = document.createElement("button");
      saveBtn.className = "mb2l-modal-btn primary";
      saveBtn.textContent = "Save";
      saveBtn.disabled = true;
      shell.actions.appendChild(saveBtn);

      let currentOptions = null;

      function setStatus(message, isError) {
        status.textContent = message;
        if (isError) {
          status.classList.add("error");
        } else {
          status.classList.remove("error");
        }
      }

      async function loadOptions() {
        setStatus("Loading options from Lidarr...", false);
        saveBtn.disabled = true;
        try {
          currentOptions = await fetchLidarrSetupOptions(apiKeyInput.value.trim());
          if (
            !currentOptions.rootFolders.length ||
            !currentOptions.qualityProfiles.length ||
            !currentOptions.metadataProfiles.length
          ) {
            throw new Error(
              "Lidarr returned empty setup lists. Check permissions and configuration."
            );
          }

          populateSelect(
            rootSelect,
            currentOptions.rootFolders,
            (item) => item.path,
            (item) => item.path,
            existingSettings?.rootFolderPath
          );
          populateSelect(
            qualitySelect,
            currentOptions.qualityProfiles,
            (item) => item.id,
            (item) => `${item.name} (#${item.id})`,
            existingSettings?.qualityProfileId
          );
          populateSelect(
            metadataSelect,
            currentOptions.metadataProfiles,
            (item) => item.id,
            (item) => `${item.name} (#${item.id})`,
            existingSettings?.metadataProfileId
          );

          setStatus("Loaded options.", false);
          saveBtn.disabled = false;
        } catch (error) {
          setStatus(
            `Failed to load options: ${mapErrorMessage(error)}. If auth is enabled, enter API key and retry.`,
            true
          );
        }
      }

      reloadBtn.addEventListener("click", () => {
        loadOptions();
      });

      cancelBtn.addEventListener("click", () => {
        shell.destroy();
        resolve(null);
      });

      saveBtn.addEventListener("click", () => {
        if (!currentOptions) {
          setStatus("Load options first.", true);
          return;
        }
        const next = withDefaultsLidarrSettings({
          apiKey: apiKeyInput.value.trim(),
          rootFolderPath: rootSelect.value,
          qualityProfileId: Number(qualitySelect.value),
          metadataProfileId: Number(metadataSelect.value),
        });
        writeJsonStorage(LIDARR_SETTINGS_KEY, next);
        shell.destroy();
        resolve(next);
      });

      shell.overlay.addEventListener("click", (event) => {
        if (event.target === shell.overlay) {
          shell.destroy();
          resolve(null);
        }
      });

      loadOptions();
      apiKeyInput.focus();
    });
  }

  async function ensureMbSettings() {
    const existing = readJsonStorage(MB_SETTINGS_KEY);
    if (isMbSettingsValid(existing)) {
      return withDefaultsMbSettings(existing);
    }
    return openMbSettingsModal(existing, true);
  }

  async function ensureLidarrSettings() {
    const existing = readJsonStorage(LIDARR_SETTINGS_KEY);
    if (isLidarrSettingsValid(existing)) {
      return withDefaultsLidarrSettings(existing);
    }
    return openLidarrSettingsModal(existing);
  }

  function makePayload(mbid, artistName, mode) {
    return {
      v: PAYLOAD_VERSION,
      mbid,
      artistName: normalizeArtistName(artistName),
      mode: mode === "api" ? "api" : "ui",
      ts: Date.now(),
    };
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== "object") {
      return "Payload is missing.";
    }
    if (payload.v !== PAYLOAD_VERSION) {
      return "Unsupported payload version.";
    }
    if (!isValidMbid(payload.mbid)) {
      return "Invalid artist MBID.";
    }
    if (payload.mode !== "ui" && payload.mode !== "api") {
      return "Invalid mode.";
    }
    if (!Number.isFinite(Number(payload.ts))) {
      return "Invalid timestamp.";
    }
    const age = Math.abs(Date.now() - Number(payload.ts));
    if (age > PAYLOAD_MAX_AGE_MS) {
      return "Payload is expired.";
    }
    return null;
  }

  function getArtistPath(rootFolderPath, artistName) {
    const base = String(rootFolderPath || "").replace(/[\\/]+$/g, "");
    const safeArtist = normalizeArtistName(artistName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "");
    const separator = base.includes("\\") ? "\\" : "/";
    return `${base}${separator}${safeArtist || "Unknown Artist"}`;
  }

  function createArtistPayload(lookupArtist, payload, settings) {
    const artist = lookupArtist && typeof lookupArtist === "object" ? { ...lookupArtist } : {};
    delete artist.id;
    artist.foreignArtistId = lookupArtist?.foreignArtistId || payload.mbid;
    artist.artistName = lookupArtist?.artistName || payload.artistName;
    artist.qualityProfileId = settings.qualityProfileId;
    artist.metadataProfileId = settings.metadataProfileId;
    artist.rootFolderPath = settings.rootFolderPath;
    artist.path = getArtistPath(settings.rootFolderPath, artist.artistName || payload.artistName);
    artist.monitored = true;
    artist.monitorNewItems = artist.monitorNewItems || "all";
    artist.addOptions = {
      ...(artist.addOptions || {}),
      monitor: "all",
      searchForMissingAlbums: true,
    };
    return artist;
  }

  async function lookupArtistByMbid(mbid, apiKey) {
    const term = encodeURIComponent(`lidarr:${mbid}`);
    const candidates = [];

    try {
      const searchResults = await lidarrApi(`search?term=${term}`, { apiKey });
      if (Array.isArray(searchResults)) {
        candidates.push(...searchResults);
      }
    } catch (_error) {
      // Continue to lookup fallback endpoint.
    }

    if (!candidates.length) {
      const lookupResults = await lidarrApi(`artist/lookup?term=${term}`, { apiKey });
      if (Array.isArray(lookupResults)) {
        candidates.push(...lookupResults);
      }
    }

    if (!candidates.length) {
      try {
        const albumLookupResults = await lidarrApi(`album/lookup?term=${term}`, { apiKey });
        if (Array.isArray(albumLookupResults)) {
          for (const album of albumLookupResults) {
            if (album && typeof album === "object" && album.artist && typeof album.artist === "object") {
              candidates.push(album.artist);
            }
          }
        }
      } catch (_error) {
        // Ignore this fallback if endpoint is unavailable.
      }
    }

    const normalizedMbid = String(mbid).toLowerCase();
    return (
      candidates.find(
        (item) =>
          item &&
          typeof item === "object" &&
          String(item.foreignArtistId || "").toLowerCase() === normalizedMbid
      ) || candidates.find((item) => item && typeof item === "object") || null
    );
  }

  async function addArtistViaApi(payload) {
    if (inFlightMbids.has(payload.mbid)) {
      showToast(`"${payload.artistName}" is already being processed.`, "info");
      return;
    }
    inFlightMbids.add(payload.mbid);
    try {
      const settings = await ensureLidarrSettings();
      if (!settings) {
        showToast("Quick Add cancelled.", "info");
        return;
      }

      showToast(`Looking up "${payload.artistName}" in Lidarr...`, "info");
      const lookupArtist = await lookupArtistByMbid(payload.mbid, settings.apiKey);
      if (!lookupArtist) {
        throw new Error("Could not find artist metadata from Lidarr lookup.");
      }

      const artistBody = createArtistPayload(lookupArtist, payload, settings);

      try {
        await lidarrApi("artist", {
          method: "POST",
          apiKey: settings.apiKey,
          body: artistBody,
        });
        showToast(`Added "${payload.artistName}" and started search.`, "success", 5000);
      } catch (error) {
        const message = mapErrorMessage(error).toLowerCase();
        if (error.status === 409 || message.includes("already exists")) {
          showToast(`"${payload.artistName}" is already in Lidarr.`, "info");
          return;
        }
        throw error;
      }
    } catch (error) {
      showToast(`Quick Add failed: ${mapErrorMessage(error)}`, "error", 7000);
    } finally {
      inFlightMbids.delete(payload.mbid);
    }
  }

  function isOnAddNewPage() {
    return window.location.pathname.includes("/add/new");
  }

  function dispatchInputEvents(input) {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter",
      })
    );
    input.dispatchEvent(
      new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter",
      })
    );
  }

  function setReactInputValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    );
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
  }

  function waitForElement(selectors, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timed out waiting for selectors: ${selectors.join(", ")}`));
      }, timeoutMs);

      function findNow() {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            return el;
          }
        }
        return null;
      }

      const initial = findNow();
      if (initial) {
        window.clearTimeout(timeout);
        resolve(initial);
        return;
      }

      const observer = new MutationObserver(() => {
        const found = findNow();
        if (found) {
          window.clearTimeout(timeout);
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  function tryClickSearchButton(input) {
    const containers = [];
    if (input.closest("form")) {
      containers.push(input.closest("form"));
    }
    if (input.parentElement) {
      containers.push(input.parentElement);
    }
    if (input.closest("section")) {
      containers.push(input.closest("section"));
    }

    for (const container of containers) {
      if (!container) {
        continue;
      }
      const buttons = Array.from(container.querySelectorAll("button, [role='button']"));
      const labeled = buttons.find((button) => {
        const label = `${button.textContent || ""} ${button.getAttribute("aria-label") || ""}`.toLowerCase();
        return label.includes("search");
      });
      if (labeled) {
        labeled.click();
        return true;
      }
    }
    return false;
  }

  async function runUiAutoSearch(payload) {
    const searchTerm = `lidarr:${payload.mbid}`;

    if (!isOnAddNewPage()) {
      const next = new URL(`${window.location.origin}/add/new`);
      next.searchParams.set(PAYLOAD_PARAM, encodePayload(payload));
      window.location.assign(next.toString());
      return;
    }

    removePayloadParamFromUrl();

    try {
      const input = await waitForElement(
        [
          "input[name='term']",
          "input[placeholder*='Search']",
          "input[placeholder*='search']",
          "input[type='search']",
          "input[aria-label*='Search']",
          "main input",
        ],
        18000
      );
      setReactInputValue(input, searchTerm);
      input.focus();
      dispatchInputEvents(input);
      if (!tryClickSearchButton(input)) {
        dispatchInputEvents(input);
      }
      showToast(`Loaded Add New search for "${payload.artistName}".`, "success");
    } catch (error) {
      showToast(`Could not auto-fill Add New search: ${mapErrorMessage(error)}`, "error", 6000);
    }
  }

  async function handleLidarrReceiver() {
    const rawPayload = getPayloadParam();
    if (!rawPayload) {
      return;
    }

    const payload = decodePayload(rawPayload);
    const validationError = validatePayload(payload);
    if (validationError) {
      removePayloadParamFromUrl();
      showToast(`Ignoring incoming payload: ${validationError}`, "error", 6000);
      return;
    }

    if (payload.mode === "ui") {
      await runUiAutoSearch(payload);
      return;
    }

    removePayloadParamFromUrl();
    await addArtistViaApi(payload);
  }

  async function launchToLidarr(mbid, artistName, mode) {
    try {
      const settings = await ensureMbSettings();
      if (!settings) {
        return;
      }
      const payload = makePayload(mbid, artistName, mode);
      const encoded = encodePayload(payload);
      const targetPath =
        mode === "ui" ? "/add/new" : `/artist/${encodeURIComponent(mbid)}`;
      const targetUrl = new URL(`${settings.lidarrBaseUrl}${targetPath}`);
      targetUrl.searchParams.set(PAYLOAD_PARAM, encoded);

      if (settings.openInNewTab) {
        const opened = window.open(targetUrl.toString(), "_blank", "noopener");
        if (!opened) {
          showToast(
            "Popup blocked. Allow popups for musicbrainz.org or use same-tab mode.",
            "error",
            6500
          );
        }
        return;
      }

      window.location.assign(targetUrl.toString());
    } catch (error) {
      showToast(`Could not open Lidarr: ${mapErrorMessage(error)}`, "error", 6000);
    }
  }

  function createActionButtons(mbid, artistName) {
    const wrap = document.createElement("span");
    wrap.className = "mb2l-btn-wrap";
    wrap.setAttribute(BTN_GROUP_ATTR, "1");
    wrap.setAttribute(BOUND_ATTR, "1");
    wrap.dataset.mbid = mbid;

    const addBtn = document.createElement("button");
    addBtn.className = "mb2l-btn";
    addBtn.type = "button";
    addBtn.textContent = "Add in Lidarr";
    addBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      launchToLidarr(mbid, artistName, "ui");
    });

    const quickBtn = document.createElement("button");
    quickBtn.className = "mb2l-btn mb2l-btn-api";
    quickBtn.type = "button";
    quickBtn.textContent = "Quick Add";
    quickBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      launchToLidarr(mbid, artistName, "api");
    });

    wrap.appendChild(addBtn);
    wrap.appendChild(quickBtn);
    return wrap;
  }

  function getScopedContainer(link) {
    return link.closest("tr, li, article, section, div, p") || link.parentElement || link;
  }

  function hasReleaseGroupLinkInContainer(link) {
    const container = getScopedContainer(link);
    if (!container) {
      return false;
    }
    return Boolean(container.querySelector("a[href*='/release-group/']"));
  }

  function findInsertionTarget(link, pageEntity) {
    const current = extractEntityFromHref(link.href || "");
    if (
      pageEntity &&
      current &&
      pageEntity.mbid === current.mbid &&
      pageEntity.entityType === current.entityType
    ) {
      const heading = document.querySelector("#content h1") || document.querySelector("h1");
      if (heading) {
        return heading;
      }
    }

    const tr = link.closest("tr");
    if (tr) {
      return tr.querySelector("td:last-child") || tr;
    }

    const li = link.closest("li");
    if (li) {
      return li;
    }

    const p = link.closest("p");
    if (p) {
      return p;
    }

    return link.parentElement || link;
  }

  function collectArtistTargets() {
    const results = [];
    const seenKeys = new Set();
    let pageEntity = null;
    const pageReleaseGroupMatch = window.location.pathname.match(RELEASE_GROUP_LINK_RE);
    if (pageReleaseGroupMatch) {
      pageEntity = { entityType: "release-group", mbid: pageReleaseGroupMatch[1].toLowerCase() };
    } else {
      const pageArtistMatch = window.location.pathname.match(ARTIST_LINK_RE);
      if (pageArtistMatch) {
        pageEntity = { entityType: "artist", mbid: pageArtistMatch[1].toLowerCase() };
      }
    }
    const contentRoot = document.querySelector("#content") || document.body;

    if (pageEntity) {
      const heading = document.querySelector("#content h1") || document.querySelector("h1");
      if (heading && !heading.querySelector(`[${BTN_GROUP_ATTR}]`)) {
        results.push({
          entityType: pageEntity.entityType,
          mbid: pageEntity.mbid,
          artistName: normalizeArtistName(heading.textContent),
          target: heading,
        });
        seenKeys.add(`${pageEntity.entityType}:${pageEntity.mbid}`);
      }
    }

    const links = Array.from(
      contentRoot.querySelectorAll("a[href*='/release-group/'], a[href*='/artist/']")
    );
    links.sort((a, b) => {
      const aIsRg = (a.href || "").includes("/release-group/");
      const bIsRg = (b.href || "").includes("/release-group/");
      return aIsRg === bIsRg ? 0 : aIsRg ? -1 : 1;
    });
    for (const link of links) {
      const entity = extractEntityFromHref(link.href || "");
      const mbid = entity ? entity.mbid : null;
      if (!entity || !mbid) {
        continue;
      }
      if (pageEntity?.entityType === "release-group" && entity.entityType === "artist") {
        continue;
      }
      if (entity.entityType === "artist" && hasReleaseGroupLinkInContainer(link)) {
        continue;
      }

      const seenKey = `${entity.entityType}:${mbid}`;
      if (seenKeys.has(seenKey)) {
        continue;
      }
      if (link.closest(`[${BTN_GROUP_ATTR}]`)) {
        continue;
      }
      if (link.hasAttribute(BOUND_ATTR)) {
        continue;
      }

      const target = findInsertionTarget(link, pageEntity);
      if (!target) {
        continue;
      }

      seenKeys.add(seenKey);
      results.push({
        entityType: entity.entityType,
        mbid,
        artistName: normalizeArtistName(link.textContent),
        target,
        link,
      });
    }
    return results;
  }

  function injectSettingsLauncher() {
    if (document.querySelector(".mb2l-settings-launcher")) {
      return;
    }
    const launcher = document.createElement("button");
    launcher.type = "button";
    launcher.className = "mb2l-settings-launcher";
    launcher.textContent = "MB2L Settings";
    launcher.addEventListener("click", async () => {
      const existing = readJsonStorage(MB_SETTINGS_KEY);
      const saved = await openMbSettingsModal(existing, false);
      if (saved) {
        showToast("Saved MusicBrainz settings.", "success");
      }
    });
    document.body.appendChild(launcher);
  }

  function injectButtonsOnMusicBrainz() {
    const targets = collectArtistTargets();
    for (const item of targets) {
      if (item.target.querySelector(`[${BTN_GROUP_ATTR}][data-mbid="${item.mbid}"]`)) {
        if (item.link) {
          item.link.setAttribute(BOUND_ATTR, "1");
        }
        continue;
      }
      const group = createActionButtons(item.mbid, item.artistName);
      if (item.target.tagName === "TR") {
        const cell = item.target.querySelector("td:last-child") || item.target;
        cell.appendChild(group);
      } else if (item.target.tagName === "H1" || item.target.tagName === "H2") {
        item.target.appendChild(group);
      } else {
        item.target.appendChild(group);
      }
      if (item.link) {
        item.link.setAttribute(BOUND_ATTR, "1");
      }
    }
  }

  function queueScan() {
    if (scanQueued) {
      return;
    }
    scanQueued = true;
    window.setTimeout(() => {
      scanQueued = false;
      injectButtonsOnMusicBrainz();
    }, 150);
  }

  function initMusicBrainz() {
    injectStyles();
    injectSettingsLauncher();
    injectButtonsOnMusicBrainz();
    const observer = new MutationObserver(() => queueScan());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function bootstrap() {
    injectStyles();
    if (window.location.host === MB_HOST) {
      initMusicBrainz();
      return;
    }
    await handleLidarrReceiver();
  }

  bootstrap();
})();
