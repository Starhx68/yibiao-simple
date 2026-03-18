"""MinIO文件存储服务"""
import io
import uuid
from datetime import timedelta
from fastapi import UploadFile
from minio import Minio
from minio.error import S3Error
import json

from ..config import settings


class MinioService:
    def __init__(self):
        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure
        )
        self.bucket_name = settings.minio_bucket
        self._ensure_bucket()
    
    def _ensure_bucket(self):
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
            policy = {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {"AWS": ["*"]},
                        "Action": ["s3:GetObject"],
                        "Resource": [f"arn:aws:s3:::{self.bucket_name}/*"],
                    }
                ],
            }
            self.client.set_bucket_policy(self.bucket_name, json.dumps(policy))
        except S3Error:
            pass
    
    async def upload_file(self, file: UploadFile, user_id: int) -> str:
        file_ext = file.filename.split('.')[-1] if '.' in file.filename else 'bin'
        object_name = f"{settings.minio_object_prefix}/{user_id}/{uuid.uuid4()}.{file_ext}"
        
        content = await file.read()
        content_size = len(content)
        
        self.client.put_object(
            self.bucket_name,
            object_name,
            io.BytesIO(content),
            content_size,
            content_type=file.content_type
        )
        
        if settings.minio_public_base_url:
            return f"{settings.minio_public_base_url}/{self.bucket_name}/{object_name}"
        
        url = self.client.presigned_get_object(
            self.bucket_name,
            object_name,
            expires=timedelta(seconds=settings.minio_presigned_expire_seconds)
        )
        return url
    
    def get_file_url(self, object_name: str) -> str:
        if settings.minio_public_base_url:
            return f"{settings.minio_public_base_url}/{self.bucket_name}/{object_name}"
        
        return self.client.presigned_get_object(
            self.bucket_name,
            object_name,
            expires=timedelta(seconds=settings.minio_presigned_expire_seconds)
        )
    
    def delete_file(self, object_name: str):
        try:
            self.client.remove_object(self.bucket_name, object_name)
        except S3Error:
            pass
