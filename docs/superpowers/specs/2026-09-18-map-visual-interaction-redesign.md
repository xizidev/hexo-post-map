# Map Visual and Interaction Redesign

Date: 2026-09-18

## 1. Summary

This redesign gives `hexo-post-map` a compact, theme-compatible visual system for map markers, article panels, the all-posts control, and detail-map points. It replaces oversized cluster circles, coordinate-obscuring image markers, plain article lists, and interactive detail labels with precise markers and one reusable article panel.

AMap remains responsible for maps, coordinates, viewport fitting, polylines, and clustering. The plugin owns all marker and panel DOM, styling, accessibility, and navigation. The design must remain suitable for a public npm package and cannot depend on the first consumer blog's theme markup.

## 2. Goals

- Keep the exact coordinate visible while still showing a representative article image on overview maps.
- Make clusters compact, visually calm, and distinguishable at every supported zoom level.
- Present one or many articles through the same polished, bounded panel.
- Keep large article collections usable without expanding the page vertically.
- Reduce detail maps to precise point markers and optional schematic route lines.
- Preserve keyboard access, failure fallbacks, responsive behavior, and reduced-motion support.
- Expose stable CSS custom properties so themes can adapt the plugin without replacing its structure.

## 3. Non-goals

- Geographic label collision solving across all third-party map labels.
- Route planning, road snapping, or navigation.
- A theme-specific skin for Cactus or any other Hexo theme.
- Manual semantic grouping through `place_id`.
- A new public JavaScript extension API.
- Changing the Front Matter or `_config.yml` contracts.

## 4. Chosen Approach

The plugin will render semantic DOM for three marker types and one shared article panel. AMap adapters will place those elements and report cluster events, but no UI will rely on AMap's undocumented internal markup.

Rejected alternatives:

- AMap `InfoWindow` and default markers do not provide consistent responsive layout, styling, or accessibility.
- Per-theme adapters would make the public package fragile and turn every theme into a separate maintenance target.
- Long map polylines for every thumbnail would add overlay cost and visual noise. The overview image marker instead owns a short stem and coordinate dot inside its DOM.

## 5. Overview Marker System

### 5.1 Cluster markers

Clusters remain driven by screen distance and zoom. No place registry or coordinate jitter is introduced.

Cluster diameter is based on the number of represented posts:

- 2-9 posts: 34px
- 10-99 posts: 38px
- 100 or more posts: 42px

Every cluster uses a low-saturation teal surface, a translucent border, a small shadow, and a high-contrast count. The default palette must work on light and dark maps and must be replaceable through plugin CSS custom properties. A cluster remains a real button with an accessible name containing its article count.

Activating a separable cluster zooms to its bounds. A cluster at maximum zoom, or posts sharing an identical coordinate, opens the shared article panel.

### 5.2 Article image markers

A leaf article marker uses a 72x54px representative-image card on desktop and a 64x48px card on small screens. The card sits above the coordinate rather than on top of it.

The marker is one DOM unit containing:

1. a rounded image card;
2. a short vertical stem;
3. an 8px coordinate dot.

The AMap offset anchors the center of the coordinate dot to the article coordinate. The stem is intentionally short and does not attempt cross-marker collision routing. Clustering controls density before leaf markers are shown.

The image card has a restrained border and shadow. Hover and keyboard focus may raise the card by at most 2px and slightly strengthen the shadow. Reduced-motion mode removes this transition. The coordinate dot remains stationary during the effect.

Activating an image marker opens the shared panel with that article. The article card inside the panel, including its image, navigates to the post.

## 6. Shared Article Panel

Every article collection uses one implementation:

- a single article selected from an image marker;
- an inseparable or maximum-zoom cluster;
- the all-articles control.

### 6.1 Desktop layout

The panel is positioned inside the overview map on the right. It is approximately 320px wide, keeps a map-edge gap, and never exceeds 70% of the map height. Its article region scrolls independently.

The surface uses a translucent theme-aware background, `backdrop-filter` blur where supported, a subtle border, rounded corners, and a soft shadow. Browsers without backdrop filtering receive an opaque fallback with equivalent contrast.

The header remains visible while the list scrolls. It contains a concise article count and a small circular close icon in the upper-right corner. The icon is visually an `×`, while its accessible name remains `关闭文章面板`.

### 6.2 Mobile layout

At 600px and below, the same panel becomes a bottom drawer. It spans the viewport width, respects safe-area insets, and has a maximum height of 65dvh. Only the article region scrolls; the header and close control remain visible.

The panel remains non-modal so the chronological fallback and surrounding page are not made inaccessible. `Escape` closes it. Closing restores focus to the current equivalent marker or the all-articles control, falling back to the map canvas if the originating cluster no longer exists after a redraw.

### 6.3 Article cards

Each article is a rounded card with:

- a fixed-aspect-ratio thumbnail;
- title;
- publication date;
- representative location name.

The entire card is one link to the post, rather than separate image and title links. Cards use a compact grid layout, visible hover and focus states, safe text wrapping, and lazy-loaded images. Failed images continue to use the packaged placeholder.

