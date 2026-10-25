/** Built-in sim tick near demo NOAA cell (Annapolis) when no UDP traffic. */
export function createSimulatorOwnShipTick(now: Date = new Date()) {
  const t = now.getTime() / 1000;
  return {
    lat: 39.241 + Math.sin(t / 40) * 0.002,
    lon: -76.549 + Math.cos(t / 55) * 0.003,
    sogKn: 7.2 + Math.sin(t / 8) * 0.4,
    depthM: 11.6 + Math.sin(t / 12) * 0.8,
    cogDegTrue: (179 + Math.sin(t / 20) * 4 + 360) % 360,
    hdgDegTrue: (181 + Math.sin(t / 18) * 3 + 360) % 360,
    time: now,
  };
}
