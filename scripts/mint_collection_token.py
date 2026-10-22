"""Offline administrator helper: no public anonymous token issuance."""
import argparse
import os
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
from app.collection import mint_token

if __name__=='__main__':
    load_dotenv()
    parser=argparse.ArgumentParser(description='Issue short-lived, account-scoped collector import token')
    parser.add_argument('--user',required=True)
    parser.add_argument('--platform',required=True,choices=['codeforces','luogu','atcoder','vjudge'])
    parser.add_argument('--account',required=True)
    parser.add_argument('--purpose',choices=['import','manage'],default='import',
                        help='manage only for explicitly requested account data deletion')
    args=parser.parse_args()
    print(mint_token(os.environ['CODEPOWERPLUS_COLLECTION_SECRET'],args.user,args.platform,args.account,purpose=args.purpose))
