"""媒体只在图状态和运行记录中保存引用，二进制内容留在服务端。"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

MediaKind = Literal["image", "video"]
MediaId = Annotated[str, Field(pattern=r"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$")]
GenerationMode = Literal["text2image", "image2image", "text2video", "image2video", "video2video"]
MAX_MEDIA_BYTES = 64 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_VIDEO_BYTES = 32 * 1024 * 1024


class MediaAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: MediaId
    kind: MediaKind
    mime_type: Literal[
        "image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"
    ]
    filename: str = Field(min_length=1, max_length=200)
    size: int = Field(gt=0, le=MAX_MEDIA_BYTES)
    url: str


class GenerationOptions(BaseModel):
    """统一生成选项；适配器只发送对应协议支持的字段，不把整份配置透传。"""

    model_config = ConfigDict(extra="forbid")
    resolution: Literal[
        "256_16_9",
        "256_1_1",
        "256_9_16",
        "480_16_9",
        "480_1_1",
        "480_9_16",
        "720_16_9",
        "720_1_1",
        "720_9_16",
    ] = "480_16_9"
    num_frames: int = Field(default=25, ge=25, le=197, strict=True)
    num_inference_steps: int = Field(default=35, ge=1, le=100, strict=True)
    fps: int = Field(default=24, ge=1, le=60, strict=True)
    seed: int | None = Field(default=None, ge=0, le=2147483647, strict=True)
    image_size: str = Field(default="1024x1024", pattern=r"^(auto|\d{3,4}x\d{3,4})$")
    quality: Literal["auto", "low", "medium", "high"] = "auto"
    video_resolution: Literal["480p", "720p", "1080p"] = "720p"
    aspect_ratio: Literal["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] = "16:9"
    duration: int = Field(default=5, ge=2, le=30, strict=True)
    audio: bool = True
    creativity: Literal["raw", "low", "medium", "high"] = "medium"
    negative_prompt: str = Field(default="", max_length=4000)
