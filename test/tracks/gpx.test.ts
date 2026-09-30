import { describe, expect, it } from 'vitest';

import { TrackBuildError } from '../../src/tracks/errors';
import { parseGpx } from '../../src/tracks/gpx';

const namespace = 'http://www.topografix.com/GPX/1/1';
const document = (body: string) =>
  Buffer.from(`<gpx xmlns="${namespace}" version="1.1">${body}</gpx>`);
const segment = (points: string) => document(`<trk><trkseg>${points}</trkseg></trk>`);
const point = (lon = '118', lat = '32', children = '') =>
  `<trkpt lon="${lon}" lat="${lat}">${children}</trkpt>`;

describe('parseGpx', () => {
  it('preserves track and segment order, discarding empty segments', () => {
    expect(
      parseGpx(
        document(`<trk><trkseg/>${`<trkseg>${point()}${point('119')}</trkseg>`}</trk>
        <trk><trkseg>${point('-180', '-90')}${point('180', '90')}</trkseg></trk>`),
      ),
    ).toEqual([
      [{ coordinate: [118, 32] }, { coordinate: [119, 32] }],
      [{ coordinate: [-180, -90] }, { coordinate: [180, 90] }],
    ]);
  });

  it('reads prefixed namespaces, UTF-8 and optional elevation/time without copying metadata', () => {
    const bytes = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
      <g:gpx xmlns:g="${namespace}" version="1.1">
        <g:metadata><g:name>南京 &amp; 山路</g:name></g:metadata>
        <g:trk><g:trkseg>
          <g:trkpt lon="118.5" lat="32.5"><g:ele>-1.5</g:ele><g:time>2026-09-29T08:00:00+08:00</g:time></g:trkpt>
          <g:trkpt lon="119" lat="33"><g:ele>1e2</g:ele><g:time>2026-09-29T00:00:01.125Z</g:time></g:trkpt>
        </g:trkseg></g:trk>
      </g:gpx>`);
    expect(parseGpx(bytes)).toEqual([
      [
        { coordinate: [118.5, 32.5], elevationMeters: -1.5, timeMilliseconds: 1790640000000 },
        { coordinate: [119, 33], elevationMeters: 100, timeMilliseconds: 1790640001125 },
      ],
    ]);
  });

  it('ignores routes, waypoints, extensions, and foreign namespace lookalikes', () => {
    const ignored = `<trk><trkseg>${point('999')}</trkseg></trk>`;
    expect(
      parseGpx(
        document(`<metadata>${ignored}</metadata><extensions>${ignored}</extensions>
      <wpt lat="invalid"/><rte><rtept lat="invalid"/></rte>
      <trk xmlns="urn:foreign"><trkseg>${point('999')}</trkseg></trk>
      <trk><trkseg>${point('118', '32', `<extensions><ele>invalid</ele>${ignored}</extensions>`)}${point('119')}</trkseg></trk>`),
      ),
    ).toEqual([[{ coordinate: [118, 32] }, { coordinate: [119, 32] }]]);
  });

  it.each([
    '<trkpt lat="32"/>',
    '<trkpt lon="118"/>',
    point('', '32'),
    point('0x10'),
    point('Infinity'),
    point('NaN'),
    point('118oops'),
    point('180.1'),
    point('-180.1'),
    point('118', '90.1'),
    point('118', '-90.1'),
    point('118', '32', '<ele/>'),
    point('118', '32', '<ele>NaN</ele>'),
    point('118', '32', '<ele>1e999</ele>'),
    point('118', '32', '<ele><other>1</other></ele>'),
    point('118', '32', '<ele>1</ele><ele>2</ele>'),
  ])('rejects malformed present point data: %s', (badPoint) => {
    expect(() => parseGpx(segment(`${badPoint}${point('119')}`))).toThrow(TrackBuildError);
  });

  it.each([
    '',
    'not-a-time-PRIVATE',
    '2026-09-29',
    '2026-09-29T00:00:00',
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-09-29T24:00:00Z',
    '2026-09-29T00:60:00Z',
    '2026-09-29T00:00:61Z',
    '2026-09-29T00:00:00+24:00',
  ])('rejects malformed timestamps without echoing the raw value: %j', (time) => {
    const parse = () =>
      parseGpx(segment(`${point('118', '32', `<time>${time}</time>`)}${point('119')}`));
    expect(parse).toThrow(/time/);
    if (time) expect(parse).not.toThrow(time);
  });

  it.each([
    '<?xml version="1.0"?><!DOCTYPE gpx SYSTEM "https://example.com/private.dtd"><gpx/>',
    '<!DOCTYPE gpx [<!ENTITY secret SYSTEM "file:///etc/passwd">]><gpx>&secret;</gpx>',
    '<!DOCTYPE gpx [<!ENTITY a "ha"><!ENTITY b "&a;&a;">]><gpx>&b;</gpx>',
    '<!ENTITY secret "private">',
    '<gpx><PRIVATE_CONTENT',
    '<gpx xmlns="urn:foreign"><trk><trkseg><trkpt lon="1" lat="2"/><trkpt lon="2" lat="3"/></trkseg></trk></gpx>',
  ])('rejects unsafe or malformed XML with controlled diagnostics', (xml) => {
    const parse = () => parseGpx(Buffer.from(xml));
    expect(parse).toThrow(TrackBuildError);
    expect(parse).not.toThrow(/PRIVATE_CONTENT|passwd|example\.com|secret/);
  });

  it.each([
    document(''),
    segment(point()),
    segment(`${point()}${point()}`),
    document(`<trk><trkseg>${point()}</trkseg><trkseg>${point('119')}</trkseg></trk>`),
  ])('requires two spatially distinct points within one segment', (bytes) => {
    expect(() => parseGpx(bytes)).toThrow(/distinct/);
  });

  it('accepts exactly 200,000 points and rejects the next point before parsing later XML', () => {
    const points = '<trkpt lon="1" lat="2"/>'.repeat(199999) + '<trkpt lon="2" lat="3"/>';
    expect(parseGpx(segment(points))[0]).toHaveLength(200000);
    const bytes = Buffer.from(
      `<gpx xmlns="${namespace}"><trk><trkseg>${points}<trkpt lon="3" lat="4"/><BROKEN`,
    );
    expect(() => parseGpx(bytes)).toThrow(/200,000/);
  });

  it('accepts RFC 3339 leap seconds and preserves partially present optional data', () => {
    expect(
      parseGpx(
        segment(`${point('118', '32', '<time>2016-12-31T23:59:60Z</time>')}${point('119')}`),
      ),
    ).toEqual([
      [{ coordinate: [118, 32], timeMilliseconds: 1483228800000 }, { coordinate: [119, 32] }],
    ]);
  });

  it('rejects invalid UTF-8', () => {
    expect(() => parseGpx(Buffer.from([0xff]))).toThrow(/UTF-8/);
  });
});
