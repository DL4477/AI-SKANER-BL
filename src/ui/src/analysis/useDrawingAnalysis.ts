import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { connectionError, modelApi } from "../model/connection";
import { prepareDrawing } from "./prepareDrawing";
import type { AnalysisReport, DrawingSource } from "./types";

export function useDrawingAnalysis(
  log: (message: string) => void,
  onReply: () => void,
) {
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savePending = useRef(false);
  const job = useRef<{
    id: string;
    abort: AbortController;
    sent: boolean;
  } | null>(null);

  function reset() {
    if (job.current) return false;
    setReport(null);
    setError("");
    setProgress("");
    return true;
  }

  async function run(source: DrawingSource) {
    if (job.current) return;
    const current = {
      id: crypto.randomUUID(),
      abort: new AbortController(),
      sent: false,
    };
    job.current = current;
    setBusy(true);
    setCancelling(false);
    setError("");
    setReport(null);
    setProgress("Подготовка чертежа…");
    log("Начата подготовка чертежа к анализу.");
    try {
      const pages = await prepareDrawing(
        source,
        current.abort.signal,
        setProgress,
      );
      current.abort.signal.throwIfAborted();
      current.sent = true;
      setProgress(
        `Kimi анализирует ${pages.length} лист(а). Ожидание — до 4 минут…`,
      );
      log(`Запрошен анализ в Kimi: ${pages.length} лист(а).`);
      const result = await invoke<AnalysisReport>("analyze_drawing", {
        requestId: current.id,
        input: { name: source.name, kind: source.kind, pages },
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
      log(message);
    } finally {
      if (job.current === current) {
        if (current.abort.signal.aborted) setProgress("Анализ остановлен.");
        job.current = null;
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
      const saved = await invoke<boolean>("save_analysis", { data: report.data });
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
    busy,
    cancelling,
    progress,
    error,
    run,
    cancel,
    reset,
    download,
    saving,
  };
}
