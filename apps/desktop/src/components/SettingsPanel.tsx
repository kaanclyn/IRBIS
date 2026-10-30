import { useState } from "react";
import type { useCameras } from "../hooks/useCameras";
import type { CamLayout, CamLayoutState, CamSlot } from "../camera/cameraLayout";
import { CAM_DRAG_MIME } from "../camera/cameraLayout";
import { CamDragChip } from "./CameraWall";

export type SettingsTab = "seyir" | "kamera" | "radar" | "genel";

type DiscoverHit = {
  hostname: string;
  port: number;
  name?: string;
};

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "seyir", label: "Seyir" },
  { id: "kamera", label: "Kamera" },
  { id: "radar", label: "Radar" },
  { id: "genel", label: "Genel" },
];

type Cams = ReturnType<typeof useCameras>;

export function SettingsPanel({
  cams,
  camLayout,
  onCamLayoutChange,
  onClose,
  onNote,
}: {
  cams: Cams;
  camLayout: CamLayoutState;
  onCamLayoutChange: (next: CamLayoutState) => void;
  onClose: () => void;
  onNote: (msg: string) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>("seyir");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("80");
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoverHit[] | null>(null);
  const [selectedHit, setSelectedHit] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const setLayout = (layout: CamLayout) => onCamLayoutChange({ ...camLayout, layout });

  const assignSlot = (index: number, cameraId: string | null) => {
    const slots = camLayout.slots.map((s, i) =>
      i === index ? { ...s, cameraId } : s,
    ) as CamLayoutState["slots"];
    onCamLayoutChange({ ...camLayout, slots, focus: index });
  };

  const runDiscover = () => {
    setDiscovering(true);
    setDiscovered(null);
    setSelectedHit(null);
    void cams
      .discover()
      .then((list) => {
        const hits: DiscoverHit[] = (list ?? [])
          .filter((d) => d?.hostname)
          .map((d) => ({
            hostname: d.hostname,
            port: Number(d.port) || 80,
            name: d.name || d.hostname,
          }));
        setDiscovered(hits);
        onNote(hits.length ? `ONVIF keşif · ${hits.length} cihaz` : "ONVIF keşif · cihaz yok");
      })
      .catch((e: { message?: string }) => {
        setDiscovered([]);
        onNote(String(e?.message || e));
      })
      .finally(() => setDiscovering(false));
  };

  const pickHit = (hit: DiscoverHit) => {
    setSelectedHit(`${hit.hostname}:${hit.port}`);
    setHost(hit.hostname);
    setPort(String(hit.port || 80));
    setAddOpen(true);
  };

  return (
    <aside className="side-panel side-panel-bridge side-panel-slim settings-panel" aria-label="Ayarlar">
      <div className="bridge-head settings-head-compact">
        <div className="bridge-brand">
          <div>
            <div className="bridge-kicker">IRBIS</div>
            <div className="bridge-title">Ayarlar</div>
          </div>
        </div>
        <button type="button" className="bridge-x" aria-label="Ayarları kapat" onClick={onClose}>
          ×
        </button>
      </div>

      <nav className="settings-tabs" aria-label="Ayar kategorileri">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`settings-tab${tab === t.id ? " active" : ""}`}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="bridge-body settings-body">
        {tab === "seyir" ? (
          <div className="settings-pane settings-pane-empty">
            <p className="settings-empty-title">Seyir</p>
            <p className="settings-empty-hint">Harita, AIS ve seyir tercihleri burada olacak.</p>
          </div>
        ) : null}

        {tab === "kamera" ? (
          <div className="settings-pane settings-cam">
            <section className="settings-card settings-card-tight">
              <div className="settings-card-head">
                <span>Ekran düzeni</span>
                <em>max 4</em>
              </div>
              <div className="cam-layout-picks">
                {([1, 2, 4] as CamLayout[]).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`cam-layout-pick${camLayout.layout === n ? " active" : ""}`}
                    onClick={() => setLayout(n)}
                    aria-pressed={camLayout.layout === n}
                  >
                    <span className={`cam-layout-glyph g${n}`} aria-hidden />
                    <strong>{n}</strong>
                    <small>{n === 1 ? "tek" : n === 2 ? "alt alta" : "ızgara"}</small>
                  </button>
                ))}
              </div>
              <p className="settings-muted tight">
                Küçük PiP’de hep 1 kanal. Büyük / split’te {camLayout.layout} kanal.
              </p>
            </section>

            <section className="settings-card settings-card-tight">
              <div className="settings-card-head">
                <span>Kanallar</span>
                <em>sürükle → bırak</em>
              </div>
              <div className={`settings-channel-matrix layout-${camLayout.layout}`}>
                {camLayout.slots.slice(0, camLayout.layout).map((slot, i) => (
                  <ChannelDrop
                    key={i}
                    index={i}
                    slot={slot}
                    name={cams.cameras.find((c) => c.id === slot.cameraId)?.name}
                    onClear={() => assignSlot(i, null)}
                    onDropCam={(id) => assignSlot(i, id)}
                  />
                ))}
              </div>
            </section>

            <section className="settings-card settings-card-tight">
              <div className="settings-card-head">
                <span>Kamera havuzu</span>
                <em>{cams.count}</em>
              </div>
              {cams.cameras.length === 0 ? (
                <p className="settings-muted tight">Henüz kamera yok — aşağıdan ekle.</p>
              ) : (
                <div className="cam-pool">
                  {cams.cameras.map((c) => (
                    <div key={c.id} className="cam-pool-row">
                      <CamDragChip id={c.id} name={c.name} host={c.host} />
                      <button
                        type="button"
                        className="settings-cam-del sm"
                        title="Kaldır"
                        onClick={() => void cams.remove(c.id).then(() => onNote(`Silindi · ${c.name}`))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="settings-card settings-card-tight">
              <button
                type="button"
                className="settings-disclosure"
                aria-expanded={addOpen}
                onClick={() => setAddOpen((v) => !v)}
              >
                <span>ONVIF ekle</span>
                <em>{addOpen ? "−" : "+"}</em>
              </button>

              {addOpen ? (
                <div className="settings-add-block">
                  <button
                    type="button"
                    className="settings-btn ghost settings-btn-block"
                    disabled={discovering || busy}
                    onClick={runDiscover}
                  >
                    {discovering ? "Aranıyor…" : "Ağda keşfet"}
                  </button>

                  {discovering ? (
                    <div className="settings-discover-status" role="status">
                      <span className="settings-spinner" aria-hidden />
                      <div>
                        <strong>Aranıyor</strong>
                        <small>ONVIF cihazlar taranıyor…</small>
                      </div>
                    </div>
                  ) : null}

                  {!discovering && discovered !== null ? (
                    <div className="settings-discover-results">
                      <div className="settings-card-head settings-card-head-sub">
                        <span>Bulunan</span>
                        <em>{discovered.length}</em>
                      </div>
                      {discovered.length === 0 ? (
                        <p className="settings-muted tight">Cihaz yok — IP elle gir.</p>
                      ) : (
                        <ul className="settings-discover-list">
                          {discovered.map((hit) => {
                            const key = `${hit.hostname}:${hit.port}`;
                            return (
                              <li key={key}>
                                <button
                                  type="button"
                                  className={`settings-cam-row${selectedHit === key ? " active" : ""}`}
                                  onClick={() => pickHit(hit)}
                                >
                                  <span className="settings-cam-name">{hit.name || hit.hostname}</span>
                                  <small>
                                    {hit.hostname}:{hit.port}
                                  </small>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : null}

                  <div className="settings-fields-grid">
                    <label className="settings-field">
                      <span className="settings-field-label">Host</span>
                      <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.64" />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">Port</span>
                      <input
                        value={port}
                        onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ""))}
                        placeholder="80"
                      />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">Kullanıcı</span>
                      <input value={user} onChange={(e) => setUser(e.target.value)} />
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">Şifre</span>
                      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="settings-btn primary settings-btn-block"
                    disabled={busy || discovering || !host.trim()}
                    onClick={() => {
                      setBusy(true);
                      void cams
                        .add({ host: host.trim(), port: Number(port) || 80, username: user, password: pass })
                        .then((r) => {
                          onNote(`Eklendi · ${r?.count ?? "?"} kamera`);
                          setPass("");
                          const id = r?.cameras?.find((c) => c.host === host.trim())?.id;
                          if (id) {
                            const empty = camLayout.slots.findIndex((s) => !s.cameraId);
                            if (empty >= 0 && empty < camLayout.layout) assignSlot(empty, id);
                          }
                        })
                        .catch((e: { message?: string }) => onNote(String(e?.message || e)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {busy ? "Ekleniyor…" : "Kamerayı kaydet"}
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {tab === "radar" ? (
          <div className="settings-pane settings-pane-empty">
            <p className="settings-empty-title">Radar</p>
            <p className="settings-empty-hint">Radar kaynağı, ARPA ve katman ayarları burada olacak.</p>
          </div>
        ) : null}

        {tab === "genel" ? (
          <div className="settings-pane settings-pane-empty">
            <p className="settings-empty-title">Genel</p>
            <p className="settings-empty-hint">Tema, dil ve sistem tercihleri burada olacak.</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function ChannelDrop({
  index,
  slot,
  name,
  onClear,
  onDropCam,
}: {
  index: number;
  slot: CamSlot;
  name?: string;
  onClear: () => void;
  onDropCam: (id: string) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`settings-channel-slot${slot.cameraId ? " filled" : ""}${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData(CAM_DRAG_MIME) || e.dataTransfer.getData("text/plain");
        if (id) onDropCam(id);
      }}
    >
      <span className="settings-channel-idx">CH{index + 1}</span>
      {slot.cameraId ? (
        <>
          <strong>{name || slot.cameraId}</strong>
          <button type="button" className="settings-channel-x" onClick={onClear} aria-label="Temizle">
            ×
          </button>
        </>
      ) : (
        <span className="settings-channel-hint">Bırak</span>
      )}
    </div>
  );
}
