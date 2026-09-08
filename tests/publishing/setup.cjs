// Keep external services disconnected; exercise the real posting service,
// DTO validation and controllers against repository / workflow doubles.
for (const name of [
  'database/prisma/posts/posts.repository',
  'integrations/integration.manager',
  'database/prisma/integrations/integration.service',
  'database/prisma/media/media.service',
  'short-linking/short.link.service',
  'openai/openai.service',
  'integrations/refresh.integration.service',
  'agent/agent.graph.service',
  'database/prisma/notifications/notification.service',
  'database/prisma/users/users.service',
  'database/prisma/organizations/organization.service',
  'database/prisma/subscriptions/subscription.service',
  'chat/validation.schemas.helper',
  'dtos/webhooks/ssrf.safe.dispatcher',
]) {
  jest.mock('@gitroom/nestjs-libraries/' + name, () => ({}));
}
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  RefreshToken: class extends Error {},
}));
jest.mock(
  '@gitroom/backend/services/auth/permissions/permissions.ability',
  () => ({ CheckPolicies: () => () => {} })
);
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));
jest.mock('sharp', () => ({}));
jest.mock('file-type', () => ({}));
// Sanitization is orthogonal to this policy; the image's DOMPurify dependency
// uses ESM-only transitive modules that Jest 29 cannot require.
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value) => value }));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service',
  () => ({})
);
jest.mock('@gitroom/nestjs-libraries/temporal/temporal.heartbeat', () => ({
  setHeartbeatDetails: () => {},
  withHeartbeat: (fn) => fn(),
}));
