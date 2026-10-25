const fs = require("node:fs");
const path = require("node:path");
const { app, dialog } = require("electron");
const { defaultChartRoot } = require("./chartServer.cjs");
const { log } = require("./log.cjs");

/** Demo cell centers/bboxes from tile57 `cells` (Chesapeake / Maryland). Kept for plain NOAA BYO only. */
const KNOWN_CENTERS = {
  US5MD11M: {
    center: [-76.549, 39.241],
    zoom: 12,
    bbox: [-76.6377114, 39.1892375, -76.4604145, 39.2931129],
  },
  US5MD21M: {
    center: [-76.45, 38.486],
    zoom: 10,
    bbox: [-76.7222834, 38.2468748, -76.1786258, 38.7248832],
  },
  US5MD23M: {
    center: [-75.88, 38.44],
    zoom: 10,
    bbox: [-76.200893, 38.2288646, -75.5585146, 38.6509209],
  },
  US5MD1MC: {
    center: [-76.4625, 38.9625],
    zoom: 13,
    bbox: [-76.5, 38.925, -76.425, 39],
  },
  US5MD1MD: {
    center: [-76.3875, 38.9625],
    zoom: 13,
    bbox: [-76.425, 38.925, -76.35, 39],
  },
  US4MD80M: {
    center: [-75.967, 38.719],
    zoom: 9,
    bbox: [-76.1643712, 38.3831385, -75.7703878, 39.055131],
  },
  US4MD1BD: {
    center: [-76.35, 38.25],
    zoom: 10,
    bbox: [-76.5, 38.1, -76.2, 38.4],
  },
};

/** Turkey / Eastern Med overview when S-63 TR exchange is active (no bake). */
const TR_WORLD = {
  center: [32.5, 36.2],
  zoom: 5.2,
};

function bandFromCellName(name) {
  const m = /^[A-Z]{2}(\d)/i.exec(name);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

/** Primary: Turkish S-63 Hafta 17 ENC_ROOT (encrypted). NOAA demo is no longer the default. */
function defaultEncRoot() {
  return path.join(
    repoRoot(),
    "LIB",
    "2022_Hafta_17",
    "2022_Hafta_17",
    "enc_file",
    "ENC_ROOT",
  );
}

function defaultPermitRoot() {
  return path.join(repoRoot(), "LIB", "Permit");
}

function settingsPath() {
  return path.join(app.getPath("userData"), "chart-library.json");
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveSettings(partial) {
  const next = { ...loadSettings(), ...partial };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * Exchange media folder for an ENC_ROOT (sibling SERIAL.ENC / IHO.CRT).
 * @param {string} encRoot
 */
function exchangeMediaDir(encRoot) {
  if (!encRoot) return null;
  const base = path.basename(encRoot).toUpperCase() === "ENC_ROOT" ? path.dirname(encRoot) : encRoot;
  return base;
}

/**
 * Normalize Hafta17 / S-63 media selection: prefer …/enc_file/ENC_ROOT when user picked enc_file.
 * @param {string} encRoot
 */
function normalizeEncRoot(encRoot) {
  if (!encRoot) return encRoot;
  try {
    const base = path.basename(encRoot);
    if (base.toUpperCase() === "ENC_ROOT") return encRoot;
    // Selected exchange folder (contains SERIAL.ENC + ENC_ROOT)
    const nested = path.join(encRoot, "ENC_ROOT");
    if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) return nested;
    // Selected parent of enc_file
    const viaEncFile = path.join(encRoot, "enc_file", "ENC_ROOT");
    if (fs.existsSync(viaEncFile) && fs.statSync(viaEncFile).isDirectory()) return viaEncFile;
  } catch {
    /* keep as-is */
  }
  return encRoot;
}

/**
 * Detect S-63 exchange media (SERIAL.ENC) near ENC_ROOT.
 * @param {string} encRoot
 */
function hasSerialEnc(encRoot) {
  const media = exchangeMediaDir(encRoot);
  if (!media) return false;
  return fs.existsSync(path.join(media, "SERIAL.ENC"));
}

/**
 * Plain ISO 8211 S-57 .000 starts with ASCII record-length digits.
 * Encrypted S-63 payload is binary (tile57 BadAsciiInt).
 * @param {string} filePath
 */
function isEncrypted000(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(8);
    const n = fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    if (n < 4) return true;
    const head = buf.subarray(0, 4).toString("ascii");
    return !/^\d{4}$/.test(head);
  } catch {
    return false;
  }
}

/**
 * Count User Permit hex strings in LIB/Permit *.txt (KB / B series lists).
 * @param {string} permitRoot
 */
function scanUserPermitCount(permitRoot) {
  if (!permitRoot || !fs.existsSync(permitRoot)) return 0;
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(permitRoot, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !/\.txt$/i.test(ent.name)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(permitRoot, ent.name), "utf8");
    } catch {
      continue;
    }
    const matches = text.match(/\b[0-9A-Fa-f]{28}\b/g);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Find a base .000 under a cell directory (S-63: edition/update/CELL.000).
 * Prefer update 0 / lowest edition folder. Skip TRI* signature files.
 * @param {string} cellDir
 * @param {string} cellName
 */
function findBase000(cellDir, cellName) {
  const want = `${cellName}.000`.toUpperCase();
  /** @type {string[]} */
  const found = [];

  /** @param {string} dir @param {number} depth */
  function walk(dir, depth) {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      if (ent.name.toUpperCase() === want) found.push(full);
    }
  }

  walk(cellDir, 0);
  if (found.length === 0) return null;
  found.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return found[0];
}

