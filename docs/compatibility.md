# Theme and PJAX compatibility

The plugin targets Hexo 7 and 8 on Node.js 20 or newer and themes that render `post.content`. Packed compatibility fixtures cover Landscape, NexT, and a minimal Cactus-style layout at both `/` and `/blog/`; they do not certify every theme customization. The overview uses the theme's `page` layout when available, or its standalone fallback. Theme navigation remains the site's responsibility.

## Loading and readable fallbacks

When `post_map.enabled: true`, every generated HTML page includes the provider-free `runtime.js`. An ordinary page with no map content loads no map UI resources or AMap resources. A page initially containing a map also includes static `style.css`, so its server-rendered place links or article list remain styled and usable without JavaScript.

The detail and overview feature IIFEs (`post-map.js` and `overview-map.js`) load only when their map roots are present. AMap remains lazy; detail maps wait until near the viewport. On an ordinary page that later receives map content through PJAX, the runtime loads the required same-origin feature script and stylesheet. Successful resource loads are shared across map roots and navigation within that document. Disabling JavaScript or failing to load resources preserves the readable fallback.

For a tracked detail, the hashed same-origin JSON is fetched only after the same near-viewport trigger. Its WGS84 coordinates are validated and then converted by the AMap detail adapter. If fetch, JSON validation, coordinate conversion, or track overlay creation fails, the card preserves its GCJ-02 place pins and schematic route; a full provider failure preserves the server-rendered place-link fallback. Playback never starts automatically. A reduced-motion preference disables continuous playback and restart but leaves native manual seeking available.

The overview never fetches, converts, embeds, or renders a recorded track. Its `posts.json` contract stays at version 1 and contains only each article's representative point plus the existing article fields. `overview-map.js` does not include track playback or conversion code. Point-only articles therefore retain the v0.4 detail and overview behavior.

Track statistics and place links are server-rendered and remain readable without JavaScript. Playback controls are hidden until a valid asset and provider map mount successfully. A display-only `playback: false` track exposes no playback controls. Track asset URLs follow the configured Hexo root, so both `/hexo-post-map/tracks/<hash>.json` and `/blog/hexo-post-map/tracks/<hash>.json` are supported by the packed matrix.

## Automatic navigation support

Conventional light-DOM PJAX replacement works automatically: the runtime observes content insertion and removal in the current document, initializes newly connected map roots, and cleans up removed maps. Destination scripts do not need to execute again. Keep the generated map root and its embedded JSON together when replacing content.

The automatic guarantee does not cover closed or unobserved shadow roots, another document (including an iframe's document), a suppressed runtime script, or nonstandard transitions. Document observation does not cross shadow boundaries. Attribute-only or application-specific transitions may need explicit lifecycle calls. If `MutationObserver` is unavailable, use manual integration. A runtime blocked or removed before it executes must first be restored; the API cannot initialize itself.

## Public lifecycle API

The public browser API is `window.HexoPostMap` with `apiVersion: 1`. After the runtime has loaded and the new content is connected, pass its container:

```js
if (window.HexoPostMap?.apiVersion === 1) {
  window.HexoPostMap.refresh(container);
}
```

Here `container` is an element already inserted into the current document. Calling `refresh()` without an argument scans `document`. Repeated calls do not duplicate an unchanged active map. A detached fragment does not initialize maps until they are connected.

Before removing a container, callers may optionally call `window.HexoPostMap.destroy(container)` under the same version guard. Conventional PJAX removal is cleaned up automatically. `destroy()` releases map instances and associated work without removing the server-rendered fallback or unloading shared scripts; it is cleanup, not a permanent opt-out from future initialization.

Both methods accept the current `document`, an `Element`, or a `DocumentFragment` owned by that document, and default to `document` when omitted. Invalid scopes, including `null`, selector strings, and nodes from another document, throw `TypeError`. Both methods return `undefined` immediately; neither provides a promise or waits for AMap loading or initialization to finish. For a reachable shadow root, explicitly refresh its connected content and manage cleanup; this does not extend automatic observation into that root.

Internal registration bridges, feature modules, selectors, and provider adapters are not extension APIs. If another script already owns `window.HexoPostMap`, the plugin does not overwrite it; coordinate that name with the theme and retain the version guard.

## Failure and retry boundaries

After a local feature bundle or stylesheet load failure, correct the resource or CSP problem and call `refresh(container)` to retry. Automatic DOM observation does not repeatedly retry failed local resources. After an AMap SDK load timeout, a full page reload is still required; `refresh` does not reset the SDK loader's timeout state. The place links or article list remain available during failures.

The lifecycle API does not remove AMap coexistence or CSP requirements. See [security, CSP, and privacy](security.md) for SDK conflicts and dynamically loaded resources, and [configuration](configuration.md) for asset routes and site-root handling.
