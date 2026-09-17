/**
 * A GCJ-02 coordinate in `[longitude, latitude]` order.
 *
 * Values remain exactly as authored: this domain contract never converts or jitters coordinates.
 */
export type Coordinate = readonly [longitude: number, latitude: number];

export interface NormalizedPoint {
  readonly id: string;
  readonly name: string;
  /** GCJ-02 coordinate preserved without conversion or jitter. */
  readonly coordinate: Coordinate;
}

export interface NormalizedPostMap {
  readonly points: readonly NormalizedPoint[];
  readonly representative: NormalizedPoint;
  readonly route: readonly NormalizedPoint[];
  readonly zoom?: number;
}