/**
 * Count update files (.001 …) for a cell under its directory tree.
 * @param {string} cellDir
 * @param {string} cellName
 */
function countUpdates(cellDir, cellName) {
  const updates = [];
  /** @param {string} dir @param {number} depth */
  function walk(dir, depth) {
    if (depth > 5) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      const m = new RegExp(`^${cellName}\\.(\\d{3})$`, "i").exec(ent.name);
      if (!m) continue;
      const n = Number(m[1]);
      if (n >= 1) updates.push(ent.name.toUpperCase());
    }
  }
  walk(cellDir, 0);
  updates.sort();
  return updates;
}

/**
 * True if a TRI*.000 signature sits next to a cell .000 (S-63 media).
 * @param {string} base000Path
 */
function hasTriSignatureBeside(base000Path) {
  const dir = path.dirname(base000Path);
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return false;
  }
  return entries.some((n) => /^TRI.+\.000$/i.test(n));
}

/**
 * Detect whether this ENC root is an S-63 exchange (not plain BYO S-57).
 * @param {string} encRoot
 */
function detectS63Exchange(encRoot) {
  if (!encRoot || !fs.existsSync(encRoot)) {
    return { s63: false, reason: null };
  }
  if (hasSerialEnc(encRoot)) {
    return { s63: true, reason: "SERIAL.ENC" };
  }

  const trDir = path.join(encRoot, "TR");
  if (fs.existsSync(trDir)) {
    let dirs;
    try {
      dirs = fs.readdirSync(trDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      dirs = [];
    }
    for (const d of dirs.slice(0, 8)) {
      const cellName = d.name.toUpperCase();
      if (!/^TR/i.test(cellName)) continue;
      const base = findBase000(path.join(trDir, d.name), cellName);
      if (!base) continue;
      if (hasTriSignatureBeside(base) || isEncrypted000(base)) {
        return { s63: true, reason: hasTriSignatureBeside(base) ? "TRI-signature" : "encrypted-000" };
      }
    }
  }

  return { s63: false, reason: null };
}

/**
 * Scan TR producer cell directories (ENC_ROOT/TR/TR*) without decrypt.
 * @param {string} encRoot
 * @param {boolean} asS63
 * @returns {Map<string, object>}
 */
function scanTrCells(encRoot, asS63) {
  /** @type {Map<string, object>} */
  const cells = new Map();
  const trDir = path.join(encRoot, "TR");
  if (!fs.existsSync(trDir)) return cells;

  let dirs;
  try {
    dirs = fs.readdirSync(trDir, { withFileTypes: true });
  } catch {
    return cells;
  }

  for (const ent of dirs) {
    if (!ent.isDirectory()) continue;
    const name = ent.name.toUpperCase();
    if (!/^TR[A-Z0-9]+$/i.test(name)) continue;
    const cellDir = path.join(trDir, ent.name);
    const base000 = findBase000(cellDir, name);
    const updates = countUpdates(cellDir, name);
    const encrypted = base000 ? isEncrypted000(base000) : asS63;
    const s63Cell = asS63 || encrypted || (base000 ? hasTriSignatureBeside(base000) : false);

    cells.set(name, {
      name,
      band: bandFromCellName(name),
      path: base000 || cellDir,
      updateNo: updates.length,
      updateFiles: updates,
      permitStatus: s63Cell ? "unsupported-s63" : "plain",
      bakeStatus: s63Cell ? "cannot-bake" : "raw-only",
      encrypted: s63Cell,
    });
  }
  return cells;
}

/**
 * Recursively find plain S-57 base cells (*.000). Skips TRI* signatures and S-63 encrypted payloads when exchange is S-63.
 * @param {string} root
 * @param {{ skipTrProducer?: boolean, markS63?: boolean }} opts
 * @returns {Map<string, object>}
 */
function scanEncRoot(root, opts = {}) {
  /** @type {Map<string, object>} */
  const cells = new Map();
  if (!root || !fs.existsSync(root)) return cells;

  const skipTr = !!opts.skipTrProducer;
  const markS63 = !!opts.markS63;

  /** @param {string} dir */
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skipTr && ent.name.toUpperCase() === "TR" && path.dirname(full) === path.normalize(root)) {
          continue;
        }
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const m = /^(.*)\.000$/i.exec(ent.name);
      if (!m) continue;
      const name = m[1].toUpperCase();
      // S-63 digital signature / info files — not chart cells
      if (name.startsWith("TRI") || name.startsWith("README")) continue;

      const encrypted = isEncrypted000(full);
      if (markS63 || encrypted) {
        // Prefer directory-based TR scan for S-63; skip loose encrypted .000 here if under TR/
        if (/[/\\]TR[/\\]/i.test(full)) continue;
      }

      const dirOf = path.dirname(full);
      const updates = [];
      for (let i = 1; i <= 99; i++) {
        const upd = path.join(dirOf, `${name}.${String(i).padStart(3, "0")}`);
        if (fs.existsSync(upd)) updates.push(path.basename(upd));
        else break;
      }

      const s63Cell = markS63 || encrypted || hasTriSignatureBeside(full);
      cells.set(name, {
        name,
        band: bandFromCellName(name),
        path: full,
        updateNo: updates.length,
        updateFiles: updates,
        permitStatus: s63Cell ? "unsupported-s63" : "plain",
        bakeStatus: s63Cell ? "cannot-bake" : "raw-only",
        encrypted: s63Cell,
      });
    }
  }

  walk(root);
  return cells;
}

