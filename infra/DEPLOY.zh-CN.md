# AWS 配置与部署指南（staging / production）

适用于 **AWS 全球区域**（aws.amazon.com 注册的账号），**不是 AWS 中国区**（amazonaws.cn）。
用到的区域：

| 区域 | 用途 |
|---|---|
| 东京 `ap-northeast-1` | 全部主要资源（VPC、RDS、ECS、S3、SES、KMS、告警） |
| 美东 `us-east-1` | CloudFront 的证书与 WAF（AWS 规定必须在这里，部署时自动创建，不用手动切换） |
| 大阪 `ap-northeast-3` | 生产环境数据库备份的异地副本（仅 production） |

英文版的同类说明在 `infra/README.md`；本文按"第一次从零开始"的顺序写。

---

## 1. AWS 账号（一次性）

1. 在 https://aws.amazon.com 注册账号。注册后：
   - **root 用户开启 MFA**，之后不再日常使用 root。
   - Billing → **Budgets** 建一个月度预算告警；打开 **Cost Anomaly Detection**。
2. **AWS Organizations**（推荐，T18 / §10.7.3 的方向）：用注册的账号作为管理账号，建成员账号：
   - `box-rush-staging`（测试环境）
   - `box-rush-production`（生产）
   - `box-rush-rng`（随机服务）、`box-rush-audit`（审计归档）—— ⚠️ 当前代码把随机服务和审计归档部署在主账号内，
     靠独立的数据库角色和 KMS 密钥隔离；拆到独立账号是已登记的后续事项（`infra/README.md` Known gaps）。先把账号建好，后续迁移时直接用。
3. **IAM Identity Center**（区域选东京）：
   - 启用 → 建自己的用户，**强制 MFA**。
   - 建权限集 `AdministratorAccess`，分配给 staging 与 production 两个账号（目前 1 人运维）。
   - 之后都用 Identity Center 登录，不建长期 Access Key。

## 2. 本地工具

| 工具 | 版本 | 说明 |
|---|---|---|
| Node.js | 22 | |
| pnpm | 10 | `corepack enable` |
| **Docker** | 任意新版本 | **必须在运行**：`sst deploy` 会在本机构建三个容器镜像 |
| AWS CLI | v2 | |
| psql | 16 | 初始化数据库登录角色时用 |

```bash
aws configure sso          # SSO start URL 用 Identity Center 门户地址；区域 ap-northeast-1；profile 名如 boxrush-staging
```
```bash
aws sso login --profile boxrush-staging
```
```bash
export AWS_PROFILE=boxrush-staging
```
```bash
aws sts get-caller-identity   # 确认是 staging 账号
```

## 3. 域名（推荐）

- 在 **Route 53** 建托管区，例如 `boxrush.jp`（域名在别处注册的话，把注册商的 NS 改成 Route 53 给的 4 条）。
- staging 用子域名，例如 `stg.boxrush.jp`。部署时 SST 会自动在这个托管区里建 DNS 记录和证书：
  - `stg.boxrush.jp` → CloudFront（用户访问的网站，经过 WAF）
  - `origin.stg.boxrush.jp` → web 的负载均衡器（只接受 CloudFront 的流量）
  - `admin.stg.boxrush.jp` → 后台（只允许 `ADMIN_ALLOWED_CIDRS` 里的 IP）
  - SES 发信域名的 DKIM / SPF / DMARC
- **不设域名也能部署**：网站用 `xxxx.cloudfront.net`，后台用负载均衡器的 `*.elb.amazonaws.com`（HTTP），
  但邮件只会打印到日志（没有 SES），后台没有 HTTPS。只适合最初的冒烟测试。

## 4. 外部服务（先准备好密钥）

