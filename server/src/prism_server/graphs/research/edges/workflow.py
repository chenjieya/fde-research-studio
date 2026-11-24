from langgraph.graph import END, START, StateGraph

from prism_server.graphs.research.state import ResearchState


def connect_workflow(builder: StateGraph[ResearchState]) -> None:
    """当前只有一条路线：开始 → AI 模型 → 结束。"""
    builder.add_edge(START, "model")
    builder.add_edge("model", END)
