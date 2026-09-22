# Changelog

Changes are recorded through release pull requests.

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
