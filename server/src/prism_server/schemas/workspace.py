"""研究记录的字段和校验规则，继续兼容原来的 JSON 备份。"""

from datetime import date
from typing import Annotated, Literal, Self
from urllib.parse import urlparse

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, model_validator

Domain = Literal["图片", "CAD", "视频", "语言文本"]
Stage = Literal["待调研", "研究中", "已验证", "持续跟踪"]
Capability = Literal["生成编辑", "识别理解"]
RecordId = Annotated[str, Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")]
Title = Annotated[str, Field(min_length=1, max_length=200000)]


def valid_source(value: str) -> str:
    """来源可以暂时不填；填写时只接受有效的网页地址。"""
    if value:
        parsed = urlparse(value)
        if parsed.scheme not in {"https", "http"} or not parsed.netloc:
            raise ValueError("来源只支持有效的 http 或 https 地址")
    return value


Source = Annotated[str, AfterValidator(valid_source)]


class Record(BaseModel):
    """所有记录共用的限制：不接受额外字段，单个文本不超过 20 万字符。"""

    model_config = ConfigDict(extra="forbid", str_max_length=200000, populate_by_name=True)


class ModelRecord(Record):
    """模型档案；demo 用来保留示例标记，favorite 表示是否关注。"""

    id: RecordId
    name: Title
    vendor: str
    domain: Domain
    capabilities: list[Capability] = Field(min_length=1, max_length=2)
    stage: Stage
    summary: str
    route: str
    access: str
    license: str
    source: Source
    updated: date
    notes: str
    demo: StrictBool
    favorite: StrictBool

    @model_validator(mode="after")
    def unique_capabilities(self) -> Self:
        if len(set(self.capabilities)) != len(self.capabilities):
            raise ValueError("模型能力不可重复")
        return self


class Experiment(Record):
    """一次实验的样本数、结果和限制；空耗时、空成本不等于零。"""

    id: RecordId
    title: Title
    modelId: RecordId
    task: str
    dataset: str
    sampleSize: int = Field(strict=True, ge=1, le=2147483647)
    successCount: int = Field(strict=True, ge=0, le=2147483647)
    latency: float | None = Field(ge=0, allow_inf_nan=False)
    cost: float | None = Field(ge=0, allow_inf_nan=False)
    conclusion: str
    limitations: str
    date: date
    demo: StrictBool

    @model_validator(mode="after")
    def valid_success_count(self) -> Self:
        if self.successCount > self.sampleSize:
            raise ValueError("成功数不能大于样本数")
        return self


class ResearchNote(Record):
    """前沿手记，保留来源、研究领域和当前进展。"""

    id: RecordId
    title: Title
    domain: Domain
    stage: Stage
    body: str
    source: Source
    date: date
    demo: StrictBool


class Artifact(Record):
    """一份可编辑的交付物；modelIds 记录报告引用了哪些模型。"""

    id: RecordId
    title: Title
    kind: Literal["研究周报", "模型对比报告", "FDE 方案草稿", "技术调研简报"]
    modelIds: list[RecordId] = Field(max_length=10000)
    content: str
    date: date


class Workspace(Record):
    """整份研究空间，保存前检查重复 ID 和不存在的模型引用。"""

    version: Literal[1] = 1
    models: list[ModelRecord] = Field(max_length=10000)
    experiments: list[Experiment] = Field(max_length=10000)
    notes: list[ResearchNote] = Field(max_length=10000)
    artifacts: list[Artifact] = Field(max_length=10000)

    @model_validator(mode="after")
    def valid_references(self) -> Self:
        for records in (self.models, self.experiments, self.notes, self.artifacts):
            if len({item.id for item in records}) != len(records):
                raise ValueError("同类记录 ID 不可重复")
        model_ids = {item.id for item in self.models}
        if any(item.modelId not in model_ids for item in self.experiments):
            raise ValueError("实验引用的模型不存在")
        for artifact in self.artifacts:
            if len(set(artifact.modelIds)) != len(artifact.modelIds) or not set(artifact.modelIds) <= model_ids:
                raise ValueError("交付物引用的模型重复或不存在")
        return self


class WorkspaceSnapshot(Record):
    """返回给页面的记录和版本号。"""

    data: Workspace
    revision: int = Field(ge=0)


class WorkspaceWrite(Record):
    """页面要保存的记录，以及它读取数据时拿到的版本号。"""

    data: Workspace
    expected_revision: int = Field(strict=True, ge=0)


class WorkspaceImport(Record):
    """旧记录和迁移编号，用来识别重复提交。"""

    data: Workspace
    source_id: str = Field(min_length=1, max_length=200)
