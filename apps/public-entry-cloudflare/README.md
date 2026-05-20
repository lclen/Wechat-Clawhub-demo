# Public Entry Cloudflare Pages Proxy

这个目录用于把公共入口部署到 Cloudflare Pages，同时继续复用远端 gateway：

- Cloudflare Pages 负责 `https://<pages-domain>/entry` 的公网 HTTPS 入口。
- Gateway 继续运行在 `http://47.97.222.122:5200`。
- `functions/[[path]].ts` 代理 `/entry`、`/api/public-entry/*`、`/api/setup/public-entry` 到远端 gateway。

## Deploy

```powershell
cd apps\public-entry-cloudflare
npx wrangler pages deploy public --project-name wechat-claw-hub-entry
```

部署成功后，在控制台“公共入口资料”里把公共入口基址改成 Cloudflare Pages 域名，例如：

```text
https://wechat-claw-hub-entry.pages.dev
```
