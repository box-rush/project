/**
 * The client's IP as far as we can trust it (T18). In production the web app sits behind CloudFront, whose viewer
 * function writes `x-boxrush-client-ip` and `x-origin-verify` (a shared secret) on every request; the header is
 * trusted only when the secret matches, so a request that reaches the load balancer some other way cannot choose
 * its own IP. Without the CloudFront setup (local, admin behind its own ALB) the right-most X-Forwarded-For entry
 * is the one the nearest proxy added.
 */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const secret = process.env.ORIGIN_VERIFY_SECRET;
  if (secret && secret !== "unset") {
    if (headers.get("x-origin-verify") === secret) return headers.get("x-boxrush-client-ip");
    return null;
  }
  const xff = headers.get("x-forwarded-for");
  return xff ? xff.split(",").pop()!.trim() || null : null;
}
