import 'reflect-metadata';
import { PostActivity } from '../../apps/orchestrator/src/activities/post.activity';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsController } from '@gitroom/backend/api/routes/posts.controller';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import {
  getPublishingPolicy,
  publishingPolicyError,
} from '@gitroom/nestjs-libraries/database/prisma/posts/publishing.policy';

const media = (path: string) => ({ id: 'media', path });
const video = media('https://media.example/video.mp4');
const photo = media('https://media.example/cover.jpg');
const originalFlag = process.env.VIDEO_ONLY_PUBLISHING;
afterAll(() => {
  if (originalFlag === undefined) delete process.env.VIDEO_ONLY_PUBLISHING;
  else process.env.VIDEO_ONLY_PUBLISHING = originalFlag;
});

function fixture() {
  const repository = {
    getPostById: jest.fn(),
    getPost: jest.fn(),
    createOrUpdatePost: jest.fn(async (type, org, date, post) => ({
      posts: [{ id: 'saved', state: type === 'draft' ? 'DRAFT' : 'QUEUE' }],
    })),
    changeState: jest.fn(),
    changeDate: jest.fn(),
  };
  const provider = {
    checkValidity: jest.fn(async () => true),
    maxLength: () => 10000,
  };
  const integrations = {
    getIntegrationById: jest.fn(async () => ({
      id: 'channel',
      providerIdentifier: 'threads',
      name: 'Test channel',
    })),
  };
  const service = new PostsService(
    repository as any,
    { getSocialIntegration: () => provider } as any,
    integrations as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const workflow = jest
    .spyOn(service, 'startWorkflow')
    .mockResolvedValue(undefined);
  const web = new PostsController(service, {} as any, {} as any);
  const api = Object.assign(
    Object.create(PublicIntegrationsController.prototype),
    { _postsService: service }
  );
  return { repository, provider, integrations, service, workflow, web, api };
}

function body(type = 'schedule', images = [video]) {
  return {
    type,
    shortLink: false,
    date: '2030-01-01T12:00:00Z',
    tags: [],
    posts: [
      {
        integration: { id: 'channel' },
        settings: { __type: 'threads' },
        value: [{ content: 'A video caption', image: images }],
      },
    ],
  };
}

beforeEach(() => {
  process.env.VIDEO_ONLY_PUBLISHING = 'true';
});

describe('policy configuration and media', () => {
  test.each([undefined, '', 'false', '1'])(
    'upstream behavior for %s',
    (flag) => {
      if (flag === undefined) delete process.env.VIDEO_ONLY_PUBLISHING;
      else process.env.VIDEO_ONLY_PUBLISHING = flag;
      expect(getPublishingPolicy()).toEqual({ videoOnly: false });
      expect(publishingPolicyError([{ image: [] }])).toBeUndefined();
      expect(publishingPolicyError([{ image: [photo] }])).toBeUndefined();
    }
  );
  test('accepts captions and both media and provider cover representations', async () => {
    const { web, repository } = fixture();
    const input = body('schedule', [
      { ...video, thumbnail: photo.path } as any,
    ]);
    (input.posts[0].settings as any).thumbnail = photo;
    await web.createPost({ id: 'org' } as any, input);
    const saved = repository.createOrUpdatePost.mock.calls[0][3];
    expect(saved.value[0].content).toBe('A video caption');
    expect(saved.value[0].image[0].thumbnail).toBe(photo.path);
    expect(saved.settings.thumbnail).toEqual(photo);
  });
  test.each([
    'https://media.example/video.mp4?signature=abc',
    '/uploads/video.mp4',
  ])('accepts existing MP4 path pattern %s', (path) => {
    expect(publishingPolicyError([{ image: [media(path)] }])).toBeUndefined();
  });
  test.each([
    'https://media.example/picture.jpg?name=video.mp4',
    'https://media.example/video.mp4/picture.jpg',
    'https://media.example/video.mp4.jpg',
  ])('does not mistake image path %s for video', (path) => {
    expect(publishingPolicyError([{ image: [media(path)] }])).toContain(
      'Video-only'
    );
  });
});

describe.each(['web', 'api'] as const)(
  '%s controller publishing path',
  (entry) => {
    test.each(['schedule', 'now'])(
      'rejects text-only and image-only %s',
      async (type) => {
        for (const images of [[], [photo], [video, photo]]) {
          const f = fixture();
          await expect(
            f[entry].createPost({ id: 'org' } as any, body(type, images))
          ).rejects.toThrow('Video-only');
          expect(f.repository.createOrUpdatePost).not.toHaveBeenCalled();
          expect(f.workflow).not.toHaveBeenCalled();
        }
      }
    );
    test('accepts video with caption and cover', async () => {
      const f = fixture();
      await expect(
        f[entry].createPost(
          { id: 'org' } as any,
          body('now', [{ ...video, thumbnail: photo.path } as any])
        )
      ).resolves.toHaveLength(1);
      expect(f.workflow).toHaveBeenCalled();
    });
    test.each([{ images: [] }, { images: [photo] }])(
      'keeps unfinished drafts editable with $images',
      async ({ images }) => {
        const f = fixture();
        f.provider.checkValidity.mockResolvedValue(
          'Provider requires a video' as any
        );
        await expect(
          f[entry].createPost({ id: 'org' } as any, body('draft', images))
        ).resolves.toHaveLength(1);
        expect(f.repository.createOrUpdatePost.mock.calls[0][0]).toBe('draft');
      }
    );
    test('drafts may omit required provider settings', async () => {
      const f = fixture();
      f.integrations.getIntegrationById.mockResolvedValue({
        id: 'channel',
        providerIdentifier: 'youtube',
        name: 'YouTube',
      });
      await expect(
        f[entry].createPost({ id: 'org' } as any, body('draft', []))
      ).resolves.toHaveLength(1);
      await expect(
        f[entry].createPost({ id: 'org' } as any, body('schedule'))
      ).rejects.toThrow();
    });
    test('flag off restores text and image scheduling', async () => {
      process.env.VIDEO_ONLY_PUBLISHING = 'false';
      const f = fixture();
      for (const images of [[], [photo]]) {
        await expect(
          f[entry].createPost({ id: 'org' } as any, body('schedule', images))
        ).resolves.toHaveLength(1);
      }
    });
  }
);

describe('shared service boundaries', () => {
  test('preflights all channels before saving the first one', async () => {
    const f = fixture();
    const input = body();
    input.posts.push(body('schedule', [photo]).posts[0]);
    await expect(
      f.service.createPost('org', input as any, 'API')
    ).rejects.toThrow('Video-only');
    expect(f.repository.createOrUpdatePost).not.toHaveBeenCalled();
  });
  test('rejects a text-only thread reply', async () => {
    const f = fixture();
    const input = body();
    input.posts[0].value.push({ content: 'Text reply', image: [] });
    await expect(
      f.service.createPost('org', input as any, 'API')
    ).rejects.toThrow('Video-only');
  });
  test.each([undefined, 'QUEUE'])(
    'update cannot bypass policy for %s rows',
    async (state) => {
      const f = fixture();
      f.repository.getPostById.mockResolvedValue(state ? { state } : null);
      const input = body('update', [photo]);
      (input.posts[0].value[0] as any).id = 'existing';
      await expect(
        f.service.createPost('org', input as any, 'API')
      ).rejects.toThrow('Video-only');
      expect(f.repository.createOrUpdatePost).not.toHaveBeenCalled();
    }
  );
  test('queued root validates draft-state and newly added children on update', async () => {
    const f = fixture();
    f.repository.getPostById.mockImplementation(async (id) => ({
      state: id === 'root' ? 'QUEUE' : 'DRAFT',
    }));
    const input = body('update');
    (input.posts[0].value[0] as any).id = 'root';
    input.posts[0].value.push({
      id: 'child',
      content: 'Text reply',
      image: [],
    } as any);
    await expect(
      f.service.createPost('org', input as any, 'API')
    ).rejects.toThrow('Video-only');
    expect(f.repository.createOrUpdatePost).not.toHaveBeenCalled();
  });
  test.each(['DRAFT', 'PUBLISHED'])(
    'update preserves editable %s rows',
    async (state) => {
      const f = fixture();
      f.repository.getPostById.mockResolvedValue({ state });
      const input = body('update', [photo]);
      (input.posts[0].value[0] as any).id = 'existing';
      await expect(
        f.service.createPost('org', input as any, 'API')
      ).resolves.toHaveLength(1);
      expect(f.workflow).not.toHaveBeenCalled();
    }
  );
  test('published recurring edits still require video in validation and writes', async () => {
    const f = fixture();
    f.repository.getPostById.mockResolvedValue({
      state: 'PUBLISHED',
      intervalInDays: 7,
    });
    const input = body('update', [photo]);
    (input.posts[0].value[0] as any).id = 'root';
    const [result] = await f.web.validatePosts({ id: 'org' } as any, input);
    expect(result.publishingError).toContain('Video-only');
    await expect(
      f.service.createPost('org', input as any, 'API')
    ).rejects.toThrow('Video-only');
    expect(f.repository.createOrUpdatePost).not.toHaveBeenCalled();
  });
  test('preflight returns the same policy error to the composer', async () => {
    const f = fixture();
    expect(f.web.getPublishingPolicy()).toEqual({ videoOnly: true });
    const [result] = await f.web.validatePosts(
      { id: 'org' } as any,
      body('schedule', [photo])
    );
    expect(result.publishingError).toBe(
      publishingPolicyError([{ image: [photo] }])
    );
  });
});

function stored(
  f: ReturnType<typeof fixture>,
  state: string,
  images = [photo]
) {
  const post = {
    id: 'existing',
    state,
    image: JSON.stringify(images),
    childrenPost: [],
    integration: { providerIdentifier: 'threads' },
  };
  f.repository.getPostById.mockResolvedValue(post);
  f.repository.getPost.mockResolvedValue(post);
  return post;
}

describe('stored post transitions and existing jobs', () => {
  test('draft promotion rejects before changing state or starting a workflow', async () => {
    const f = fixture();
    stored(f, 'DRAFT');
    await expect(
      f.service.changePostStatus('org', 'existing', 'schedule')
    ).rejects.toThrow('Video-only');
    expect(f.repository.changeState).not.toHaveBeenCalled();
    expect(f.workflow).not.toHaveBeenCalled();
  });
  test('promotion checks children as well as the root video', async () => {
    const f = fixture();
    const root = stored(f, 'DRAFT', [video]);
    f.repository.getPost
      .mockResolvedValueOnce({ ...root, childrenPost: [{ id: 'reply' }] })
      .mockResolvedValueOnce({ ...root, id: 'reply', image: '[]' });
    await expect(
      f.service.changePostStatus('org', 'existing', 'schedule')
    ).rejects.toThrow('Video-only');
  });
  test('video draft promotion succeeds', async () => {
    const f = fixture();
    stored(f, 'DRAFT', [video]);
    await f.service.changePostStatus('org', 'existing', 'schedule');
    expect(f.repository.changeState).toHaveBeenCalledWith('existing', 'QUEUE');
  });
  test('moving a draft date keeps it editable', async () => {
    const f = fixture();
    stored(f, 'DRAFT');
    await f.service.changeDate('org', 'existing', '2030-01-01', 'schedule');
    expect(f.repository.changeDate).toHaveBeenCalledWith(
      'org',
      'existing',
      '2030-01-01',
      true,
      'schedule'
    );
  });
  test('explicit rescheduling is rejected without touching the existing job', async () => {
    const f = fixture();
    stored(f, 'QUEUE');
    await expect(
      f.service.changeDate('org', 'existing', '2030-01-01', 'schedule')
    ).rejects.toThrow('Video-only');
    expect(f.repository.changeDate).not.toHaveBeenCalled();
    expect(f.workflow).not.toHaveBeenCalled();
  });
  test('flag off restores draft promotion and rescheduling', async () => {
    process.env.VIDEO_ONLY_PUBLISHING = 'false';
    const f = fixture();
    stored(f, 'DRAFT');
    await f.service.changePostStatus('org', 'existing', 'schedule');
    stored(f, 'QUEUE');
    await f.service.changeDate('org', 'existing', '2030-01-01', 'schedule');
    expect(f.repository.changeState).toHaveBeenCalled();
    expect(f.repository.changeDate).toHaveBeenCalled();
  });
  test('existing job reads and state changes remain available', async () => {
    const f = fixture();
    stored(f, 'QUEUE');
    await expect(
      f.service.getPostsRecursively('existing', false, 'org')
    ).resolves.toHaveLength(1);
    await f.service.changeState('existing', 'PUBLISHED');
    expect(f.repository.changeState).toHaveBeenCalledWith(
      'existing',
      'PUBLISHED',
      undefined,
      undefined
    );
    expect(f.workflow).not.toHaveBeenCalled();
  });
});

// Exercise the real activity dispatch, including both workflow generations.
// Provider calls are doubles: no social network receives anything.
describe.each(['postSocial', 'postSocialPending'])(
  'existing job %s',
  (method) => {
    test.each([{ images: [] }, { images: [photo] }])(
      'still dispatches $images with video-only enabled',
      async ({ images }) => {
        const f = fixture();
        jest
          .spyOn(f.service, 'updateTags')
          .mockImplementation(async (_org, posts) => posts);
        jest
          .spyOn(f.service, 'updateMedia')
          .mockImplementation(async (_id, media) => media);
        const publish = jest.fn(async () => [
          { id: 'existing', postId: 'published' },
        ]);
        const activity = Object.assign(Object.create(PostActivity.prototype), {
          _postService: f.service,
          _integrationManager: {
            getSocialIntegration: () => ({
              editor: 'normal',
              post: publish,
              postPending: publish,
            }),
          },
          _subscriptionService: { getSubscription: async () => ({}) },
          _temporalService: {
            client: {
              getRawClient: () => ({ workflow: { start: jest.fn() } }),
            },
          },
        });
        await expect(
          activity[method](
            { providerIdentifier: 'threads', organizationId: 'org' },
            [
              {
                id: 'existing',
                state: 'QUEUE',
                content: 'Previously scheduled caption',
                image: JSON.stringify(images),
                settings: '{}',
              },
            ]
          )
        ).resolves.toHaveLength(1);
        expect(publish.mock.calls[0][2][0]).toMatchObject({
          message: 'Previously scheduled caption',
          media: images,
        });
      }
    );
  }
);
