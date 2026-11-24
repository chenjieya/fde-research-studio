# 前端部署配置：直接提供 Vite 构建出的 dist 文件。
FROM nginx:stable-alpine
COPY dist/ /usr/share/nginx/html/
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
