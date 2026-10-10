import { invoke, isTauri } from "@tauri-apps/api/core";

export type DiagnosticKind = "access" | "text" | "vision" | "json";
export type ConnectionInfo = {
  provider: string;
  model: string;
  endpoint: string;
  keyStored: boolean;
};
export type DiagnosticReport = {
  kind: DiagnosticKind;
  message: string;
  elapsedMs: number;
  totalTokens: number | null;
};
export type ConnectionError = { code: string; message: string };

export const desktopAvailable = isTauri();
export const defaultConnection: ConnectionInfo = {
  provider: "Kimi API",
  model: "kimi-k3",
  endpoint: "https://api.moonshot.ai/v1",
  keyStored: false,
};

export const modelApi = {
  status: () => invoke<ConnectionInfo>("model_status"),
  saveKey: (apiKey: string) =>
    invoke<ConnectionInfo>("save_api_key", { apiKey }),
  removeKey: () => invoke<ConnectionInfo>("remove_api_key"),
  diagnose: (kind: DiagnosticKind, requestId: string) =>
    invoke<DiagnosticReport>("run_diagnostic", { kind, requestId }),
  cancel: (requestId: string) =>
    invoke<void>("cancel_diagnostic", { requestId }),
};

export function connectionError(error: unknown): ConnectionError {
  // Native commands return sanitized errors. Never display raw IPC exceptions.
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "app_error",
    message:
      "Не удалось выполнить действие. Перезапустите приложение и повторите попытку.",
  };
}
