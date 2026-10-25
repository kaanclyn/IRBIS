export type Waypoint = {
  id: string;
  lat: number;
  lon: number;
  name: string;
};

export type MobPoint = {
  lat: number;
  lon: number;
  droppedAtUtc: string;
};

export type AnchorWatch = {
  lat: number;
  lon: number;
  radiusM: number;
};
