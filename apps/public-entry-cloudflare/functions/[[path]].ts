const ORIGIN_BASE_URL = "http://47.97.222.122:5200";

const PROXY_PREFIXES = [
  "/api/public-entry/",
] as const;

const EXACT_PROXY_PATHS = new Set([
  "/entry",
  "/api/setup/public-entry",
]);

export async function onRequest(context: EventContext<Env, string, unknown>): Promise<Response> {
  const requestUrl = new URL(context.request.url);

  if (requestUrl.pathname === "/") {
    return Response.redirect(`${requestUrl.origin}/entry`, 302);
  }

  if (!shouldProxyPath(requestUrl.pathname)) {
    return new Response("Not found", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const upstreamUrl = new URL(`${ORIGIN_BASE_URL}${requestUrl.pathname}`);
  upstreamUrl.search = requestUrl.search;

  const upstreamRequest = new Request(upstreamUrl, context.request);
  const upstreamResponse = await fetch(upstreamRequest);
  const headers = new Headers(upstreamResponse.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("cache-control", "no-store");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers,
  });
}

function shouldProxyPath(pathname: string): boolean {
  if (EXACT_PROXY_PATHS.has(pathname)) {
    return true;
  }
  return PROXY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

type Env = Record<string, never>;
