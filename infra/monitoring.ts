/**
 * T17 monitoring: CloudWatch metric filters on the services' logs, alarms on the load balancers, the database and
 * the services, all notifying one SNS topic. Subscribe people with ALERT_EMAILS (comma separated; each address must
 * confirm the subscription e-mail). LINE Notify has been discontinued, so alerts go by e-mail (and anything else
 * subscribed to the topic, e.g. a chat integration).
 *
 * What each alarm means for the business is in infra/README.md ("Alarms").
 */
type Service = sst.aws.Service;

export function monitoring(p: { stage: string; isProd: boolean; db: sst.aws.Postgres; web: Service; admin: Service; worker: Service }) {
  const { stage, isProd } = p;
  const ns = `BoxRush/${stage}`;
  const alertTopic = new aws.sns.Topic("Alerts", { name: `boxrush-${stage}-alerts` });
  for (const [i, email] of (process.env.ALERT_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean).entries())
    new aws.sns.TopicSubscription(`AlertEmail${i}`, { topic: alertTopic.arn, protocol: "email", endpoint: email });
  const actions = { alarmActions: [alertTopic.arn], okActions: [alertTopic.arn] };

  // ── log metric filters ──────────────────────────────────────────────────────────────────────────
  const logGroup = (svc: string) => `/boxrush/${stage}/${svc}`;
  const filter = (name: string, svc: string, pattern: string, metric: string, dependsOn: Service) =>
    new aws.cloudwatch.LogMetricFilter(
      name,
      { logGroupName: logGroup(svc), pattern, metricTransformation: { name: metric, namespace: ns, value: "1", defaultValue: "0" } },
      { dependsOn: [dependsOn] },
    );
  // the worker's own alerts: failing / overdue jobs, unconfirmed X7 reports, notification and sweep failures
  filter("WorkerAlertFilter", "worker", '"[alert]"', "WorkerAlerts", p.worker);
  // a crash loop shows as repeated start lines
  filter("WorkerStartFilter", "worker", '"box-rush worker started"', "WorkerStarts", p.worker);
  // unexpected errors (domain errors are expected and not logged as errors)
  const errors = '?"[worker]" ?"[web action]" ?"[admin action]" ?"[db] idle client error" ?"[devices/segments]" ?"[intake documents]" ?"[documents]" ?"⨯"';
  filter("WebErrorFilter", "web", errors, "WebErrors", p.web);
  filter("AdminErrorFilter", "admin", errors, "AdminErrors", p.admin);
  filter("WorkerErrorFilter", "worker", errors, "WorkerErrors", p.worker);

  const alarm = (
    name: string,
    a: { description: string; metric: string; namespace?: string; stat: string; threshold: $util.Input<number>; op?: string; periods?: number; period?: number; dims?: Record<string, $util.Input<string>>; missing?: string },
  ) =>
    new aws.cloudwatch.MetricAlarm(name, {
      name: `boxrush-${stage}-${name}`,
      alarmDescription: a.description,
      namespace: a.namespace ?? ns,
      metricName: a.metric,
      ...(a.stat.startsWith("p") ? { extendedStatistic: a.stat } : { statistic: a.stat }),
      period: a.period ?? 300,
      evaluationPeriods: a.periods ?? 1,
      threshold: a.threshold,
      comparisonOperator: a.op ?? "GreaterThanOrEqualToThreshold",
      dimensions: a.dims,
      treatMissingData: a.missing ?? "notBreaching",
      ...actions,
    });

  // ── worker / jobs ────────────────────────────────────────────────────────────────────────────────
  alarm("worker-alerts", { description: "Worker raised [alert]: failing or overdue jobs (draws, refunds, sale closes), unconfirmed X7 reports, notification or sweep failures. Check the worker log.", metric: "WorkerAlerts", stat: "Sum", threshold: 1 });
  alarm("worker-crash-loop", { description: "Worker started 3+ times in an hour (crash loop or failing health check). Draws and refunds are not running.", metric: "WorkerStarts", stat: "Sum", threshold: 3, period: 3600 });
  alarm("worker-errors", { description: "Unexpected errors in the worker.", metric: "WorkerErrors", stat: "Sum", threshold: 5 });

  // ── apps ─────────────────────────────────────────────────────────────────────────────────────────
  alarm("web-errors", { description: "Unexpected errors in the consumer web app.", metric: "WebErrors", stat: "Sum", threshold: 10 });
  alarm("admin-errors", { description: "Unexpected errors in the back office.", metric: "AdminErrors", stat: "Sum", threshold: 5 });
  for (const [svc, s] of [["web", p.web], ["admin", p.admin]] as const) {
    const lb = { LoadBalancer: s.nodes.loadBalancer.arnSuffix };
    alarm(`${svc}-5xx`, { description: `${svc}: the application returned 5xx responses.`, metric: "HTTPCode_Target_5XX_Count", namespace: "AWS/ApplicationELB", stat: "Sum", threshold: svc === "web" ? 20 : 5, dims: lb });
    alarm(`${svc}-no-healthy-target`, { description: `${svc}: the load balancer itself answered 5xx — usually no healthy task.`, metric: "HTTPCode_ELB_5XX_Count", namespace: "AWS/ApplicationELB", stat: "Sum", threshold: 5, period: 60, periods: 3, dims: lb });
  }
  alarm("web-latency", { description: "web: p95 response time above 2 s for 15 minutes (scale-out lagging or a slow query).", metric: "TargetResponseTime", namespace: "AWS/ApplicationELB", stat: "p95", threshold: 2, periods: 3, dims: { LoadBalancer: p.web.nodes.loadBalancer.arnSuffix } });
  alarm("web-cpu", { description: "web: CPU above 85% for 15 minutes — autoscaling is at its maximum.", metric: "CPUUtilization", namespace: "AWS/ECS", stat: "Average", threshold: 85, periods: 3, dims: { ClusterName: p.web.nodes.service.cluster.apply((c) => c.split("/").pop()!), ServiceName: p.web.nodes.service.name } });

  // ── database ─────────────────────────────────────────────────────────────────────────────────────
  const rds = { DBInstanceIdentifier: p.db.nodes.instance!.identifier };
  alarm("db-cpu", { description: "Database CPU above 80% for 15 minutes.", metric: "CPUUtilization", namespace: "AWS/RDS", stat: "Average", threshold: 80, periods: 3, dims: rds });
  alarm("db-storage", { description: "Database free storage below 5 GB.", metric: "FreeStorageSpace", namespace: "AWS/RDS", stat: "Minimum", threshold: 5 * 1024 ** 3, op: "LessThanThreshold", dims: rds });
  // pools: web ≤ 8 tasks × 10, admin ≤ 2 × 12, worker 12 (+ migrations) — alarm well before max_connections
  alarm("db-connections", { description: "Database connections near the instance limit (pool exhaustion → requests fail fast).", metric: "DatabaseConnections", namespace: "AWS/RDS", stat: "Maximum", threshold: isProd ? 300 : 80, dims: rds });

  return { alertTopic };
}
