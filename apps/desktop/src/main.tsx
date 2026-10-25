import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

window.addEventListener("error", (e) => {
  console.error("[irbis:window.error]", e.message, e.filename, e.lineno, e.error);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[irbis:unhandledrejection]", e.reason);
});

const root = document.getElementById("root");
if (!root) throw new Error("root missing");

try {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  console.info("[irbis] React mounted");
} catch (err) {
  console.error("[irbis] React mount failed", err);
  root.textContent = `IRBIS UI hatası: ${err instanceof Error ? err.message : String(err)}`;
}
