# Public Entry Netlify Proxy

这个目录用于让 Netlify 通过 `_redirects` 代理公共入口。

## Netlify build settings

- Base directory: `apps/public-entry-netlify`
- Build command: 留空
- Publish directory: `public`
- Functions directory: 留空

## Important

当前 `_redirects` 指向：

```text
http://192.168.0.17:8300
```

这个地址只在你的局域网内可访问。Netlify 云端一般访问不到局域网 IP，所以生产环境需要把 `_redirects` 目标改成公网可访问的源站，例如：

- ngrok / cpolar / NATAPP 生成的 HTTPS 地址
- 已备案域名反代到 gateway
- 其他公网可访问的 gateway 地址
