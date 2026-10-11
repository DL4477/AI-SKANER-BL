import { useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { connectionError, modelApi } from "../model/connection";
import { prepareDrawing } from "./prepareDrawing";
import type { AnalysisProgress, AnalysisReport, DrawingSource } from "./types";
import { preparePdf } from "../preparation/prepare";
import type { PreparedDrawing } from "../preparation/types";
import { SETTINGS_KEY } from "../preparation/geometry";

export function useDrawingAnalysis(
  log: (message: string) => void,
  onReply: () => void,
) {
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [prepared, setPrepared] = useState<PreparedDrawing | null>(null);
  const cache = useRef<{
    url: string;
    settings: string;
    data: PreparedDrawing;
  } | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAt = useRef(0);
  const savePending = useRef(false);
  const job = useRef<{
    id: string;
    abort: AbortController;
    sent: boolean;
  } | null>(null);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(
      () =>
        setElapsedSeconds(Math.floor((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);

  function reset() {
    if (job.current) return false;
    setReport(null);
    setPrepared(null);
    cache.current = null;
    setError("");
    setProgress("");
    setElapsedSeconds(0);
    return true;
  }

  async function run(source: DrawingSource, onlyPrepare = false) {
    if (job.current) return;
    const current = {
      id: crypto.randomUUID(),
      abort: new AbortController(),
      sent: false,
    };
    job.current = current;
    startedAt.current = Date.now();
    setElapsedSeconds(0);
    setBusy(true);
    setLocalOnly(onlyPrepare);
    setCancelling(false);
    setError("");
    setReport(null);
    setProgress("Подготовка чертежа…");
    log("Начата подготовка чертежа к анализу.");
    try {
      let preparation: PreparedDrawing | null = null;
      if (source.kind === "pdf") {
        if (
          cache.current?.url === source.url &&
          cache.current.settings === SETTINGS_KEY
        ) {
          preparation = cache.current.data;
          log("Использована локальная подготовка из кэша сеанса.");
        } else {
          setPrepared(null);
          preparation = await preparePdf(
            source,
            current.abort.signal,
            setProgress,
            setPrepared,
          );
          current.abort.signal.throwIfAborted();
          cache.current = {
            url: source.url,
            settings: SETTINGS_KEY,
            data: preparation,
          };
        }
        setPrepared(preparation);
      }
      const pages =
        preparation?.pages ??
        (await prepareDrawing(source, current.abort.signal, setProgress));
      current.abort.signal.throwIfAborted();
      if (onlyPrepare) {
        setProgress(
          `Подготовка завершена · ${pages.length} лист(а). Запросов к Kimi не было.`,
        );
        log("PDF подготовлен локально. Изображения и текст PDF доступны для просмотра. OCR отключён.");
        return;
      }
      if (preparation) {
        const size = [...pages, ...preparation.fragments].reduce(
          (n, p) => n + p.image.length * 0.75,
          0,
        );
        if (size > 20 * 1024 * 1024)
          throw new Error(
            "Полный пакет изображений превышает 20 МиБ. Он не усечён и не отправлен в Kimi; подготовленные данные доступны ниже.",
          );
      }
      current.sent = true;
      setProgress(
        `Подключение к Kimi · ${pages.length} лист(а). Лимит анализа — 15 минут…`,
      );
      log(`Запрошен анализ в Kimi: ${pages.length} лист(а).`);
      let lastPhase = "";
      const onProgress = new Channel<AnalysisProgress>((event) => {
        if (current.abort.signal.aborted || job.current !== current) return;
        const messages = {
          connecting: "Подключаемся к Kimi и передаём чертёж…",
          waiting: "Соединение с Kimi открыто. Ожидаем начало генерации…",
          thinking: "Kimi обрабатывает чертёж. Данные от модели поступают…",
          receiving: `Получаем JSON от Kimi · ${(event.contentBytes / 1024).toFixed(1)} КБ…`,
          validating: "Ответ получен. Проверяем структуру JSON и ссылки…",
        };
        setProgress(messages[event.phase]);
        if (event.phase !== lastPhase) {
          log(messages[event.phase]);
          lastPhase = event.phase;
        }
      });
      const result = await invoke<AnalysisReport>("analyze_drawing", {
        requestId: current.id,
        input: {
          name: source.name,
          kind: source.kind,
          pages,
          preparation: preparation
            ? { ...preparation, pages: undefined }
            : null,
        },
        onProgress,
      });
      if (current.abort.signal.aborted || job.current !== current) return;
      setReport(result);
      onReply();
      setProgress(
        `Анализ завершён · найдено поверхностей: ${result.data.surfaces.length}. Требуется проверка.`,
      );
      log(
        `Анализ завершён. Поверхностей: ${result.data.surfaces.length}; вопросов: ${result.data.questions.length}. Результат требует проверки.`,
      );
    } catch (failure) {
      if (job.current !== current) return;
      const message = current.abort.signal.aborted
        ? "Анализ остановлен."
        : !current.sent && failure instanceof Error
          ? failure.message
          : connectionError(failure).message;
      if (current.abort.signal.aborted) setProgress(message);
      else {
        setError(message);
        setProgress("");
      }
      log(
        `${message} Прошло ${Math.round((Date.now() - startedAt.current) / 1000)} с.`,
      );
    } finally {
      if (job.current === current) {
        if (current.abort.signal.aborted) setProgress("Анализ остановлен.");
        job.current = null;
        setElapsedSeconds(Math.round((Date.now() - startedAt.current) / 1000));
        setBusy(false);
        setCancelling(false);
      }
    }
  }

  async function cancel() {
    const current = job.current;
    if (!current || cancelling) return;
    setCancelling(true);
    current.abort.abort();
    if (current.sent) {
      try {
        await modelApi.cancel(current.id);
      } catch (failure) {
        if (job.current === current) setError(connectionError(failure).message);
      }
    }
  }

  async function download() {
    if (!report || busy || savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await invoke<boolean>("save_analysis", {
        data: report.data,
      });
      if (saved) log("Черновик JSON сохранён в выбранный файл.");
    } catch (failure) {
      setError(connectionError(failure).message);
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  return {
    report,
    prepared,
    localOnly,
    busy,
    cancelling,
    progress,
    error,
    run,
    cancel,
    reset,
    download,
    saving,
    elapsedSeconds,
  };
}
