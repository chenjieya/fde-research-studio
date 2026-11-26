"""只在测试中使用的两种 HTTP 协议模拟器；真正调用 LangChain 适配器。"""

import base64
import json
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


@contextmanager
def mock_provider(*, generated_media=None):
    requests = []
    tasks = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def respond(self, result, status=200):
            data = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def result_uri(self, kind):
            default = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=") if kind == "image" else b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 20
            raw = (generated_media or {}).get(kind, default)
            return f"data:{'image/png' if kind == 'image' else 'video/mp4'};base64," + base64.b64encode(raw).decode()

        def do_GET(self):
            requests.append({"path": self.path, "method": "GET", "headers": dict(self.headers)})
            task_id = self.path.rsplit("/", 1)[-1]
            provider = tasks.get(task_id)
            if provider == "wan":
                self.respond({"output": {"task_id": task_id, "task_status": "SUCCEEDED", "video_url": self.result_uri("video")}})
            elif provider == "seedance":
                self.respond({"id": task_id, "status": "succeeded", "content": {"video_url": self.result_uri("video")}})
            elif provider == "krea":
                self.respond({"job_id": task_id, "status": "completed", "result": {"urls": [self.result_uri("image")]}})
            else:
                self.respond({"error": {"code": "NotFound"}}, 404)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append({"path": self.path, "body": body, "headers": dict(self.headers)})
            if self.path == "/api/v1/services/aigc/multimodal-generation/generation":
                self.respond({"output": {"choices": [{"message": {"content": [{"image": self.result_uri("image")}]}}]}})
                return
            if self.path == "/v1/images/generations":
                self.respond({"data": [{"b64_json": self.result_uri("image").split(",", 1)[1]}]})
                return
            if self.path in {"/contents/generations/tasks", "/api/v1/services/aigc/video-generation/video-synthesis"} or self.path.startswith("/generate/image/krea/"):
                provider = "seedance" if self.path == "/contents/generations/tasks" else "krea" if self.path.startswith("/generate/image/krea/") else "wan"
                task_id = "test-task-" + str(len(tasks))
                tasks[task_id] = provider
                self.respond({"output": {"task_id": task_id}} if provider == "wan" else {"job_id" if provider == "krea" else "id": task_id})
                return
            if self.path == "/v1/cosmos/nvidia/cosmos3-nano":
                self.send_response(200)
                # 测试协议与持久化，媒体内容不用于评价生成质量。
                media = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=") if body["model_mode"] == "text2image" else b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 20
                media = (generated_media or {}).get("image" if body["model_mode"] == "text2image" else "video", media)
                key = "b64_image" if body["model_mode"] == "text2image" else "b64_video"
                data = json.dumps({key: base64.b64encode(media).decode()}).encode()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            anthropic = self.path == "/v1/messages"
            if body["model"] == "slow":
                time.sleep(2)
            if body["model"] == "reject":
                self.send_response(401)
                result = {
                    "type": "error",
                    "error": {"type": "authentication_error", "message": "private-provider-error"},
                }
            else:
                self.send_response(200)
                text = "模拟接口验证成功：" + str(len(body["messages"])) + " 条消息"
                result = (
                    {
                        "id": "msg_test",
                        "type": "message",
                        "role": "assistant",
                        "model": body["model"],
                        "content": [{"type": "text", "text": text}],
                        "stop_reason": "end_turn",
                        "stop_sequence": None,
                        "usage": {"input_tokens": 12, "output_tokens": 8},
                    }
                    if anthropic
                    else {
                        "id": "chatcmpl-test",
                        "object": "chat.completion",
                        "created": 1,
                        "model": body["model"],
                        "choices": [
                            {
                                "index": 0,
                                "message": {"role": "assistant", "content": text},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
                    }
                )
            if body.get("stream") and not anthropic and body["model"] != "reject":
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                chunks = [
                    {"id": "chatcmpl-test", "object": "chat.completion.chunk", "created": 1, "model": body["model"], "choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}]},
                    {"id": "chatcmpl-test", "object": "chat.completion.chunk", "created": 1, "model": body["model"], "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
                    {"id": "chatcmpl-test", "object": "chat.completion.chunk", "created": 1, "model": body["model"], "choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20}},
                ]
                self.wfile.write("".join("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n" for chunk in chunks).encode() + b"data: [DONE]\n\n")
                return
            data = json.dumps(result, ensure_ascii=False).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            try:
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=3)
