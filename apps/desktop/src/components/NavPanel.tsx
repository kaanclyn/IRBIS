import type { AnchorWatch, Waypoint } from "../nav/types";

type Props = {
  waypoints: Waypoint[];
  clickToAddWp: boolean;
  onToggleClickAdd: () => void;
  onAddAtOwnShip: () => void;
  onClearRoute: () => void;
  onRemoveWp: (id: string) => void;
  onExportGpx: () => void;
  onImportGpx: () => void;
  gpxMsg: string | null;
  mobActive: boolean;
  onDropMob: () => void;
  onClearMob: () => void;
  anchor: AnchorWatch | null;
  anchorAlarm: boolean;
  onSetAnchor: () => void;
  onClearAnchor: () => void;
  onRadiusChange: (m: number) => void;
};

export function NavPanel({
  waypoints,
  clickToAddWp,
  onToggleClickAdd,
  onAddAtOwnShip,
  onClearRoute,
  onRemoveWp,
  onExportGpx,
  onImportGpx,
  gpxMsg,
  mobActive,
  onDropMob,
  onClearMob,
  anchor,
  anchorAlarm,
  onSetAnchor,
  onClearAnchor,
  onRadiusChange,
}: Props) {
  return (
    <div className="nav-panel">
      <div className="nav-panel-title">Seyir · Rota</div>

      <div className="nav-actions">
        <button
          type="button"
          className={clickToAddWp ? "active" : undefined}
          onClick={onToggleClickAdd}
          title="Haritaya tıklayarak WP ekle"
        >
          {clickToAddWp ? "Tıklama: AÇIK" : "Haritadan WP"}
        </button>
        <button type="button" onClick={onAddAtOwnShip} title="OwnShip konumuna WP">
          + OwnShip
        </button>
        <button type="button" onClick={onClearRoute} disabled={waypoints.length === 0}>
          Temizle
        </button>
      </div>

      <div className="nav-actions">
        <button type="button" onClick={onExportGpx} disabled={waypoints.length === 0}>
          GPX indir
        </button>
        <button type="button" onClick={onImportGpx}>
          GPX yükle
        </button>
      </div>
      {gpxMsg ? <div className="nav-msg">{gpxMsg}</div> : null}

      <div className="nav-wp-list">
        {waypoints.length === 0 ? (
          <div className="nav-empty">Rota yok — haritaya tıkla veya OwnShip ekle</div>
        ) : (
          waypoints.map((w, i) => (
            <div key={w.id} className="nav-wp-row">
              <div className="nav-wp-main">
                <span className="nav-wp-idx">{i + 1}</span>
                <span className="nav-wp-name">{w.name}</span>
              </div>
              <button
                type="button"
                className="nav-wp-del"
                aria-label={`${w.name} sil`}
                onClick={() => onRemoveWp(w.id)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="nav-section">
        <div className="nav-panel-title">MOB</div>
        <div className="nav-actions">
          <button type="button" className="nav-danger" onClick={onDropMob}>
            MOB bırak
          </button>
          <button type="button" onClick={onClearMob} disabled={!mobActive}>
            MOB iptal
          </button>
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-panel-title">Demir</div>
        <div className="nav-actions">
          <button type="button" onClick={onSetAnchor}>
            Demir at
          </button>
          <button type="button" onClick={onClearAnchor} disabled={!anchor}>
            Demir al
          </button>
        </div>
        {anchor ? (
          <label className="nav-radius">
            <span>Yarıçap</span>
            <input
              type="number"
              min={5}
              max={500}
              step={5}
              value={anchor.radiusM}
              onChange={(e) => onRadiusChange(Number(e.target.value) || 30)}
            />
            <span className="nav-radius-unit">m</span>
          </label>
        ) : null}
        {anchorAlarm ? <div className="nav-warn">OwnShip yarıçap dışında</div> : null}
      </div>
    </div>
  );
}
