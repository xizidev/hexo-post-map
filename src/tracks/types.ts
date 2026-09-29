/** Local track authoring options retained only while generating the site. */
export interface NormalizedTrackReference {
  readonly source: string;
  readonly privacy: {
    readonly trimStartMeters: number;
    readonly trimEndMeters: number;
  };
  readonly simplifyToleranceMeters: number;
  readonly playback: boolean;
}

/** WGS84 source data; must never be serialized before privacy processing. */
export interface RawTrackPoint {
  readonly coordinate: readonly [longitude: number, latitude: number];
  readonly elevationMeters?: number;
  readonly timeMilliseconds?: number;
}

export type RawTrack = readonly (readonly RawTrackPoint[])[];

export interface TrackStats {
  readonly distanceMeters: number;
  readonly elevationGainMeters?: number;
  readonly durationSeconds?: number;
}

export type PublishedTrackCoordinate =
  | readonly [longitude: number, latitude: number]
  | readonly [longitude: number, latitude: number, elevationMeters: number];

export type PublishedTrackSegments = readonly (readonly PublishedTrackCoordinate[])[];

export interface PublishedTrackAsset {
  readonly version: 1;
  readonly coordinateSystem: 'wgs84';
  readonly segments: PublishedTrackSegments;
  readonly stats: TrackStats;
}

export interface CompiledTrack {
  readonly routePath: `hexo-post-map/tracks/${string}.json`;
  readonly serialized: string;
  readonly asset: PublishedTrackAsset;
  readonly stats: TrackStats;
  readonly playback: boolean;
}

/** Server-only source identity and bytes. */
export interface TrackSourceFile {
  readonly format: 'gpx' | 'geojson';
  readonly bytes: Buffer;
  readonly canonicalPath: string;
  readonly fingerprint: string;
}
