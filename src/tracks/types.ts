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
