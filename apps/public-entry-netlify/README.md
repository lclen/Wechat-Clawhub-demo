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
http://47.97.222.122:5200
```

这个地址是公网可访问的 gateway 源站。Netlify 会把 `https://<site>.netlify.app/entry` 代理到这个 HTTP 源站。

如果未来源站变更，只需要同步修改 `public/_redirects` 中的目标地址。
