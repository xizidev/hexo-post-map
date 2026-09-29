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

/** Server-only source identity and bytes. */
export interface TrackSourceFile {
  readonly format: 'gpx' | 'geojson';
  readonly bytes: Buffer;
  readonly canonicalPath: string;
  readonly fingerprint: string;
}
