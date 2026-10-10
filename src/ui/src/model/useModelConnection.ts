import { useEffect, useRef, useState } from "react";
import {
  connectionError,
  defaultConnection,
  desktopAvailable,
  modelApi,
  type ConnectionError,
  type DiagnosticKind,
  type DiagnosticReport,
} from "./connection";

export const diagnosticNames: Record<DiagnosticKind, string> = {
  access: "Доступ к API",
  text: "Текстовый ответ",
  vision: "Чтение изображения",
  json: "Ответ по JSON Schema",
};
export type ProbeResult = {
  status: "success" | "error" | "cancelled";
  message: string;
  report?: DiagnosticReport;
};

export function useModelConnection() {
  const [info, setInfo] = useState(defaultConnection);
  const [loading, setLoading] = useState(desktopAvailable);
  const [loadError, setLoadError] = useState<ConnectionError | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<ProbeResult | null>(null);
  const [active, setActive] = useState<DiagnosticKind | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [results, setResults] = useState<
    Partial<Record<DiagnosticKind, ProbeResult>>
  >({});
  const [events, setEvents] = useState<
    { id: number; time: string; message: string }[]
  >([]);
  const sequence = useRef(0);
  const operation = useRef<string | null>(null);

  useEffect(() => {
    if (!desktopAvailable) return;
    let disposed = false;
    void modelApi
      .status()
      .then(
        (value) => {
          if (!disposed) setInfo(value);
        },
        (error: unknown) => {
          if (!disposed) setLoadError(connectionError(error));
        },
      )
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  function log(message: string) {
    const event = {
      id: ++sequence.current,
      time: new Date().toLocaleTimeString("ru-RU"),
      message,
    };
    setEvents((current) => [...current, event].slice(-20));
  }

  async function changeKey(key?: string) {
    if (!desktopAvailable || loading || operation.current) return false;
    operation.current = "credential";
    setSaving(true);
    setNotice(null);
    try {
      const value =
        key === undefined
          ? await modelApi.removeKey()
          : await modelApi.saveKey(key);
      setInfo(value);
      setLoadError(null);
      setResults({});
      const message =
        key === undefined
          ? "Ключ удалён с этого компьютера."
          : "Ключ сохранён. Теперь проверьте доступ к API.";
      setNotice({ status: "success", message });
      log(message);
      return true;
    } catch (error) {
      const failure = connectionError(error);
      setNotice({ status: "error", message: failure.message });
      log(failure.message);
      return false;
    } finally {
      operation.current = null;
      setSaving(false);
    }
  }

  async function run(kind: DiagnosticKind) {
    if (
      !desktopAvailable ||
      loading ||
      loadError ||
      !info.keyStored ||
      operation.current
    )
      return;
    const requestId = crypto.randomUUID();
    operation.current = requestId;
    setActive(kind);
    setCancelling(false);
    setNotice(null);
    setResults((current) => ({ ...current, [kind]: undefined }));
    log(`${diagnosticNames[kind]}: проверка запущена.`);
    try {
      const report = await modelApi.diagnose(kind, requestId);
      if (operation.current !== requestId) return;
      setResults((current) => ({
        ...current,
        [kind]: { status: "success", message: report.message, report },
      }));
      log(`${diagnosticNames[kind]}: ${report.message}`);
    } catch (error) {
      if (operation.current !== requestId) return;
      const failure = connectionError(error);
      setResults((current) => ({
        ...current,
        [kind]: {
          status: failure.code === "cancelled" ? "cancelled" : "error",
          message: failure.message,
        },
      }));
      log(`${diagnosticNames[kind]}: ${failure.message}`);
    } finally {
      if (operation.current === requestId) {
        operation.current = null;
        setActive(null);
        setCancelling(false);
      }
    }
  }

  async function cancel() {
    const requestId = operation.current;
    if (!requestId || !active || cancelling) return;
    setCancelling(true);
    try {
      await modelApi.cancel(requestId);
    } catch (error) {
      if (operation.current !== requestId) return;
      setNotice({ status: "error", message: connectionError(error).message });
      setCancelling(false);
    }
  }

  const hasFailure = Object.values(results).some(
    (result) => result?.status === "error",
  );
  const hasReply = (["text", "vision", "json"] as const).some(
    (kind) => results[kind]?.status === "success",
  );
  const badge = !desktopAvailable
    ? { text: "Откройте приложение", tone: "neutral" }
    : loading
      ? { text: "Чтение настроек…", tone: "neutral" }
      : loadError
        ? { text: "Ошибка настроек Kimi", tone: "error" }
        : active
          ? { text: "Проверка Kimi…", tone: "pending" }
          : !info.keyStored
            ? { text: "Подключить Kimi", tone: "neutral" }
            : hasFailure
              ? { text: "Проверьте Kimi", tone: "error" }
              : hasReply
                ? { text: "Kimi отвечает", tone: "success" }
                : results.access?.status === "success"
                  ? { text: "API Kimi доступен", tone: "success" }
                  : { text: "Ключ сохранён · не проверен", tone: "neutral" };

  return {
    info,
    loading,
    loadError,
    saving,
    notice,
    active,
    cancelling,
    results,
    events,
    badge,
    desktopAvailable,
    busy: loading || saving || active !== null,
    changeKey,
    run,
    cancel,
  };
}

export type ModelConnection = ReturnType<typeof useModelConnection>;
