import 'reflect-metadata';

jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  SocialAbstract: class {},
  BadBody: class extends Error {},
  RefreshToken: class extends Error {},
  stripQuery: (url: string) => url.split('?')[0],
}));
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YoutubeProvider } from '../../libraries/nestjs-libraries/src/integrations/social/youtube.provider';
import { UploadFactory } from '../../libraries/nestjs-libraries/src/upload/upload.factory';
import { LocalStorage } from '../../libraries/nestjs-libraries/src/upload/local.storage';

describe('local publishing media resolution', () => {
  let parent: string;
  let root: string;
  let storage: LocalStorage;
  const previous = process.env.FRONTEND_URL;
  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), 'warsha-media-'));
    root = join(parent, 'uploads');
    mkdirSync(join(root, '2026/09/08'), { recursive: true });
    writeFileSync(join(root, '2026/09/08/test.mp4'), 'test-video');
    writeFileSync(join(parent, 'private.mp4'), 'private');
    symlinkSync(join(parent, 'private.mp4'), join(root, 'escape.mp4'));
    process.env.FRONTEND_URL = 'http://localhost:4007';
    storage = new LocalStorage(root);
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = previous;
    rmSync(parent, { recursive: true, force: true });
  });
  it('resolves an uploaded URL to its real local file without an HTTP request', () => {
    expect(storage.resolveLocalFilePath('http://localhost:4007/uploads/2026/09/08/test.mp4?download=1'))
      .toBe(join(root, '2026/09/08/test.mp4'));
  });
  it('passes the verified file into the resumable YouTube upload', async () => {
    const spy = jest.spyOn(UploadFactory, 'createStorage').mockReturnValue(storage);
    const provider = new YoutubeProvider();
    const send = jest.fn().mockResolvedValue({ headers: new Headers({ location: 'https://www.googleapis.com/upload/session/test' }) });
    Object.assign(provider, { fetch: send });
    try {
      const result = await provider.postPending('channel', 'test-token', [{
        id: 'post', message: 'Private test',
        settings: { title: 'Private test', type: 'private' },
        media: [{ path: 'http://localhost:4007/uploads/2026/09/08/test.mp4' }],
      }] as any, {} as any);
      expect(result[0].pendingData.path).toBe(join(root, '2026/09/08/test.mp4'));
      expect(result[0].pendingData.videoSize).toBe(10);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toContain('https://www.googleapis.com/upload/youtube/');
      expect(JSON.parse(send.mock.calls[0][1].body).status.privacyStatus).toBe('private');
    } finally { spy.mockRestore(); }
  });
  it.each([
    'https://other.example/uploads/2026/09/08/test.mp4',
    'http://localhost:4008/uploads/2026/09/08/test.mp4',
    'http://localhost:4007/not-uploads/test.mp4',
    'http://localhost:4007/uploads/%2f..%2fprivate.mp4',
    'http://localhost:4007/uploads/escape.mp4',
    'http://localhost:4007/uploads/missing.mp4',
    'http://user:password@localhost:4007/uploads/2026/09/08/test.mp4',
    'file:///etc/passwd',
  ])('does not resolve untrusted or missing path %s', (url) => {
    expect(storage.resolveLocalFilePath(url)).toBeUndefined();
  });
});
