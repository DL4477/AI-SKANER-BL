"""Build-time only: download pinned OCR assets and record their checksums."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import urllib.request
import yaml
import rapidocr

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / ".local" / "ocr-assets"
DEST.mkdir(parents=True, exist_ok=True)
models = yaml.safe_load((Path(rapidocr.__file__).parent / "default_models.yaml").read_text(encoding="utf-8"))["onnxruntime"]["PP-OCRv5"]
assets = []
for section, name in [("det", "ch_PP-OCRv5_det_mobile"), ("rec", "eslav_PP-OCRv5_rec_mobile"), ("cls", "ch_PP-LCNet_x0_25_textline_ori_cls_mobile")]:
    entry = models[section][name]
    assets.append((name + ".onnx", entry["model_dir"], entry["SHA256"].lower()))
for lang in ("rus", "eng"):
    assets.append((lang + ".traineddata", f"https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/{lang}.traineddata", None))
manifest_path = ROOT / "tools" / "ocr" / "assets.lock.json"
previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
manifest = {"rapidocr": importlib.metadata.version("rapidocr"), "assets": []}
for name, url, expected in assets:
    expected = expected or next((v["sha256"] for v in previous.get("assets", []) if v["name"] == name), None)
    path = DEST / name
    if not path.exists():
        print("Downloading", name, flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            content = response.read()
        path.write_bytes(content)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if expected and digest != expected:
        raise RuntimeError(f"Checksum mismatch: {name}")
    manifest["assets"].append({"name": name, "url": url, "sha256": digest})
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(DEST / "assets.lock.json").write_text(manifest_path.read_text(encoding="utf-8"), encoding="utf-8")
print("All assets verified.", flush=True)
