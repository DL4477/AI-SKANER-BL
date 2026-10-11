import { useState } from "react";
import type {
  DrawingAnalysis,
  Evidence,
  Binding,
  Dimension,
  Requirement,
} from "./types";

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
const basis: Record<string, string> = {
  read: "Прочитано",
  derived: "Вычислено",
  assumed: "Предположение",
  unknown: "Неизвестно",
};
const severity: Record<string, string> = {
  error: "Противоречие",
  warning: "Проверить",
  not_checkable: "Не проверено",
  info: "Арифметика",
};

export default function AnalysisInspector({
  data,
  tab,
  onSource,
}: {
  data: DrawingAnalysis;
  tab: "surfaces" | "general";
  onSource: (source: Evidence) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"detail" | "facts" | "checks">("detail");
  const [query, setQuery] = useState("");
  const surface =
    data.surfaces.find((s) => s.id === selected) ?? data.surfaces[0];
  const facts = [...data.dimensions, ...data.requirements];
  const checks = data.validation.checks;
  const observationIds = (entityId: string): string[] => {
    const observation = data.observations.find((o) => o.id === entityId);
    if (observation) return [observation.id];
    const fact = facts.find((f) => f.id === entityId);
    if (fact) return fact.observation_ids;
    const binding = data.bindings.find((b) => b.id === entityId);
    if (binding)
      return facts.find((f) => f.id === binding.fact_id)?.observation_ids ?? [];
    const chain = data.dimension_chains.find((c) => c.id === entityId);
    if (chain)
      return [
        chain.total_dimension_id,
        ...chain.terms.map((t) => t.dimension_id),
      ].flatMap((id) => facts.find((f) => f.id === id)?.observation_ids ?? []);
    return [];
  };
  const Sources = ({ items }: { items: Evidence[] }) => (
    <ul className="analysis-evidence">
      {items.map((e, i) => (
        <li key={i}>
          <button
            className="source-link"
            onClick={() => onSource(e)}
            title={
              e.bbox
                ? "Показать область на чертеже"
                : "Координаты не указаны; открыть лист"
            }
          >
            Лист {e.page} · {e.description}
            {!e.bbox ? " (без координат)" : " ↗"}
          </button>
        </li>
      ))}
    </ul>
  );
  const Observed = ({ ids }: { ids: string[] }) => (
    <>
      {data.observations
        .filter((o) => ids.includes(o.id))
        .map((o) => (
          <div className="observed-label" key={o.id}>
            <small>Исходная надпись · {o.id}</small>
            <strong>{o.raw_text}</strong>
            {o.alternatives.length > 0 && (
              <p>Варианты: {o.alternatives.join(" / ")}</p>
            )}
            <Sources items={o.evidence} />
          </div>
        ))}
    </>
  );
  const Fact = ({ item }: { item: Dimension | Requirement }) => {
    const dimension = "basis" in item;
    return (
      <div className="analysis-requirement">
        <strong>
          {item.id} · {dimension ? item.name : item.raw_text}
        </strong>
        {dimension ? (
          <>
            <p>
              {basis[item.basis]}: {item.value ?? "?"} {item.unit ?? ""} ·{" "}
              {item.designation}
            </p>
            <p>{item.reference_description}</p>
            {item.derivation_note && <p>{item.derivation_note}</p>}
          </>
        ) : (
          <>
            <p>{item.scope_description}</p>
            {item.it_grade && <p>Квалитет: {item.it_grade}</p>}
            {item.dimension_ids.length > 0 && (
              <p>Относится к размерам: {item.dimension_ids.join(", ")}</p>
            )}
          </>
        )}
        <Observed ids={item.observation_ids} />
      </div>
    );
  };
  const Bound = ({ binding }: { binding: Binding }) => {
    const fact = facts.find((f) => f.id === binding.fact_id);
    return (
      <div className={`binding-card ${binding.status}`}>
        <small>
          {binding.id} ·{" "}
          {binding.status === "disputed"
            ? "Спорная привязка"
            : "Гипотеза привязки"}
        </small>
        {fact && <Fact item={fact} />}
        <p>{binding.rationale}</p>
        {binding.target_evidence.length > 0 && (
          <>
            <small>Место привязки на контуре</small>
            <Sources items={binding.target_evidence} />
          </>
        )}
        {binding.surface_ids.length > 1 && (
          <p>
            Участники: {binding.surface_ids.join(", ")}. Размер не обязательно
            задаёт длину каждой поверхности.
          </p>
        )}
        {binding.alternatives.map((a, i) => (
          <p className="analysis-question" key={i}>
            {a}
          </p>
        ))}
      </div>
    );
  };
  const unbound = facts.filter(
    (f) =>
      !("scope" in f && f.scope === "general") &&
      !data.bindings.some((b) => b.fact_id === f.id && b.surface_ids.length),
  );
  return (
    <div className="analysis-data">
      <div className="analysis-draft">
        <strong>Анализ 0.5 · требуется проверка</strong>
        <p>
          {data.observations.length} обозначений · {data.dimensions.length}{" "}
          размеров · {data.requirements.length} требований
        </p>
        <details>
          <summary>Описание детали</summary>
          <p>{data.summary}</p>
        </details>
        <small>Все привязки — гипотезы. Готовность к 3D не подтверждена.</small>
      </div>
      <div className="analysis-modes" aria-label="Просмотр анализа">
        <button
          aria-pressed={mode === "detail"}
          onClick={() => setMode("detail")}
        >
          Детали
        </button>
        <button
          aria-pressed={mode === "facts"}
          onClick={() => setMode("facts")}
        >
          Обозначения
        </button>
        <button
          aria-pressed={mode === "checks"}
          onClick={() => setMode("checks")}
        >
          Проверки (
          {
            checks.filter(
              (c) => c.severity === "error" || c.severity === "warning",
            ).length
          }
          )
        </button>
      </div>
      {mode === "checks" ? (
        <div className="local-checks">
          <p>{data.validation.scope}</p>
          {checks.map((c, i) => (
            <div className={`local-check ${c.severity}`} key={i}>
              <strong>
                {severity[c.severity]} · {c.entity_ids.join(", ")}
              </strong>
              <p>{c.message}</p>
              <Observed
                ids={[...new Set(c.entity_ids.flatMap(observationIds))]}
              />
              {data.surfaces
                .filter((s) => c.entity_ids.includes(s.id))
                .map((s) => (
                  <Sources key={s.id} items={s.evidence} />
                ))}
            </div>
          ))}
        </div>
      ) : mode === "facts" ? (
        <>
          <label className="fact-search">
            Поиск обозначения
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Число, знак, требование…"
            />
          </label>
          <details className="unbound-facts">
            <summary>Факты без привязки ({unbound.length})</summary>
            {unbound.map((f) => (
              <Fact key={f.id} item={f} />
            ))}
          </details>
          {data.observations
            .filter((o) =>
              `${o.raw_text} ${o.id}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((o) => (
              <div className="fact-card" key={o.id}>
                <Observed ids={[o.id]} />
                <p>
                  {data.views.find((v) => v.id === o.view_id)?.label ??
                    "Общие указания / вид не определён"}
                </p>
                {facts
                  .filter((f) => f.observation_ids.includes(o.id))
                  .map((f) => (
                    <div key={f.id}>
                      <p>
                        <b>Трактовка {f.id}:</b>{" "}
                        {"basis" in f
                          ? `${f.name}: ${f.value ?? "?"} ${f.unit ?? ""}. ${f.reference_description}`
                          : f.scope_description}
                      </p>
                      {data.bindings
                        .filter((b) => b.fact_id === f.id)
                        .map((b) => (
                          <p key={b.id}>
                            {b.status === "disputed" ? "Спорно" : "Гипотеза"} →{" "}
                            {b.surface_ids.join(", ") || "нет поверхности"}:{" "}
                            {b.rationale}
                          </p>
                        ))}
                    </div>
                  ))}
              </div>
            ))}
        </>
      ) : tab === "general" ? (
        <div className="general-detail">
          <h3>{data.drawing_general.part_name ?? "Название не определено"}</h3>
          <dl className="properties">
            {[
              ["Обозначение", data.drawing_general.designation],
              ["Материал", data.drawing_general.material],
              ["Единицы", data.drawing_general.units],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v ?? "Не определено"}</dd>
              </div>
            ))}
          </dl>
          <h4>Общие требования</h4>
          {data.requirements
            .filter((r) =>
              data.drawing_general.general_requirement_ids.includes(r.id),
            )
            .map((r) => (
              <Fact key={r.id} item={r} />
            ))}
          {data.drawing_general.notes.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
          <h4>Виды и разрезы</h4>
          {data.views.map((v) => (
            <div className="fact-card" key={v.id}>
              <strong>
                {v.id} · {v.label}
              </strong>
              <p>{v.description}</p>
              <Sources items={v.evidence} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="surface-list">
            {data.surfaces.map((s) => (
              <button
                key={s.id}
                className={`surface-row ${surface?.id === s.id ? "selected" : ""}`}
                aria-pressed={surface?.id === s.id}
                onClick={() => setSelected(s.id)}
              >
                <div className="surface-text">
                  <strong>{s.name}</strong>
                  <small>
                    {s.id} · {kinds[s.type]}
                  </small>
                </div>
              </button>
            ))}
          </div>
          {surface ? (
            <div className="surface-detail">
              <h3>
                {surface.id} · {surface.name}
              </h3>
              <p>{surface.boundary_description ?? "Границы не определены"}</p>
              <Sources items={surface.evidence} />
              <h4>Размеры и требования: привязки модели</h4>
              {data.bindings
                .filter((b) => b.surface_ids.includes(surface.id))
                .map((b) => (
                  <Bound key={b.id} binding={b} />
                ))}
              {surface.uncertainties.map((u, i) => (
                <p className="analysis-question" key={i}>
                  {u}
                </p>
              ))}
            </div>
          ) : (
            <p>Поверхности не выделены.</p>
          )}
        </>
      )}
      <details className="analysis-questions">
        <summary>
          Вопросы и недостающие данные ({data.questions.length})
        </summary>
        <ul>
          {data.questions.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </details>
      <details className="analysis-json">
        <summary>JSON результата</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
