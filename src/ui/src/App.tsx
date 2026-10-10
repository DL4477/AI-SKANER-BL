import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileText,
  FolderOpen,
  Layers3,
  Maximize2,
  Minus,
  Plus,
  ScanLine,
  Settings2,
  SlidersHorizontal,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import PdfPreview from "./PdfPreview";

type Surface = {
  id: string;
  name: string;
  kind: string;
  size: string;
  geometry: [string, string][];
  roughness: string;
  source: string;
};
const surfaces: Surface[] = [
  {
    id: "S001",
    name: "Наружная стенка",
    kind: "Цилиндр",
    size: "Ø40",
    geometry: [
      ["Диаметр", "40 мм"],
      ["Длина", "30 мм"],
      ["Ориентация", "Наружу"],
    ],
    roughness: "Ra 1,6 мкм",
    source: "Местное обозначение",
  },
  {
    id: "S002",
    name: "Стенка отверстия",
    kind: "Цилиндр",
    size: "Ø20",
    geometry: [
      ["Диаметр", "20 мм"],
      ["Длина", "30 мм"],
      ["Ориентация", "В полость"],
    ],
    roughness: "Ra 3,2 мкм",
    source: "Из общих требований",
  },
  {
    id: "S003",
    name: "Левый торец",
    kind: "Плоскость",
    size: "Z = 0",
    geometry: [
      ["Наружный диаметр", "40 мм"],
      ["Диаметр отверстия", "20 мм"],
      ["Положение", "Z = 0 мм"],
    ],
    roughness: "Ra 3,2 мкм",
    source: "Из общих требований",
  },
  {
    id: "S004",
    name: "Правый торец",
    kind: "Плоскость",
    size: "Z = 30",
    geometry: [
      ["Наружный диаметр", "40 мм"],
      ["Диаметр отверстия", "20 мм"],
      ["Положение", "Z = 30 мм"],
    ],
    roughness: "Ra 3,2 мкм",
    source: "Из общих требований",
  },
];
const highlightPaths: Record<string, string> = {
  S001: "M130 155H430 M130 355H430",
  S002: "M130 205H430 M130 305H430",
  S003: "M130 155V205 M130 305V355",
  S004: "M430 155V205 M430 305V355",
};
type LocalDocument = { name: string; url: string };
type ModelProfile = { mode: string; endpoint: string; model: string };

