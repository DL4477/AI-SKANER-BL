import { useState } from "react";
import { Check, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { diagnosticNames, type ModelConnection } from "./useModelConnection";
import type { DiagnosticKind } from "./connection";

const probes: { kind: DiagnosticKind; description: string }[] = [
  {
    kind: "access",
    description: "Проверяет ключ и наличие Kimi K3 в списке моделей.",
  },
  { kind: "text", description: "Запрашивает короткий контрольный ответ." },
  {
    kind: "vision",
    description: "Просит посчитать фигуры на учебной картинке.",
  },
  { kind: "json", description: "Проверяет ответ по небольшой тестовой схеме." },
];

export default function ModelSettings({
  connection: c,
  locked = false,
}: {
  connection: ModelConnection;
  locked?: boolean;
}) {
  const [key, setKey] = useState("");
  const disabled = !c.desktopAvailable || c.busy || locked;
  return (
    <div className="model-settings">
      {locked && (
        <p className="connection-notice">
          Идёт анализ чертежа. Изменение ключа и проверки будут доступны после
          его завершения или отмены.
        </p>
      )}
      <div className="provider-card">
        <div>
          <strong>Kimi K3</strong>
          <span>Внешний API</span>
        </div>
        <p>
          {c.info.endpoint} · {c.info.model}
        </p>
      </div>
      {!c.desktopAvailable && (
        <p className="connection-notice" role="status">
          Подключение доступно в установленном приложении «ИИ СКАНЕР». В
          браузере открыт только просмотр интерфейса.
        </p>
      )}
      {c.loadError && (
        <p className="connection-notice error" role="alert">
          {c.loadError.message}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void c.changeKey(key).then((saved) => {
            if (saved) setKey("");
          });
        }}
      >
        <label className="field">
          <span className="key-label">
            <span>
              <KeyRound size={14} /> API-ключ Kimi
            </span>
            <span>
              {c.loading
                ? "Чтение…"
                : c.loadError
                  ? "Недоступен"
                  : c.info.keyStored
                    ? "Сохранён"
                    : "Не добавлен"}
            </span>
          </span>
          <input
            type="password"
            name="kimi-api-key"
            value={key}
            autoComplete="off"
            spellCheck={false}
            placeholder={
              c.info.keyStored
                ? "Новый ключ для замены сохранённого"
                : "Вставьте ключ из кабинета Kimi"
            }
            disabled={disabled}
            onChange={(event) => setKey(event.target.value)}
            maxLength={1024}
          />
        </label>
        <p className="key-storage">
          <ShieldCheck size={15} /> Ключ хранится в защищённом хранилище Windows
          на этом компьютере.
        </p>
        <div className="credential-actions">
          <button
            className="button primary"
            type="submit"
            disabled={disabled || !key.trim()}
          >
            {c.saving ? "Сохранение…" : "Сохранить ключ"}
          </button>
          {c.info.keyStored && (
            <button
              className="button"
              type="button"
              disabled={disabled}
              onClick={() => {
                void c.changeKey().then((removed) => {
                  if (removed) setKey("");
                });
              }}
            >
              Удалить ключ
            </button>
          )}
        </div>
      </form>
      {c.notice && (
        <p
          className={`connection-notice ${c.notice.status}`}
          role={c.notice.status === "error" ? "alert" : "status"}
        >
          {c.notice.message}
        </p>
      )}
      <h3 className="tools-title">Проверки подключения</h3>
      <p className="probe-intro">
        Запускаются вручную. Текст, изображение и JSON — по одному платному
        запросу к API. Для них нужен баланс в кабинете Kimi.
      </p>
      <div className="probe-list">
        {probes.map(({ kind, description }) => {
          const result = c.results[kind];
          const running = c.active === kind;
          return (
            <div className="probe-row" key={kind}>
              <div className="probe-heading">
                <div>
                  <strong>{diagnosticNames[kind]}</strong>
                  <p>{description}</p>
                </div>
                <button
                  className="button probe-button"
                  disabled={
                    disabled || !!c.loadError || !c.info.keyStored || !!key
                  }
                  onClick={() => {
                    void c.run(kind);
                  }}
                  aria-label={`Проверить: ${diagnosticNames[kind]}`}
                >
                  {running ? (
                    <LoaderCircle size={14} className="loading-spinner" />
                  ) : result?.status === "success" ? (
                    <Check size={14} />
                  ) : null}
                  {running ? "Проверка…" : result ? "Повторить" : "Проверить"}
                </button>
              </div>
              {running && (
                <p className="probe-result" role="status">
                  Ожидание ответа, до 90 секунд…
                </p>
              )}
              {result && (
                <div className={`probe-result ${result.status}`} role="status">
                  {result.message}
                  {result.report && (
                    <small>
                      {(result.report.elapsedMs / 1000).toFixed(1)} с
                      {result.report.totalTokens != null
                        ? ` · ${result.report.totalTokens} токенов`
                        : ""}
                    </small>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {c.active && (
        <div className="probe-cancel">
          <button
            className="button"
            disabled={c.cancelling}
            onClick={() => {
              void c.cancel();
            }}
          >
            {c.cancelling ? "Отмена…" : "Отменить ожидание"}
          </button>
          <small>
            Отмена ожидания не гарантирует отмену обработки и оплаты на стороне
            Kimi.
          </small>
        </div>
      )}
      {!!key && (
        <p className="probe-intro">
          Сохраните введённый ключ или очистите поле, чтобы запустить проверку.
        </p>
      )}
      <p className="model-footnote">
        Проверки отправляют только учебные данные. Открытый PDF остаётся на
        компьютере. Результаты проверок и журнал хранятся до закрытия
        приложения.
      </p>
      <div className="upcoming-tools">
        <strong>Следующий этап</strong>
        <p>
          Уточнение мелких фрагментов, инструменты OCR и проверка геометрии.
          Пробный анализ уже запускается кнопкой «Разобрать чертёж» в рабочей
          области.
        </p>
      </div>
    </div>
  );
}
