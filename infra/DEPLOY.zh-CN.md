# AWS 配置与部署指南（staging / production）

适用于 **AWS 全球区域**（aws.amazon.com 注册的账号），**不是 AWS 中国区**（amazonaws.cn）。
用到的区域：

| 区域 | 用途 |
|---|---|
| 东京 `ap-northeast-1` | 全部主要资源（VPC、RDS、ECS、S3、SES、KMS、告警） |
| 美东 `us-east-1` | CloudFront 的证书与 WAF（AWS 规定必须在这里，部署时自动创建，不用手动切换） |
| 大阪 `ap-northeast-3` | 生产环境数据库备份的异地副本（仅 production） |

英文版的同类说明在 `infra/README.md`。第 0 节是**最快路径**（不装本地工具、不要外部服务的 key，交给云端 Claude 运维）；
第 1 节起是从自己电脑部署的完整步骤。

---

## 0. 最快路径：测试模式 + GitHub Actions（推荐先走这条）

**测试模式**（`BOXRUSH_TEST_MODE=1`，只能用于 staging，production 会直接拒绝部署和启动）：

| 项目 | 测试模式下 |
|---|---|
| 付款 | 内置测试支付（点按钮即成功），不需要 Stripe |
| 短信认证 | 不发短信，验证码直接显示在认证页面上，不需要 Twilio |
| 人机验证、LINE、Sentry | 关闭 |
| 域名 | 不需要：用户端和后台都是 `https://xxxx.cloudfront.net`；邮件只写日志 |
| 数据 | 自动导入演示数据（商品、各状态的场次、测试员工与测试用户） |
| 页面 | 顶部有「テスト環境」横幅 |

部署由 GitHub Actions 完成（`.github/workflows/deploy.yml`），用 GitHub OIDC 换取临时 AWS 凭证，**不需要 Access Key**。
你只需要做 3 件事：

### 0.1 AWS：建一个允许 GitHub 部署的角色（一次）

1. 注册 AWS 账号并做好第 1 节第 1 步（root MFA、预算告警）。
2. 登录 AWS 控制台，右上角区域选 **東京 ap-northeast-1**，点顶栏的 **CloudShell** 图标，依次执行：

```bash
curl -sO https://raw.githubusercontent.com/box-rush/project/main/infra/bootstrap/github-oidc.yaml
```
```bash
aws cloudformation deploy --template-file github-oidc.yaml --stack-name boxrush-github-deploy-staging --capabilities CAPABILITY_NAMED_IAM
```
```bash
aws cloudformation describe-stacks --stack-name boxrush-github-deploy-staging --query 'Stacks[0].Outputs[0].OutputValue' --output text
```

最后一条输出的 `arn:aws:iam::<账号>:role/boxrush-github-deploy-staging` 就是要填到 GitHub 的角色 ARN。
这个角色只信任 `box-rush/project` 仓库里使用 `staging` 环境的 workflow。

> 这个角色有 AdministratorAccess（SST 要建 VPC、RDS、ECS、CloudFront、WAF、IAM 角色等）。建议放在单独的 staging 账号里（第 1 节第 2 步）。

### 0.2 GitHub：建 `staging` 环境（一次）

仓库 **Settings → Environments → New environment**，名字 `staging`：
- **Deployment branches**：选 Selected branches，只允许 `main`。
- **Environment variables**（是 Variables，不是 Secrets；这些值都不是机密）：

| 变量 | 值 |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | 0.1 得到的角色 ARN |
| `ADMIN_ALLOWED_CIDRS` | 能打开后台的 IP，如 `203.0.113.10/32`（在自己电脑上打开 https://checkip.amazonaws.com 查看）；多个用逗号分隔 |
| `BOXRUSH_TEST_MODE` | `1` |
| `ALERT_EMAILS` | （可选）告警邮箱，部署后要点确认邮件 |

### 0.3 运行部署

