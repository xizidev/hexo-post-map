import { parseGeoJson } from './geojson';
import { parseGpx } from './gpx';
import type { RawTrack, TrackSourceFile } from './types';

export function parseTrackSource(file: TrackSourceFile): RawTrack {
  return file.format === 'gpx' ? parseGpx(file.bytes) : parseGeoJson(file.bytes);
}
