# 后端部署配置：构建 Python Agent Server 镜像，依赖版本来自 uv.lock。
FROM langchain/langgraph-api:3.11

# 先安装锁文件中的第三方依赖，修改业务代码时可以复用这一层。
ADD pyproject.toml /tmp/uv_export/project/pyproject.toml
ADD uv.lock /tmp/uv_export/project/uv.lock
WORKDIR /tmp/uv_export/project
RUN uv export --no-dev --package prism-research-server --frozen --no-hashes --no-emit-project --no-emit-workspace -o uv_requirements.txt
RUN PYTHONDONTWRITEBYTECODE=1 uv pip install --system --no-cache-dir -c /api/constraints.txt -r uv_requirements.txt
RUN rm -rf /tmp/uv_export

# 再安装 server/src 中的业务包，包含接口、图和数据库迁移文件。
ADD langgraph.json /deps/workspace/langgraph.json
ADD pyproject.toml /deps/workspace/pyproject.toml
ADD server /deps/workspace/server
ADD uv.lock /deps/workspace/uv.lock
WORKDIR /deps/workspace
RUN PYTHONDONTWRITEBYTECODE=1 uv pip install --system --no-cache-dir -c /api/constraints.txt --no-deps -e .

# Studio 会发送认证和追踪请求头，方法和请求头放行，来源仍按名单检查。
ENV LANGGRAPH_HTTP='{"app":"prism_server.app:app","cors":{"allow_origins":["http://127.0.0.1:4178","http://localhost:4178","https://smith.langchain.com"],"allow_methods":["*"],"allow_headers":["*"],"allow_credentials":true}}'
ENV LANGSERVE_GRAPHS='{"prism_research": "prism_server.graphs.research.graph:graph"}'

# 安装业务依赖后，确保仍使用基础镜像自带的 Agent Server。
RUN mkdir -p /api/langgraph_api /api/langgraph_runtime /api/langgraph_license && touch /api/langgraph_api/__init__.py /api/langgraph_runtime/__init__.py /api/langgraph_license/__init__.py
RUN PYTHONDONTWRITEBYTECODE=1 uv pip install --system --no-cache-dir --no-deps -e /api
# 运行镜像不再需要构建工具，清理后减小体积。
RUN pip uninstall -y pip setuptools wheel
RUN rm -rf /usr/local/lib/python*/site-packages/pip* /usr/local/lib/python*/site-packages/setuptools* /usr/local/lib/python*/site-packages/wheel* && find /usr/local/bin -name "pip*" -delete || true
RUN rm -rf /usr/lib/python*/site-packages/pip* /usr/lib/python*/site-packages/setuptools* /usr/lib/python*/site-packages/wheel* && find /usr/bin -name "pip*" -delete || true
RUN uv pip uninstall --system pip setuptools wheel && rm /usr/bin/uv /usr/bin/uvx

WORKDIR /deps/workspace
