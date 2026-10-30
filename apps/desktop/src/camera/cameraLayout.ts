export type CamLayout = 1 | 2 | 4;

export type CamSlot = {
  cameraId: string | null;
  stream: "visible" | "thermal";
};

export type CamLayoutState = {
  layout: CamLayout;
  slots: [CamSlot, CamSlot, CamSlot, CamSlot];
  focus: number;
};

const STORAGE_KEY = "irbis.camLayout.v1";

export function emptySlots(): CamLayoutState["slots"] {
  return [
    { cameraId: null, stream: "visible" },
    { cameraId: null, stream: "visible" },
    { cameraId: null, stream: "visible" },
    { cameraId: null, stream: "visible" },
  ];
}

export function defaultCamLayout(): CamLayoutState {
  return { layout: 1, slots: emptySlots(), focus: 0 };
}

export function loadCamLayout(): CamLayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCamLayout();
    const parsed = JSON.parse(raw) as Partial<CamLayoutState>;
    const layout = parsed.layout === 2 || parsed.layout === 4 ? parsed.layout : 1;
    const next = emptySlots();
    (parsed.slots ?? []).slice(0, 4).forEach((s, i) => {
      if (!s) return;
      next[i] = {
        cameraId: typeof s.cameraId === "string" ? s.cameraId : null,
        stream: s.stream === "thermal" ? "thermal" : "visible",
      };
    });
    const focus = Math.min(3, Math.max(0, Number(parsed.focus) || 0));
    return { layout, slots: next, focus };
  } catch {
    return defaultCamLayout();
  }
}

export function saveCamLayout(state: CamLayoutState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export const CAM_DRAG_MIME = "application/x-irbis-cam";