| 服务 | 要拿到的东西 | 不配会怎样 |
|---|---|---|
| Stripe（测试模式） | `sk_test_…`、`pk_test_…`；部署后建 webhook 拿 `whsec_…`（第 7 步） | 不能付款 |
| Twilio（短信） | Account SID、Auth Token、发信号码 | **短信认证发不出去 → 用户不能购买**（KDDI Message Cast 待合同规格） |
| Cloudflare Turnstile | Cloudflare 账号 → Turnstile → 添加站点，主机名填 `stg.boxrush.jp` → Site Key、Secret Key | 购买前没有人机验证（staging 可暂不配） |
| LINE Messaging API（可选） | Channel Access Token | 只发邮件，不推 LINE |
| Sentry（可选） | 项目 DSN | 不做错误追踪（告警仍然有） |

## 5. 部署前的环境变量

```bash
export BOXRUSH_DOMAIN=stg.boxrush.jp                 # 没有域名就不设
export ADMIN_ALLOWED_CIDRS=203.0.113.10/32           # 能打开后台的 IP，逗号分隔；查自己的 IP：curl ifconfig.me
export ALERT_EMAILS=you@example.jp                   # 告警邮件，逗号分隔（部署后每个邮箱要点一次确认）
```

production 必须设 `ADMIN_ALLOWED_CIDRS`，否则部署会直接报错。

## 6. 设置密钥（每个 stage 一次）

在仓库根目录执行（staging 示例）：

```bash
for s in BetterAuthSecret PseudonymKey DbAppPassword DbRngPassword OriginVerifySecret; do npx sst secret set $s "$(openssl rand -hex 32)" --stage staging; done
```
```bash
npx sst secret set StripeSecretKey sk_test_xxx --stage staging
```
```bash
npx sst secret set StripePublishableKey pk_test_xxx --stage staging
```
```bash
npx sst secret set StripeWebhookSecret whsec_placeholder --stage staging   # 第 7 步拿到真值后再设一次
```
```bash
npx sst secret set TwilioAccountSid ACxxx --stage staging
```
```bash
npx sst secret set TwilioAuthToken xxx --stage staging
```
```bash
npx sst secret set TwilioFrom +1xxxxxxxxxx --stage staging
```

可选：`TurnstileSiteKey`、`TurnstileSecretKey`、`LineChannelAccessToken`、`SentryDsn`。

注意：
- **`PseudonymKey` 一旦用过就不能改**（公开记录里的匿名 ID 会全部变化）。
- 部署时这些值会写入 Secrets Manager（`boxrush/<stage>/…`），容器启动时由 ECS 注入，任务定义里只有 ARN。
- 查看已设置的密钥：`npx sst secret list --stage staging`。

## 7. 部署

```bash
pnpm install --frozen-lockfile
```
```bash
npx sst deploy --stage staging
```

第一次大约 20–30 分钟（CloudFront 和 RDS 比较慢）。结束时会打印：

```
web:        https://stg.boxrush.jp          ← 测试页面（用户端 + 公开验证页）
webOrigin:  https://origin.stg.boxrush.jp   ← 负载均衡器（只给 CloudFront 用，直接访问会被拒）
admin:      https://admin.stg.boxrush.jp    ← 后台
```

这时服务已经启动，但数据库还没初始化，页面会报错 —— 继续第 8 步。

## 8. 部署后初始化（第一次）

### 8.1 数据库迁移
```bash
npx sst shell --stage staging -- node infra/run-migrate.mjs
```

### 8.2 数据库登录角色（应用不能用数据库所有者账号连接）

数据库在私有子网里，经跳板机隧道访问：

```bash
sudo npx sst tunnel install          # 只需一次
```
```bash
npx sst tunnel --stage staging       # 保持这个终端开着，另开一个终端继续
```

取所有者连接串，并下载 RDS 证书（连接串里的证书路径是容器内的路径，本机要换成下载的文件）：

```bash
curl -so /tmp/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
```
```bash
export OWNER_URL=$(aws secretsmanager get-secret-value --secret-id boxrush/staging/OWNER_DATABASE_URL --query SecretString --output text | sed 's#/etc/ssl/rds-global-bundle.pem#/tmp/rds-global-bundle.pem#')
```
```bash
psql "$OWNER_URL" -v app_password="'<DbAppPassword 的值>'" -v rng_password="'<DbRngPassword 的值>'" -f infra/db-login-roles.sql
```

