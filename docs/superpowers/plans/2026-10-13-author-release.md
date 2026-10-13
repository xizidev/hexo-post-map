# Local Map Authoring Release Plan

> **For agentic workers:** Use superpowers:executing-plans for this already-authorized release workflow. Independent documentation work and read-only review may run in parallel; builds, packaging and repository audits remain serial.

**Goal:** Publish the locally accepted map authoring tool as 0.7.0 with complete usage documentation and verified npm provenance.

**Architecture:** Preserve the implemented author/reader boundary and existing GitHub Release Please/OIDC pipeline. Merge the reviewed implementation through a pull request, then let Release Please prepare release metadata. Publish only the exact artifact accepted by the release workflow.

**Tech Stack:** TypeScript, Hexo 7/8, AMap JS API, Vitest, Chromium, GitHub Actions, npm trusted publishing.

**Spec:** [release guide](../../releases.md), [accepted author design](../specs/2026-10-09-map-authoring-design.md), and the user's 2026-10-13 instruction to update documentation and publish after testing.

## Global Constraints

- Preserve Node >=20 and Hexo >=7 <9 support; require CI Node 20/22/24.
- No new feature development, manual version/manifest bump, publishing token, permission change, branch-protection bypass or force-push.
- Preserve existing user modifications and all active local previews; never reload the user's existing draft.
- Do not modify real blog dependencies, keys, configuration or articles; no OSS upload.
- Never include real keys, authorization fragments or private logs in commits, reports, screenshots or release notes.

## Review Focus

- Package author resources must not become generated public resources.
- Draft feedback must not weaken immediate stale-export or explicit candidate-confirmation guards.
- A successful local test cannot substitute for missing or failed required CI.
- A published GitHub Release is not yet proof of successful npm publication.
- Documentation must explain page-memory drafts separately from the process-lifetime configuration credential.

## Task 1: Publication-ready documentation and implementation commit

- [ ] Update both READMEs, configuration, security, compatibility and release guidance for 0.7.0+ usage, preserving configuration and schema contracts.
- [ ] Run formatting, lint/type/build/unit checks and inspect the explicit changed-file scope.
- [ ] Seal a tarball, verify its inventory and unchanged reader assets, then run packed matrix, Chromium and audited real-blog-copy smoke serially.
- [ ] Commit only reviewed implementation/tests/docs paths, keeping package/manifest at 0.6.1.

## Task 2: Reviewed integration and release metadata

- [ ] Push the feature branch normally, create/attach an implementation PR against verified `main`, and wait for all eleven required CI checks.
- [ ] Merge with the exact reviewed head SHA and a Conventional Commit feature title; do not weaken repository protections.
- [ ] Inspect the resulting Release Please PR for 0.7.0 package/lock/manifest/changelog consistency; attach it and wait for required CI.
- [ ] Merge only the reviewed release PR and verify the published `v0.7.0` GitHub Release references its merged commit.

## Task 3: Publication verification and handoff

- [ ] Observe the tag publication workflow; if environment protection, login or 2FA requires the maintainer, report the exact action without bypassing it.
- [ ] Verify npm 0.7.0 and `latest`, artifact integrity and provenance against the successful release workflow.
- [ ] Test installing the registry version in a disposable Hexo site and verify the author command, without changing the real blog.
- [ ] Report the npm/GitHub release links, installation command and any remaining blocker; do not claim completion before registry verification.
