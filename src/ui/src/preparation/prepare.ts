import {
  getDocument,
  GlobalWorkerOptions,
  Util,
  type PDFPageProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { invoke } from "@tauri-apps/api/core";
import type { DrawingSource } from "../analysis/types";
import {
  bounds,
  comparable,
  expandBox,
  mergeRegion,
  overlap,
  pagePolygon,
  SETTINGS_KEY,
  tileBoxes,
} from "./geometry";
import type {
  Box,
  Fragment,
  OcrResult,
  Polygon,
  PreparedDrawing,
  TextRegion,
} from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;
const MIB = 1024 * 1024;
const MAX_CACHE = 160 * MIB;
const MAX_REGIONS = 20000;

export async function preparePdf(
  source: DrawingSource,
  requestId: string,
  signal: AbortSignal,
  progress: (text: string) => void,
  onPartial?: (data: PreparedDrawing) => void,
): Promise<PreparedDrawing> {
  const started = performance.now();
  const bytes = await (await fetch(source.url, { signal })).arrayBuffer();
  if (bytes.byteLength > 40 * MIB)
    throw new Error("Выберите PDF размером до 40 МБ.");
  const checksum = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const result: PreparedDrawing = {
    version: "preparation-1",
    documentId: checksum,
    checksum,
    settingsKey: SETTINGS_KEY,
    pages: [],
    pageInfo: [],
    fragments: [],
    regions: [],
    warnings: [],
    engines: {},
    elapsedMs: 0,
    status: "preparing",
    coverage: {
      pagesTotal: 0,
      pagesCompleted: 0,
      tilesCompleted: 0,
      reviewsCompleted: 0,
      unfinishedPages: [],
      errors: [],
    },
  };
  let imageBytes = 0;
  const account = (image: string) => {
    imageBytes += image.length * 0.75;
    if (imageBytes > MAX_CACHE)
      throw new Error(
        "Подготовленные изображения превысили 160 МиБ. Документ не усечён и не отправлен в Kimi.",
      );
  };
  const task = getDocument({
    data: bytes,
    cMapUrl: "/pdf-assets/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdf-assets/standard_fonts/",
    wasmUrl: "/pdf-assets/wasm/",
    iccUrl: "/pdf-assets/iccs/",
  });
  let protectedPdf = false;
  task.onPassword = () => {
    protectedPdf = true;
    void task.destroy();
  };
  const abort = () => {
    void task.destroy();
    void invoke("ocr_cancel", { requestId }).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  let begun = false;
  try {
    const pdf = await task.promise;
    signal.throwIfAborted();
    if (pdf.numPages > 8)
      throw new Error(
        "Подготовка поддерживает до 8 листов. Документ не отправлен в Kimi.",
      );
    result.coverage.pagesTotal = pdf.numPages;
    result.coverage.unfinishedPages = Array.from(
      { length: pdf.numPages },
      (_, i) => i + 1,
    );
    await invoke("ocr_begin", { requestId });
    begun = true;
    signal.throwIfAborted();
    for (let n = 1; n <= pdf.numPages; n++) {
      signal.throwIfAborted();
      progress(`Подготовка листов · лист ${n} из ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      const natural = page.getViewport({ scale: 1 });
      const overview = await render(
        page,
        [0, 0, 1, 1],
        2400 / Math.max(natural.width, natural.height),
        signal,
      );
      account(overview.image);
      result.pages.push({ page: n, ...overview });
      progress(`Чтение текста · лист ${n} из ${pdf.numPages}`);
      let textLayer: "present" | "empty" | "error" = "empty";
      try {
        const text = await page.getTextContent({ disableNormalization: true });
        for (const item of text.items) {
          if (!("str" in item) || !item.str.trim()) continue;
          const transform = Util.transform(natural.transform, item.transform);
          const angle = Math.atan2(transform[1], transform[0]);
          const height = Math.hypot(transform[2], transform[3]);
          const style = text.styles[item.fontName];
          const ascent =
            (style?.ascent ?? (style?.descent ? 1 + style.descent : 0.8)) *
            height;
          const x = transform[4] + Math.sin(angle) * ascent;
          const y = transform[5] - Math.cos(angle) * ascent;
          const textWidth =
            item.width * Math.hypot(natural.transform[0], natural.transform[1]);
          const dx = Math.cos(angle) * textWidth,
            dy = Math.sin(angle) * textWidth;
          const hx = -Math.sin(angle) * height,
            hy = Math.cos(angle) * height;
          const polygon: Polygon = [
            [x, y],
            [x + dx, y + dy],
            [x + dx + hx, y + dy + hy],
            [x + hx, y + hy],
          ].map(([px, py]) => [
            Math.max(0, Math.min(1, px / natural.width)),
            Math.max(0, Math.min(1, py / natural.height)),
          ]);
          result.regions.push({
            id: `p${n}-pdf-${result.regions.length}`,
            page: n,
            polygon,
            readings: [
              {
                text: item.str,
                engine: "pdf",
                confidence: null,
                rotation: (angle * 180) / Math.PI,
              },
            ],
            fragmentIds: [],
            reasons: [],
          });
          textLayer = "present";
        }
      } catch {
        signal.throwIfAborted();
        textLayer = "error";
        result.warnings.push(
          `Лист ${n}: текстовый слой не удалось извлечь; используются изображения и OCR.`,
        );
      }
      result.pageInfo.push({
        page: n,
        width: natural.width,
        height: natural.height,
        rotation: natural.rotation,
        textLayer,
      });
      result.warnings.push(
        `Лист ${n}: увеличение растровых участков не восстанавливает отсутствующие в скане детали.`,
      );
      const scale = 300 / 72;
      const width = Math.ceil(natural.width * scale),
        height = Math.ceil(natural.height * scale);
      const boxes = tileBoxes(width, height);
      if (boxes.length > 512)
        throw new Error(
          "Лист требует более 512 фрагментов. Подготовка остановлена без усечения.",
        );
      for (let i = 0; i < boxes.length; i++) {
        signal.throwIfAborted();
        progress(
          `OCR · лист ${n}/${pdf.numPages} · фрагмент ${i + 1}/${boxes.length}`,
        );
        const box: Box = [
          boxes[i][0] / width,
          boxes[i][1] / height,
          boxes[i][2] / width,
          boxes[i][3] / height,
        ];
        const picture = await render(page, box, scale, signal);
        const fragment: Fragment = {
          id: `p${n}-tile-${i}`,
          page: n,
          bbox: box,
          dpi: 300,
          rotation: natural.rotation,
          purpose: "tile",
          ...picture,
        };
        account(picture.image);
        result.fragments.push(fragment);
        const reading = await invoke<OcrResult>("ocr_image", {
          requestId,
          image: picture.image,
          mode: "primary",
          dpi: fragment.dpi,
        });
        signal.throwIfAborted();
        result.engines = reading.engines;
        addReadings(result.regions, reading, fragment);
        result.coverage.tilesCompleted++;
        if (result.regions.length > MAX_REGIONS)
          throw new Error(
            "Слишком много текстовых областей. Подготовка остановлена без усечения.",
          );
      }
      const candidates = result.regions.filter(
        (r) =>
          r.page === n &&
          (r.reasons.length ||
            !r.readings.some((v) => v.engine === "rapidocr") ||
            r.readings.some(
              (v) => v.engine === "rapidocr" && (v.confidence ?? 0) < 0.85,
            )),
      );
      const reviewed: Box[] = [];
      for (const region of candidates) {
        signal.throwIfAborted();
        const box = expandBox(
          bounds(region.polygon),
          8 / natural.width,
          5 / natural.height,
        );
        if (reviewed.some((b) => overlap(b, box) > 0.85)) continue;
        reviewed.push(box);
        progress(
          `Проверка спорных областей · лист ${n}/${pdf.numPages} · область ${reviewed.length}/${candidates.length}`,
        );
        const reviewScale = Math.min(
          600 / 72,
          2000 / ((box[2] - box[0]) * natural.width),
          2000 / ((box[3] - box[1]) * natural.height),
        );
        const picture = await render(page, box, reviewScale, signal);
        const fragment: Fragment = {
          id: `p${n}-review-${reviewed.length}`,
          page: n,
          bbox: box,
          dpi: reviewScale * 72,
          rotation: natural.rotation,
          purpose: "review",
          ...picture,
        };
        account(picture.image);
        result.fragments.push(fragment);
        const reading = await invoke<OcrResult>("ocr_image", {
          requestId,
          image: picture.image,
          mode: "secondary",
          dpi: fragment.dpi,
        });
        signal.throwIfAborted();
        result.engines = reading.engines;
        region.fragmentIds.push(fragment.id);
        if (!reading.regions.length)
          region.reasons.push("Tesseract не прочитал область");
        addReadings(result.regions, reading, fragment);
        result.coverage.reviewsCompleted++;
        if (result.regions.length > MAX_REGIONS)
          throw new Error(
            "Слишком много текстовых областей. Подготовка остановлена без усечения.",
          );
      }
      page.cleanup();
      result.coverage.pagesCompleted++;
      result.coverage.unfinishedPages = result.coverage.unfinishedPages.filter(
        (p) => p !== n,
      );
    }
    signal.throwIfAborted();
    result.elapsedMs = Math.round(performance.now() - started);
    result.status = "complete";
    progress(
      `Готово · ${result.pages.length} лист(а), ${result.regions.length} текстовых областей`,
    );
    return result;
  } catch (error) {
    result.status = signal.aborted ? "cancelled" : "failed";
    result.elapsedMs = Math.round(performance.now() - started);
    const message = signal.aborted
      ? "Подготовка остановлена."
      : protectedPdf
        ? "PDF защищён паролем."
        : error instanceof Error
          ? error.message
          : "Локальная подготовка завершилась с ошибкой.";
    result.coverage.errors.push(message);
    if (result.pages.length) onPartial?.(result);
    signal.throwIfAborted();
    if (protectedPdf)
      throw new Error("PDF защищён паролем. Выберите документ без пароля.");
    if (
      error instanceof Error &&
      [
        "InvalidPDFException",
        "MissingPDFException",
        "UnknownErrorException",
      ].includes(error.name)
    )
      throw new Error(
        "Не удалось прочитать PDF: файл повреждён или имеет неподдерживаемую структуру. Откройте исправную копию документа.",
      );
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    if (begun) await invoke("ocr_end", { requestId }).catch(() => {});
    await task.destroy();
  }
}

function addReadings(
  regions: TextRegion[],
  response: OcrResult,
  fragment: Fragment,
) {
  for (const [i, value] of response.regions.entries()) {
    const reasons = [];
    if (!value.text.trim())
      reasons.push("Обнаружена область без прочитанного текста");
    if (value.engine === "rapidocr" && (value.confidence ?? 0) < 0.85)
      reasons.push("Низкая оценка OCR");
    const polygon = pagePolygon(
      value.polygon,
      fragment.bbox,
      fragment.width,
      fragment.height,
    );
    const pdf = regions.filter(
      (r) =>
        r.page === fragment.page &&
        r.readings.some((v) => v.engine === "pdf") &&
        overlap(bounds(r.polygon), bounds(polygon)) > 0.7,
    );
    if (
      pdf.length &&
      !pdf.some((r) =>
        r.readings.some(
          (v) =>
            v.engine === "pdf" && comparable(v.text) === comparable(value.text),
        ),
      )
    )
      reasons.push("Расхождение с текстовым слоем PDF");
    mergeRegion(regions, {
      id: `${fragment.id}-${value.engine}-${i}`,
      page: fragment.page,
      polygon,
      readings: [
        {
          text: value.text,
          engine: value.engine,
          confidence: value.confidence,
          rotation: value.rotation,
        },
      ],
      fragmentIds: [fragment.id],
      reasons,
    });
  }
}

async function render(
  page: PDFPageProxy,
  box: Box,
  scale: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(
    1,
    Math.ceil((box[2] - box[0]) * viewport.width - 1e-8),
  );
  canvas.height = Math.max(
    1,
    Math.ceil((box[3] - box[1]) * viewport.height - 1e-8),
  );
  if (canvas.width > 2401 || canvas.height > 2401)
    throw new Error("Слишком большой фрагмент изображения.");
  const task = page.render({
    canvas,
    viewport,
    transform: [
      1,
      0,
      0,
      1,
      -box[0] * viewport.width,
      -box[1] * viewport.height,
    ],
    background: "rgb(255,255,255)",
  });
  const cancel = () => task.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await task.promise;
    signal.throwIfAborted();
    return {
      width: canvas.width,
      height: canvas.height,
      image: canvas.toDataURL("image/png"),
    };
  } finally {
    signal.removeEventListener("abort", cancel);
    canvas.width = 0;
    canvas.height = 0;
  }
}
