import { useState } from "react";
import type { PreparedDrawing } from "./types";

export default function PreparationInspector({
  data,
}: {
  data: PreparedDrawing;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [limit, setLimit] = useState(50);
  const region = data.regions.find((r) => r.id === selected);
  const fragments = region
    ? data.fragments.filter((f) => region.fragmentIds.includes(f.id))
    : [];
  const disputed = data.regions.filter((r) => r.reasons.length);
  const listed = conflictsOnly ? disputed : data.regions;
  return (
    <details className="preparation-panel">
      <summary>
        Локальная подготовка · {data.pages.length} лист(а) ·{" "}
        {data.regions.length} текстовых областей · {disputed.length} требуют
        внимания
      </summary>
      <p>
        OCR помогает прочитать надписи. Совпадение вариантов не подтверждает
        правильность размера или его привязку к поверхности.
      </p>
      {data.status !== "complete" && (
        <p role="alert">
          Подготовка не завершена. Эти данные не отправляются в Kimi.
          Незавершённые листы: {data.coverage.unfinishedPages.join(", ")}.
          Нажмите «Подготовить PDF» для повторной попытки.
        </p>
      )}
      <div className="preparation-toolbar">
        <label>
          <input
            type="checkbox"
            checked={conflictsOnly}
            onChange={(e) => {
              setConflictsOnly(e.target.checked);
              setLimit(50);
            }}
          />{" "}
          Только области с замечаниями
        </label>
        <small>
          {(data.elapsedMs / 1000).toFixed(1)} с · {data.fragments.length}{" "}
          фрагментов · CPU
        </small>
      </div>
      <div className="preparation-grid">
        <div className="preparation-regions">
          {listed.slice(0, limit).map((r) => (
            <button
              type="button"
              key={r.id}
              className={selected === r.id ? "selected" : ""}
              onClick={() => setSelected(r.id)}
            >
              <small>
                Лист {r.page}
                {r.reasons.length ? " · проверить" : ""}
              </small>
              <span>{r.readings[0]?.text || "Не прочитано"}</span>
            </button>
          ))}
          {listed.length > limit && (
            <button type="button" onClick={() => setLimit(limit + 50)}>
              Показать ещё 50
            </button>
          )}
          {!listed.length && <p>Текстовые области не найдены.</p>}
        </div>
        <div className="preparation-reading">
          {region ? (
            <>
              <h3>Лист {region.page} · варианты чтения</h3>
              {region.readings.map((r, i) => (
                <div key={i}>
                  <strong>{r.engine === "pdf" ? "Текст PDF" : r.engine}</strong>
                  <pre>{r.text || "Не прочитано"}</pre>
                  <small>
                    {r.confidence == null
                      ? "Без оценки уверенности"
                      : `Оценка движка: ${r.confidence.toFixed(2)} (не вероятность правильности)`}{" "}
                    · поворот {r.rotation.toFixed(0)}°
                  </small>
                </div>
              ))}
              {region.reasons.length > 0 && (
                <ul>
                  {region.reasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              )}
              {fragments.map((f) => (
                <figure key={f.id}>
                  <img
                    src={f.image}
                    alt={`Исходная область листа ${f.page}`}
                    loading="lazy"
                  />
                  <figcaption>
                    {f.purpose === "review"
                      ? "Повторное чтение"
                      : "Исходный фрагмент"}{" "}
                    · {f.dpi.toFixed(0)} DPI
                  </figcaption>
                </figure>
              ))}
            </>
          ) : (
            <p>
              Выберите надпись, чтобы посмотреть варианты чтения и исходные
              фрагменты.
            </p>
          )}
        </div>
      </div>
      <details>
        <summary>Диагностика подготовки</summary>
        <ul>
          {[...data.warnings, ...data.coverage.errors].map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
        <p>
          Листов завершено: {data.coverage.pagesCompleted}/
          {data.coverage.pagesTotal}. Фрагментов прочитано:{" "}
          {data.coverage.tilesCompleted}; повторных проверок:{" "}
          {data.coverage.reviewsCompleted}.
        </p>
        <pre>{JSON.stringify(data.engines, null, 2)}</pre>
        <small>SHA-256 документа: {data.checksum}</small>
      </details>
    </details>
  );
}
