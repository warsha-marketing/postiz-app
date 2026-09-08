# Video-only publishing

Set `VIDEO_ONLY_PUBLISHING=true` in the backend runtime environment to require MP4 videos for new scheduling and publishing. Unset it or set it to `false` to restore normal publishing. Only the exact string `true` enables the policy. The composer reads the effective setting from `GET /posts/publishing-policy`; there is no separate frontend build flag.

Each post, including each thread reply, must have at least one video attachment and no standalone image attachments. Captions remain in `value[].content`. Optional covers remain in `value[].image[].thumbnail` or the provider's existing cover settings (for example YouTube `settings.thumbnail`), subject to that provider's existing support and validation. A cover alone does not count as a video. MP4 and signed URL handling match the existing media DTO's supported video format; this is a publishing policy, not a new upload format or content-sniffing system.

Drafts may contain just a caption or images and may omit required publishing settings. Existing DTO shape and minimum-content requirements still apply. Scheduling/publishing and draft promotion enforce the policy. Moving a draft's date keeps it a draft. `type: update` validates all content of queued or recurring published posts, including their replies; ordinary published edits and draft edits remain available. New rows submitted as updates also require video.

Existing workflows, activities, provider implementations and database schema are unchanged. Enabling the flag does not scan, cancel or rewrite scheduled jobs; previously scheduled image/text posts and their repeats continue to execute. Explicitly rescheduling them or changing content through a publishing-bound update requires compliant media. Disabling the flag restores those operations too.

## Entry points

- Composer: `ManageModal` loads the setting with SWR, sends content to `POST /posts/valid`, and displays the shared backend policy error before scheduling/publishing. The caption editor, media library and cover controls remain available for drafts and video covers.
- Dashboard `POST /posts` and public `POST /public/v1/posts`: existing DTO/provider validation followed by the shared `PostsService.createPost` preflight. The entire batch is checked before any repository writes or workflow changes. Internal agent/autopost callers use this same service.
- Public `PUT /public/v1/posts/:id/status`: `changePostStatus` validates the stored thread before promotion to `QUEUE`.
- Dashboard `PUT /posts/:id/date`: `changeDate` validates an explicit non-draft reschedule. Date-only updates preserve state and jobs.
- `type: update`: root state and recurrence determine whether the whole thread will still publish; child row state alone is not sufficient.

## Docker

`docker-compose.yaml` passes `${VIDEO_ONLY_PUBLISHING:-false}` into the existing Postiz service. The local override's `HIDDEN_PROVIDERS` value is inherited unchanged.

The current Warsha local override pins an older upstream 2.23.0 image. That binary does **not** contain this feature. Merely setting the variable on it has no effect. `docker-compose.fork.yaml` is an opt-in final overlay that builds this source with the existing `Dockerfile.dev`. It retains the existing config/upload volumes and removes the old-image compiled provider backport mount; the fork's source already supports `HIDDEN_PROVIDERS`. It does not change the local override file, secrets, ports, databases or Temporal configuration.

Review/build later, from `warsha-marketing/postiz-app`:

```sh
docker compose --project-name warsha-postiz \
  --env-file ../local-runtime/postiz/.env \
  -f docker-compose.yaml \
  -f ../local-runtime/postiz/compose.override.yaml \
  -f docker-compose.fork.yaml config --quiet

# Build only; does not replace the running application.
docker compose --project-name warsha-postiz \
  --env-file ../local-runtime/postiz/.env \
  -f docker-compose.yaml \
  -f ../local-runtime/postiz/compose.override.yaml \
  -f docker-compose.fork.yaml build postiz
```

After a separately approved rollout of the fork image, put `VIDEO_ONLY_PUBLISHING=true` in `../local-runtime/postiz/.env`, or export it for the Compose invocation. Recreate only the app service using the same complete file order and `up -d --no-deps --no-build postiz`. To disable, set `false` (or remove it from both shell and env file) and recreate the app again. Refresh the composer. Keep the fork overlay in subsequent commands: the existing wrapper alone selects the pinned upstream image. Do not use `down -v`.

For other installations, use the fork image and the base Compose environment setting, preserving your existing overrides. The optional Warsha overlay assumes the base config/upload volumes and should be adapted if you have additional custom mounts.

## Automated checks

```sh
pnpm exec jest --config tests/publishing/jest.config.cjs --runInBand
```

The focused Jest config uses existing dependencies, without the stale root Jest config's unavailable Nx setup. Tests exercise real controllers, DTO mapping, service boundaries, React composer buttons and worker dispatch; persistence, external services and social provider calls use doubles. They do not send social posts or replace live jobs. Sanitization is outside this suite.

## Manual QA after an approved test rollout

