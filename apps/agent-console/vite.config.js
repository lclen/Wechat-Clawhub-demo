import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "");
    var apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8300";
    var localProxyTarget = env.VITE_LOCAL_PROXY_TARGET || "http://127.0.0.1:8765";
    return {
        plugins: [react()],
        server: {
            host: "0.0.0.0",
            port: 5174,
            proxy: {
                "/api": {
                    target: apiProxyTarget,
                    changeOrigin: true,
                },
                "/local": {
                    target: localProxyTarget,
                    changeOrigin: true,
                },
            },
        },
    };
});
