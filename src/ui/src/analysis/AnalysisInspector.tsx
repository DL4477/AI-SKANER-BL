import { useState } from "react";
import type { DrawingAnalysis, Evidence, Requirement } from "./types";

const kinds: Record<string, string> = {
  plane: "Плоскость",
  cylinder: "Цилиндр",
  cone: "Конус",
  sphere: "Сфера",
  torus: "Тор",
  freeform: "Свободная форма",
  other: "Другая",
  unknown: "Не определено",
};
function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  return evidence.length ? (
    <ul className="analysis-evidence">
      {evidence.map((item, index) => (
        <li key={index}>
          Лист {item.page} · {item.description}
        </li>
      ))}
    </ul>
  ) : null;
}
function Requirements({
  values,
  inherited = false,
}: {
  values: Requirement[];
  inherited?: boolean;
}) {
  return (
    <>
      {values.map((item) => (
        <div className="analysis-requirement" key={item.id}>
          <strong>{item.raw_text}</strong>
          <p>
            {inherited ? "Общее требование" : "Местное требование"} ·{" "}
            {item.applies_to}
          </p>
          {item.value !== null && (
            <p>
              Значение: {item.value} {item.unit ?? "(единицы не определены)"}
            </p>
          )}
          {item.it_grade && <p>Квалитет: {item.it_grade}</p>}
          <EvidenceList evidence={item.evidence} />
        </div>
      ))}
    </>
  );
}

export default function AnalysisInspector({
  data,
  tab,
}: {
  data: DrawingAnalysis;
  tab: "surfaces" | "general";
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const surface =
    data.surfaces.find((item) => item.id === selected) ?? data.surfaces[0];
  return (
    <div className="analysis-data">
      <div className="analysis-draft">
        <strong>Результат Kimi · требуется проверка</strong>
        <details>
          <summary>Краткое описание детали</summary>
          <p>{data.summary}</p>
        </details>
        <small>
          Полнота поверхностей и готовность к 3D ещё не подтверждены.
        </small>
      </div>
      {tab === "general" ? (
        <div className="general-detail">
          <h3>{data.drawing_general.part_name ?? "Название не определено"}</h3>
          <dl className="properties">
            {[
              ["Обозначение", data.drawing_general.designation],
              ["Материал", data.drawing_general.material],
              ["Единицы", data.drawing_general.units],
              ["Листов обработано", data.source.page_count],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value ?? "Не определено"}</dd>
              </div>
            ))}
          </dl>
          <h4>Общие требования</h4>
          <Requirements
            values={data.drawing_general.general_requirements}
            inherited
          />
          {!data.drawing_general.general_requirements.length && (
            <p className="detail-explanation">
              Модель не выделила общих требований. Проверьте исходник.
            </p>
          )}
          {data.drawing_general.notes.map((note, i) => (
            <p className="detail-explanation" key={i}>
              {note}
            </p>
          ))}
        </div>
      ) : (
        <>
          <div className="surface-list">
            {data.surfaces.map((item) => (
              <button
                key={item.id}
                className={`surface-row ${surface?.id === item.id ? "selected" : ""}`}
                aria-pressed={surface?.id === item.id}
                onClick={() => setSelected(item.id)}
              >
                <div className="surface-text">
                  <strong>{item.name}</strong>
                  <small>
                    {item.id} · {kinds[item.type] ?? item.type}
                  </small>
                </div>
              </button>
            ))}
          </div>
          {!surface ? (
            <p className="detail-explanation">
              Поверхности не обнаружены. Смотрите вопросы ниже.
            </p>
          ) : (
            <div className="surface-detail">
              <h3>{surface.name}</h3>
              <p className="detail-explanation">
                {kinds[surface.type]} ·{" "}
                {surface.orientation === "inward"
                  ? "В полость"
                  : surface.orientation === "outward"
                    ? "Наружу"
                    : "Ориентация не определена"}
              </p>
              <dl className="properties">
                {surface.geometry_parameters.map((parameter, i) => (
                  <div key={i}>
                    <dt>
                      {parameter.name}
                      {parameter.basis === "derived" ? " (выведено)" : ""}
                    </dt>
                    <dd>
                      {parameter.value === null
                        ? "Не определено"
                        : `${parameter.value} ${parameter.unit ?? ""}`}
                      <small>{parameter.designation}</small>
                    </dd>
                  </div>
                ))}
              </dl>
              {surface.geometry_parameters.some((p) => p.evidence.length) && (
                <details className="analysis-sources">
                  <summary>Источники размеров</summary>
                  {surface.geometry_parameters.map((p, i) => (
                    <div key={i}>
                      <strong>{p.name}</strong>
                      <EvidenceList evidence={p.evidence} />
                    </div>
                  ))}
                </details>
              )}
              <p className="detail-explanation">
                {surface.boundary_description ??
                  "Границы поверхности не определены."}
              </p>
              <h4>Технические требования</h4>
              <Requirements values={surface.local_requirements} />
              <Requirements
                values={data.drawing_general.general_requirements.filter(
                  (item) => surface.general_requirement_ids.includes(item.id),
                )}
                inherited
              />
              {!surface.local_requirements.length &&
                !surface.general_requirement_ids.length && (
                  <p className="detail-explanation">
                    Требования не найдены моделью. Это не подтверждает их
                    отсутствие.
                  </p>
                )}
              <EvidenceList evidence={surface.evidence} />
              {surface.uncertainties.map((item, i) => (
                <p className="analysis-question" key={i}>
                  {item}
                </p>
              ))}
            </div>
          )}
        </>
      )}
      <div className="analysis-questions">
        <h4>Вопросы и недостающие данные</h4>
        {data.questions.length ? (
          <ul>
            {data.questions.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p>
            Модель не перечислила вопросов. Всё равно сверьте результат с
            чертежом.
          </p>
        )}
      </div>
      <details className="analysis-json">
        <summary>JSON результата</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
