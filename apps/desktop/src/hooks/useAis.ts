import { useEffect, useState } from "react";
import { subscribeLiveNav } from "../runtime/bridge";

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
    return subscribeLiveNav({
      onAis: (payload) => {
        const p = payload as { targets?: AisTarget[] };
        setTargets(p?.targets ?? []);
      },
    });
  }, []);

  return { targets, count: targets.length };
}
