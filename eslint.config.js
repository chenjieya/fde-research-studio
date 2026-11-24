// 前端配置：检查浏览器代码、前端测试和 JS 配置文件。
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig([
  // 依赖、构建结果和 Python 文件由各自的工具处理。
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.venv/**',
      '.data/**',
      '.langgraph_api/**',
      '.claude/**',
      '.codex/**',
      '.qa/**',
      '**/*.egg-info/**',
      '**/__pycache__/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    // src 在浏览器运行，允许使用 document、window 等全局变量。
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.config.js', 'tests/**/*.mjs'],
    // 配置和测试在 Node.js 运行，允许使用 process 等全局变量。
    languageOptions: { globals: globals.node },
  },
  {
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  // 格式交给 Prettier，关闭 ESLint 中与它冲突的格式规则。
  prettier,
]);
