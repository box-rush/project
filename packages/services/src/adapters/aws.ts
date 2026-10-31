/**
 * Shared AWS SDK v3 client settings: bounded connection and request time, and the SDK's own retries (3 attempts,
 * exponential backoff). Without these a stalled socket can block a worker lane or a request indefinitely.
 */
export function awsClientConfig() {
  return {
    region: process.env.AWS_REGION ?? "ap-northeast-1",
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 3_000, requestTimeout: 15_000 },
  };
}
