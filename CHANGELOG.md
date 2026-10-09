# Changelog

Changes are recorded through release pull requests.

## [0.6.0](https://github.com/xizidev/hexo-post-map/compare/v0.5.0...v0.6.0) (2026-10-09)


### Features

* add overview restoration, sharing and random exploration ([#24](https://github.com/xizidev/hexo-post-map/issues/24)) ([1c159f2](https://github.com/xizidev/hexo-post-map/commit/1c159f23c22b531d10c17397e67aaeee37c75aab))

## [0.5.0](https://github.com/xizidev/hexo-post-map/compare/v0.4.0...v0.5.0) (2026-10-08)


### Features

* compile privacy-safe track assets ([97e7a55](https://github.com/xizidev/hexo-post-map/commit/97e7a55cd610b18a239f8e8f0d1b5f203f9467d8))
* finish accessible track playback experience ([4ba6e42](https://github.com/xizidev/hexo-post-map/commit/4ba6e42a1c24b98861793564eb5a61d3e8790b5f))
* load and control article track playback ([1345563](https://github.com/xizidev/hexo-post-map/commit/13455634bd4a88226441667a1c11b1073b6f5e08))
* publish hashed article track assets ([6f343a1](https://github.com/xizidev/hexo-post-map/commit/6f343a1f2941b6d5db70399e721f7d99869d652e))
* render recorded tracks with amap ([67622ae](https://github.com/xizidev/hexo-post-map/commit/67622ae116c4ca1a1bf14defe2c00ea7c3cefe8f))
* securely parse local track files ([8772b69](https://github.com/xizidev/hexo-post-map/commit/8772b6907c4eae9e6c2890f94e53ae1fe15002fd))
* validate recorded track front matter ([dcc3863](https://github.com/xizidev/hexo-post-map/commit/dcc3863949b3d14027e72276936f359cdce355c7))


### Bug Fixes

* block raw track assets before Hexo route updates ([a35c8bd](https://github.com/xizidev/hexo-post-map/commit/a35c8bdcd01baf785a4ea8ce3da2878d8781f0c5))
* fence track reads against filesystem races ([909a663](https://github.com/xizidev/hexo-post-map/commit/909a663ee1b216355c7442e2d03ec715b1dd7c1e))
* isolate and validate amap track rendering ([0362935](https://github.com/xizidev/hexo-post-map/commit/03629351d895f296bda0ad4015a221987855df37))
* preserve track display mode and failure state ([06130ad](https://github.com/xizidev/hexo-post-map/commit/06130ad284797cc41508dfa1074a34280a82c989))
* preserve track privacy and generation consistency ([813953a](https://github.com/xizidev/hexo-post-map/commit/813953ae33049be6e91b952bea9eac1c706aa867))
* trim tracks across the antimeridian ([77e4ce1](https://github.com/xizidev/hexo-post-map/commit/77e4ce1b1f2dc337e590fb4a1c420ba0d89ddd6f))
* trust compiled tracks and refresh cached post maps ([85e97f0](https://github.com/xizidev/hexo-post-map/commit/85e97f066a2f43a8e505768d9afd2a35e18fa230))

## [0.4.0](https://github.com/xizidev/hexo-post-map/compare/v0.3.0...v0.4.0) (2026-09-29)


### Features

* add lazy browser feature loader ([b1d3961](https://github.com/xizidev/hexo-post-map/commit/b1d3961e67b5a137d49c839c62849121b0a72bac))
* add PJAX map lifecycle runtime ([29590f6](https://github.com/xizidev/hexo-post-map/commit/29590f647a7ce274dedaab5f576480b1c486327b))
* publish lightweight map runtime ([95e38c5](https://github.com/xizidev/hexo-post-map/commit/95e38c5b1506ea2397d05a04e54fbdcab8ab9e63))
* register maps with browser runtime ([e907c68](https://github.com/xizidev/hexo-post-map/commit/e907c68a2718d190605456c03180702594005386))
* support PJAX map lifecycle runtime ([624a48f](https://github.com/xizidev/hexo-post-map/commit/624a48fee338df590648befc1d20717094449747))


### Bug Fixes

* adopt loaded duplicate browser stylesheet ([8813402](https://github.com/xizidev/hexo-post-map/commit/8813402c50a9bc4e5062e73676c93a35425ddb12))
* anchor runtime build guard to project root ([104d4d7](https://github.com/xizidev/hexo-post-map/commit/104d4d76784dbbd076e367f06c96fdd1936cdcc3))
* cancel pending map hydration on scoped destroy ([4990789](https://github.com/xizidev/hexo-post-map/commit/4990789f57551b4e5280c63ade094cfbcc730539))
* verify applied styles before map hydration ([5fdb65f](https://github.com/xizidev/hexo-post-map/commit/5fdb65fb9fffdbb8810708dd6cc58ddfa94d4803))

## [0.3.0](https://github.com/xizidev/hexo-post-map/compare/v0.2.3...v0.3.0) (2026-09-24)


### Features

* support configurable AMap styles ([cd42331](https://github.com/xizidev/hexo-post-map/commit/cd42331b5f121367aa33e16112dca9b7592d2ed8))
* support configurable AMap styles ([d94d3b3](https://github.com/xizidev/hexo-post-map/commit/d94d3b3eb7257389d077071dc9ac9ba311693d54))

## [0.2.3](https://github.com/xizidev/hexo-post-map/compare/v0.2.2...v0.2.3) (2026-09-22)


### Bug Fixes

* support Live Photo images and improve overview performance ([420864a](https://github.com/xizidev/hexo-post-map/commit/420864a1795d483c619ee202a03177ba399b5b1e))
* support Live Photo representative images ([f3e8c22](https://github.com/xizidev/hexo-post-map/commit/f3e8c22f802af8a36e03e8611772e8fba51e8203))


### Performance Improvements

* lazy load overview article images ([47bcb64](https://github.com/xizidev/hexo-post-map/commit/47bcb64b01eb24329d50b333eb2e2107b7b1e3f0))

## [0.2.2](https://github.com/xizidev/hexo-post-map/compare/v0.2.1...v0.2.2) (2026-09-22)


### Bug Fixes

* support npm 12 pack JSON output ([2db4989](https://github.com/xizidev/hexo-post-map/commit/2db4989bcd03fe020473b1de962cd7474f85672f))
* support npm 12 pack JSON output ([3cc3915](https://github.com/xizidev/hexo-post-map/commit/3cc3915682b27f189203657e70d7ea7af8157117))

## [0.2.1](https://github.com/xizidev/hexo-post-map/compare/v0.2.0...v0.2.1) (2026-09-21)


### Bug Fixes

* normalize lockfile registry URLs ([25079d2](https://github.com/xizidev/hexo-post-map/commit/25079d2b483c3aaa3cb2c454c68807c4f1d0232a))
* use official registry for release installs ([799c912](https://github.com/xizidev/hexo-post-map/commit/799c912601d971586a2852f8235c8d0f26efc0a0))
* use official registry for release installs ([dbd4589](https://github.com/xizidev/hexo-post-map/commit/dbd4589ff232a31b9284829de87bd0e83354d99a))

## [0.2.0](https://github.com/xizidev/hexo-post-map/compare/v0.1.0...v0.2.0) (2026-09-21)


### Features

* activate maps automatically ([0692311](https://github.com/xizidev/hexo-post-map/commit/06923114be22c17f2debd6d53a8f656804739f3f))
* add bounded glass article panel ([87be30d](https://github.com/xizidev/hexo-post-map/commit/87be30dd4702b9f494d0c0810ef066f1f004fbb3))
* anchor compact overview markers ([52fa47e](https://github.com/xizidev/hexo-post-map/commit/52fa47e3a2e894f3984be9f3934c7e6884881cc2))
* improve map presentation and detail place tooltips ([fd0fd84](https://github.com/xizidev/hexo-post-map/commit/fd0fd845a5ac3a89197478c90c9bd3668d0bee7e))
* show detail place tooltips ([0aee73d](https://github.com/xizidev/hexo-post-map/commit/0aee73dfba1696b5c5ee8e16694a01441902f075))
* simplify detail maps to route pins ([1366bf6](https://github.com/xizidev/hexo-post-map/commit/1366bf6a5d596c3ef7f9995ab70adabe7f735ed5))


### Bug Fixes

* **amap:** preserve articles collapsed at identical coordinates ([5a98460](https://github.com/xizidev/hexo-post-map/commit/5a98460c4e17eb4ccd77f4398a70285bd44d5551))
* anchor all-posts control to map top right ([5941cd3](https://github.com/xizidev/hexo-post-map/commit/5941cd335588af059eea7ebba4fb560e988a240a))
* **detail:** keep rotated route pins inside fitted map bounds ([300b2b8](https://github.com/xizidev/hexo-post-map/commit/300b2b8c7dc0a79a59b296fab37a4d9d8bd96988))
* improve map metadata contrast ([b60fc32](https://github.com/xizidev/hexo-post-map/commit/b60fc32503f52dc882b6b7d8bc1817b2b291e3e5))
* keep detail tooltips visible ([37311cf](https://github.com/xizidev/hexo-post-map/commit/37311cfce48c05243c46a1189d10adf33212e484))
* keep overview markers anchored responsively ([79b56ab](https://github.com/xizidev/hexo-post-map/commit/79b56ab7507819d32ca59235d6b98917ba2f0851))
* make detail tooltips fully operable ([7e7a179](https://github.com/xizidev/hexo-post-map/commit/7e7a1799af1634fe33cafc037f7e7721757c18f7))
* make loaded detail maps keyboard reachable ([d4c2589](https://github.com/xizidev/hexo-post-map/commit/d4c2589f917ffeeb47d4d95208c7ae054d627a42))
* **maps:** preserve route visits and fitted marker geometry ([bd9329f](https://github.com/xizidev/hexo-post-map/commit/bd9329f24145a1c5853fb602a5b3fe3679d602e1))
* normalize map cards and location pins ([f1acd3e](https://github.com/xizidev/hexo-post-map/commit/f1acd3e37294605f7f1f384144aded3104468066))
* scale article cards with text ([111dd4f](https://github.com/xizidev/hexo-post-map/commit/111dd4f60bd7ac613daf6e617de9efd965297d16))
* separate tooltip scrolling from visible arrow shell ([56e6cc8](https://github.com/xizidev/hexo-post-map/commit/56e6cc8d631ac193e88c08d6076e096a962bebfa))

## [0.1.0](https://github.com/xizidev/hexo-post-map/releases/tag/v0.1.0) (2026-09-18)

- Strict opt-in site configuration and GCJ-02 post metadata.
- Compact detail maps for single points, multiple points, and schematic itineraries.
- Overview map with representative images, automatic pixel clustering, and overlap article lists.
- Readable fallbacks, safe rendering, and theme-independent assets.
- Packed-artifact compatibility checks and deterministic desktop/mobile browser tests.
- English and Chinese usage documentation, security guidance, and contribution policies.
