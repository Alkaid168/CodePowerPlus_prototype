"""Scoped import of locally collected results. No OJ credentials accepted."""
import os
import sqlite3
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool
from app.collection import CollectionStore, ImportBatch, verify_token
from app.collection_storage import DEFAULT_LIMIT, DEFAULT_WARNING, StorageQuotaExceeded
from app.container import get_container

router=APIRouter(prefix='/api/collection',tags=['collection'])
MAX_BODY=8_000_000

def scope(request: Request):
    secret=os.getenv('CODEPOWERPLUS_COLLECTION_SECRET','')
    if len(secret)<32: raise HTTPException(503,'Collection import is disabled; configure a 32+ character server secret')
    auth=request.headers.get('authorization','')
    if not auth.startswith('Bearer '): raise HTTPException(401,'Import token required')
    try: return verify_token(secret,auth[7:])
    except ValueError: raise HTTPException(401,'Invalid or expired import token') from None

def store(request):
    c=get_container(request)
    path=Path(os.getenv('CODEPOWERPLUS_COLLECTION_DB',str(Path(c.settings.db_path).parent/'collection.db'))).resolve()
    if c.settings.db_path!=':memory:' and path==Path(c.settings.db_path).resolve():
        raise HTTPException(503,'Collection database must be separate from learning database')
    try:
        return CollectionStore(path,
            limit_bytes=int(os.getenv('CODEPOWERPLUS_COLLECTION_LIMIT_BYTES', str(DEFAULT_LIMIT))),
            warning_bytes=int(os.getenv('CODEPOWERPLUS_COLLECTION_WARNING_BYTES', str(DEFAULT_WARNING))))
    except ValueError:
        raise HTTPException(503,'Invalid collection storage configuration or schema') from None
    except sqlite3.Error:
        raise HTTPException(503,'Collection storage unavailable; retry later') from None

def storage_call(request, method, *args, **kwargs):
    try: return getattr(store(request), method)(*args, **kwargs)
    except StorageQuotaExceeded as exc:
        raise HTTPException(413, exc.detail) from None
    except sqlite3.Error:
        raise HTTPException(503, 'Collection storage unavailable; retry later', headers={'Retry-After':'5'}) from None

@router.post('/batches')
async def import_batch(request:Request,claim=Depends(scope)):
    if claim['purpose']!='import': raise HTTPException(403,'Import token required')
    data=bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data)>MAX_BODY: raise HTTPException(413,'Batch exceeds 8 MB; use smaller batches')
    try: batch=ImportBatch.model_validate_json(bytes(data))
    except ValidationError: raise HTTPException(422,'Invalid collection batch or unsupported fields') from None
    if (batch.platform,batch.account_id)!=(claim['platform'],claim['account_id']):
        raise HTTPException(403,'Token does not cover this platform/account')
    try: return await run_in_threadpool(storage_call,request,'import_batch',claim['user_id'],batch)
    except ValueError as exc: raise HTTPException(409,str(exc)) from None

@router.get('/submissions')
def list_submissions(request:Request,limit:int=Query(50,ge=1,le=100),offset:int=Query(0,ge=0),claim=Depends(scope)):
    return storage_call(request,'list_submissions',claim['user_id'],limit,offset,platform=claim['platform'],account_id=claim['account_id'])

@router.get('/storage')
def storage_usage(request:Request,claim=Depends(scope)):
    return storage_call(request,'usage',claim['user_id'])

@router.delete('/submissions')
def delete_submissions(request:Request,confirm:Literal['delete-account-data']=Query(...),claim=Depends(scope)):
    if claim['purpose']!='manage': raise HTTPException(403,'Dedicated management token required')
    return storage_call(request,'delete_account',claim['user_id'],claim['platform'],claim['account_id'])