**Actions → deploy → Run workflow**（stage `staging`，action `deploy`）。也可以让 Claude 触发并看日志。
第一次 30–40 分钟。流程：生成随机密钥（只生成一次，已有的不会覆盖）→（非首次时先迁移数据库）→ `sst deploy` → 数据库迁移 → 数据库登录角色 → 演示数据 → 健康检查。
结束后在这次运行的 Summary 里有两个地址：用户端、后台。

测试账号（只在测试模式的演示数据里存在）：

| 用途 | 账号 / 密码 |
|---|---|
| 用户端 | `demo@boxrush.local` / `boxrush-demo`，或自己注册（短信验证码会显示在页面上） |
| 后台 | `admin@boxrush.local`、`merchant@`、`reviewer@`、`station@`、`warehouse@`、`cs@`…（均 `@boxrush.local`）/ `boxrush-dev` |
| 后台二段階認証 | 认证应用里手动添加密钥 `JBSWY3DPEHPK3PXP`（所有测试员工共用，只用于测试） |

其他操作：action `status` 打印最近日志与告警；action `remove` 删除整个 staging（`confirm` 里填 `staging`）。
**不用时建议 remove**：staging 常驻约每月 150–200 美元（NAT、2 个负载均衡器、RDS、Fargate、WAF、Secrets Manager 为主；⚠️ 粗略估算，以账单为准）。

以后要接真实服务时：设置 Stripe / Twilio 等密钥（第 4、6 节），把 `BOXRUSH_TEST_MODE` 改成 `0` 或删掉，重新部署。

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
  - `admin.stg.boxrush.jp` → 后台的 CloudFront（WAF 只允许 `ADMIN_ALLOWED_CIDRS` 里的 IP）
  - `admin-origin.stg.boxrush.jp` → 后台的负载均衡器（只接受 CloudFront）
  - SES 发信域名的 DKIM / SPF / DMARC
- **不设域名也能部署**：网站和后台都用 `xxxx.cloudfront.net`（HTTPS，后台仍有 IP 白名单），
  但邮件只会打印到日志（没有 SES）。适合测试模式。

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
admin:      https://admin.stg.boxrush.jp    ← 后台（只允许 ADMIN_ALLOWED_CIDRS）
```

这时服务已经启动，但数据库还没初始化，页面会报错 —— 继续第 8 步。

## 8. 部署后初始化（第一次）

### 8.1 数据库迁移
```bash
npx sst shell --stage staging -- node infra/run-task.mjs Migrate
```

### 8.2 数据库登录角色（应用不能用数据库所有者账号连接）

在 VPC 内以 ECS 任务运行，密码从 Secrets Manager 读取，不需要隧道和 psql（可重复执行）：

```bash
npx sst shell --stage staging -- node infra/run-task.mjs DbRoles
```

### 8.3 第一个管理员（测试模式不需要：演示数据里已有测试员工）

需要经跳板机隧道访问数据库（`sudo npx sst tunnel install` 一次，然后 `npx sst tunnel --stage staging` 保持开着），
并下载 RDS 证书：`curl -so /tmp/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`

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

- 测试模式：部署时自动运行 `Seed` 任务（用该 stage 的 KMS 密钥加密种子，云上的 worker 可以正常抽选）；已有数据时跳过。
- 非测试模式：不导入演示数据（`seed` 在部署环境里会拒绝运行）。测试数据在后台创建：商品マスタ → 収録リスト（一人起草、另一人核验）→ 入庫検品 → 商家创建场次 → 审核批准。
- 本地开发：`pnpm db:seed`。

## 10. 之后的每次部署

```bash
npx sst deploy --stage staging
```

如果 `packages/db/migrations` 有新文件，**先迁移再部署**（避免新代码碰到旧表结构）：

```bash
npx sst deploy --stage staging --target Migrate
```
```bash
npx sst shell --stage staging -- node infra/run-task.mjs Migrate
```

然后再执行上面的 `npx sst deploy --stage staging`。GitHub Actions 的 deploy 会自动按这个顺序执行，并每次执行 8.1、8.2。

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
