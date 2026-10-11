"""Keep upstream licensing notices in the frozen distribution."""
import importlib.metadata
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parents[2]
dest = root / '.local/ocr-licenses'
dest.mkdir(parents=True, exist_ok=True)
lines = []
for dist in importlib.metadata.distributions():
    name = dist.metadata['Name']
    lines.append(f'{name} {dist.version}: {dist.metadata.get("License-Expression", dist.metadata.get("License", "see included license files"))}')
    for file in dist.files or []:
        if any(word in file.name.lower() for word in ('license', 'copying', 'notice')):
            source = Path(dist.locate_file(file))
            if source.is_file():
                target = dest / name / str(file).replace('..', '_')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
python_license = Path(sys.base_prefix) / 'LICENSE.txt'
if python_license.exists():
    shutil.copy2(python_license, dest / 'Python-LICENSE.txt')
shutil.copy2(root / 'tools/ocr/THIRD-PARTY.txt', dest / 'THIRD-PARTY.txt')
(dest / 'packages.txt').write_text('\n'.join(lines), encoding='utf-8')
