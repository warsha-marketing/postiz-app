import { BadRequestException } from '@nestjs/common';

type PublishingContent = { image?: Array<{ path: string }> };

export const getPublishingPolicy = () => ({
  videoOnly: process.env.VIDEO_ONLY_PUBLISHING === 'true',
});

export function publishingPolicyError(
  value: PublishingContent[],
  context?: {
    type: string;
    existing?: { state: string; intervalInDays?: number };
    inter?: number;
  }
): string | undefined {
  if (!getPublishingPolicy().videoOnly) {
    return;
  }

  if (context?.type === 'draft') {
    return;
  }
  if (context?.type === 'update' && context.existing) {
    const { existing, inter } = context;
    // Published recurring posts still feed future executions. One-off
    // published edits and drafts do not cross a publishing boundary.
    if (
      existing.state !== 'QUEUE' &&
      !(existing.state === 'PUBLISHED' && (existing.intervalInDays || inter))
    ) {
      return;
    }
  }

  // Match MediaDto's supported video format and query-string handling.
  // Covers live in media.thumbnail or provider settings, not in image[].
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some(
      (post) =>
        !Array.isArray(post.image) ||
        !post.image.length ||
        post.image.some((media) => !media?.path?.split('?')[0].endsWith('.mp4'))
    )
  ) {
    return 'Video-only publishing is enabled. Each post must contain a video and no standalone images. Captions and optional video covers are supported. You can save unfinished posts as drafts.';
  }
}

export function assertPublishingPolicy(value: PublishingContent[]) {
  const error = publishingPolicyError(value);
  if (error) {
    throw new BadRequestException(error);
  }
}