/**
 * Find baked cells under tile57 output root (folders with *.pmtiles).
 * @param {string} bakeRoot
 */
function scanBakeRoot(bakeRoot) {
  /** @type {Map<string, object>} */
  const cells = new Map();
  if (!bakeRoot || !fs.existsSync(bakeRoot)) return cells;

  let entries;
  try {
    entries = fs.readdirSync(bakeRoot, { withFileTypes: true });
  } catch {
    return cells;
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name === "assets" || ent.name.startsWith(".")) continue;
    const cellDir = path.join(bakeRoot, ent.name);
    const name = ent.name.toUpperCase();
    const pmtiles = path.join(cellDir, `${ent.name}.pmtiles`);
    const alt = path.join(cellDir, `${name}.pmtiles`);
    const pmPath = fs.existsSync(pmtiles) ? pmtiles : fs.existsSync(alt) ? alt : null;
    if (!pmPath) continue;

    const known = KNOWN_CENTERS[name];
    cells.set(name, {
      name,
      band: bandFromCellName(name),
      path: cellDir,
      bakeStatus: "ready",
      permitStatus: "plain",
      pmtilesPath: path.posix.join(ent.name, path.basename(pmPath)),
      center: known?.center,
      zoom: known?.zoom,
    });
  }
  return cells;
}

