"""把研究图的状态、节点和连线组装起来。"""

from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from prism_server.graphs.research.edges.workflow import connect_workflow
from prism_server.graphs.research.nodes.connection_check import connection_check
from prism_server.graphs.research.state import ResearchInput, ResearchOutput, ResearchState


def build_graph() -> CompiledStateGraph:
    """编译出可以调用的图；这里不会启动 HTTP 服务，也不会执行节点。"""
    # ResearchState 是内部共享状态；input/output_schema 决定对外收发哪些字段。
    builder = StateGraph(ResearchState, input_schema=ResearchInput, output_schema=ResearchOutput)
    builder.add_node("connection_check", connection_check)
    connect_workflow(builder)
    return builder.compile(name="Prism 研究工作台 · 连通性验证")


# langgraph.json 的 graphs 指向这个实例，Agent Server 启动时会导入它。
graph = build_graph()
