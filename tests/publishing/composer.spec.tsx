/** @jest-environment jsdom */
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { publishingPolicyError } from '@gitroom/nestjs-libraries/database/prisma/posts/publishing.policy';

dayjs.extend(utc);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let values: any[];
const show = jest.fn();
const fetchMock = jest.fn(async (url, options?: any) => ({
  json: async () => {
    if (url === '/posts/publishing-policy')
      return { videoOnly: process.env.VIDEO_ONLY_PUBLISHING === 'true' };
    if (url === '/posts/valid') {
      return JSON.parse(options.body).posts.map((post) => ({
        id: 'channel',
        identifier: 'threads',
        name: 'Test channel',
        valid: true,
        errors: true,
        emptyContent: false,
        tooLong: false,
        publishingError: publishingPolicyError(post.value),
      }));
    }
    return {};
  },
}));
const state = {
  hide: false,
  current: 'global',
  date: dayjs('2030-01-01'),
  tags: [],
  selectedIntegrations: [{ integration: { id: 'channel' } }],
  integrations: [],
  locked: false,
  setHide: jest.fn(),
  setDate: jest.fn(),
  setTags: jest.fn(),
};
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key, fallback) => fallback,
}));
jest.mock('@gitroom/react/toaster/toaster', () => ({
  useToaster: () => ({ show }),
}));
jest.mock('@gitroom/react/helpers/delete.dialog', () => ({
  deleteDialog: jest.fn(),
}));
jest.mock('@gitroom/frontend/components/new-launch/store', () => ({
  useLaunchStore: (selector) => selector(state),
}));
jest.mock(
  '@gitroom/frontend/components/launches/helpers/use.existing.data',
  () => ({ useExistingData: () => ({}) })
);
jest.mock('@gitroom/frontend/components/layout/new-modal', () => ({
  useModals: () => ({ closeAll: jest.fn() }),
}));
jest.mock(
  '@gitroom/frontend/components/settings/shortlink-preference.component',
  () => ({ useShortlinkPreference: () => ({ data: { shortlink: 'NO' } }) })
);
jest.mock('@gitroom/frontend/components/ui/is.scroll.hook', () => ({
  useHasScroll: () => false,
}));
jest.mock('@copilotkit/react-ui', () => ({ CopilotPopup: () => null }));
jest.mock(
  '@gitroom/frontend/components/new-launch/providers/show.all.providers',
  () => ({
    ShowAllProviders: React.forwardRef((_props, ref) => {
      React.useImperativeHandle(ref, () => ({
        getAllValues: async () => values,
      }));
      return null;
    }),
  })
);
for (const name of [
  'new-launch/picks.socials.component',
  'new-launch/editor',
  'new-launch/select.current',
  'launches/helpers/date.picker',
  'launches/repeat.component',
  'launches/tags.component',
  'launches/select.customer',
  'new-launch/dummy.code.component',
  'launches/creation.method.badge',
  'ui/icons',
]) {
  jest.doMock(
    '@gitroom/frontend/components/' + name,
    () =>
      new Proxy(
        {},
        {
          get: (_target, key) => (key === '__esModule' ? true : () => null),
        }
      )
  );
}
jest.mock('@gitroom/react/form/button', () => ({
  Button: (props) => <button {...props} />,
}));
const {
  ManageModal,
} = require('../../apps/frontend/src/components/new-launch/manage.modal');
let container: HTMLDivElement;
let root: Root;
const originalFlag = process.env.VIDEO_ONLY_PUBLISHING;
beforeEach(() => {
  process.env.VIDEO_ONLY_PUBLISHING = 'true';
  fetchMock.mockClear();
  show.mockClear();
  values = [
    {
      id: 'channel',
      settings: {},
      values: [{ content: 'My caption', media: [] }],
    },
  ];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
afterAll(() => {
  if (originalFlag === undefined) delete process.env.VIDEO_ONLY_PUBLISHING;
  else process.env.VIDEO_ONLY_PUBLISHING = originalFlag;
});
async function render() {
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <ManageModal mutate={jest.fn()} />
      </SWRConfig>
    );
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === label
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
const writes = () => fetchMock.mock.calls.filter(([url]) => url === '/posts');

test('explains the backend setting', async () => {
  await render();
  expect(container.querySelector('[role="note"]')?.textContent).toContain(
    'Video-only publishing'
  );
  expect(fetchMock).toHaveBeenCalledWith('/posts/publishing-policy');
});
test.each([{ media: [] }, { media: [{ id: 'image', path: '/cover.jpg' }] }])(
  'schedule rejects $media and leaves the composer open',
  async ({ media }) => {
    values[0].values[0].media = media;
    await render();
    await click('Add to calendar');
    expect(show).toHaveBeenCalledWith(
      expect.stringContaining('Video-only'),
      'warning'
    );
    expect(writes()).toHaveLength(0);
    expect(container.querySelector('button')?.disabled).toBe(false);
  }
);
test('publish now rejects text-only content', async () => {
  await render();
  await click('Post Now');
  expect(show).toHaveBeenCalledWith(
    expect.stringContaining('Video-only'),
    'warning'
  );
  expect(writes()).toHaveLength(0);
});
test('saves incomplete drafts', async () => {
  await render();
  await click('Save as Draft');
  expect(JSON.parse(writes()[0][1].body).type).toBe('draft');
});
test('schedules video preserving caption and both cover fields', async () => {
  values[0].values[0].media = [
    {
      id: 'video',
      path: '/video.mp4',
      thumbnail: 'https://media.example/cover.jpg',
    },
  ];
  values[0].settings.thumbnail = {
    id: 'cover',
    path: 'https://media.example/cover.jpg',
  };
  await render();
  await click('Add to calendar');
  const input = JSON.parse(writes()[0][1].body);
  expect(input.posts[0].value[0]).toMatchObject({
    content: 'My caption',
    image: values[0].values[0].media,
  });
  expect(input.posts[0].settings.thumbnail).toEqual(
    values[0].settings.thumbnail
  );
});
test.each([{ media: [] }, { media: [{ id: 'image', path: '/cover.jpg' }] }])(
  'flag off hides notice and permits scheduling $media',
  async ({ media }) => {
    process.env.VIDEO_ONLY_PUBLISHING = 'false';
    values[0].values[0].media = media;
    await render();
    await click('Add to calendar');
    expect(container.querySelector('[role="note"]')).toBeNull();
    expect(writes()).toHaveLength(1);
  }
);
