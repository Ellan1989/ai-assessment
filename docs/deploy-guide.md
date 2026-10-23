# 部署手册（自助版）

本仓库已包含全部部署所需文件，按本手册操作即可上线。三条路线按成本排序：
**路线一（推荐，AU$0）** Oracle 免费服务器一键脚本；**路线二** 任意有 Docker 的机器；
**路线三** Render 托管（约 AU$11/月，最省心但非免费）。

## 部署包文件总览

| 文件 | 用途 |
| --- | --- |
| `scripts/setup-server.sh` | 一键安装脚本（Ubuntu 专用）：装 Node、拉代码、构建、开机自启、自动 HTTPS |
| `Dockerfile` + `docker-compose.yml` | Docker 部署（路线二） |
| `render.yaml` | Render 托管配置（路线三） |
| `.env.example` | 环境变量模板（所有路线都要先复制成 `.env.local` 并填写） |
| `scripts/backup.sh` | 数据备份（数据库 + 已生成 PDF 打包） |
| `/api/health` | 部署后的健康检查接口 |

必填的环境变量（各路线通用）：

```
APP_BASE_URL=https://你的域名        # 报告邮件里的链接前缀
APP_SECRET=一串随机长字符             # openssl rand -hex 32 生成
ADMIN_EMAIL=你的管理员邮箱
ADMIN_PASSWORD=你的管理员密码
DATABASE_PATH=数据目录/app.db         # 必须放在持久磁盘/卷上
```

---

## 路线一：Oracle Cloud 永久免费服务器（AU$0，推荐）

### 第 1 步 注册并创建服务器

1. 注册 [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)：Home Region 选 **Sydney**，
   需 Visa/Master 卡验证（不扣费）；审核几分钟到 1-2 天
2. 控制台 → **Compute → Instances → Create**，按此选择：
   - Image：**Canonical Ubuntu 22.04**
   - Shape：**Ampere（A1.Flex）**，2 OCPU / 8GB（内存务必 ≥4GB，否则构建失败）
   - SSH Keys：**Generate a key pair**，下载并保存私钥文件
3. 创建完成后记下**公网 IP**
4. 开放端口：实例页 → 点 Virtual Cloud Network → Security Lists → Add Ingress Rule ×2：
   Source `0.0.0.0/0`，目的端口分别填 `80`、`443`（协议 TCP）

> 若提示 "Out of capacity"：编辑实例换一个 Availability Domain 重试，或错峰再试。

### 第 2 步 免费域名

1. 打开 [duckdns.org](https://www.duckdns.org/)，用 GitHub 账号登录
2. 创建子域名（如 `saide-assess` → `saide-assess.duckdns.org`），记下页面上的 **token**

### 第 3 步 一键安装（复制粘贴即可）

在本机终端执行（把 4 个值换成自己的）：

```bash
ssh -i /path/to/私钥文件 ubuntu@服务器IP
```

登录服务器后执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Ellan1989/ai-assessment/main/scripts/setup-server.sh \
  | sudo bash -s -- --domain 你的名字.duckdns.org --duckdns-token 你的token \
       --admin-email 你的邮箱 --admin-password '你的后台密码'
```

脚本自动完成：Node 22 → 拉代码 → 构建 → 配置环境 → systemd 开机自启 → Caddy 自动 HTTPS →
DuckDNS 域名解析 → 防火墙。全程约 5 分钟。

### 第 4 步 验证

- 浏览器打开 `https://你的名字.duckdns.org`（首次访问自动签发证书，稍等十几秒）
- 健康检查：`https://你的名字.duckdns.org/api/health` 应返回 `{"status":"ok",...}`
- 完整走一遍评估 → 留资 → 报告；登录 `/admin/login` 确认线索入库

---

## 路线二：Docker（任意有 Docker 的服务器）

```bash
git clone https://github.com/Ellan1989/ai-assessment.git && cd ai-assessment
cp .env.example .env.local && nano .env.local     # 填好必填变量，DATABASE_PATH 保持默认
docker compose up -d --build
```

访问 `http://服务器IP:3000`。数据持久化在 `./data/` 目录。HTTPS 需自配反向代理
（如 Caddy/Nginx）或 Cloudflare。

## 路线三：Render 托管（约 US$7/月，非免费）

1. [render.com](https://render.com) 用 GitHub 登录 → New → **Blueprint** → 选本仓库 → Apply
2. 在 Environment 里填 `APP_SECRET`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`、`APP_BASE_URL`
3. 完成后得到 `https://ai-assessment-xxxx.onrender.com`；自定义域名在 Settings → Custom Domains

---

## 日常运维

**更新到新版本**（我方 `git push` 之后）：

```bash
# 路线一：服务器上重跑安装命令（自动拉取最新代码重建）
sudo systemctl stop ai-assessment
cd /opt/ai-assessment && git pull && npm ci && npm run build
sudo systemctl start ai-assessment

# 路线二：docker compose up -d --build
```

**备份数据**（建议每周 + 每次营销活动前）：

```bash
# 服务器上执行，产物是 .tar.gz（数据库 + 全部 PDF 报告）
/opt/ai-assessment/scripts/backup.sh ~/backups
# 下载到本地：本机执行 scp -i 私钥 ubuntu@服务器IP:~/backups/*.tar.gz .
```

**恢复**：解压备份包，用里面的 `app-*.db` 覆盖数据目录的 `app.db`，重启服务
（`sudo systemctl restart ai-assessment`）。

**查看运行日志**：`journalctl -u ai-assessment -f`（路线一）/ `docker compose logs -f`（路线二）。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 构建时内存不足被杀（OOM） | 实例内存需 ≥4GB；或本地构建后上传 `.next` 目录 |
| 域名打不开 / 证书失败 | 确认 80、443 端口已在 Security List 放行；DuckDNS 页面确认域名状态 OK |
| 邮件里的报告链接是 localhost | `.env.local` 的 `APP_BASE_URL` 没改成正式域名，改完重启 |
| 忘记后台密码 | 改 `.env.local` 的 `ADMIN_PASSWORD`，重启服务 |
| 想重置全部数据 | 停服务 → 删除数据目录下 `app.db*` → 启动（会自动重建空库） |