/**
 * @param {string} encRoot
 * @param {string} bakeRoot
 * @param {{ ignoreBake?: boolean }} [opts]
 */
function mergeLibrary(encRoot, bakeRoot, opts = {}) {
  const detection = detectS63Exchange(encRoot);
  const asS63 = detection.s63;
  // Lab bake (NOAA / plain BYO) must stay visible even when encRoot is S-63 TR.
  // Never merge bake onto encrypted TR cell names — only add as separate ready cells.
  const ignoreBake = !!opts.ignoreBake;

  /** @type {Map<string, object>} */
  const merged = new Map();

  if (asS63 || fs.existsSync(path.join(encRoot, "TR"))) {
    for (const [name, cell] of scanTrCells(encRoot, asS63)) {
      merged.set(name, { ...cell });
    }
  }

  const enc = scanEncRoot(encRoot, { skipTrProducer: true, markS63: asS63 });
  for (const [name, cell] of enc) {
    if (!merged.has(name)) merged.set(name, { ...cell });
  }

  if (!ignoreBake) {
    const bake = scanBakeRoot(bakeRoot);
    for (const [name, baked] of bake) {
      const prev = merged.get(name);
      if (prev) {
        if (prev.permitStatus === "unsupported-s63" || prev.bakeStatus === "cannot-bake") {
          // Keep S-63 row; lab cell may appear under a different US* name from bakeRoot.
          continue;
        }
        merged.set(name, {
          ...prev,
          bakeStatus: "ready",
          pmtilesPath: baked.pmtilesPath,
          center: baked.center ?? prev.center,
          zoom: baked.zoom ?? prev.zoom,
          bakePath: baked.path,
        });
      } else {
        merged.set(name, { ...baked, labQuilt: true });
      }
    }
  }

  const cells = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { cells, s63: asS63, s63Reason: detection.reason };
}

function isLegacyNoaaEncRoot(encRoot) {
  if (!encRoot) return true;
  const norm = path.normalize(encRoot).toLowerCase().replace(/\\/g, "/");
  return norm.includes("/samples/enc-noaa/");
}