export default function App() {
  const [document, setDocument] = useState<LocalDocument | null>(null);
  const [selected, setSelected] = useState("S001");
  const [tab, setTab] = useState<"surfaces" | "general">("surfaces");
  const [zoom, setZoom] = useState(100);
  const [journal, setJournal] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<"settings" | "projects" | "help" | null>(
    null,
  );
  const [profile, setProfile] = useState<ModelProfile>({
    mode: "remote",
    endpoint: "",
    model: "",
  });
  const [savedProfile, setSavedProfile] = useState<ModelProfile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const drawingSpace = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const surface = surfaces.find((item) => item.id === selected)!;
  const demo = document === null;

  useEffect(
    () => () => {
      if (document) URL.revokeObjectURL(document.url);
    },
    [document],
  );
  useEffect(() => {
    if (dialog) modal.current?.showModal();
    else modal.current?.close();
  }, [dialog]);

  async function openFile(file?: File) {
    if (!file) return;
    setError("");
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Выберите PDF-файл. Другие форматы пока не поддерживаются.");
      return;
    }
    try {
      const header = await file.slice(0, 1024).text();
      if (!header.includes("%PDF-")) {
        setError("Файл не похож на PDF. Проверьте исходный документ.");
        return;
      }
      setDocument({ name: file.name, url: URL.createObjectURL(file) });
      setZoom(100);
      setDialog(null);
    } catch {
      setError("Не удалось открыть файл. Попробуйте выбрать его ещё раз.");
    }
  }
  function openDemo() {
    setDocument(null);
    setSelected("S001");
    setZoom(100);
    setTab("surfaces");
    setError("");
    setDialog(null);
  }
  function fitDrawing() {
    const viewport = drawingSpace.current;
    if (!viewport) return;
    const style = getComputedStyle(viewport);
    const width =
      viewport.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    const height =
      viewport.clientHeight -
      parseFloat(style.paddingTop) -
      parseFloat(style.paddingBottom);
    setZoom(
      Math.max(
        30,
        Math.min(
          100,
          Math.floor((Math.min(width, (height * 800) / 560) / width) * 100),
        ),
      ),
    );
  }

  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Навигация">
        <div className="brand-mark" aria-label="ИИ СКАНЕР">
          <ScanLine size={25} />
        </div>
        <button
          className="rail-button active"
          aria-label="Рабочая область"
          title="Рабочая область"
          onClick={() => setDialog(null)}
        >
          <Layers3 size={21} />
        </button>
        <button
          className="rail-button"
          aria-label="Проекты"
          title="Проекты"
          onClick={() => setDialog("projects")}
        >
          <FolderOpen size={21} />
        </button>
        <button
          className="rail-button"
          aria-label="Модель и инструменты"
          title="Модель и инструменты"
          onClick={() => setDialog("settings")}
        >
          <Workflow size={21} />
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-button"
          aria-label="Об интерфейсе"
          title="Об интерфейсе"
          onClick={() => setDialog("help")}
        >
          <CircleHelp size={21} />
        </button>
        <div className="avatar" aria-label="Локальное рабочее пространство">
          Л
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="wordmark">
            ИИ СКАНЕР
            <span className="wordmark-divider" />
            <span className="workspace-label">Рабочее пространство</span>
          </div>
          <button className="connection" onClick={() => setDialog("settings")}>
            <span className="status-dot" />
            Модель не подключена
            <Settings2 size={15} />
          </button>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                ПРОЕКТИРОВАНИЕ <span>/</span> ПЕРВЫЙ ИНТЕРФЕЙС
              </div>
              <h1>{demo ? "Учебная втулка" : document.name}</h1>
              <p>
                {demo
                  ? "DEMO-001 · Пример рабочего пространства"
                  : "Локальный документ · Только просмотр"}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={16} />
                Открыть PDF
              </button>
              <button
                className="button primary"
                disabled
                title="Разбор появится после подключения ядра агента"
              >
                <ScanLine size={17} />
                Разобрать чертёж
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              onChange={(event) => {
                void openFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>

          <div className="stage-strip">
            <span className="stage current">
              <span className="stage-number">1</span>Исходный чертёж
            </span>
            <ChevronRight size={15} />
            <span className="stage">
              <span className="stage-number">2</span>Разбор агентом
            </span>
            <ChevronRight size={15} />
            <span className="stage">
              <span className="stage-number">3</span>Проверка и JSON
            </span>
            <span className="stage-note">Этап 1 · Интерфейс</span>
          </div>
          {error && (
            <div className="error-message" role="alert">
              {error}
              <button aria-label="Закрыть ошибку" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}

          <div className="workspace-grid">
            <section
              className={`viewer-panel ${dragging ? "dragging" : ""}`}
              aria-label="Просмотр чертежа"
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                  setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void openFile(event.dataTransfer.files[0]);
              }}
            >
              <div className="panel-toolbar">
                <div className="panel-title">
                  <FileText size={17} />
                  <span>Чертёж</span>
                  <span className="badge">
                    {demo ? "Учебный пример" : "PDF"}
                  </span>
                </div>
                {demo ? (
                  <div className="zoom-controls">
                    <button
                      aria-label="Уменьшить"
                      disabled={!demo || zoom <= 30}
                      onClick={() =>
                        setZoom((value) => Math.max(30, value - 10))
                      }
                    >
                      <Minus size={15} />
                    </button>
                    <span>{demo ? `${zoom}%` : "PDF"}</span>
                    <button
                      aria-label="Увеличить"
                      disabled={!demo || zoom >= 180}
                      onClick={() =>
                        setZoom((value) => Math.min(180, value + 10))
                      }
                    >
                      <Plus size={15} />
                    </button>
                    <span className="control-divider" />
                    <button
                      aria-label="Вписать чертёж"
                      disabled={!demo}
                      onClick={fitDrawing}
                    >
                      <Maximize2 size={15} />
                    </button>
                  </div>
                ) : (
                  <span className="muted-label">
                    Просмотр на этом компьютере
                  </span>
                )}
              </div>
              <div className="drawing-space" ref={drawingSpace}>
                {demo ? (
                  <div className="drawing-page" style={{ width: `${zoom}%` }}>
                    <img
                      src="/demo-bushing.svg"
                      alt="Учебный эскиз втулки с наружным диаметром 40, отверстием 20 и длиной 30 миллиметров"
                    />
                    <svg
                      className="drawing-overlay"
                      viewBox="0 0 800 560"
                      aria-label={`Подсветка: ${tab === "general" ? "общие требования" : surface.name}`}
                      role="img"
                    >
                      {tab === "surfaces" ? (
                        <path d={highlightPaths[selected]} />
                      ) : (
                        <rect x="94" y="444" width="600" height="35" rx="4" />
                      )}
                    </svg>
                  </div>
                ) : (
                  <PdfPreview key={document.url} url={document.url} />
                )}
                {dragging && (
                  <div className="drop-overlay">
                    <Upload size={32} />
                    <strong>Отпустите PDF здесь</strong>
                  </div>
                )}
              </div>
              <div className="viewer-footer">
                <span>
                  {demo
                    ? "Лист 1 из 1"
                    : "Локальный просмотр · без обработки ИИ"}
                </span>
                {demo ? (
                  <span className="selection-hint">
                    <span className="blue-dot" />
                    {tab === "general"
                      ? "Общие требования"
                      : `${surface.id} · ${surface.name}`}
                  </span>
                ) : (
                  <button className="text-button" onClick={openDemo}>
                    Закрыть PDF
                    <X size={13} />
                  </button>
                )}
              </div>
            </section>

            <aside className="inspector" aria-label="Данные чертежа">
              <div className="inspector-heading">
                <h2>Данные чертежа</h2>
                <SlidersHorizontal size={17} />
              </div>
              <div className="data-tabs" aria-label="Раздел данных">
                <button
                  aria-pressed={tab === "surfaces"}
                  className={tab === "surfaces" ? "selected" : ""}
                  onClick={() => setTab("surfaces")}
                >
                  Поверхности{demo && <span>4</span>}
                </button>
                <button
                  aria-pressed={tab === "general"}
                  className={tab === "general" ? "selected" : ""}
                  onClick={() => setTab("general")}
                >
                  Общие сведения
                </button>
              </div>
              <div className="inspector-content">
                {!demo ? (
                  <div className="empty-data">
                    <div className="empty-icon">
                      <ScanLine size={28} />
                    </div>
                    <h3>Чертёж открыт</h3>
                    <p>
                      Здесь появятся поверхности, размеры и требования после
                      подключения агента.
                    </p>
                    <span className="muted-label">
                      Сейчас доступен просмотр PDF
                    </span>
                    <button className="text-button" onClick={openDemo}>
                      Посмотреть учебный пример
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                ) : tab === "surfaces" ? (
                  <>
                    <div className="surface-list">
                      {surfaces.map((item) => (
                        <button
                          key={item.id}
                          className={`surface-row ${selected === item.id ? "selected" : ""}`}
                          aria-pressed={selected === item.id}
                          onClick={() => setSelected(item.id)}
                        >
                          <div
                            className={`surface-symbol ${item.kind === "Плоскость" ? "plane" : ""}`}
                            aria-hidden="true"
                          >
                            {item.kind === "Цилиндр" ? "◯" : "◇"}
                          </div>
                          <div className="surface-text">
                            <strong>{item.name}</strong>
                            <small>
                              {item.id}
                              <span>·</span>
                              {item.kind}
                              <span>·</span>
                              {item.size}
                            </small>
                          </div>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                    <div className="surface-detail" aria-live="polite">
                      <div className="detail-title">
                        <span className="eyebrow">ВЫБРАННАЯ ПОВЕРХНОСТЬ</span>
                        <span className="id-tag">{surface.id}</span>
                      </div>
                      <h3>{surface.name}</h3>
                      <dl className="properties">
                        {surface.geometry.map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <h4>Технические требования</h4>
                      <div className="requirement">
                        <div>
                          <span className="muted-label">Шероховатость</span>
                          <strong>{surface.roughness}</strong>
                        </div>
                        <span
                          className={`requirement-source ${surface.id === "S001" ? "local" : ""}`}
                        >
                          {surface.source}
                        </span>
                      </div>
                      <dl className="properties compact">
                        <div>
                          <dt>Квалитет IT</dt>
                          <dd>Не задан в примере</dd>
                        </div>
                        {surface.id === "S001" && (
                          <div>
                            <dt>Допуск диаметра</dt>
                            <dd>±0,1 мм</dd>
                          </div>
                        )}
                      </dl>
                      <div className="source-note">
                        <FileText size={14} />
                        <span>Связанная область выделена на чертеже</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="general-detail">
                    <span className="eyebrow">ОБЩАЯ ИНФОРМАЦИЯ</span>
                    <h3>Учебная втулка</h3>
                    <dl className="properties">
                      <div>
                        <dt>Обозначение</dt>
                        <dd>DEMO-001</dd>
                      </div>
                      <div>
                        <dt>Материал</dt>
                        <dd>Сталь 45</dd>
                      </div>
                      <div>
                        <dt>Единицы длины</dt>
                        <dd>Миллиметры</dd>
                      </div>
                      <div>
                        <dt>Количество листов</dt>
                        <dd>1</dd>
                      </div>
                    </dl>
                    <h4>Общие требования</h4>
                    <div className="general-requirement">
                      <strong>Ra 3,2 мкм</strong>
                      <p>
                        Для поверхностей без местного обозначения шероховатости.
                      </p>
                    </div>
                    <p className="detail-explanation">
                      Общие указания хранятся отдельно. В карточках поверхностей
                      показываются применимые к ним требования.
                    </p>
                    <div className="source-note">
                      <FileText size={14} />
                      <span>Общее указание выделено на чертеже</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="inspector-footer">
                <span>
                  {demo
                    ? "Данные примера заданы вручную"
                    : "Распознавание ещё не запускалось"}
                </span>
                <button
                  className="button export-button"
                  disabled
                  title="Экспорт станет доступен после реализации структуры данных"
                >
                  <ArrowDownToLine size={15} />
                  Экспорт JSON
                </button>
              </div>
            </aside>
          </div>

          <section className="journal">
            <button
              className="journal-toggle"
              aria-expanded={journal}
              aria-controls="journal-content"
              onClick={() => setJournal((value) => !value)}
            >
              <span>
                <Workflow size={16} />
                Журнал действий
                <span className="count">{document ? "2" : "1"}</span>
              </span>
              <span className="journal-summary">
                {document ? "PDF открыт локально" : "Учебный пример загружен"}
                <ChevronDown className={journal ? "rotated" : ""} size={16} />
              </span>
            </button>
            {journal && (
              <div id="journal-content" className="journal-content">
                <p>
                  <Check size={14} />
                  Интерфейс открыт. Учебные данные созданы вручную.
                </p>
                {document && (
                  <p>
                    <FileText size={14} />
                    Открыт локальный файл: {document.name}
                  </p>
                )}
                <p className="muted-label">
                  Запросы к модели не выполняются. Журнал доступен до
                  перезагрузки страницы.
                </p>
              </div>
            )}
          </section>
          <footer className="workspace-footer">
            <span>
              <span className="status-dot" />
              {demo
                ? "Демонстрация интерфейса · без ИИ-обработки"
                : "PDF остаётся на этом компьютере"}
            </span>
            <span>
              ИИ СКАНЕР <span className="version">0.1</span>
            </span>
          </footer>
        </main>
      </div>

      <dialog
        ref={modal}
        className="modal"
        onCancel={() => setDialog(null)}
        onClose={() => setDialog(null)}
        aria-labelledby="dialog-title"
      >
        <div className="modal-heading">
          <h2 id="dialog-title">
            {dialog === "settings"
              ? "Модель и инструменты"
              : dialog === "projects"
                ? "Рабочие документы"
                : "Первый интерфейс"}
          </h2>
          <button
            className="icon-button"
            aria-label="Закрыть окно"
            onClick={() => setDialog(null)}
          >
            <X size={20} />
          </button>
        </div>
        {dialog === "settings" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSavedProfile({ ...profile });
            }}
          >
            <p className="modal-intro">
              Подготовка настроек подключения. Модель и инструменты подключим на
              следующем этапе.
            </p>
            <label className="field">
              Размещение модели
              <select
                value={profile.mode}
                onChange={(event) => {
                  setProfile({ ...profile, mode: event.target.value });
                  setSavedProfile(null);
                }}
              >
                <option value="remote">Внешний API</option>
                <option value="local">Локальный API</option>
              </select>
            </label>
            <label className="field">
              Адрес API
              <input
                type="url"
                placeholder={
                  profile.mode === "local"
                    ? "http://localhost:1234/v1"
                    : "https://api.example.com/v1"
                }
                value={profile.endpoint}
                onChange={(event) => {
                  setProfile({ ...profile, endpoint: event.target.value });
                  setSavedProfile(null);
                }}
              />
            </label>
            <label className="field">
              Название модели
              <input
                placeholder="Идентификатор модели на сервере"
                value={profile.model}
                onChange={(event) => {
                  setProfile({ ...profile, model: event.target.value });
                  setSavedProfile(null);
                }}
              />
            </label>
            <h3 className="tools-title">Инструменты агента</h3>
            <div className="tool-row">
              <span>
                <FileText size={15} />
                Чтение PDF
              </span>
              <span>Запланирован</span>
            </div>
            <div className="tool-row">
              <span>
                <ScanLine size={15} />
                Распознавание обозначений
              </span>
              <span>Запланирован</span>
            </div>
            <div className="tool-row">
              <span>
                <Box size={15} />
                Проверка поверхностей
              </span>
              <span>Запланирован</span>
            </div>
            <p className="settings-status" role="status">
              {savedProfile
                ? "Настройки сохранены до закрытия страницы. Подключение не выполнялось."
                : "Ключ API пока не требуется. Запросы не отправляются."}
            </p>
            <button className="button primary" type="submit">
              Сохранить для этого сеанса
            </button>
          </form>
        ) : dialog === "projects" ? (
          <>
            <p className="modal-intro">
              Документы текущего сеанса. Библиотека проектов появится позже.
            </p>
            <button className="document-choice" onClick={openDemo}>
              <FileText size={25} />
              <span>
                <strong>Учебная втулка</strong>
                <small>Пример интерфейса · 4 поверхности</small>
              </span>
              <ChevronRight size={18} />
            </button>
            {document && (
              <button
                className="document-choice"
                onClick={() => setDialog(null)}
              >
                <FileText size={25} />
                <span>
                  <strong>{document.name}</strong>
                  <small>Локальный PDF · Только просмотр</small>
                </span>
                <ChevronRight size={18} />
              </button>
            )}
            <button
              className="button"
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={16} />
              Открыть PDF
            </button>
          </>
        ) : (
          <>
            <p className="modal-intro">
              Первый шаг проектирования приложения для чтения инженерных
              чертежей.
            </p>
            <ul className="help-list">
              <li>Откройте PDF для локального просмотра.</li>
              <li>
                В учебном примере выберите поверхность: её граница подсветится
                на эскизе.
              </li>
              <li>
                Переключитесь на общие сведения, чтобы увидеть требования ко
                всей детали.
              </li>
            </ul>
            <p className="detail-explanation">
              Распознавание, проверка геометрии, постоянное хранение и экспорт
              JSON ещё не подключены. Учебные значения не относятся к
              загруженным PDF.
            </p>
            <button className="button primary" onClick={() => setDialog(null)}>
              К рабочему пространству
            </button>
          </>
        )}
      </dialog>
    </div>
  );
}
