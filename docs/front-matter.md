# Front Matter contract / 文章地理信息

Geographic metadata belongs in each Markdown post's YAML Front Matter. The four copyable examples are in [English](../README.md#write-posts) and [简体中文](../README.zh-CN.md#文章写法). They are one schema: omitted map, one point, several points, and several points plus a route.

## Fields

| Field                    | Requirement                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `map`                    | Omit for no map. If present it must be an object; `null`, `false`, and an empty object are invalid                         |
| `map.points`             | Non-empty list of point objects                                                                                            |
| `map.points[].id`        | Unique within this post; lowercase ASCII letters/digits separated by single hyphens, matching `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `map.points[].name`      | Non-empty string after trimming                                                                                            |
| `map.points[].longitude` | Finite YAML number in `[-180, 180]`                                                                                        |
| `map.points[].latitude`  | Finite YAML number in `[-90, 90]`                                                                                          |
| `map.representative`     | An existing point ID; required with multiple points, otherwise defaults to the only point                                  |
| `map.route`              | Optional list of at least two existing point IDs, in travel order                                                          |
| `map.zoom`               | Optional finite number, used only for a single-point detail map; use AMap's normal 2–20 range                              |

The public site settings `post.default_zoom` and `cluster.max_zoom` enforce `[2, 20]`; the Front Matter schema currently checks `map.zoom` for finiteness only, with the SDK determining usable zoom behavior. Multi-point cards fit all points instead.

Only these fields are accepted under `map` and each point. For example, `place_id`, `address`, and `map.points[].image` are not supported. Unrelated top-level Hexo metadata remains available as usual. Numeric strings such as `longitude: "121.4737"` are rejected. YAML indentation matters.

Point IDs are local references, not geographic identities: different posts may reuse `shanghai` and the same coordinates. Routes may revisit a point by repeating its ID. The displayed line connects listed coordinates directly and is not route planning. A point outside the route still appears on the detail card. The overview uses only `representative`, never every stop of the route.

Coordinates are interpreted as **GCJ-02** and preserved as given. No conversion, geocoding, random displacement, or precision reduction is performed. Validate coordinates yourself; use an approximate public place for sensitive locations. Detail HTML publishes every point, and the overview JSON publishes each representative location.

## Images

`thumbnail` is a top-level Front Matter field, not part of `map`. Selection order is a safe `thumbnail`, the first safe image `src` found in rendered HTML, then the bundled placeholder. Executable URL schemes are rejected. A broken selected image becomes the placeholder in the browser; it does not trigger another scan of the article. External HTTP(S) images and safe site-relative images are supported. Full article galleries are never embedded into the overview data.

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

中文要点：一个 schema、四种用法；多点必须指定代表点，路线只引用本文已有 ID。字段名和坐标类型严格校验，坐标不自动转换。详情发布全部地点，全国地图只使用代表点。
