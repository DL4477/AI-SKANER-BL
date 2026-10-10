import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { AnalysisPage, DrawingSource } from "./types";

GlobalWorkerOptions.workerSrc = workerUrl;
const MAX_PAGES = 8;
const MAX_EDGE = 2400;

export async function prepareDrawing(
  source: DrawingSource,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<AnalysisPage[]> {
  signal.throwIfAborted();
  if (source.kind === "demo") {
    progress("Подготовка учебного чертежа…");
    const image = new Image();
    image.src = source.url;
    await image.decode();
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1680;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Не удалось подготовить изображение чертежа.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return [encodePage(canvas, 1)];
  }
  const task = getDocument({
    url: source.url,
    cMapUrl: "/pdf-assets/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdf-assets/standard_fonts/",
    wasmUrl: "/pdf-assets/wasm/",
    iccUrl: "/pdf-assets/iccs/",
  });
  let passwordRequired = false;
  task.onPassword = () => {
    passwordRequired = true;
    void task.destroy();
  };
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const pdf = await task.promise;
    signal.throwIfAborted();
    if (pdf.numPages > MAX_PAGES)
      throw new Error(
        "Пробный анализ поддерживает PDF до 8 листов. Этот документ не отправлен в Kimi.",
      );
    const pages: AnalysisPage[] = [];
    let bytes = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      signal.throwIfAborted();
      progress(`Подготовка листа ${pageNumber} из ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: MAX_EDGE / Math.max(natural.width, natural.height),
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(MAX_EDGE, Math.ceil(viewport.width));
      canvas.height = Math.min(MAX_EDGE, Math.ceil(viewport.height));
      const render = page.render({
        canvas,
        viewport,
        background: "rgb(255,255,255)",
      });
      const cancelRender = () => render.cancel();
      signal.addEventListener("abort", cancelRender, { once: true });
      try {
        await render.promise;
      } finally {
        signal.removeEventListener("abort", cancelRender);
      }
      signal.throwIfAborted();
      const encoded = encodePage(canvas, pageNumber);
      bytes += encoded.image.length * 0.75;
      if (bytes > 20 * 1024 * 1024)
        throw new Error(
          "Изображения листов слишком велики для пробного анализа. Документ не отправлен в Kimi.",
        );
      pages.push(encoded);
      page.cleanup();
    }
    return pages;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Анализ отменён", "AbortError");
    if (passwordRequired)
      throw new Error(
        "PDF защищён паролем. Для анализа нужен документ без пароля.",
      );
    throw error instanceof Error
      ? error
      : new Error("Не удалось подготовить PDF к анализу.");
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}

function encodePage(canvas: HTMLCanvasElement, page: number): AnalysisPage {
  const image = canvas.toDataURL("image/png");
  if (image.length * 0.75 > 4 * 1024 * 1024)
    throw new Error(
      "Лист слишком велик для пробного анализа. Он не отправлен в Kimi.",
    );
  return { page, width: canvas.width, height: canvas.height, image };
}
