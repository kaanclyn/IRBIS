import { useCallback, useEffect, useState } from "react";
import type { ChartScheme } from "../chart/scheme";
import { SchemeSwitcher } from "./SchemeSwitcher";

type Library = ChartLibrarySnapshot;

function bakeLabel(status: string): string {
  switch (status) {
    case "ready":
      return "Bake hazır";
    case "raw-only":
      return "Ham ENC";
    case "pending":
      return "Bekliyor";
    case "error":
      return "Hata";
    case "quarantine":
      return "Karantina";
    case "cannot-bake":
      return "Bake yok (S-63)";
    default:
      return status;
  }
}

function permitLabel(status: string): string {
  switch (status) {
    case "plain":
      return "S-57";
    case "unsupported-s63":
      return "S-63 (desteklenmiyor)";
    case "future":
      return "Gelecek";
    default:
      return status;
  }
}

function libraryBlurb(lib: Library | null): string {
  if (lib?.s63Detected) {
    const n = lib.trCellCount ?? lib.cells.length;
    const permits =
      lib.userPermitCount && lib.userPermitCount > 0
        ? ` LIB/Permit: ${lib.userPermitCount} user permit listelenmiş.`
        : "";
    return (
      `S-63 TR değişimi algılandı (${n} hücre, şifreli). CodeMeter dongle tek başına IHO decrypt açmaz — IRBIS’te kayıtlı OEM M_KEY / kurulum HW_ID yok.` +
      ` Bake/PMTiles yazılmaz; harita boş (ENC katmanı yok).${permits}` +
      ` Çizim için: (1) IHO S-63 OEM kaydı + permit’lerin IRBIS HW_ID’sine yeniden basılması, veya (2) lisanslı chart OEM SDK, veya (3) şifresiz S-57 BYO + tile57.`
    );
  }
  return (
    "Uygulama ENC satmaz. Kendi şifresiz S-57 klasörünüzü (BYO) seçin; haritada göstermek için tile57 bake gerekir. " +
    "S-63 (şifreli) hücreler listelenir; CmStick ≠ S-63 OEM."
  );
}

export function ChartLibraryPanel({
  open,
  onClose,
  onActivated,
  scheme,
  onSchemeChange,
}: {
  open: boolean;
  onClose: () => void;
  onActivated: () => void;
  scheme: ChartScheme;
  onSchemeChange: (s: ChartScheme) => void;
}) {
  const [lib, setLib] = useState<Library | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const snap = await window.irbis?.getChartLibrary?.();
    if (snap) setLib(snap);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const pickFolder = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await window.irbis?.pickEncFolder?.();
      if (res && !res.canceled) {
        setLib(res.library);
        setMsg(`ENC klasörü: ${res.library.encRoot}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const rescan = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const snap = await window.irbis?.rescanCharts?.();
      if (snap) {
        setLib(snap);
        const note = snap.s63Detected
          ? `${snap.cells.length} S-63 hücre (bake yok)`
          : `${snap.cells.length} hücre`;
        setMsg(note);
      }
    } finally {
      setBusy(false);
    }
  };

  const activate = async (name: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await window.irbis?.setActiveCell?.(name);
      if (!res) return;
      setLib(res.library);
      if (!res.ok) {
        setMsg(res.error ?? "Aktifleştirilemedi");
        return;
      }
      setMsg(`${name} aktif`);
      onActivated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="chart-lib-title">
      <div className="modal-card chart-lib-card">
        <div className="chart-lib-head">
          <h1 id="chart-lib-title">Chart Library</h1>
          <button type="button" className="chart-lib-close" onClick={onClose} aria-label="Kapat">
            ×
          </button>
        </div>
        <p className="chart-lib-blurb">{libraryBlurb(lib)}</p>

        <div className="chart-lib-scheme">
          <span className="chart-lib-k">Palet</span>
          <SchemeSwitcher value={scheme} onChange={onSchemeChange} />
        </div>

        <div className="chart-lib-paths">
          <div>
            <span className="chart-lib-k">ENC</span>
            <code title={lib?.encRoot}>{lib?.encRoot || "—"}</code>
          </div>
          <div>
            <span className="chart-lib-k">Bake</span>
            <code title={lib?.bakeRoot}>{lib?.bakeRoot || "—"}</code>
          </div>
        </div>

        <div className="chart-lib-actions">
          <button type="button" disabled={busy} onClick={() => void pickFolder()}>
            ENC klasörü seç
          </button>
          <button type="button" disabled={busy} onClick={() => void rescan()}>
            Yeniden tara
          </button>
        </div>

        {msg ? <div className="chart-lib-msg">{msg}</div> : null}

        <div className="chart-lib-list">
          {(lib?.cells ?? []).length === 0 ? (
            <div className="ais-empty">Hücre yok — ENC klasörü seçin</div>
          ) : (
            lib!.cells.map((c) => {
              const active = c.name === lib!.activeCell;
              const ready = c.bakeStatus === "ready";
              return (
                <button
                  key={c.name}
                  type="button"
                  className={`chart-lib-row${active ? " active" : ""}${ready ? "" : " disabled"}`}
                  disabled={busy || !ready}
                  onClick={() => void activate(c.name)}
                >
                  <div className="chart-lib-row-main">
                    <span className="chart-lib-name">{c.name}</span>
                    {active ? <span className="chart-lib-active-tag">AKTİF</span> : null}
                  </div>
                  <div className="chart-lib-row-meta">
                    <span>{c.band != null ? `Band ${c.band}` : "Band ?"}</span>
                    <span>{c.updateNo != null ? `U${c.updateNo}` : "U0"}</span>
                    <span>{bakeLabel(c.bakeStatus)}</span>
                    <span>{permitLabel(c.permitStatus)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
