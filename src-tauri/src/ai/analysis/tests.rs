use super::*;

pub(crate) fn input() -> AnalysisInput {
    AnalysisInput {
        preparation: None,
        name: "Учебный тест".into(),
        kind: "demo".into(),
        pages: vec![AnalysisPage {
            page: 1,
            width: 160,
            height: 80,
            image: format!(
                "data:image/png;base64,{}",
                STANDARD.encode(include_bytes!("../../../assets/vision-probe.png"))
            ),
        }],
    }
}
pub(crate) fn data() -> Value {
    let evidence = json!([{"page":1,"description":"Вид сверху","bbox":[0.1,0.1,0.9,0.9]}]);
    json!({
        "schema_version":"0.2.0-draft","status":"needs_review","ready_for_3d":false,
        "source":{"name":"model supplied name","kind":"pdf","page_count":1},
        "drawing_general":{"part_name":"Деталь","designation":null,"material":null,"units":"мм","notes":[],"general_requirement_ids":["R1"]},
        "views":[{"id":"V1","label":"Главный вид","kind":"main","description":"Вид","evidence":evidence}],
        "observations":[{"id":"O1","raw_text":"Ø40","kind":"dimension","view_id":"V1","alternatives":[],"evidence":evidence},{"id":"O2","raw_text":"Ra 3,2","kind":"requirement","view_id":null,"alternatives":[],"evidence":evidence}],
        "dimensions":[{"id":"D1","observation_ids":["O1"],"name":"Диаметр","value":40,"unit":"мм","designation":"Ø40","basis":"read","role":"diameter","axis":"transverse","reference_description":"Между образующими","derived_from":[],"derivation_note":null}],
        "requirements":[{"id":"R1","kind":"roughness","raw_text":"Ra 3,2","value":3.2,"unit":"мкм","it_grade":null,"observation_ids":["O2"],"dimension_ids":[],"scope":"general","scope_description":"Без местного указания"}],
        "bindings":[{"id":"B1","fact_id":"D1","surface_ids":["S1"],"property":"diameter","target_evidence":[],"status":"proposed","rationale":"Между образующими","alternatives":[]},{"id":"B2","fact_id":"R1","surface_ids":["S1"],"property":"technical_requirement","target_evidence":[],"status":"proposed","rationale":"Без местного указания","alternatives":[]}],
        "surfaces":[{"id":"S1","name":"Цилиндр","physical_role":"cylindrical_side","type":"cylinder","orientation":"outward","boundary_description":null,"evidence":evidence,"uncertainties":["Длина неизвестна"]}],
        "dimension_chains":[],"questions":["Уточнить длину"],"summary":"Черновой анализ"
    })
}
pub(crate) fn completion(data: &Value) -> Value {
    json!({"choices":[{"finish_reason":"stop","message":{"content":data.to_string()}}],"usage":{"total_tokens":123}})
}

