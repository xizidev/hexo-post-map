import { SaxesParser } from 'saxes';

import { TrackBuildError } from './errors';
import type { RawTrack, RawTrackPoint } from './types';
import {
  coordinate,
  decodeUtf8,
  enforcePointLimit,
  invalidTrack,
  validateRawTrack,
} from './validation';

const gpxNamespace = 'http://www.topografix.com/GPX/1/1';
type Element = 'gpx' | 'trk' | 'trkseg' | 'trkpt' | 'ele' | 'time' | 'ignored';
type Point = {
  coordinate: RawTrackPoint['coordinate'];
  elevationMeters?: number;
  timeMilliseconds?: number;
};

function numericText(text: string | undefined, field: string): number {
  const value = text?.trim() ?? '';
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
    return invalidTrack(`invalid ${field}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return invalidTrack(`invalid ${field}`);
  return parsed;
}

function timestamp(text: string): number {
  const value = text.trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[tT](\d{2}):(\d{2}):(\d{2})(\.\d+)?([zZ]|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return invalidTrack('invalid GPX time');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 60
  ) {
    return invalidTrack('invalid GPX time');
  }
  if (zone!.length > 1 && (Number(zone!.slice(1, 3)) > 23 || Number(zone!.slice(4)) > 59)) {
    return invalidTrack('invalid GPX time');
  }
  // JavaScript timestamps do not represent leap seconds; map an insertion to the next instant.
  const milliseconds = Date.parse(
    second === 60 ? `${value.slice(0, 17)}59${value.slice(19)}` : value,
  );
  if (!Number.isFinite(milliseconds)) return invalidTrack('invalid GPX time');
  if (second === 60) {
    const instant = new Date(milliseconds);
    const followingDay = new Date(milliseconds + 86400000);
    if (
      instant.getUTCHours() !== 23 ||
      instant.getUTCMinutes() !== 59 ||
      followingDay.getUTCDate() !== 1
    ) {
      return invalidTrack('invalid GPX time');
    }
  }
  return milliseconds + (second === 60 ? 1000 : 0);
}

export function parseGpx(bytes: Uint8Array): RawTrack {
  const segments: RawTrackPoint[][] = [];
  const stack: Element[] = [];
  let segment: RawTrackPoint[] | undefined;
  let point: Point | undefined;
  let text = '';
  let count = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => invalidTrack('GPX DTD and entity declarations are forbidden'));
  parser.on('error', () => invalidTrack('malformed GPX XML'));
  parser.on('opentag', (tag) => {
    const parent = stack.at(-1);
    if (parent === 'ele' || parent === 'time') invalidTrack(`invalid GPX ${parent}`);
    let element: Element = 'ignored';
    if (stack.length === 0) {
      if (tag.local !== 'gpx' || tag.uri !== gpxNamespace)
        invalidTrack('expected a GPX 1.1 document');
      element = 'gpx';
    } else if (tag.uri === gpxNamespace) {
      if (parent === 'gpx' && tag.local === 'trk') element = 'trk';
      if (parent === 'trk' && tag.local === 'trkseg') {
        element = 'trkseg';
        segment = [];
      }
      if (parent === 'trkseg' && tag.local === 'trkpt') {
        element = 'trkpt';
        point = {
          coordinate: coordinate(
            numericText(tag.attributes.lon?.value, 'longitude'),
            numericText(tag.attributes.lat?.value, 'latitude'),
          ),
        };
      }
      if (parent === 'trkpt' && (tag.local === 'ele' || tag.local === 'time')) {
        element = tag.local;
        const key = element === 'ele' ? 'elevationMeters' : 'timeMilliseconds';
        if (point![key] !== undefined) invalidTrack(`duplicate GPX ${element}`);
        text = '';
      }
    }
    stack.push(element);
  });
  const appendText = (value: string) => {
    if (stack.at(-1) === 'ele' || stack.at(-1) === 'time') text += value;
  };
  parser.on('text', appendText);
  parser.on('cdata', appendText);
  parser.on('closetag', () => {
    switch (stack.pop()) {
      case 'ele':
        point!.elevationMeters = numericText(text, 'elevation');
        break;
      case 'time':
        point!.timeMilliseconds = timestamp(text);
        break;
      case 'trkpt':
        enforcePointLimit(++count);
        segment!.push(point!);
        point = undefined;
        break;
      case 'trkseg':
        if (segment!.length) segments.push(segment!);
        segment = undefined;
        break;
    }
  });
  try {
    parser.write(decodeUtf8(bytes)).close();
  } catch (error) {
    if (error instanceof TrackBuildError) throw error;
    return invalidTrack('malformed GPX XML');
  }
  return validateRawTrack(segments);
}
