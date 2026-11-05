const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

function storePath() {
  return path.join(app.getPath("userData"), "map-engine.json");
}

function defaults() {
  return {
    version: 1,
    engine: "navionics", // navionics | nautilus
    nautilusCellId: null,
  };
}

function load() {
  try {
    const p = storePath();
    if (!fs.existsSync(p)) return defaults();
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return {
      ...defaults(),
      engine: raw.engine === "nautilus" ? "nautilus" : "navionics",
      nautilusCellId: raw.nautilusCellId ?? null,
    };
  } catch {
    return defaults();
  }
}

function save(next) {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function createMapEngineStore() {
  let state = load();
  return {
    get: () => ({ ...state }),
    setEngine(engine) {
      state = save({
        ...state,
        engine: engine === "nautilus" ? "nautilus" : "navionics",
      });
      return state;
    },
    setNautilusCell(cellId) {
      state = save({ ...state, nautilusCellId: cellId || null });
      return state;
    },
  };
}

module.exports = { createMapEngineStore };