## 7. All-articles Control

The overview map receives a top-right pill control labeled `全部文章 N`, where `N` is the number of geotagged posts. It is inside the map control layer rather than below the map.

Activating it opens the shared article panel with all posts sorted newest first. The control exposes `aria-expanded` and `aria-controls`; activating it again while its panel is open closes the panel. The panel has a fixed outer size and an independently scrollable article region, so hundreds of posts do not grow the page.

The generated no-JavaScript fallback list remains in document order and readable. Once the map is successfully enhanced, it becomes visually hidden rather than being used as the interactive panel.

## 8. Detail Map

Detail maps no longer display text labels inside markers.

- A one-point post shows one compact location-pin icon.
- A multi-point post shows compact numbered pins so route order remains understandable.
- Points excluded from `route` use an unnumbered pin.
- A configured `route` continues to draw one schematic polyline through point IDs in declared order.
- No road routing, travel mode, animation, or inferred connection is added.

Detail markers are visual map annotations, not buttons. They do not open an `InfoWindow`, place card, or `在高德地图中查看` action. Point names remain available to assistive technology and in the failure/no-JavaScript fallback without appearing over the working map.

The map keeps automatic near-viewport loading and immediate pan/zoom interaction. Normal loading and success messages remain hidden.

## 9. Component Boundaries

The browser code will use these focused responsibilities:

- `providers/amap.ts`: AMap lifecycle, coordinates, offsets, clustering, bounds, detail markers, and detail polylines.
- `overview/markers.ts`: semantic DOM factories for cluster and image-anchor markers.
- `overview/panel.ts`: the reusable panel, header, close control, scroll region, and article cards.
- `overview/index.ts`: overview data loading, panel selection state, all-articles control, failure handling, and lifecycle cleanup.
- `detail/index.ts`: detail loading, fallback state, and lifecycle cleanup.
- `styles/index.css`: component styling and public CSS custom-property defaults.

Marker factories receive data and callbacks but do not import AMap. The provider receives marker elements and owns their map placement. The panel receives sorted posts and a focus origin but knows nothing about map SDK objects.

## 10. Theme Contract

The plugin will define documented custom properties on its roots. The initial set covers:

- accent and accent-contrast colors;
- cluster surface and border;
- panel and card surfaces;
- primary and muted text;
- border and shadow colors;
- panel and card radii.

Defaults use theme-aware neutral surfaces and a low-saturation teal accent. A theme may override variables on `.hpm-detail` or `.hpm-overview`; it must not need to replace internal selectors. High-contrast and forced-colors modes retain visible boundaries and native focus indicators.

## 11. Failure and Fallback Behavior

- SDK, data, or map-initialization failure reveals the existing readable fallback and a concise error.
- Successful enhancement has no loading, success, or activation message.
- Image failure replaces only that image with the packaged placeholder.
- Missing safe post URLs render non-interactive article content rather than unsafe links.
- A late provider error destroys the affected map UI and restores the fallback.
- No credentials, raw provider errors, or unsafe HTML appear in user-visible messages.

## 12. Accessibility

- Cluster, image-marker, all-articles, close, and article-card controls are keyboard reachable.
- Focus indicators meet contrast requirements and are not clipped by marker containers.
- Icon-only controls have explicit accessible names.
- Panel focus is moved to the close button on open and restored on close.
- The panel has an appropriate non-modal dialog label including its article count.
- Detail point names remain programmatically available without visible marker text.
- Reduced-motion mode disables decorative transforms and panel transitions.
- Touch targets for interactive controls remain at least 44x44px even when their visible artwork is smaller.

## 13. Testing

Unit tests cover:

- marker DOM, sizes, accessible names, and count-size classes;
- image marker anchor structure and safe image fallback;
- panel header, one-link article cards, sorting, scrolling hooks, close behavior, and focus restoration;
- detail markers without buttons or `InfoWindow` creation;
- route numbering and polyline order;
- cleanup across redraw, failure, abort, and back-forward cache lifecycles.

Browser tests cover desktop and mobile layouts, keyboard use, reduced motion, long lists, identical coordinates, cluster zoom, image failure, SDK failure, and responsive panel placement.

Real-blog acceptance verifies both the detail and overview pages with the actual Cactus theme. Screenshots must demonstrate:

- smaller teal clusters;
- anchored thumbnail markers that leave the coordinate visible;
- the glass article panel and scrolling card list;
- the in-map `全部文章 N` control;
- icon-only detail pins and a multi-point route.

## 14. Acceptance Criteria

The redesign is complete when:

1. no overview thumbnail is centered directly over its coordinate;
2. every leaf thumbnail visibly terminates at a coordinate dot;
3. clusters never use the former fixed 48px blue circle;
4. every article selection path uses the same bounded panel and article card;
5. the all-articles list cannot increase page height regardless of post count;
6. detail markers contain no visible place text and open no provider popup;
7. route posts retain ordered schematic lines and numbered points;
8. desktop, mobile, keyboard, failure, and real-blog checks pass;
9. the package remains theme-independent and introduces no public configuration migration.
