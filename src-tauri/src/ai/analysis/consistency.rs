//! Structural integrity is mandatory. Semantic checks are review hints, never CAD approval.
use super::*;
use std::collections::{HashMap, HashSet};

fn list<'a>(v: &'a Value, key: &str) -> &'a Vec<Value> {
    v[key].as_array().unwrap()
}
fn id(v: &Value) -> &str {
    v["id"].as_str().unwrap()
}
fn strings<'a>(v: &'a Value, key: &str) -> impl Iterator<Item = &'a str> {
    list(v, key).iter().map(|s| s.as_str().unwrap())
}
fn invalid() -> AiError {
    AiError::new(
        "invalid_references",
        "В анализе есть неверные ссылки, координаты или значения. Результат не принят.",
    )
}

pub(super) fn validate_relations(data: &Value, page_count: usize) -> AiResult<()> {
    let mut ids = HashSet::new();
    for key in [
        "views",
        "observations",
        "dimensions",
        "requirements",
        "surfaces",
        "bindings",
        "dimension_chains",
    ] {
        for item in list(data, key) {
            if id(item).trim().is_empty() || !ids.insert(id(item)) {
                return Err(invalid());
            }
        }
    }
    let set = |key| list(data, key).iter().map(id).collect::<HashSet<_>>();
    let views = set("views");
    let obs = set("observations");
    let dims = set("dimensions");
    let reqs = set("requirements");
    let surfs = set("surfaces");
    for o in list(data, "observations") {
        if let Some(view) = o["view_id"].as_str() {
            if !views.contains(view) {
                return Err(invalid());
            }
        }
    }
    for fact in list(data, "dimensions")
        .iter()
        .chain(list(data, "requirements"))
    {
        let refs: Vec<_> = strings(fact, "observation_ids").collect();
        if refs.iter().any(|x| !obs.contains(x))
            || refs.iter().collect::<HashSet<_>>().len() != refs.len()
        {
            return Err(invalid());
        }
    }
    for d in list(data, "dimensions") {
        if d["basis"] == "unknown" && !d["value"].is_null() {
            return Err(invalid());
        }
        if d["basis"] != "derived" && !list(d, "derived_from").is_empty() {
            return Err(invalid());
        }
        for term in list(d, "derived_from") {
            if !dims.contains(term["dimension_id"].as_str().unwrap()) {
                return Err(invalid());
            }
        }
    }
    for r in list(data, "requirements") {
        if strings(r, "dimension_ids").any(|x| !dims.contains(x)) {
            return Err(invalid());
        }
    }
    for b in list(data, "bindings") {
        let fact = b["fact_id"].as_str().unwrap();
        if !(dims.contains(fact) || reqs.contains(fact))
            || strings(b, "surface_ids").any(|x| !surfs.contains(x))
            || strings(b, "surface_ids").collect::<HashSet<_>>().len()
                != list(b, "surface_ids").len()
            || (reqs.contains(fact) != (b["property"] == "technical_requirement"))
        {
            return Err(invalid());
        }
    }
    for r in strings(&data["drawing_general"], "general_requirement_ids") {
        if !list(data, "requirements")
            .iter()
            .any(|item| id(item) == r && item["scope"] == "general")
        {
            return Err(invalid());
        }
    }
    for c in list(data, "dimension_chains") {
        if !dims.contains(c["total_dimension_id"].as_str().unwrap())
            || list(c, "terms")
                .iter()
                .any(|t| !dims.contains(t["dimension_id"].as_str().unwrap()))
        {
            return Err(invalid());
        }
    }
    fn evidence_ok(v: &Value, pages: usize) -> bool {
        match v {
            Value::Object(fields) => fields.iter().all(|(key, v)| {
                if key == "evidence" || key == "target_evidence" {
                    v.as_array().unwrap().iter().all(|e| {
                        e["page"].as_u64().unwrap() as usize <= pages
                            && e["bbox"].as_array().map_or(true, |b| {
                                b[0].as_f64() < b[2].as_f64() && b[1].as_f64() < b[3].as_f64()
                            })
                    })
                } else {
                    evidence_ok(v, pages)
                }
            }),
            Value::Array(items) => items.iter().all(|v| evidence_ok(v, pages)),
            _ => true,
        }
    }
    if !evidence_ok(data, page_count) {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn check(data: &Value) -> Value {
    let mut checks = Vec::new();
    let mut omitted = 0usize;
    let mut add = |code: &str, severity: &str, ids: Vec<&str>, message: String| {
        if checks.len() >= 4999 {
            omitted += 1;
            return;
        }
        checks.push(json!({"code":code,"severity":severity,"entity_ids":ids,"message":message}));
    };
    let dims: HashMap<_, _> = list(data, "dimensions")
        .iter()
        .map(|v| (id(v), v))
        .collect();
    let observations: HashMap<_, _> = list(data, "observations")
        .iter()
        .map(|v| (id(v), v))
        .collect();
    let requirements: HashMap<_, _> = list(data, "requirements")
        .iter()
        .map(|r| (id(r), r))
        .collect();
    let bindings = list(data, "bindings");
    let facts: Vec<_> = list(data, "dimensions")
        .iter()
        .chain(list(data, "requirements"))
        .collect();
    add("interpretation_unverified","not_checkable",vec![],"Приложение проверяет ссылки и согласованность. Геометрический смысл, правильность стрелок и полнота поверхностей требуют сверки с чертежом.".into());
    for o in list(data, "observations") {
        if !list(o, "alternatives").is_empty() {
            add(
                "reading_alternatives",
                "warning",
                vec![id(o)],
                "Сохранено несколько прочтений обозначения.".into(),
            );
        }
        if list(o, "evidence").iter().all(|e| e["bbox"].is_null()) {
            add(
                "source_unlocated",
                "not_checkable",
                vec![id(o)],
                "Нет координат обозначения; переход возможен только к листу.".into(),
            );
        }
        if !facts
            .iter()
            .any(|f| strings(f, "observation_ids").any(|x| x == id(o)))
            && (o["kind"] == "dimension" || o["kind"] == "requirement")
        {
            add(
                "uninterpreted_observation",
                "warning",
                vec![id(o)],
                "Обозначение прочитано, но не представлено размером или требованием.".into(),
            );
        }
    }
    for f in &facts {
        let fid = id(f);
        if list(f, "observation_ids").is_empty() && f["basis"] != "derived" {
            add(
                "missing_observation",
                "warning",
                vec![fid],
                "Нет ссылки на прочитанное обозначение.".into(),
            );
        }
        if f["scope"] != "general"
            && !bindings
                .iter()
                .any(|b| b["fact_id"] == fid && !list(b, "surface_ids").is_empty())
        {
            add(
                "unbound_fact",
                "warning",
                vec![fid],
                "Факт пока не привязан к поверхностям.".into(),
            );
        }
        if strings(f, "observation_ids").any(|o| !list(observations[o], "alternatives").is_empty())
        {
            add(
                "fact_from_disputed_reading",
                "warning",
                vec![fid],
                "Значение опирается на неоднозначное прочтение; не считайте его подтверждённым."
                    .into(),
            );
        }
        if f["scope"] == "general"
            && !strings(&data["drawing_general"], "general_requirement_ids").any(|r| r == fid)
        {
            add(
                "general_requirement_not_listed",
                "warning",
                vec![fid],
                "Общее требование отсутствует в ссылках drawing_general.".into(),
            );
        }
    }
    for d in list(data, "dimensions") {
        if d["basis"] == "assumed" || d["basis"] == "unknown" || d["value"].is_null() {
            add(
                "dimension_not_read",
                "not_checkable",
                vec![id(d)],
                "Размер неизвестен или предположен моделью.".into(),
            );
        }
        if d["role"] == "angle"
            && d["unit"]
                .as_str()
                .is_some_and(|u| matches!(u, "мм" | "mm" | "см" | "м"))
        {
            add(
                "angle_with_length_unit",
                "error",
                vec![id(d)],
                "Угол записан в единицах длины. Разделите линейный размер фаски и её угол.".into(),
            );
        }
        if let Some(designation) = d["designation"].as_str() {
            let raw = designation.trim_start_matches(['Ø', '⌀', 'φ', 'Φ', '∅', ' ', 'ø']);
            let chars: Vec<_> = raw.chars().collect();
            let has_fit = chars.first().is_some_and(|c| c.is_ascii_digit())
                && chars
                    .windows(2)
                    .any(|pair| pair[0].is_ascii_alphabetic() && pair[1].is_ascii_digit());
            if has_fit
                && !list(data, "requirements").iter().any(|r| {
                    !r["it_grade"].is_null() && strings(r, "dimension_ids").any(|x| x == id(d))
                })
            {
                add("fit_without_grade_requirement","warning",vec![id(d)],"В обозначении есть поле допуска, но нет требования с квалитетом и ссылкой на этот размер.".into());
            }
        }
        if d["basis"] == "derived" {
            arithmetic(d, list(d, "derived_from"), id(d), &dims, &mut add, true);
        }
    }
    // Detect dependency cycles without evaluating any model-provided formula/code.
    fn cycle<'a>(
        start: &'a str,
        current: &'a str,
        dims: &HashMap<&'a str, &'a Value>,
        seen: &mut HashSet<&'a str>,
    ) -> bool {
        if !seen.insert(current) {
            return false;
        }
        list(dims[current], "derived_from").iter().any(|t| {
            let next = t["dimension_id"].as_str().unwrap();
            next == start || cycle(start, next, dims, seen)
        })
    }
    for d in list(data, "dimensions") {
        if cycle(id(d), id(d), &dims, &mut HashSet::new()) {
            add(
                "derivation_cycle",
                "error",
                vec![id(d)],
                "Циклическое вычисление размера; значение нельзя считать выведенным.".into(),
            );
        }
    }
    for b in bindings {
        let bid = id(b);
        if list(b, "target_evidence").is_empty()
            || list(b, "target_evidence")
                .iter()
                .all(|e| e["bbox"].is_null())
        {
            add("binding_target_unlocated","not_checkable",vec![bid],"Место контакта выноски или границы измерения не показаны. Привязку нужно сверить на чертеже.".into());
        }
        if b["status"] == "disputed" || !list(b, "alternatives").is_empty() {
            add(
                "disputed_binding",
                "warning",
                vec![bid],
                "У привязки есть альтернативы или спорный смысл.".into(),
            );
        }
        if b["rationale"].as_str().unwrap().trim().is_empty() {
            add(
                "missing_binding_basis",
                "warning",
                vec![bid],
                "Не указано, по каким линиям или указаниям выполнена привязка.".into(),
            );
        }
        if let Some(d) = dims.get(b["fact_id"].as_str().unwrap()) {
            let prop = b["property"].as_str().unwrap();
            if d["role"] != "unknown" && prop != "unknown" && d["role"] != prop {
                add(
                    "binding_role_conflict",
                    "error",
                    vec![bid, id(d)],
                    "Трактовка размера и его роль в привязке различаются.".into(),
                );
            }
            if (matches!(prop, "axial_length" | "hole_depth" | "thread_depth")
                && d["axis"] == "transverse")
                || (prop == "transverse_distance" && d["axis"] == "axial")
            {
                add(
                    "binding_axis_conflict",
                    "error",
                    vec![bid, id(d)],
                    "Направление размера противоречит роли привязки.".into(),
                );
            }
        }
    }
    for s in list(data, "surfaces") {
        let sid = id(s);
        let name = s["name"].as_str().unwrap().to_lowercase();
        if name.contains(" шт")
            || name.starts_with("два ")
            || name.starts_with("две ")
            || name.starts_with("фаски ")
        {
            add("grouped_physical_surfaces","warning",vec![sid],"Название описывает группу элементов. Для 3D нужны отдельные физические поверхности каждого экземпляра.".into());
        }
        let local: Vec<_> = bindings
            .iter()
            .filter(|b| strings(b, "surface_ids").any(|x| x == sid))
            .collect();
        if local.is_empty() {
            add(
                "surface_without_facts",
                "warning",
                vec![sid],
                "Поверхность не связана ни с одним размером или требованием.".into(),
            );
        }
        for (i, a) in local.iter().enumerate() {
            for b in &local[i + 1..] {
                if let (Some(ra), Some(rb)) = (
                    requirements.get(a["fact_id"].as_str().unwrap()),
                    requirements.get(b["fact_id"].as_str().unwrap()),
                ) {
                    let parameter = |r: &Value| {
                        let raw = r["raw_text"].as_str().unwrap().trim().to_ascii_lowercase();
                        if raw.starts_with("ra ") {
                            Some("Ra")
                        } else if raw.starts_with("rz ") {
                            Some("Rz")
                        } else {
                            None
                        }
                    };
                    if ra["scope"] == "local"
                        && rb["scope"] == "local"
                        && ra["kind"] == "roughness"
                        && rb["kind"] == "roughness"
                        && parameter(ra).is_some()
                        && parameter(ra) == parameter(rb)
                        && ra["unit"] == rb["unit"]
                        && !ra["value"].is_null()
                        && !rb["value"].is_null()
                        && ra["value"] != rb["value"]
                    {
                        add("competing_local_roughness","warning",vec![sid,id(ra),id(rb)],"Одной поверхности назначены разные местные значения одного параметра шероховатости. Проверьте области действия; значения сохранены.".into());
                    }
                }
                if a["property"] != b["property"]
                    || a["fact_id"] == b["fact_id"]
                    || !matches!(
                        a["property"].as_str().unwrap(),
                        "diameter" | "radius" | "axial_length" | "hole_depth" | "thread_depth"
                    )
                {
                    continue;
                }
                // Axial lengths may share one endpoint without measuring the same span.
                if a["property"] == "axial_length"
                    && strings(a, "surface_ids").collect::<HashSet<_>>()
                        != strings(b, "surface_ids").collect::<HashSet<_>>()
                {
                    continue;
                }
                if let (Some(da), Some(db)) = (
                    dims.get(a["fact_id"].as_str().unwrap()),
                    dims.get(b["fact_id"].as_str().unwrap()),
                ) {
                    if da["unit"] == db["unit"]
                        && !da["value"].is_null()
                        && !db["value"].is_null()
                        && da["value"] != db["value"]
                    {
                        add("competing_surface_dimensions","warning",vec![sid,id(a),id(b)],"Одной поверхности назначены разные значения одного типа размера. Проверьте границы и область действия.".into());
                    }
                }
            }
        }
    }
    for c in list(data, "dimension_chains") {
        arithmetic(
            dims[c["total_dimension_id"].as_str().unwrap()],
            list(c, "terms"),
            id(c),
            &dims,
            &mut add,
            false,
        );
    }
    if list(data, "dimension_chains").is_empty() {
        add("no_dimension_chains","not_checkable",vec![],"Модель не задала проверяемых размерных цепей. Арифметическая согласованность не проверена.".into());
    }
    // A duplicate candidate needs the same physical type, the same dimension references,
    // and strongly overlapping source regions. Equal adjacent dimensions alone are insufficient.
    let surfs = list(data, "surfaces");
    for (i, a) in surfs.iter().enumerate() {
        for b in &surfs[i + 1..] {
            if bindings.iter().any(|binding| {
                strings(binding, "surface_ids").any(|s| s == id(a))
                    && strings(binding, "surface_ids").any(|s| s == id(b))
                    && matches!(
                        binding["property"].as_str().unwrap(),
                        "center_distance" | "transverse_distance"
                    )
            }) {
                continue;
            }
            let keys = |s: &Value| {
                bindings
                    .iter()
                    .filter(|x| {
                        strings(x, "surface_ids").any(|v| v == id(s))
                            && dims.contains_key(x["fact_id"].as_str().unwrap())
                    })
                    .map(|x| x["fact_id"].as_str().unwrap())
                    .collect::<HashSet<_>>()
            };
            let ka = keys(a);
            if ka.is_empty()
                || ka != keys(b)
                || a["type"] != b["type"]
                || a["orientation"] != b["orientation"]
            {
                continue;
            }
            if list(a, "evidence")
                .iter()
                .any(|ea| list(b, "evidence").iter().any(|eb| overlap(ea, eb) > 0.85))
            {
                add("possible_duplicate_surfaces","warning",vec![id(a),id(b)],"Совпадают размеры, тип и область источника двух поверхностей. Проверьте возможное дублирование; автоматического объединения нет.".into());
            }
        }
    }
    drop(add);
    if omitted > 0 {
        checks.push(json!({"code":"check_limit","severity":"not_checkable","entity_ids":[],"message":format!("Список замечаний ограничен: ещё {omitted} замечаний. Все исходные факты сохранены; документ требует отдельной проверки.")}));
    }
    json!({"engine_version":"0.5.0","checks":checks,"scope":"Локальные проверки ссылок, арифметики и противоречий. Совпадение не подтверждает геометрический смысл или готовность к 3D."})
}

fn arithmetic<'a>(
    total: &'a Value,
    terms: &'a [Value],
    owner: &'a str,
    dims: &HashMap<&'a str, &'a Value>,
    add: &mut impl FnMut(&str, &str, Vec<&'a str>, String),
    derived: bool,
) {
    let usable = |d: &Value| {
        d["value"].is_number()
            && !d["unit"].is_null()
            && d["basis"] != "assumed"
            && d["basis"] != "unknown"
            && !d["designation"]
                .as_str()
                .is_some_and(|s| s.trim_start().starts_with('~') || s.trim_start().starts_with('≈'))
    };
    let prefix = if derived {
        "Вычисление размера"
    } else {
        "Размерная цепь"
    };
    if terms.is_empty()
        || !usable(total)
        || terms.iter().any(|t| {
            let d = dims[t["dimension_id"].as_str().unwrap()];
            !usable(d) || d["unit"] != total["unit"]
        })
    {
        add(
            "arithmetic_uncheckable",
            "not_checkable",
            vec![owner],
            format!(
                "{prefix}: отсутствуют точные значения, одинаковые единицы или достоверное основание. Приближённые размеры не проверяются как точные."
            ),
        );
        return;
    }
    if terms.iter().any(|t| t["dimension_id"] == total["id"]) {
        add(
            "self_referential_chain",
            "error",
            vec![owner],
            format!("{prefix}: проверяемый размер входит в собственную сумму."),
        );
        return;
    }
    let sum: f64 = terms
        .iter()
        .map(|t| {
            dims[t["dimension_id"].as_str().unwrap()]["value"]
                .as_f64()
                .unwrap()
                * t["coefficient"].as_f64().unwrap()
        })
        .sum();
    let value = total["value"].as_f64().unwrap();
    if !sum.is_finite() || (sum - value).abs() > 1e-6_f64.max(value.abs() * 1e-9) {
        add(
            "arithmetic_mismatch",
            "error",
            vec![owner],
            format!("{prefix}: сумма {sum} не равна {value}. Значения не исправлены."),
        );
    } else {
        add(
            "arithmetic_equal",
            "info",
            vec![owner],
            format!(
                "{prefix}: арифметика сходится ({sum}); общие границы и направление требуют визуальной проверки."
            ),
        );
    }
}
fn overlap(a: &Value, b: &Value) -> f64 {
    if a["page"] != b["page"] {
        return 0.;
    }
    let (Some(a), Some(b)) = (a["bbox"].as_array(), b["bbox"].as_array()) else {
        return 0.;
    };
    let a: Vec<_> = a.iter().map(|x| x.as_f64().unwrap()).collect();
    let b: Vec<_> = b.iter().map(|x| x.as_f64().unwrap()).collect();
    let inter =
        (a[2].min(b[2]) - a[0].max(b[0])).max(0.) * (a[3].min(b[3]) - a[1].max(b[1])).max(0.);
    inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)
}
