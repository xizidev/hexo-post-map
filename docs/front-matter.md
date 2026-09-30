# Front Matter contract / 文章地理信息

Geographic metadata belongs in each Markdown post's YAML Front Matter. The copyable point and track examples are also available in [English](../README.md#write-posts) and [简体中文](../README.zh-CN.md#文章写法). They are one strict schema: `points` describes public places and the optional `track` references one local recording.

## Fields

| Field                                 | Requirement                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `map`                                 | Omit for no map. If present it must be an object; `null`, `false`, and an empty object are invalid                         |
| `map.points`                          | Non-empty list of point objects                                                                                            |
| `map.points[].id`                     | Unique within this post; lowercase ASCII letters/digits separated by single hyphens, matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `map.points[].name`                   | Non-empty string after trimming                                                                                            |
| `map.points[].longitude`              | Finite YAML number in `[-180, 180]`                                                                                        |
| `map.points[].latitude`               | Finite YAML number in `[-90, 90]`                                                                                          |
| `map.representative`                  | An existing point ID; required with multiple points, otherwise defaults to the only point                                  |
| `map.route`                           | Optional list of at least two existing point IDs, in travel order                                                          |
| `map.zoom`                            | Optional finite number, used only for a single-point detail map; use AMap's normal 2–20 range                              |
| `map.track`                           | Optional local recorded track; `map.points` remains required                                                               |
| `map.track.source`                    | Article-relative `.gpx`, `.geojson`, or GeoJSON `.json` path inside Hexo `source_dir`                                      |
| `map.track.privacy`                   | Optional object containing finite non-negative `trim_start_meters` and `trim_end_meters`; each defaults to `0`             |
| `map.track.simplify_tolerance_meters` | Optional finite minimum simplification tolerance in `[0, 10000]`; defaults to `5`                                          |
| `map.track.playback`                  | Optional boolean; defaults to `true`; false renders the full track without playback controls                               |

The public site settings `post.default_zoom` and `cluster.max_zoom` enforce `[2, 20]`; the Front Matter schema currently checks `map.zoom` for finiteness only, with the SDK determining usable zoom behavior. Multi-point cards fit all points instead.

Only these fields are accepted under `map` and each point. For example, `place_id`, `address`, and `map.points[].image` are not supported. Unrelated top-level Hexo metadata remains available as usual. Numeric strings such as `longitude: "121.4737"` are rejected. YAML indentation matters.

Point IDs are local references, not geographic identities: different posts may reuse `shanghai` and the same coordinates. Routes may revisit a point by repeating its ID. The displayed line connects listed coordinates directly and is not route planning. A point outside the route still appears on the detail card. The overview uses only `representative`, never every stop of the route.

Coordinates are interpreted as **GCJ-02** and preserved as given. No conversion, geocoding, random displacement, or precision reduction is performed. Validate coordinates yourself; use an approximate public place for sensitive locations. Detail HTML publishes every point, and the overview JSON publishes each representative location.

## Recorded tracks

`map.points` remains required and uses GCJ-02. `map.track` is optional; GPX and GeoJSON track coordinates are WGS84 and are converted only by the AMap detail adapter in the browser. The overview always uses the GCJ-02 representative point and never reads the track.

The track path resolves relative to the article source file. For `_posts/nanjing.md`, `./tracks/nanjing.gpx` means `_posts/tracks/nanjing.gpx`. Only local regular files contained by canonical Hexo `source_dir` are accepted. URL-like and absolute paths, traversal, unsupported suffixes, missing files, directories, and escaping symlinks fail generation.

### GPX with privacy trimming

```yaml test=post-map-track
title: Nanjing by train
map:
  representative: station
  points:
    - id: station
      name: 南京站
      longitude: 118.7977
      latitude: 32.0872
  track:
    source: ./tracks/nanjing.gpx
    privacy:
      trim_start_meters: 300
      trim_end_meters: 300
    simplify_tolerance_meters: 5
    playback: true
```

GPX input must use the GPX 1.1 namespace `http://www.topografix.com/GPX/1/1`. Track segments and points are read only from the `trk` > `trkseg` > `trkpt` hierarchy in that namespace. Route-only (`rte`/`rtept`), waypoint-only (`wpt`), and files using the GPX 1.0 namespace are not supported track inputs; because they yield no supported track segment, they fail with no usable track.

