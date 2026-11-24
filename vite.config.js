// 前端配置：开发服务、接口转发、构建和本地预览。
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // 这里只用后端地址，不会把 .env 里的数据库密码或密钥发给浏览器。
  const env = loadEnv(mode, process.cwd(), 'PRISM_');
  const proxy = {
    // 浏览器请求 /api/workspace，转发后是 Agent Server 的 /prism/workspace。
    '/api': {
      target: env.PRISM_AGENT_API_URL || 'http://127.0.0.1:2024',
      changeOrigin: true,
      proxyTimeout: 35000,
      timeout: 35000,
      rewrite: (path) => path.replace(/^\/api(?=\/)/, '/prism'),
    },
  };

  return {
    server: {
      host: '127.0.0.1',
      port: 4178,
      // 端口被占用就报错，避免换端口后读不到原地址下的浏览器记录。
      strictPort: true,
      proxy,
      fs: {
        // Vite 会提供源码文件，后端代码、密钥和本地数据需要明确拦住。
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          '**/.venv/**',
          '**/.data/**',
          '**/.langgraph_api/**',
          '**/.claude/**',
          '**/.codex/**',
          '**/.qa/**',
          '**/server/**',
        ],
      },
    },
    // 预览构建结果时，也沿用同一套接口转发。
    preview: { host: '127.0.0.1', port: 4178, strictPort: true, proxy },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
