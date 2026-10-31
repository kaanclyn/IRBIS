import { useEffect, useState } from "react";
import type { CamLayout, CamSlot } from "../camera/cameraLayout";
import { CAM_DRAG_MIME } from "../camera/cameraLayout";

type CamInfo = {
  id: string;
  name: string;
  status?: string;
  streams: {
    visible: { playUrl: string | null } | null;
    thermal: { playUrl: string | null } | null;
  };
  capabilities?: { ptz?: boolean };
};

export function CameraWall({
  layout,
  slots,
  focus,
  cameras,
  pip,
  onFocus,
  onAssign,
  onClear,
  onLayoutChange,
}: {
  layout: CamLayout;
  slots: CamSlot[];
  focus: number;
  cameras: CamInfo[];
  pip?: boolean;
  onFocus: (index: number) => void;
  onAssign: (index: number, cameraId: string) => void;
  onClear: (index: number) => void;
  onLayoutChange?: (layout: CamLayout) => void;
}) {
  const count = pip ? 1 : layout;
  const indices = pip ? [Math.min(focus, 3)] : [...Array(count).keys()];

  return (
    <div className={`cam-wall${pip ? " pip" : ""}`} data-layout={pip ? 1 : layout}>
      {!pip && onLayoutChange ? (
        <div className="cam-wall-toolbar">
          <span className="cam-wall-toolbar-label">Görünüm</span>
          {([1, 2, 4] as CamLayout[]).map((n) => (
            <button
              key={n}
              type="button"
              className={`cam-wall-layout-btn${layout === n ? " active" : ""}`}
              title={`${n} kanal`}
              aria-pressed={layout === n}
              onClick={() => onLayoutChange(n)}
            >
              {n === 1 ? "1" : n === 2 ? "2" : "4"}
            </button>
          ))}
        </div>
      ) : null}

      <div className={`cam-wall-grid layout-${pip ? 1 : layout}`}>
        {indices.map((slotIndex) => {
          const slot = slots[slotIndex] ?? { cameraId: null, stream: "visible" as const };
          const cam = cameras.find((c) => c.id === slot.cameraId) ?? null;
          const playUrl =
            slot.stream === "thermal"
              ? cam?.streams.thermal?.playUrl ?? cam?.streams.visible?.playUrl ?? null
              : cam?.streams.visible?.playUrl ?? null;
          const focused = !pip && focus === slotIndex;

          return (
            <div
              key={slotIndex}
              className={`cam-cell${focused ? " focused" : ""}${cam ? "" : " empty"}`}
              onClick={() => onFocus(slotIndex)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id =
                  e.dataTransfer.getData(CAM_DRAG_MIME) || e.dataTransfer.getData("text/plain");
                if (id) onAssign(slotIndex, id);
              }}
            >
              <div className="cam-cell-feed">
                {playUrl ? (
                  <LiveMjpeg src={playUrl} alt={cam?.name ?? "CAM"} />
                ) : (
                  <div className="cam-cell-empty">
                    <span>{cam ? "Stream yok" : `Kanal ${slotIndex + 1}`}</span>
                    <small>{cam ? cam.name : "Kamerayı sürükle"}</small>
                  </div>
                )}
              </div>
              <div className="cam-cell-chrome">
                <span className="cam-cell-name">{cam?.name ?? `CH ${slotIndex + 1}`}</span>
                <span
                  className={`cam-cell-live${cam?.status === "online" ? " on" : ""}${cam?.status === "reconnecting" ? " wait" : ""}`}
                >
                  {cam?.status === "online" ? "LIVE" : cam?.status === "reconnecting" ? "YENİDEN…" : cam ? "—" : "BOŞ"}
                </span>
                {cam ? (
                  <button
                    type="button"
                    className="cam-cell-clear"
                    title="Kanalı temizle"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClear(slotIndex);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Chromium'da multipart MJPEG kırılgan — proxy .jpg + blob polling */
function toSnapUrl(playUrl: string) {
  return playUrl.replace(/\.mjpg(\?|$)/i, ".jpg$1");
}

function LiveMjpeg({ src, alt }: { src: string; alt: string }) {
  const [frame, setFrame] = useState<string | null>(null);
  const snapBase = toSnapUrl(src);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    let objectUrl: string | null = null;
    let n = 0;

    const release = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    const pull = async () => {
      if (cancelled) return;
      n += 1;
      const url = `${snapBase}${snapBase.includes("?") ? "&" : "?"}t=${Date.now()}_${n}`;
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        if (!blob.size || blob.size < 64) {
          throw new Error("empty");
        }
        const next = URL.createObjectURL(blob);
        release();
        objectUrl = next;
        setFrame(next);
        timer = window.setTimeout(pull, 110);
      } catch {
        if (cancelled) return;
        timer = window.setTimeout(pull, 600);
      }
    };

    setFrame(null);
    void pull();
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      release();
    };
  }, [snapBase]);

  if (!frame) {
    return (
      <div className="cam-cell-empty">
        <span>Bağlanıyor…</span>
        <small>{alt}</small>
      </div>
    );
  }

  return <img className="camera-live" src={frame} alt={alt} draggable={false} />;
}

export function CamDragChip({ id, name, host }: { id: string; name: string; host?: string }) {
  return (
    <button
      type="button"
      className="cam-drag-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CAM_DRAG_MIME, id);
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={host ? `${name} · ${host}` : name}
    >
      <span className="cam-drag-chip-dot" />
      <span className="cam-drag-chip-text">
        <strong>{name}</strong>
        {host ? <small>{host}</small> : null}
      </span>
    </button>
  );
}