```xml test=track-source-gpx
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <trkseg>
      <trkpt lon="118.7900" lat="32.0800" />
      <trkpt lon="118.7910" lat="32.0810" />
    </trkseg>
  </trk>
</gpx>
```

### Display-only GeoJSON

```yaml test=post-map-track
title: Walking through Nanjing
map:
  representative: old-city
  points:
    - id: old-city
      name: 南京老城
      longitude: 118.7872
      latitude: 32.0415
  track:
    source: ./tracks/nanjing.geojson
    playback: false
```

A GeoJSON source may be a direct `LineString` or `MultiLineString` Geometry, or contain those line geometries in supported `Feature`, `FeatureCollection`, or `GeometryCollection` containers. The other standard geometries (`Point`, `MultiPoint`, `Polygon`, and `MultiPolygon`) are ignored rather than treated as tracks; if no usable line remains, the build fails. Every WGS84 position uses `[longitude, latitude, optional elevation]`; later dimensions and foreign properties are ignored.

```json test=track-source-geojson
{
  "type": "LineString",
  "coordinates": [
    [118.79, 32.08, 10],
    [118.791, 32.081, 14]
  ]
}
```

For either format, at least one segment must contain two distinct usable points in the same segment. Separate one-point segments, an empty track, or a line containing only repeated coordinates fails validation.

The maximum source size is 8 MiB, with at most 200,000 raw points and 2,000 published points. The fixed pipeline is secure read and parse → privacy trim → statistics → simplification → canonical JSON → SHA-256. Statistics use the trimmed unsimplified geometry. GPX duration appears only with complete monotonic timestamps; elevation gain appears only with complete elevation values. GeoJSON foreign properties, including timestamp arrays, are ignored.

Privacy trimming is not anonymization. It removes the requested travelled distance from each end before any published statistic or coordinate is derived, but the remaining shape and nearby landmarks may still identify a sensitive place. The build fails if trimming consumes all usable geometry.

The generated detail descriptor contains only a root-aware hashed URL, sanitized statistics, and the playback flag. The published JSON contains bounded coordinates and statistics, never the source filename/path, absolute timestamps, GPX metadata, GeoJSON properties, or pre-trim geometry. Hexo's ordinary asset generation is guarded so a referenced track is not also copied as a raw post asset.

## Images

`thumbnail` is a top-level Front Matter field, not part of `map`. Selection order is a safe `thumbnail`, the first safe rendered `<img src>` or `.live-photo[data-photo-src]` in document order, then the bundled placeholder. The Live Photo source is the still image shown on the map; video data is never embedded into overview data. Executable URL schemes are rejected. A broken selected image becomes the placeholder in the browser; it does not trigger another scan of the article. External HTTP(S) images and safe site-relative images are supported. Full article galleries are never embedded into the overview data.

## Build errors

An enabled plugin reports the source identifier Hexo supplies and the exact failing field. Example message for a route containing an unknown `summit-top` at its third entry:

```text
[hexo-post-map] _posts/trip.md: map.route[2]: point "summit-top" does not exist in map.points
```

For several points without a representative:

```text
[hexo-post-map] _posts/trip.md: map.representative: is required when map.points contains multiple points
```

For duplicate point IDs:

```text
[hexo-post-map] _posts/trip.md: map.points[1].id: point identifier must be unique within the post
```

The first validation failure is reported. Source paths can differ with your Hexo source directory. Correct the field, then regenerate. Disabling the plugin avoids map validation but also removes all map functionality.

中文要点：`points` 必填并使用 GCJ-02；`track` 可选，GPX/GeoJSON 使用 WGS84。轨迹文件相对文章解析且必须位于 `source_dir` 内，默认首尾裁剪 0 米、简化 5 米、允许播放；限制为 8 MiB、200,000 个原始点和 2,000 个发布点。隐私裁剪先于统计、简化和哈希，但不等于匿名化。详情发布全部地点与处理后的哈希轨迹，全国地图只使用代表点。
