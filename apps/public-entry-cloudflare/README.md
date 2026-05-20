# Public Entry Cloudflare Pages Proxy

这个目录用于把公共入口部署到 Cloudflare Pages，同时继续复用远端 gateway：

- Cloudflare Pages 负责 `https://<pages-domain>/entry` 的公网 HTTPS 入口。
- Gateway 默认运行在 `http://47.97.222.122:5200`，但 Cloudflare 生产环境建议通过环境变量 `ORIGIN_BASE_URL` 指向一个可从 Cloudflare 边缘访问的源站域名。
- `functions/[[path]].ts` 代理 `/entry`、`/api/public-entry/*`、`/api/setup/public-entry` 到远端 gateway。

## Origin

不要在 Cloudflare Pages 生产环境长期使用裸 IP 源站：

- Cloudflare 边缘反代裸 IP 可能返回 `error code: 1003`。
- 阿里云中国区服务器使用临时解析域名（例如 `sslip.io`）可能触发未备案拦截。

推荐二选一：

1. 使用已备案并解析到 `47.97.222.122` 的域名，例如 `http://entry-origin.example.com:5200`。
2. 在服务器上跑 Cloudflare Tunnel，并把 `ORIGIN_BASE_URL` 指向 Tunnel/custom domain 的 HTTPS 地址。

Cloudflare Pages 环境变量：

```text
ORIGIN_BASE_URL=https://你的源站域名
```

## Deploy

```powershell
cd apps\public-entry-cloudflare
npx wrangler pages deploy public --project-name wechat-claw-hub-entry
```

部署成功后，在控制台“公共入口资料”里把公共入口基址改成 Cloudflare Pages 域名，例如：

```text
https://wechat-claw-hub-entry.pages.dev
```