function createChartLibrary() {
  const bakeRoot = process.env.IRBIS_CHART_ROOT || defaultChartRoot();
  const permitRoot = defaultPermitRoot();
  let settings = loadSettings();
  // Prefer Turkish S-63 Hafta17; migrate away from bundled NOAA demo root.
  let encRoot = normalizeEncRoot(
    settings.encRoot && !isLegacyNoaaEncRoot(settings.encRoot)
      ? settings.encRoot
      : defaultEncRoot(),
  );
  let activeCell = settings.activeCell || "";
  // Migrate encRoot off legacy NOAA demo path; keep US* activeCell when lab bake will draw it.
  if (isLegacyNoaaEncRoot(settings.encRoot)) {
    settings = saveSettings({ encRoot, activeCell });
    log.info("encRoot migrated from NOAA demo to Hafta17 S-63", encRoot);
  } else if (settings.encRoot && settings.encRoot !== encRoot) {
    settings = saveSettings({ encRoot, activeCell });
    log.info("encRoot normalized to ENC_ROOT", encRoot);
  }

  function snapshot() {
    const { cells, s63, s63Reason } = mergeLibrary(encRoot, bakeRoot);
    const userPermitCount = scanUserPermitCount(permitRoot);
    const trCells = cells.filter((c) => /^TR/i.test(c.name));
    const s63Cells = cells.filter((c) => c.permitStatus === "unsupported-s63");
    const readyList = cells.filter((c) => c.bakeStatus === "ready" && c.pmtilesPath);

    // Dual-source: when lab bake exists, "active" follows drawable quilt — never TR/S-63 stubs.
    if (readyList.length > 0) {
      if (!readyList.some((c) => c.name === activeCell)) {
        const prefer =
          readyList.find((c) => c.name === "US5MD11M") ||
          readyList.find((c) => /^US/i.test(c.name)) ||
          readyList[0];
        if (prefer && prefer.name !== activeCell) {
          activeCell = prefer.name;
          settings = saveSettings({ encRoot, activeCell });
          log.info("activeCell set to lab/plain ready cell", activeCell);
        }
      }
    } else if (!cells.some((c) => c.name === activeCell)) {
      // No bake: informational TR selection only (not drawn until OEM).
      activeCell = trCells[0]?.name || s63Cells[0]?.name || cells[0]?.name || "";
      if (activeCell) settings = saveSettings({ encRoot, activeCell });
    } else if (s63 && /^US/i.test(activeCell || "")) {
      // Stale US* with no bake on disk — clear confusion.
      activeCell = trCells[0]?.name || s63Cells[0]?.name || "";
      settings = saveSettings({ encRoot, activeCell });
    }

    return {
      encRoot,
      bakeRoot,
      permitRoot,
      activeCell,
      cells,
      stylePath: "style.json",
      spritePath: "assets/sprite-mln",
      s63Detected: s63,
      s63Reason: s63Reason || null,
      userPermitCount,
      cellCount: cells.length,
      trCellCount: trCells.length,
      labReadyCount: readyList.length,
      displayLabel:
        readyList.length > 0
          ? `LAB NOAA · ${readyList.length} hücre`
          : s63
            ? `S-63 · ${trCells.length || cells.length} hücre`
            : activeCell || "—",
    };
  }

  function quiltBounds(readyCells) {
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    let any = false;
    for (const c of readyCells) {
      const b = c.bbox || KNOWN_CENTERS[c.name]?.bbox;
      if (!b || b.length !== 4) continue;
      any = true;
      w = Math.min(w, b[0]);
      s = Math.min(s, b[1]);
      e = Math.max(e, b[2]);
      n = Math.max(n, b[3]);
    }
    return any ? [w, s, e, n] : null;
  }

  function getActiveConfig(baseUrl) {
    const snap = snapshot();
    const cell = snap.cells.find((c) => c.name === snap.activeCell);

    // Display always uses baked plain S-57 quilt (lab NOAA) when present — independent of S-63 encRoot.
    const readyCells = snap.cells
      .filter((c) => c.bakeStatus === "ready" && c.pmtilesPath)
      .map((c) => {
        const k = KNOWN_CENTERS[c.name] || {};
        return {
          name: c.name,
          pmtilesPath: c.pmtilesPath,
          center: c.center || k.center,
          zoom: c.zoom ?? k.zoom ?? 11,
          bbox: k.bbox || null,
        };
      });

    const labPrimary =
      readyCells.find((c) => c.name === snap.activeCell) ||
      readyCells.find((c) => c.name === "US5MD11M") ||
      readyCells.find((c) => /^US/i.test(c.name)) ||
      readyCells[0] ||
      null;

    const bounds = quiltBounds(readyCells);
    const base = {
      baseUrl,
      stylePath: snap.stylePath,
      spritePath: snap.spritePath,
      mode: "simulation",
      readyCells,
      s63Detected: !!snap.s63Detected,
      userPermitCount: snap.userPermitCount,
      // HeyCaptain-like: always keep a subtle nautical basemap under ENC / void.
      hideWorldBasemap: false,
      labBakeActive: !!labPrimary,
      displayLabel: snap.displayLabel,
    };

    if (labPrimary) {
      const known = KNOWN_CENTERS[labPrimary.name] || {};
      const trN = snap.trCellCount || 0;
      const center = labPrimary.center || known.center || [-76.45, 38.75];
      return {
        ...base,
        pmtilesPath: labPrimary.pmtilesPath,
        center,
        zoom: labPrimary.zoom ?? known.zoom ?? 10,
        cellName: labPrimary.name,
        bakeReady: true,
        bbox: known.bbox || null,
        fitBounds: bounds,
        worldCenter: center,
        worldZoom: 9,
        displayLabel: `LAB NOAA · ${readyCells.length} hücre`,
        warning: snap.s63Detected
          ? `Lab S-57 çiziliyor · S-63 TR ${trN} listeleniyor (OEM bekliyor)`
          : undefined,
      };
    }

    // No bake: basemap + strong status (never blank void).
    if (snap.s63Detected) {
      const n = snap.trCellCount || snap.cells.length;
      const permits = snap.userPermitCount || 0;
      return {
        ...base,
        pmtilesPath: "",
        center: TR_WORLD.center,
        zoom: TR_WORLD.zoom,
        worldCenter: TR_WORLD.center,
        worldZoom: TR_WORLD.zoom,
        cellName: snap.activeCell || "S-63",
        bakeReady: false,
        displayLabel: `S-63 · ${n} hücre`,
        warning: `S-63 TR şifreli · ${n} hücre · lab bake yok — tools/bake-noaa.ps1 · OEM M_KEY yok${permits ? ` · ${permits} permit` : ""}`,
      };
    }

    const known = KNOWN_CENTERS[snap.activeCell] || {
      center: [-20, 10],
      zoom: 1.25,
      bbox: null,
    };
    return {
      ...base,
      pmtilesPath: "",
      center: known.center,
      zoom: known.zoom,
      worldCenter: known.center,
      worldZoom: known.zoom,
      cellName: snap.activeCell || "",
      bakeReady: false,
      displayLabel: snap.displayLabel,
      warning: cell
        ? "Hücre bake edilmemiş — tools/bake-noaa.ps1 veya tile57"
        : "Aktif hücre yok",
    };
  }

  async function pickEncFolder(parentWindow) {
    const result = await dialog.showOpenDialog(parentWindow ?? undefined, {
      title: "S-57 / S-63 ENC klasörü seç (ENC_ROOT veya hücre klasörü)",
      properties: ["openDirectory"],
      defaultPath: encRoot && fs.existsSync(encRoot) ? encRoot : undefined,
    });
    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true, library: snapshot() };
    }
    encRoot = result.filePaths[0];
    // Force re-evaluate active cell on next snapshot (may clear US* demo)
    const detection = detectS63Exchange(encRoot);
    if (detection.s63 && /^US/i.test(activeCell || "")) {
      activeCell = "";
    }
    settings = saveSettings({ encRoot, activeCell });
    log.info("ENC root selected", encRoot, detection.s63 ? "(S-63)" : "(plain)");
    return { canceled: false, library: snapshot() };
  }

  function setActiveCell(name) {
    const snap = snapshot();
    const cell = snap.cells.find((c) => c.name === name);
    if (!cell) return { ok: false, error: "Hücre bulunamadı", library: snap };
    if (cell.permitStatus === "unsupported-s63" || cell.bakeStatus === "cannot-bake") {
      return {
        ok: false,
        error: "S-63 hücre — MVP’de decrypt/bake yok (OEM gerekli)",
        library: snap,
      };
    }
    if (cell.bakeStatus !== "ready") {
      return {
        ok: false,
        error: "Bu hücre henüz bake edilmedi — haritada gösterilemez",
        library: snap,
      };
    }
    activeCell = name;
    settings = saveSettings({ encRoot, activeCell });
    return { ok: true, library: snapshot() };
  }

  function rescan() {
    return snapshot();
  }

  return {
    snapshot,
    getActiveConfig,
    pickEncFolder,
    setActiveCell,
    rescan,
    get bakeRoot() {
      return bakeRoot;
    },
    get encRoot() {
      return encRoot;
    },
  };
}

module.exports = {
  createChartLibrary,
  defaultEncRoot,
  defaultPermitRoot,
  scanEncRoot,
  scanBakeRoot,
  scanTrCells,
  detectS63Exchange,
  scanUserPermitCount,
  isEncrypted000,
};
