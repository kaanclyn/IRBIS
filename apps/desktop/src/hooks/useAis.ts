import { useEffect, useState } from "react";

export interface AisTarget {
  mmsi: number;
  name: string | null;
  class: string | null;
  msgType?: number;
  lat: number;
  lon: number;
  sogKn?: number;
  cogDeg?: number;
  headingDeg?: number;
  shipType?: number;
  lost: boolean;
  lastSeenUtc?: string;
  source?: string;
}

export function useAis() {
  const [targets, setTargets] = useState<AisTarget[]>([]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (window.irbis?.onAis) {
      unsub = window.irbis.onAis((payload) => {
        const p = payload as { targets?: AisTarget[] };
        setTargets(p.targets ?? []);
      });
    }
    void window.irbis?.getAis?.().then((s) => {
      const p = s as { targets?: AisTarget[] };
      if (p?.targets) setTargets(p.targets);
    });
    return () => unsub?.();
  }, []);

  return { targets, count: targets.length };
}