fn has_check(data: &Value, code: &str) -> bool {
    consistency::check(data)["checks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["code"] == code)
}

#[test]
fn fit_chamfer_and_target_coverage_are_checked_without_inventing_values() {
    let mut d = data();
    d["dimensions"][0]["designation"] = json!("40h7");
    assert!(has_check(&d, "fit_without_grade_requirement"));
    assert!(has_check(&d, "binding_target_unlocated"));
    d["requirements"][0]["it_grade"] = json!("IT7");
    d["requirements"][0]["dimension_ids"] = json!(["D1"]);
    assert!(!has_check(&d, "fit_without_grade_requirement"));
    d["dimensions"][0]["role"] = json!("angle");
    assert!(has_check(&d, "angle_with_length_unit"));
    d["dimensions"][0]["designation"] = json!("М6-7H/8g");
    d["requirements"][0]["it_grade"] = Value::Null;
    assert!(!has_check(&d, "fit_without_grade_requirement"));
    d["bindings"][0]["target_evidence"] =
        json!([{"page":2,"bbox":[0.1,0.1,0.2,0.2],"description":"Контакт"}]);
    assert_eq!(
        parse_output(&completion(&d), &input()).unwrap_err().code,
        "invalid_references"
    );
}

#[test]
fn two_walls_defining_width_are_not_duplicate_candidates() {
    let mut d = data();
    let mut second = d["surfaces"][0].clone();
    second["id"] = json!("S2");
    d["surfaces"].as_array_mut().unwrap().push(second);
    d["bindings"][0]["surface_ids"] = json!(["S1", "S2"]);
    d["bindings"][0]["property"] = json!("transverse_distance");
    assert!(!has_check(&d, "possible_duplicate_surfaces"));
}

#[test]
fn axial_lengths_with_only_one_shared_endpoint_do_not_conflict() {
    let mut d = data();
    for sid in ["S2", "S3"] {
        let mut surface = d["surfaces"][0].clone();
        surface["id"] = json!(sid);
        d["surfaces"].as_array_mut().unwrap().push(surface);
    }
    d["dimensions"][0]["role"] = json!("axial_length");
    d["dimensions"][0]["axis"] = json!("axial");
    let mut second = d["dimensions"][0].clone();
    second["id"] = json!("D2");
    second["value"] = json!(20);
    d["dimensions"].as_array_mut().unwrap().push(second);
    d["bindings"][0]["property"] = json!("axial_length");
    d["bindings"][0]["surface_ids"] = json!(["S1", "S2"]);
    let mut binding = d["bindings"][0].clone();
    binding["id"] = json!("B3");
    binding["fact_id"] = json!("D2");
    binding["surface_ids"] = json!(["S2", "S3"]);
    d["bindings"].as_array_mut().unwrap().push(binding);
    assert!(!has_check(&d, "competing_surface_dimensions"));
    // The same endpoints in reverse order still describe a competing span.
    d["bindings"][2]["surface_ids"] = json!(["S2", "S1"]);
    assert!(has_check(&d, "competing_surface_dimensions"));
}

#[test]
fn local_roughness_conflicts_but_general_fallback_and_different_parameters_do_not() {
    let mut d = data();
    d["requirements"][0]["scope"] = json!("local");
    let mut second = d["requirements"][0].clone();
    second["id"] = json!("R2");
    second["value"] = json!(0.8);
    second["raw_text"] = json!("Ra 0,8");
    d["requirements"].as_array_mut().unwrap().push(second);
    let mut binding = d["bindings"][1].clone();
    binding["id"] = json!("B3");
    binding["fact_id"] = json!("R2");
    d["bindings"].as_array_mut().unwrap().push(binding);
    assert!(has_check(&d, "competing_local_roughness"));
    d["requirements"][0]["scope"] = json!("general");
    assert!(!has_check(&d, "competing_local_roughness"));
    d["requirements"][0]["scope"] = json!("local");
    d["requirements"][1]["raw_text"] = json!("Rz 0,8");
    assert!(!has_check(&d, "competing_local_roughness"));
}

#[test]
fn literal_reading_survives_wrong_interpretation_and_export_cannot_forge_checks() {
    let mut value = data();
    value["observations"][0]["raw_text"] = json!("35");
    value["dimensions"][0]["role"] = json!("transverse_distance");
    value["bindings"][0]["property"] = json!("axial_length");
    assert!(has_check(&value, "binding_role_conflict"));
    assert!(has_check(&value, "binding_axis_conflict"));
    value["validation"] = json!({"checks":[],"approved":true});
    let exported: Value = serde_json::from_slice(&export_bytes(&value).unwrap()).unwrap();
    assert_eq!(exported["observations"][0]["raw_text"], "35");
    assert!(exported["validation"]["checks"].as_array().unwrap().len() > 1);
    assert_eq!(exported["ready_for_3d"], false);
}

#[test]
fn bad_cross_registry_references_and_wrong_fact_types_rejected() {
    for n in 0..5 {
        let mut d = data();
        match n {
            0 => d["observations"][0]["view_id"] = json!("missing"),
            1 => d["dimensions"][0]["observation_ids"][0] = json!("missing"),
            2 => d["bindings"][0]["surface_ids"][0] = json!("missing"),
            3 => d["bindings"][0]["fact_id"] = json!("missing"),
            _ => d["bindings"][0]["property"] = json!("technical_requirement"),
        }
        assert_eq!(
            parse_output(&completion(&d), &input()).unwrap_err().code,
            "invalid_references"
        );
    }
}

#[test]
fn arithmetic_checks_sum_units_missing_values_and_cycles() {
    let mut d = data();
    let mut part = d["dimensions"][0].clone();
    part["id"] = json!("D2");
    part["value"] = json!(20);
    d["dimensions"].as_array_mut().unwrap().push(part);
    d["dimension_chains"] = json!([{"id":"C1","total_dimension_id":"D1","terms":[{"dimension_id":"D2","coefficient":2}],"description":"Контроль"}]);
    assert!(has_check(&d, "arithmetic_equal"));
    d["dimensions"][1]["designation"] = json!("~20");
    assert!(has_check(&d, "arithmetic_uncheckable"));
    assert!(!has_check(&d, "arithmetic_equal"));
    d["dimensions"][1]["designation"] = json!("20");
    d["dimensions"][1]["value"] = json!(21);
    assert!(has_check(&d, "arithmetic_mismatch"));
    d["dimensions"][1]["unit"] = json!("м");
    assert!(has_check(&d, "arithmetic_uncheckable"));
    d["dimensions"][1]["value"] = Value::Null;
    assert!(has_check(&d, "arithmetic_uncheckable"));
    d["dimensions"][0]["basis"] = json!("derived");
    d["dimensions"][0]["derived_from"] = json!([{"dimension_id":"D2","coefficient":1}]);
    d["dimensions"][1]["basis"] = json!("derived");
    d["dimensions"][1]["derived_from"] = json!([{"dimension_id":"D1","coefficient":1}]);
    assert!(has_check(&d, "derivation_cycle"));
}

#[test]
fn unbound_disputed_and_duplicate_cases_remain_visible() {
    let mut d = data();
    d["observations"][0]["alternatives"] = json!(["h7", "H7"]);
    assert!(has_check(&d, "reading_alternatives"));
    assert!(has_check(&d, "fact_from_disputed_reading"));
    d["bindings"][0]["status"] = json!("disputed");
    assert!(has_check(&d, "disputed_binding"));
    let mut second = d["surfaces"][0].clone();
    second["id"] = json!("S2");
    d["surfaces"].as_array_mut().unwrap().push(second);
    d["bindings"][0]["surface_ids"] = json!(["S1", "S2"]);
    assert!(has_check(&d, "possible_duplicate_surfaces"));
    // Same diameter at different positions is not merged or flagged as a duplicate.
    d["surfaces"][1]["evidence"][0]["bbox"] = json!([0.91, 0.1, 0.99, 0.9]);
    assert!(!has_check(&d, "possible_duplicate_surfaces"));
    d["bindings"] = json!([]);
    assert!(has_check(&d, "unbound_fact"));
    assert_eq!(d["surfaces"].as_array().unwrap().len(), 2);
}

#[test]
fn validates_draft_and_uses_actual_source_identity() {
    let input = input();
    validate_input(&input).unwrap();
    let result = parse_output(&completion(&data()), &input).unwrap();
    assert_eq!(result["source"]["name"], input.name);
    assert_eq!(result["source"]["kind"], "demo");
    assert_eq!(result["ready_for_3d"], false);
}

#[test]
fn missing_fields_bad_types_and_claimed_cad_readiness_are_rejected() {
    for mutation in 0..4 {
        let mut value = data();
        match mutation {
            0 => {
                value.as_object_mut().unwrap().remove("questions");
            }
            1 => value["ready_for_3d"] = json!(true),
            2 => value["dimensions"][0]["value"] = json!("40"),
            _ => value["drawing_general"]["unexpected"] = json!(true),
        }
        assert_eq!(
            parse_output(&completion(&value), &input())
                .unwrap_err()
                .code,
            "schema_mismatch"
        );
    }
}

#[test]
fn invalid_ids_source_pages_bounds_and_unknown_numbers_are_rejected() {
    for mutation in 0..5 {
        let mut value = data();
        match mutation {
            0 => value["surfaces"][0]["id"] = json!("R1"),
            1 => value["drawing_general"]["general_requirement_ids"][0] = json!("missing"),
            2 => value["surfaces"][0]["evidence"][0]["page"] = json!(2),
            3 => value["surfaces"][0]["evidence"][0]["bbox"] = json!([0.9, 0.1, 0.1, 0.9]),
            _ => value["dimensions"][0]["basis"] = json!("unknown"),
        }
        assert_eq!(
            parse_output(&completion(&value), &input())
                .unwrap_err()
                .code,
            "invalid_references"
        );
    }
}

#[test]
fn incomplete_and_non_json_outputs_are_not_results() {
    let mut response = completion(&data());
    response["choices"][0]["finish_reason"] = json!("length");
    assert_eq!(
        parse_output(&response, &input()).unwrap_err().code,
        "analysis_limit"
    );
    response["choices"][0]["finish_reason"] = json!("stop");
    response["choices"][0]["message"]["content"] = json!("```json\n{}\n```");
    assert_eq!(
        parse_output(&response, &input()).unwrap_err().code,
        "invalid_json"
    );
}

#[test]
fn input_does_not_allow_urls_missing_pages_or_mismatched_image_dimensions() {
    for mutation in 0..4 {
        let mut value = input();
        match mutation {
            0 => value.pages[0].image = "https://example.com/private.png".into(),
            1 => value.pages[0].page = 2,
            2 => value.pages[0].width = 100,
            _ => value.pages.clear(),
        }
        assert_eq!(validate_input(&value).unwrap_err().code, "invalid_document");
    }
}

#[test]
fn request_contains_all_pages_schema_and_no_manual_surface_answers() {
    let mut input = input();
    input.pages.push(AnalysisPage {
        page: 2,
        width: 160,
        height: 80,
        image: input.pages[0].image.clone(),
    });
    validate_input(&input).unwrap();
    let request = request_body(&input, "test-model");
    assert_eq!(
        request["messages"][1]["content"].as_array().unwrap().len(),
        5
    );
    assert_eq!(request["response_format"]["json_schema"]["strict"], true);
    assert_eq!(request["max_completion_tokens"], 50_000);
    assert_eq!(request["reasoning_effort"], "high");
    assert_eq!(
        request["messages"][0]["content"],
        crate::ai::system_prompt::get_system_prompt().text
    );
    assert!(!request.to_string().contains("Ø40"));
}

#[test]
fn export_preserves_data_and_rejects_invalid_documents() {
    let value = data();
    let decoded: Value = serde_json::from_slice(&export_bytes(&value).unwrap()).unwrap();
    let mut expected = value.clone();
    expected["validation"] = consistency::check(&value);
    assert_eq!(decoded, expected);
    let export_schema: Value = serde_json::from_str(SCHEMA_TEXT).unwrap();
    assert!(
        jsonschema::validator_for(&export_schema)
            .unwrap()
            .is_valid(&decoded)
    );
    assert!(export_bytes(&json!({})).is_err());
    let mut invalid = value;
    invalid["drawing_general"]["general_requirement_ids"][0] = json!("missing");
    assert!(export_bytes(&invalid).is_err());
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "Opens a native Save As dialog; run manually with desktop interaction"]
async fn native_save_dialog_smoke() {
    assert!(
        save_with_dialog(&data(), rfd::AsyncFileDialog::new())
            .await
            .unwrap()
    );
}

#[test]
#[ignore = "Local revalidation of an existing report; requires ANALYSIS_REVIEW_FILE, no API"]
fn recheck_saved_report() {
    let path = std::path::PathBuf::from(
        std::env::var_os("ANALYSIS_REVIEW_FILE").expect("Set existing report path"),
    );
    let report: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    let bytes = export_bytes(&report["data"]).unwrap();
    let checked: Value = serde_json::from_slice(&bytes).unwrap();
    let schema: Value = serde_json::from_str(SCHEMA_TEXT).unwrap();
    assert!(
        jsonschema::validator_for(&schema)
            .unwrap()
            .is_valid(&checked)
    );
    let mut original = report["data"].clone();
    original.as_object_mut().unwrap().remove("validation");
    let mut unchanged = checked.clone();
    unchanged.as_object_mut().unwrap().remove("validation");
    assert_eq!(
        original, unchanged,
        "Local review must never rewrite model facts"
    );
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path.with_extension("checked.json"))
        .unwrap();
    file.write_all(&bytes).unwrap();
}
