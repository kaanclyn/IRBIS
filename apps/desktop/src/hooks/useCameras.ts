import { useCallback, useEffect, useMemo, useState } from "react";

export type StreamKind = "visible" | "thermal";

export function useCameras() {
  const [snap, setSnap] = useState<CameraSnapshot>({
    activeId: null,
    activeStream: "visible",
    cameras: [],
    count: 0,
  });

  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (window.irbis?.onCameras) {
      unsub = window.irbis.onCameras((payload) => setSnap(payload));
    }
    void window.irbis?.cameraList?.().then((s) => {
      if (s) setSnap(s);
    });
    return () => unsub?.();
  }, []);

  const active = useMemo(
    () => snap.cameras.find((c) => c.id === snap.activeId) ?? snap.cameras[0] ?? null,
    [snap.cameras, snap.activeId],
  );

  const streamKind: StreamKind =
    snap.activeStream === "thermal" && active?.streams.thermal ? "thermal" : "visible";

  const playUrl =
    streamKind === "thermal"
      ? active?.streams.thermal?.playUrl ?? null
      : active?.streams.visible?.playUrl ?? null;

  const setActive = useCallback(async (id: string) => {
    const r = await window.irbis?.cameraSetActive?.(id);
    if (r && "cameras" in r && r.cameras) setSnap(r as CameraSnapshot);
  }, []);

  const setStream = useCallback(async (kind: StreamKind) => {
    const r = await window.irbis?.cameraSetStream?.(kind);
    if (r) setSnap(r);
  }, []);

  const add = useCallback(
    async (payload: { host: string; port?: number; username: string; password: string; name?: string }) => {
      const r = await window.irbis?.cameraAdd?.(payload);
      if (r) setSnap(r);
      return r;
    },
    [],
  );

  const discover = useCallback(async () => {
    return (await window.irbis?.cameraDiscover?.({ timeoutMs: 5000 })) ?? [];
  }, []);

  const remove = useCallback(async (id: string) => {
    const r = await window.irbis?.cameraRemove?.(id);
    if (r) setSnap(r);
  }, []);

  const ptz = useCallback(
    async (action: "up" | "down" | "left" | "right" | "zoomin" | "zoomout" | "home" | "stop") => {
      if (!active?.id) return { ok: false as const, error: "Kamera yok" };
      return window.irbis?.cameraPtz?.({ id: active.id, action }) ?? { ok: false, error: "IPC yok" };
    },
    [active?.id],
  );

  const cycleActive = useCallback(async () => {
    if (snap.cameras.length === 0) return;
    const idx = Math.max(
      0,
      snap.cameras.findIndex((c) => c.id === (snap.activeId ?? active?.id)),
    );
    const next = snap.cameras[(idx + 1) % snap.cameras.length]!;
    await setActive(next.id);
  }, [snap.cameras, snap.activeId, active?.id, setActive]);

  return {
    ...snap,
    active,
    streamKind,
    playUrl,
    setActive,
    setStream,
    add,
    discover,
    remove,
    ptz,
    cycleActive,
  };
}
