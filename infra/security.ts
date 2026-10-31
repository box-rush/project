/**
 * T18 security foundation for the public site:
 *  - CloudFront in front of the web app (also the CDN for static assets and frozen public records), with an AWS WAF
 *    web ACL: AWS managed rules (IP reputation, common exploits, known bad inputs) and per-IP rate limits.
 *  - A viewer-request function stamps the viewer IP (`x-boxrush-client-ip`) and a shared secret (`x-origin-verify`)
 *    on every request; the app trusts the IP only with the secret (services/src/clientIp.ts), and the load balancer
 *    accepts traffic only from CloudFront's origin-facing addresses.
 *  - The back office goes through the same path with an IP allowlist in the WAF (office / VPN / station network), so it
 *    has HTTPS even without a custom domain.
 *  - AWS Backup: daily RDS backups kept 35 days, each copied to Osaka (ap-northeast-3) — production only.
 */
let usEast1: aws.Provider | undefined;
const cloudfrontRegion = () => (usEast1 ??= new aws.Provider("UsEast1", { region: "us-east-1" })); // CloudFront-scope WAF lives in us-east-1

/**
 * A site served through CloudFront + WAF (route it with `router.route("/", service.url, …)`). `allowCidrs` turns it into an allowlist (the back office: office / VPN /
 * station network only); without it the site is public and only the managed rules and rate limits apply.
 */
export function protectedSite(
  name: string,
  p: { stage: string; host: string | undefined; originVerify: $util.Input<string>; allowCidrs?: string[]; ratePerIp: number; postRatePerIp: number },
) {
  const managed = (rule: string, priority: number, overrides: string[] = []) => ({
    name: rule,
    priority,
    overrideAction: { none: {} },
    statement: {
      managedRuleGroupStatement: {
        vendorName: "AWS",
        name: rule,
        // count-only for rules our own traffic can trip (e.g. large request bodies), block for the rest
        ruleActionOverrides: overrides.map((r) => ({ name: r, actionToUse: { count: {} } })),
      },
    },
    visibilityConfig: { cloudwatchMetricsEnabled: true, sampledRequestsEnabled: true, metricName: `${name}-${rule}` },
  });
  const rate = (rule: string, priority: number, limit: number, postOnly: boolean) => ({
    name: rule,
    priority,
    action: { block: {} },
    statement: {
      rateBasedStatement: {
        limit, // requests per 5 minutes per IP
        aggregateKeyType: "IP",
        ...(postOnly ? { scopeDownStatement: { byteMatchStatement: { fieldToMatch: { method: {} }, positionalConstraint: "EXACTLY", searchString: "POST", textTransformations: [{ priority: 0, type: "NONE" }] } } } : {}),
      },
    },
    visibilityConfig: { cloudwatchMetricsEnabled: true, sampledRequestsEnabled: true, metricName: `${name}-${rule}` },
  });
  const allow = p.allowCidrs?.length
    ? new aws.wafv2.IpSet(`${name}AllowIps`, { name: `boxrush-${p.stage}-${name.toLowerCase()}-allow`, scope: "CLOUDFRONT", ipAddressVersion: "IPV4", addresses: p.allowCidrs }, { provider: cloudfrontRegion() })
    : undefined;
  const acl = new aws.wafv2.WebAcl(
    `${name}Acl`,
    {
      name: `boxrush-${p.stage}-${name.toLowerCase()}`,
      scope: "CLOUDFRONT",
      // allowlisted site: everything not in the IP set is blocked
      defaultAction: allow ? { block: {} } : { allow: {} },
      rules: [
        managed("AWSManagedRulesAmazonIpReputationList", 0),
        managed("AWSManagedRulesCommonRuleSet", 1, ["SizeRestrictions_BODY"]),
        managed("AWSManagedRulesKnownBadInputsRuleSet", 2),
        // everything: generous for people, stops floods; POST (server actions: hold, pay, sign-in): tight
        rate("RatePerIp", 10, p.ratePerIp, false),
        rate("PostRatePerIp", 11, p.postRatePerIp, true),
        ...(allow
          ? [
              {
                name: "AllowListed",
                priority: 20,
                action: { allow: {} },
                statement: { ipSetReferenceStatement: { arn: allow.arn } },
                visibilityConfig: { cloudwatchMetricsEnabled: true, sampledRequestsEnabled: true, metricName: `${name}-AllowListed` },
              },
            ]
          : []),
      ],
      visibilityConfig: { cloudwatchMetricsEnabled: true, sampledRequestsEnabled: true, metricName: `boxrush-${p.stage}-${name.toLowerCase()}` },
    },
    { provider: cloudfrontRegion() },
  );

  const router = new sst.aws.Router(`${name}Cdn`, {
    domain: p.host,
    edge: {
      viewerRequest: {
        // overwrite whatever the client sent: the IP CloudFront saw, and proof the request came through CloudFront
        injection: $interpolate`event.request.headers["x-boxrush-client-ip"] = { value: event.viewer.ip };
event.request.headers["x-origin-verify"] = { value: "${p.originVerify}" };`,
      },
    },
    transform: {
      cdn: (args) => {
        args.transform = { ...args.transform, distribution: (d) => void (d.webAclId = acl.arn) };
      },
    },
  });
  // the caller routes "/" to its service once that exists: the service needs this router's URL first (its own base
  // URL when there is no custom domain), so the router is created before the service it fronts
  return { router, acl };
}

/**
 * The load balancer behind a protected site accepts only CloudFront's origin-facing addresses. ONE rule: each
 * reference to this prefix list counts as ~55 rules against the 60-rules-per-group quota. Any CloudFront distribution
 * (also someone else's) can still reach it, so the listener additionally forwards only requests carrying our origin
 * secret (infra/stack.ts `fromOurCdn`).
 */
export function cloudfrontOnlyIngress(args: aws.ec2.SecurityGroupArgs): undefined {
  const cf = aws.ec2.getManagedPrefixListOutput({ name: "com.amazonaws.global.cloudfront.origin-facing" });
  args.ingress = [{ protocol: "tcp", fromPort: 80, toPort: 443, prefixListIds: [cf.id] }];
  return undefined;
}

/** Production backups: AWS Backup daily, 35 days, each recovery point copied to Osaka. */
export function rdsBackups(p: { stage: string; dbArn: $util.Input<string> }) {
  const osaka = new aws.Provider("Osaka", { region: "ap-northeast-3" });
  const vault = new aws.backup.Vault("BackupVault", { name: `boxrush-${p.stage}` });
  const osakaVault = new aws.backup.Vault("BackupVaultOsaka", { name: `boxrush-${p.stage}-osaka` }, { provider: osaka });
  const plan = new aws.backup.Plan("BackupPlan", {
    name: `boxrush-${p.stage}-daily`,
    rules: [
      {
        ruleName: "daily-with-osaka-copy",
        targetVaultName: vault.name,
        schedule: "cron(0 18 * * ? *)", // 03:00 JST
        startWindow: 60,
        completionWindow: 360,
        lifecycle: { deleteAfter: 35 },
        copyActions: [{ destinationVaultArn: osakaVault.arn, lifecycle: { deleteAfter: 35 } }],
      },
    ],
  });
  const role = new aws.iam.Role("BackupRole", {
    assumeRolePolicy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "backup.amazonaws.com" }, Action: "sts:AssumeRole" }] }),
    managedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup", "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"],
  });
  new aws.backup.Selection("BackupSelection", { name: "rds", planId: plan.id, iamRoleArn: role.arn, resources: [p.dbArn] });
  return { vault, osakaVault };
}
