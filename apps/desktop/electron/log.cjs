const fs = require("node:fs");
const path = require("node:path");

const LOG_DIR = path.resolve(__dirname, "..", "..", "..", "logs");
const LOG_FILE = path.join(LOG_DIR, "irbis-main.log");

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function stamp() {
  return new Date().toISOString();
}

function write(level, ...args) {
  ensureLogDir();
  const line = `[${stamp()}] [${level}] ${args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack || ""}`;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line, "utf8");
  } catch {
    /* ignore */
  }
  const fn = level === "ERROR" ? console.error : console.log;
  fn(`[irbis]`, ...args);
}

const log = {
  info: (...a) => write("INFO", ...a),
  warn: (...a) => write("WARN", ...a),
  error: (...a) => write("ERROR", ...a),
  path: LOG_FILE,
};

module.exports = { log };
