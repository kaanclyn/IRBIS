/**
 * Nautilus S-63 paths + user-permit scan helpers (vendor ENC / permits).
 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function defaultEncExchange() {
  return path.join(
    repoRoot(),
    "vendor",
    "enc",
    "2022_Hafta_17",
    "2022_Hafta_17",
    "enc_file"
  );
}

function defaultPermitTxt() {
  return path.join(
    repoRoot(),
    "vendor",
    "enc",
    "2022_Hafta_17",
    "2022_Hafta_17",
    "permit_file",
    "PERMIT.TXT"
  );
}

function defaultIhoCrt() {
  return path.join(defaultEncExchange(), "IHO.CRT");
}

function defaultUserPermitRoot() {
  return path.join(repoRoot(), "vendor", "permits");
}

function defaultChartLibRoot() {
  return path.join(app.getPath("userData"), "nautilus-s63-library");
}

function s63SettingsPath() {
  return path.join(app.getPath("userData"), "nautilus-s63.json");
}

function loadS63Settings() {
  try {
    return JSON.parse(fs.readFileSync(s63SettingsPath(), "utf8"));
  } catch {
    return {};
  }
}

function saveS63Settings(partial) {
  const next = { ...loadS63Settings(), ...partial };
  fs.mkdirSync(path.dirname(s63SettingsPath()), { recursive: true });
  // Never persist mKey in plaintext settings if env is preferred — still allow local lab store.
  fs.writeFileSync(s63SettingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/**
 * Parse User Permit hex strings from vendor/permits *.txt lists.
 * @returns {Array<{label:string, hwId:string, userPermit:string, source:string}>}
 */
function scanUserPermits(permitRoot = defaultUserPermitRoot()) {
  const out = [];
  if (!permitRoot || !fs.existsSync(permitRoot)) return out;
  let entries;
  try {
    entries = fs.readdirSync(permitRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (!ent.isFile() || !/\.txt$/i.test(ent.name)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(permitRoot, ent.name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      // Columns: SIRA NUMARA HW_ID ASCII_HWID UserPermit
      const parts = line.split(/\t+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length < 4) continue;
      const userPermit = parts.find((p) => /^[0-9A-Fa-f]{28}$/.test(p));
      if (!userPermit) continue;
      const hwId = parts.find((p) => /^A[0-9A-Fa-f]{4}$/i.test(p)) || "";
      const label = parts.find((p) => /^(KB|B)-?\d+/i.test(p)) || userPermit.slice(0, 8);
      out.push({
        label: String(label),
        hwId: String(hwId),
        userPermit: userPermit.toUpperCase(),
        source: ent.name,
      });
    }
  }
  // de-dupe by userPermit
  const seen = new Set();
  return out.filter((p) => {
    if (seen.has(p.userPermit)) return false;
    seen.add(p.userPermit);
    return true;
  });
}

/** List TR cell folder names under ENC_ROOT/TR (pre-import catalog). */
function scanTrCellIds(exchangeDir = defaultEncExchange()) {
  const encRoot = path.join(exchangeDir, "ENC_ROOT");
  const trDir = path.join(encRoot, "TR");
  if (!fs.existsSync(trDir)) return [];
  let ents;
  try {
    ents = fs.readdirSync(trDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return ents
    .filter((e) => e.isDirectory() && /^TR/i.test(e.name))
    .map((e) => e.name.toUpperCase())
    .sort();
}

function resolveS63Paths(overrides = {}) {
  const saved = loadS63Settings();
  const exchange = overrides.exchange || saved.exchange || defaultEncExchange();
  const permitTxt = overrides.permitTxt || saved.permitTxt || defaultPermitTxt();
  const certificate = overrides.certificate || saved.certificate || defaultIhoCrt();
  const library = overrides.library || saved.library || defaultChartLibRoot();
  const userPermit =
    overrides.userPermit ||
    process.env.IRBIS_S63_USER_PERMIT ||
    saved.userPermit ||
    "";
  const mKey =
    overrides.mKey || process.env.IRBIS_S63_MKEY || saved.mKey || "";
  return {
    exchange,
    permitTxt,
    certificate,
    library,
    userPermit,
    mKey,
    hasExchange: fs.existsSync(path.join(exchange, "SERIAL.ENC")),
    hasPermitTxt: fs.existsSync(permitTxt),
    hasCertificate: fs.existsSync(certificate),
    hasCredentials: !!(userPermit && mKey),
  };
}

module.exports = {
  repoRoot,
  defaultEncExchange,
  defaultPermitTxt,
  defaultIhoCrt,
  defaultUserPermitRoot,
  defaultChartLibRoot,
  loadS63Settings,
  saveS63Settings,
  scanUserPermits,
  scanTrCellIds,
  resolveS63Paths,
};