两个密码用 `npx sst secret list --stage staging` 查看。

### 8.3 第一个管理员

```bash
export DATABASE_URL=$(aws secretsmanager get-secret-value --secret-id boxrush/staging/DATABASE_URL --query SecretString --output text | sed 's#/etc/ssl/rds-global-bundle.pem#/tmp/rds-global-bundle.pem#')
```
```bash
BOOTSTRAP_ADMIN_EMAIL=you@example.jp BOOTSTRAP_ADMIN_PASSWORD='至少16位的随机密码' pnpm --filter @boxrush/services bootstrap
```

然后打开后台地址登录，第一次登录时用认证应用（Google Authenticator、1Password 等）扫码登记二段階認証。
其他员工在后台「監査ログ」页的「スタッフを追加」里创建（一次性密码只显示一次，本人首次登录时登记二段階認証）。

### 8.4 其余设置

1. **Stripe webhook**：Stripe 后台 → Developers → Webhooks → 添加端点
   `https://stg.boxrush.jp/api/webhooks/stripe`，事件选 `payment_intent.succeeded`、`payment_intent.payment_failed`
   → 把 `whsec_…` 设进 `StripeWebhookSecret`，再 `npx sst deploy --stage staging` 一次。
2. **SES**：控制台（东京）→ 申请 production access（离开沙箱）。沙箱期间只能发给已验证的邮箱。
3. **告警邮件**：`ALERT_EMAILS` 里的每个邮箱会收到 SNS 确认邮件，点确认。
4. **开盒工位摄像机**：后台「監視」页登记设备（令牌只显示一次）。
5. **外部监控**（可选）：从允许的 IP 访问 `https://admin.stg.boxrush.jp/api/health?deep=1`，返回 503 表示数据库异常或任务积压超过 5 分钟。

### 8.5 冒烟测试

```bash
E2E_BASE_URL=https://stg.boxrush.jp npx playwright test tests/e2e/consumer.spec.ts -g verification
```

## 9. 测试数据

`pnpm db:seed` 只用于本地：种子数据的抽选密钥用的是本地密钥，和云上的 KMS 不一致，**不要对云上的数据库运行**。
staging 的测试数据请在后台创建：商品マスタ → 収録リスト（一人起草、另一人核验）→ 入庫検品 → 商家创建场次 → 审核批准。

## 10. 之后的每次部署

```bash
npx sst deploy --stage staging
```

如果 `packages/db/migrations` 有新文件，部署后再执行 8.1。

## 11. production 与 staging 的区别

| 项目 | production |
|---|---|
| 数据库 | t4g.medium、Multi-AZ、删除保护、备份保留 35 天 + 每日复制到大阪 |
| web | 2–8 个任务自动扩缩 |
| 日志保留 | 3 个月 |
| 资源删除 | `sst remove` 也会保留（removal: retain） |
| 必须的变量 | `BOXRUSH_DOMAIN`、`ADMIN_ALLOWED_CIDRS` |
| 用户端语言 | 只开放日语（PD16） |

## 12. 删除 staging

```bash
npx sst remove --stage staging
```

## 13. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `sst deploy` 卡在构建镜像 | Docker 没有在运行 |
| 打开网站 502 / 503 | 8.1、8.2 还没做（应用连不上数据库）；或任务还在启动 |
| 后台打不开 | 当前 IP 不在 `ADMIN_ALLOWED_CIDRS`；改变量后重新部署 |
| 直接访问 `origin.` 地址被拒 | 正常：负载均衡器只接受 CloudFront |
| 收不到短信 | Twilio 未配置或号码未开通日本发送 |
| 收不到邮件 | SES 还在沙箱 |
| 付款后状态不变 | Stripe webhook 未配置或 `StripeWebhookSecret` 不对 |
