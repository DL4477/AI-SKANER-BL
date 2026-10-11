"""Offline JSON Lines OCR worker. Stdout is exclusively the bounded protocol."""
import base64
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import sys

os.environ.setdefault("OMP_THREAD_LIMIT", "2")
PROTOCOL = sys.stdout
PROTOCOL.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.stdout = sys.stderr
import cv2
import numpy as np
from PIL import Image, ImageOps
from rapidocr import RapidOCR, OCRVersion, ModelType
from rapidocr.utils.typings import LangRec
import tesserocr

cv2.setNumThreads(2)
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2] / ".local"))
ASSETS = ROOT / "ocr-assets"
LIMIT = 6 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 6_000_000


def original_polygon(polygon, rotation, width, height):
    if rotation == 90:
        return [[width - float(y), float(x)] for x, y in polygon]
    if rotation == 270:
        return [[float(y), height - float(x)] for x, y in polygon]
    return [[float(x), float(y)] for x, y in polygon]


def verify_assets():
    manifest = json.loads((ASSETS / "assets.lock.json").read_text(encoding="utf-8"))
    for item in manifest["assets"]:
        path = ASSETS / item["name"]
        if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
            raise RuntimeError("OCR asset checksum mismatch")
    return manifest


class Engine:
    def __init__(self):
        self.manifest = verify_assets()
        self.rapid = RapidOCR(params={
            "Global.log_level": "error", "Global.text_score": 0.0,
            "Global.use_cls": False, "Global.max_side_len": 2400,
            "Det.model_path": str(ASSETS / "ch_PP-OCRv5_det_mobile.onnx"),
            "Det.ocr_version": OCRVersion.PPOCRV5, "Det.model_type": ModelType.MOBILE, "Det.limit_side_len": 2000, "Det.limit_type": "max",
            "Rec.model_path": str(ASSETS / "eslav_PP-OCRv5_rec_mobile.onnx"),
            "Rec.ocr_version": OCRVersion.PPOCRV5, "Rec.model_type": ModelType.MOBILE, "Rec.lang_type": LangRec.ESLAV,
            "EngineConfig.onnxruntime.intra_op_num_threads": 2,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        })
        # The Windows Tesseract build cannot open an absolute Unicode path.
        # A relative path uses the OS working directory and needs no 8.3 names.
        previous_dir = Path.cwd()
        try:
            os.chdir(ASSETS)
            self.tess = tesserocr.PyTessBaseAPI(path=".", lang="rus+eng", psm=tesserocr.PSM.SPARSE_TEXT)
        finally:
            os.chdir(previous_dir)
        self.metadata = {
            "rapidocr": importlib.metadata.version("rapidocr"),
            "onnxruntime": importlib.metadata.version("onnxruntime"),
            "tesseract": tesserocr.tesseract_version().splitlines()[0],
            "opencv": cv2.__version__,
            "detector": "PP-OCRv5_mobile_det", "recognizer": "eslav_PP-OCRv5_mobile_rec",
            "dictionary": "embedded ONNX metadata; pinned model SHA256",
            "assetsSha256": hashlib.sha256((ASSETS / "assets.lock.json").read_bytes()).hexdigest(),
            "device": "CPU", "languages": "rus+eng",
            "rapidParameters": "det.limit_side_len=2000; text_score=0; rotations=0,90,270; use_cls=false",
            "tesseractParameters": "PSM=11; rotations=0,90,270; grayscale + autocontrast",
        }

    def run(self, request):
        mode = request.get("mode")
        if mode == "status":
            return {"regions": [], "engines": self.metadata}
        if mode not in ("primary", "secondary"):
            raise ValueError("Unsupported OCR mode")
        encoded = request["image"]
        if not isinstance(encoded, str) or len(encoded) > LIMIT or not encoded.startswith("data:image/png;base64,"):
            raise ValueError("Invalid image")
        decoded = base64.b64decode(encoded.split(",", 1)[1], validate=True)
        with Image.open(io.BytesIO(decoded)) as im:
            if im.format != "PNG" or not (0 < im.width <= 2401 and 0 < im.height <= 2401):
                raise ValueError("Invalid image size")
            image = im.convert("RGB")
        dpi = float(request.get("dpi", 300 if mode=="primary" else 600))
        if not (0 < dpi <= 600.00001):
            raise ValueError("Invalid DPI")
        regions = self.primary(image) if mode == "primary" else self.secondary(image, dpi)
        if len(regions) > 4000:
            raise ValueError("Too many OCR regions")
        return {"regions": regions, "engines": self.metadata}

    def primary(self, image):
        array = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        regions = []
        for k in (0, 1, 3):
            output = self.rapid(np.ascontiguousarray(np.rot90(array, k)))
            if output.boxes is None:
                continue
            for box, text, score in zip(output.boxes, output.txts, output.scores):
                polygon = original_polygon(box, k * 90, image.width, image.height)
                # Extra orientation passes contribute only vertical source text.
                if k and max(p[1] for p in polygon)-min(p[1] for p in polygon) <= 1.3*(max(p[0] for p in polygon)-min(p[0] for p in polygon)):
                    continue
                regions.append({"polygon": polygon, "text": text, "confidence": float(score), "engine": "rapidocr", "rotation": k*90})
        if not regions and np.mean(np.asarray(image.convert("L")) < 180) > 0.002:
            regions.append({"polygon": [[0,0],[image.width,0],[image.width,image.height],[0,image.height]], "text": "", "confidence": 0.0, "engine": "rapidocr", "rotation": 0})
        return regions

    def secondary(self, image, dpi=600):
        regions = []
        gray = ImageOps.grayscale(image)
        variants = [gray, ImageOps.autocontrast(gray)]
        for variant in variants:
            for rotation in (0,90,270):
                current = variant.rotate(rotation, expand=True)
                self.tess.SetImage(current)
                self.tess.SetSourceResolution(max(70,round(dpi)))
                self.tess.Recognize()
                iterator = self.tess.GetIterator()
                if iterator is None:
                    continue
                level = tesserocr.RIL.TEXTLINE
                while True:
                    try:
                        text = iterator.GetUTF8Text(level)
                    except RuntimeError as error:
                        if str(error) != "No text returned":
                            raise
                        text = None
                    box = iterator.BoundingBox(level) if text else None
                    if text and text.strip() and box:
                        x0,y0,x1,y1 = box
                        polygon = original_polygon([[x0,y0],[x1,y0],[x1,y1],[x0,y1]],rotation,image.width,image.height)
                        if rotation == 0 or y1-y0 < x1-x0:
                            item = {"polygon":polygon,"text":text.strip(),"confidence":float(iterator.Confidence(level))/100,"engine":"tesseract","rotation":rotation}
                            if not any(r["text"]==item["text"] and r["rotation"]==rotation and r["polygon"]==polygon for r in regions):
                                regions.append(item)
                    if not iterator.Next(level):
                        break
                self.tess.Clear()
        return regions


def main():
    engine = None
    while True:
        line = sys.stdin.buffer.readline(LIMIT + 1)
        if not line:
            return
        if len(line) > LIMIT or not line.endswith(b"\n"):
            return
        try:
            request = json.loads(line)
            if engine is None:
                engine = Engine()
            result = {"ok": True, "data": engine.run(request)}
        except Exception as error:
            # No raw source text, paths or library traceback in the app protocol.
            print(type(error).__name__ + ": " + str(error), file=sys.stderr, flush=True)
            result = {"ok": False, "error": "Локальный OCR не смог обработать фрагмент. Повторите подготовку или переустановите OCR-компонент."}
        PROTOCOL.write(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
        PROTOCOL.flush()


if __name__ == "__main__":
    main()
