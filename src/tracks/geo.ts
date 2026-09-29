import type { RawTrackPoint } from './types';

export const earthRadiusMeters = 6371008.8;
export const radiansPerDegree = Math.PI / 180;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function haversineMeters(
  a: RawTrackPoint['coordinate'],
  b: RawTrackPoint['coordinate'],
): number {
  const latitudeDelta = (b[1] - a[1]) * radiansPerDegree;
  const longitudeDelta = (b[0] - a[0]) * radiansPerDegree;
  const halfChord =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(a[1] * radiansPerDegree) *
      Math.cos(b[1] * radiansPerDegree) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(clamp(halfChord, 0, 1)));
}

export function interpolatePoint(
  a: RawTrackPoint,
  b: RawTrackPoint,
  fraction: number,
): RawTrackPoint {
  const ratio = clamp(fraction, 0, 1);
  const mix = (left: number, right: number) => left * (1 - ratio) + right * ratio;
  return {
    coordinate: [mix(a.coordinate[0], b.coordinate[0]), mix(a.coordinate[1], b.coordinate[1])],
    ...(a.elevationMeters !== undefined && b.elevationMeters !== undefined
      ? { elevationMeters: mix(a.elevationMeters, b.elevationMeters) }
      : {}),
    ...(a.timeMilliseconds !== undefined && b.timeMilliseconds !== undefined
      ? { timeMilliseconds: mix(a.timeMilliseconds, b.timeMilliseconds) }
      : {}),
  };
}
