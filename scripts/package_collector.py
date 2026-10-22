"""Build a deterministic MV3 source package without local data or dependencies."""
from pathlib import Path
import hashlib
import json
import zipfile
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'extensions'/'collector'
def build():
    manifest=json.loads((SOURCE/'manifest.json').read_text(encoding='utf-8'))
    output=ROOT/'output'/'collector'
    output.mkdir(parents=True,exist_ok=True)
    target=output/f"codepowerplus-collector-{manifest['version']}.zip"
    files=[SOURCE/'manifest.json',SOURCE/'collector.html',SOURCE/'collector.css',SOURCE/'README.md',*sorted((SOURCE/'src').glob('*.js'))]
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            info=zipfile.ZipInfo(file.relative_to(SOURCE).as_posix(),(2026,10,21,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,file.read_bytes())
    receipt={'file':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':len(files)}
    (output/'package.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    return receipt
if __name__=='__main__': print(json.dumps(build(),ensure_ascii=False))
