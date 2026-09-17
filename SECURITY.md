# Security policy

## Supported versions

The project is preparing its first release. Until then, reports against the current `main` branch are accepted. After releases begin, security fixes target the latest released minor line; users should keep its patch releases up to date. Runtime support is Node.js 20+ and Hexo 7/8. AMap and hosting services maintain their own security policies.

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting](https://github.com/xizidev/hexo-post-map/security/advisories/new) when available. Include affected versions, impact, safe reproduction steps, and a proposed mitigation if known. Do not include a real AMap credential, an unpublished location, or unrelated user data.

If private reporting is unavailable, open an issue titled “Private security contact requested” with no exploit details, credentials, or sensitive attachments; ask the maintainer for a private channel. Do not disclose a working exploit publicly before the maintainer has had a reasonable opportunity to investigate and coordinate a fix. There is currently no guaranteed response-time SLA.

Ordinary configuration and rendering issues belong in public Issues with sanitized examples. Coordinates, Web keys, and client-mode security codes are intentionally delivered to the browser; see [the deployment security guide](docs/security.md) before deciding what to publish.

中文：安全漏洞优先使用 GitHub 私密报告；若入口未开放，只公开请求私密联系方式，不公开漏洞细节。请勿附上真实凭据或敏感位置。
