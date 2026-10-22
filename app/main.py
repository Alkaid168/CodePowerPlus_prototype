"""应用组装：创建 FastAPI 实例、挂载接口与静态前端。

所有业务依赖由 ``Container`` 提供，接口层只通过 ``get_container`` 取用，
因此测试可以给每个用例装配内存数据库，而不必修改模块全局变量。
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import os
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.config import Settings
from app.container import Container
from app.errors import install_error_handlers
from app.schemas import HealthOut


def create_app(settings: Settings | None = None) -> FastAPI:
    container = Container.build(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        container.close()

    app = FastAPI(title='码力加加智能辅导系统', version=container.settings.app_version,
                  description='面向算法竞赛训练的题目分析、能力画像、代码辅导与推荐原型。',
                  lifespan=lifespan)
    app.state.container = container
    # Explicitly allow only configured extension origins; no wildcard credentialed CORS.
    extension_origins = [item.strip() for item in os.getenv('CODEPOWERPLUS_COLLECTION_ALLOWED_ORIGINS', '').split(',') if item.strip()]
    if extension_origins:
        app.add_middleware(CORSMiddleware, allow_origins=extension_origins, allow_credentials=False,
                           allow_methods=['POST', 'GET', 'DELETE', 'OPTIONS'],
                           allow_headers=['Authorization', 'Content-Type'], max_age=600)
    install_error_handlers(app)
    app.include_router(api_router)

    @app.get('/health', response_model=HealthOut, tags=['meta'])
    def health():
        return {'status': 'ok', 'message': '码力加加服务运行正常',
                'version': container.settings.app_version,
                'taxonomy_version': container.taxonomy.version,
                'model_configured': container.settings.model_configured,
                'mode': 'local-single-user'}

    @app.get('/', include_in_schema=False)
    def homepage():
        return FileResponse(container.settings.web_dir / 'index.html')

    @app.middleware('http')
    async def revalidate_static_assets(request: Request, call_next):
        """静态资源每次都带 ETag 重新校验。

        开发期改前端最容易踩的坑是浏览器用启发式缓存继续跑旧模块，
        让人误判“改了没效果”。这里统一加 no-cache（仍然走 304，不会重复下载）。
        """
        response = await call_next(request)
        if request.url.path == '/' or request.url.path.startswith('/static/'):
            response.headers.setdefault('Cache-Control', 'no-cache')
        return response

    app.mount('/static', StaticFiles(directory=container.settings.web_dir), name='static')
    return app


app = create_app()
