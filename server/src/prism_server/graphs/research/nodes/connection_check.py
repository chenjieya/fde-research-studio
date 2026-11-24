from prism_server.graphs.research.state import ResearchInput, ResearchOutput


def connection_check(state: ResearchInput) -> ResearchOutput:
    """检查输入并回传文字，用来验证图能跑通，当前不会调用 AI。"""
    prompt = state["prompt"].strip()
    if not prompt or len(prompt) > 4000:
        raise ValueError("验证输入需要为 1 到 4000 个字符")
    return {
        "message": "Agent Server 已执行连通性验证节点；本次未调用 AI 模型。",
        "echo": prompt,
        "request_id": state["request_id"],
        "execution_mode": "connection_check",
    }
