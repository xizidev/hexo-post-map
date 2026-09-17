export type Coordinate = readonly [longitude: number, latitude: number];

export interface NormalizedPoint {
  readonly id: string;
  readonly name: string;
  readonly coordinate: Coordinate;
}

export interface NormalizedPostMap {
  readonly points: readonly NormalizedPoint[];
  readonly representative: NormalizedPoint;
  readonly route: readonly NormalizedPoint[];
  readonly zoom?: number;
}
