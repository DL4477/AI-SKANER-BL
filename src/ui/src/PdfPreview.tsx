import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Minus, Plus } from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfPreview({ url }: { url: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(400);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const scrollArea = useRef<HTMLDivElement>(null);
  const output = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setError("");
    setBusy(true);
    setPageNumber(1);
    setZoom(1);
    const task = getDocument({
      url,
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
      iccUrl: "/pdf-assets/iccs/",
    });
    task.onPassword = () => {
      if (!cancelled) {
        setError(
          "PDF защищён паролем. Откройте исходный файл в другой программе или выберите документ без пароля.",
        );
        setBusy(false);
      }
      void task.destroy();
    };
    void task.promise
      .then((value) => {
        if (!cancelled) setPdf(value);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            (current) =>
              current ||
              "Не удалось отобразить PDF. Проверьте файл или откройте его отдельно.",
          );
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [url]);

  useEffect(() => {
    const element = scrollArea.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(100, entries[0].contentRect.width - 32)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    setBusy(true);
    setError("");
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
          scale: Math.min(width / natural.width, 2) * zoom,
        });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `Страница ${pageNumber} PDF`);
        renderTask = page.render({
          canvas,
          viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await renderTask.promise;
        if (!cancelled) {
          output.current?.replaceChildren(canvas);
          setBusy(false);
        }
      } catch {
        if (!cancelled) {
          setError(
            "Не удалось показать эту страницу. Попробуйте другую страницу или откройте файл отдельно.",
          );
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, width, zoom]);

  return (
    <div className="pdf-preview">
      <div className="pdf-navigation">
        <div>
          <button
            aria-label="Предыдущая страница PDF"
            disabled={!pdf || pageNumber <= 1}
            onClick={() => setPageNumber((value) => value - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>{pdf ? `${pageNumber} / ${pdf.numPages}` : "PDF"}</span>
          <button
            aria-label="Следующая страница PDF"
            disabled={!pdf || pageNumber >= pdf.numPages}
            onClick={() => setPageNumber((value) => value + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <div>
          <button
            aria-label="Уменьшить PDF"
            disabled={!pdf || zoom <= 0.6}
            onClick={() => setZoom((value) => Math.max(0.6, value - 0.2))}
          >
            <Minus size={15} />
          </button>
          <button
            className="pdf-zoom-value"
            aria-label="Вписать PDF по ширине"
            disabled={!pdf}
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Увеличить PDF"
            disabled={!pdf || zoom >= 2.4}
            onClick={() => setZoom((value) => Math.min(2.4, value + 0.2))}
          >
            <Plus size={15} />
          </button>
        </div>
      </div>
      <div className="pdf-canvas-area" ref={scrollArea} aria-busy={busy}>
        {error ? (
          <div className="pdf-message" role="alert">
            <FileText size={25} />
            <p>{error}</p>
          </div>
        ) : (
          <>
            {busy && (
              <div className="pdf-message" role="status">
                Отображаем страницу…
              </div>
            )}
            <div
              className={`pdf-canvas-output ${busy ? "rendering" : ""}`}
              ref={output}
            />
          </>
        )}
      </div>
    </div>
  );
}
