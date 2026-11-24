from langgraph.graph import END, START, StateGraph

from prism_server.graphs.research.state import ResearchState


def connect_workflow(builder: StateGraph[ResearchState]) -> None:
    """当前只有一条路线：开始 → 连通性验证 → 结束。"""
    builder.add_edge(START, "connection_check")
    builder.add_edge("connection_check", END)