1. With the flag unset, open the composer for a connected test channel that permits images/text; schedule an image post and a text post in the future. Record their job IDs.
2. Enable the flag and recreate only the fork app. Confirm `GET /posts/publishing-policy` returns `{"videoOnly":true}` and the composer explains the restriction. Confirm the channel list still follows `HIDDEN_PROVIDERS`.
3. Attach a supported MP4, write a caption and select an optional cover using the existing cover control. Schedule it; verify persisted caption, video and cover. Repeat via `POST /public/v1/posts` with valid provider settings. Use a provider sandbox/test account for an actual publish.
4. Attempt image-only, text-only, mixed image/video attachments and a text-only thread reply with Schedule and Post Now. Expect a policy warning and no new scheduled post. Repeat via the public API with `type: schedule` and `type: now`; expect HTTP 400 and no new job.
5. Save caption-only/image drafts with incomplete provider settings. Reopen and edit them. Draft save succeeds; promotion through `PUT /public/v1/posts/:id/status` with `{"status":"schedule"}` fails until every entry has a video. Moving a draft's date leaves it a draft.
6. Try replacing a queued thread reply with text using `type: update`, including a promoted draft whose child rows retain `DRAFT` state. Expect rejection. Repeat on a recurring published post. Editing an ordinary published post without republishing remains allowed.
7. Verify the image/text jobs recorded before enabling still execute, including a repeat if configured. Explicitly rescheduling them while enabled fails without canceling their existing jobs.
8. Disable the flag, recreate the app and refresh. Confirm the notice disappears and image/text scheduling and draft promotion work again within provider rules.

## Verification results — 2026-09-08

Baseline: `36d5fc7b`. Feature branch: `feature/video-only-publishing`.

| Check | Actual result |
| --- | --- |
| Focused Jest suite | **52 passed, 2 suites passed** (44 backend/controller/service/worker cases; 8 React composer cases). |
| Frontend TypeScript | Zero diagnostics on both feature and baseline. |
| Backend TypeScript | **Fails with 7 identical baseline errors**, none in changed code. Errors are existing implicit-any annotations in wallet, agent graph, autopost, media repository, email and short-link provider code. |
| Repository-root ESLint on changed source | **Blocked at config loading**: `TypeError: Converting circular structure to JSON` from the existing FlatCompat/Next ESLint configuration; no lint verdict claimed. |
| Docker config, flag true and false | Passed. Compared parsed merged configurations without printing secrets: `HIDDEN_PROVIDERS`, all environment values, persistent volumes, ports and every other service preserved. Fork image/build and removal of the old compiled mount verified. |
| `git diff --check` | Passed. |
| Separate repository-pattern review | Completed; two update bypasses found and fixed, with regression tests. Final review found no further actionable issue. |

There were no installed dependencies in this checkout. Checks used a disposable, network-disabled container based on the already-installed pinned Postiz image, reading this branch's source. The image's optional unbuilt `canvas` package was moved aside only inside that disposable container for JSDOM. Type checks ran with a 4 GB Node heap after generating the current Prisma client inside the container (no database connection or migration). Feature and baseline diagnostic logs were byte-identical; the initial 2 GB type-check attempt exhausted its heap before that comparison. No dependencies were added to the fork.

Not verified: a full Docker/Next production build, browser end-to-end interaction against a running fork, authenticated HTTP requests against that fork, real social publishing/cover acceptance, and live Temporal job execution after changing the flag. No fork was deployed, no channel was connected, and no existing job was modified. Automated UI tests mount the real composer with editor/provider components replaced by doubles; backend tests call the real controllers/services and worker dispatch with persistence and provider calls replaced by doubles. Complete the manual QA above in a suitable test environment before rollout.

## Changed files

| Files | Purpose |
| --- | --- |
| `libraries/nestjs-libraries/src/database/prisma/posts/publishing.policy.ts` | Central flag interpretation and publishing rules. |
| `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` | Shared preflight, effective setting, and stored-post transitions. |
| `apps/backend/src/api/routes/posts.controller.ts` | Effective-setting endpoint and composer validation context. |
| `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` | Preserve draft settings validation semantics and pass publishing context. |
| `apps/frontend/src/components/new-launch/manage.modal.tsx` | Notice and shared-backend error handling; caption/cover payload preserved. |
| `.env.example`, `docker-compose.yaml`, `docker-compose.fork.yaml` | Default-off runtime flag and optional source-image overlay. |
| `tests/publishing/publishing.spec.ts`, `tests/publishing/composer.spec.tsx` | Regression coverage. |
| `tests/publishing/jest.config.cjs`, `tests/publishing/setup.cjs` | Focused existing-dependency test harness. |
| `docs/video-only-publishing.md` | Configuration, trace, QA, results and limitations. |
