# 后端部署指南（Cloudflare Workers + D1）

## 前提

- 一个 Cloudflare 账号（免费即可）
- 已登录 wrangler

## 步骤

### 1. 登录

```bash
cd v2/api
npx wrangler login
```
浏览器会弹出授权页，点「允许」。

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create haircrm
```

输出里会有一行 `database_id = "xxxx-xxxx"`，**复制它**。

### 3. 把 ID 填进 wrangler.json

```json
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "haircrm",
      "database_id": "这里粘贴你的 database_id"
    }
  ]
}
```

### 4. 部署

```bash
npx wrangler deploy
```

输出会有类似：
```
https://haircrm-api.<你的子域>.workers.dev
```

**记下这个地址。**

### 5. 初始化数据库

浏览器打开（或 curl）：
```
https://haircrm-api.<你的子域>.workers.dev/api/init
```
用 POST 方式。

或命令行：
```bash
curl -X POST https://haircrm-api.<你的子域>.workers.dev/api/init
```

### 6. 前端填上后端地址

编辑 `v2/js/db.js`：
```js
const API_CONFIG = {
  mode: 'cloud',
  baseUrl: 'https://haircrm-api.<你的子域>.workers.dev',   // ← 改成你的
};
```

然后 push 到 GitHub，前端就接到后端了。

## 验证

```bash
# 健康检查
curl https://haircrm-api.xxx.workers.dev/health
# 应返回 {"ok":true,"db":true,...}

# 店铺数据
curl https://haircrm-api.xxx.workers.dev/api/shop
```

## 成本

| 项 | 免费额度 | 说明 |
|---|---|---|
| Workers 请求 | 10 万次/天 | 5 家店用不完 |
| D1 读 | 500 万行/天 | 富余 |
| D1 写 | 10 万行/天 | 富余 |
| **合计** | **¥0** | |

## 常见问题

**Q: 前端报 CORS 错误？**
Worker 里已经配了 `Access-Control-Allow-Origin: *`，应该不会。若出现，检查部署是否成功。

**Q: 数据会不会丢？**
D1 是持久化数据库，不会。但免费版有存储上限（5GB），养发馆用几年也到不了。

**Q: 能改回本地模式吗？**
能。把 `API_CONFIG.mode` 改成 `'local'` 即可，代码同时支持两种模式。

**Q: 以后要迁走怎么办？**
```bash
npx wrangler d1 export haircrm --output=backup.sql
```
导出为 SQL，可导入任何 SQLite/PG 数据库。
