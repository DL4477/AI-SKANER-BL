import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Check, Copy, FileText, LoaderCircle, RotateCw } from "lucide-react";
import { connectionError } from "./connection";

type SystemPromptInfo = {
  text: string;
  model: string;
  reasoningEffort: string;
  maxCompletionTokens: number;
  appVersion: string;
};

export default function SystemPromptWindow() {
  const [info, setInfo] = useState<SystemPromptInfo | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    let disposed = false;
    setError("");
    if (!isTauri()) {
      setError("Откройте это окно в установленном приложении «ИИ СКАНЕР».");
      return;
    }
    void invoke<SystemPromptInfo>("get_system_prompt").then(
      (value) => {
        if (!disposed) setInfo(value);
      },
      (failure) => {
        if (!disposed) setError(connectionError(failure).message);
      },
    );
    return () => {
      disposed = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyPrompt() {
    if (!info || copying) return;
    setCopying(true);
    setCopyError("");
    try {
      await navigator.clipboard.writeText(info.text);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError(
        "Не удалось скопировать автоматически. Выделите текст и нажмите Ctrl+C.",
      );
    } finally {
      setCopying(false);
    }
  }

  return (
    <main className="prompt-window">
      <header className="prompt-heading">
        <div className="prompt-icon">
          <FileText size={24} />
        </div>
        <div>
          <div className="eyebrow">ИНСТРУКЦИЯ АНАЛИЗАТОРА</div>
          <h1>Системный промпт</h1>
          <p>
            Полный текст, который приложение отправляет Kimi при разборе
            чертежа.
          </p>
        </div>
      </header>

      {info ? (
        <>
          <div className="prompt-toolbar">
            <div className="prompt-settings" aria-label="Настройки анализа">
              <span>{info.model}</span>
              <span>Рассуждение: {info.reasoningEffort}</span>
              <span>
                Лимит: {info.maxCompletionTokens.toLocaleString("ru-RU")}{" "}
                токенов
              </span>
            </div>
            <button
              className="button"
              disabled={copying}
              onClick={() => void copyPrompt()}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Скопировано" : "Копировать"}
            </button>
          </div>
          <div className="prompt-copy-status" role="status" aria-live="polite">
            {copyError || (copied ? "Полный текст скопирован." : "")}
          </div>
          <section
            className="prompt-text-panel"
            aria-labelledby="prompt-text-title"
          >
            <div className="prompt-text-heading">
              <h2 id="prompt-text-title">Текст системного промпта</h2>
              <span>Только просмотр</span>
            </div>
            <textarea
              className="prompt-text"
              aria-labelledby="prompt-text-title"
              readOnly
              spellCheck={false}
              value={info.text}
            />
          </section>
          <footer className="prompt-footer">
            <p>
              Изображения чертежа, извлечённый текст и схема JSON передаются
              отдельно.
            </p>
            <span>ИИ СКАНЕР {info.appVersion}</span>
          </footer>
        </>
      ) : error ? (
        <div className="prompt-state" role="alert">
          <p>{error}</p>
          {isTauri() && (
            <button
              className="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RotateCw size={16} /> Повторить
            </button>
          )}
        </div>
      ) : (
        <div className="prompt-state" role="status">
          <LoaderCircle size={20} className="loading-spinner" /> Загружаем
          актуальный промпт…
        </div>
      )}
    </main>
  );
}
