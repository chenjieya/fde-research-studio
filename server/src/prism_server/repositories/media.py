"""媒体存取边界：限制体积、核对文件签名，不读取用户提供的任意路径或 URL。"""

import base64
import binascii
from uuid import uuid4

from prism_server.core.exceptions import RuntimeServiceError
from prism_server.db.postgres import PostgresDatabase
from prism_server.schemas.media import MAX_IMAGE_BYTES, MAX_MEDIA_BYTES, MAX_VIDEO_BYTES, MediaAsset


def detect_media(content: bytes) -> str:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    if len(content) >= 12 and content[4:8] == b"ftyp":
        return "video/mp4"
    if content.startswith(b"\x1aE\xdf\xa3"):
        return "video/webm"
    raise RuntimeServiceError(422, "文件格式无法识别，请上传 PNG、JPEG、WebP、GIF、MP4 或 WebM。")


def decode_media(value: str) -> bytes:
    """限制解码前后的体积；不下载模型返回的任意外部地址。"""
    encoded = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    if len(encoded) > (MAX_MEDIA_BYTES + 2) // 3 * 4:
        raise RuntimeServiceError(502, "模型返回的媒体超过 64 MB，请降低分辨率或帧数。")
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise RuntimeServiceError(502, "模型返回了无法解码的媒体。") from None


class MediaRepository:
    def __init__(self, database: PostgresDatabase):
        self.database = database

    @staticmethod
    def record(row: dict) -> MediaAsset:
        return MediaAsset(
            **{key: row[key] for key in ("id", "kind", "mime_type", "filename", "size")},
            url=f"/api/runtime/media/{row['id']}",
        )

    def save(
        self,
        content: bytes,
        filename: str,
        mime_type: str | None = None,
        *,
        generated: bool = False,
    ) -> MediaAsset:
        actual_type = detect_media(content)
        if mime_type and mime_type != actual_type:
            raise RuntimeServiceError(422, "文件内容与声明的媒体格式不一致。")
        limit = (
            MAX_MEDIA_BYTES
            if generated
            else MAX_IMAGE_BYTES
            if actual_type.startswith("image/")
            else MAX_VIDEO_BYTES
        )
        if len(content) > limit:
            raise RuntimeServiceError(413, f"文件过大，当前上限为 {limit // 1024 // 1024} MB。")
        safe_name = filename.replace("\\", "/").rsplit("/", 1)[-1]
        safe_name = "".join(char for char in safe_name if char.isprintable())[:200] or "media"
        if generated and "." not in safe_name:
            extension = "jpg" if actual_type == "image/jpeg" else actual_type.split("/")[1]
            safe_name += f".{extension}"
        with self.database.connect() as connection:
            row = connection.execute(
                "INSERT INTO media_assets(id,kind,mime_type,filename,size,content) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id,kind,mime_type,filename,size",
                (
                    str(uuid4()),
                    actual_type.split("/")[0],
                    actual_type,
                    safe_name,
                    len(content),
                    content,
                ),
            ).fetchone()
        return self.record(row)

    def get(self, media_id: str, *, content: bool = False) -> tuple[MediaAsset, bytes]:
        fields = "id,kind,mime_type,filename,size" + (",content" if content else "")
        with self.database.connect() as connection:
            row = connection.execute(
                f"SELECT {fields} FROM media_assets WHERE id=%s AND workspace_id='default'",
                (media_id,),
            ).fetchone()
        if row is None:
            raise RuntimeServiceError(404, "媒体文件不存在，请重新上传。")
        return self.record(row), bytes(row["content"]) if content else b""

    def list_refs(self, ids: list[str]) -> list[MediaAsset]:
        if not ids:
            return []
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT id,kind,mime_type,filename,size FROM media_assets WHERE workspace_id='default' AND id=ANY(%s)",
                (ids,),
            ).fetchall()
        found = {row["id"]: self.record(row) for row in rows}
        if any(media_id not in found for media_id in ids):
            raise RuntimeServiceError(404, "媒体文件不存在，请重新上传。")
        return [found[media_id] for media_id in ids]

    def data_uri(self, media_id: str) -> tuple[MediaAsset, str]:
        asset, content = self.get(media_id, content=True)
        return asset, f"data:{asset.mime_type};base64,{base64.b64encode(content).decode()}"
