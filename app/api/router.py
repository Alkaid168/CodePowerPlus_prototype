"""把所有接口模块聚合成一个路由，main.py 只挂载一次。"""
from fastapi import APIRouter

from app.api import knowledge, learners, overview, problems, reviews, submissions, tutor, collection

api_router = APIRouter()
for module in (knowledge, problems, reviews, submissions, learners, overview, tutor, collection):
    api_router.include_router(module.router)
