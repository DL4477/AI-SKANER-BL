use super::*;

pub(crate) fn input() -> AnalysisInput {
    AnalysisInput {
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
        "schema_version":"0.1.0-draft","status":"needs_review","ready_for_3d":false,
        "source":{"name":"model supplied name","kind":"pdf","page_count":1},
        "drawing_general":{"part_name":"Деталь","designation":null,"material":null,"units":"мм","notes":[],"general_requirements":[{
            "id":"R1","kind":"roughness","raw_text":"Ra 3,2","value":3.2,"unit":"мкм","it_grade":null,"applies_to":"Без местного указания","evidence":evidence
        }]},
        "surfaces":[{"id":"S1","name":"Цилиндр","type":"cylinder","orientation":"outward",
            "geometry_parameters":[{"name":"Диаметр","value":40,"unit":"мм","designation":"Ø40","basis":"read","evidence":evidence}],
            "boundary_description":null,"local_requirements":[],"general_requirement_ids":["R1"],"evidence":evidence,"uncertainties":["Длина неизвестна"]}],
        "questions":["Уточнить длину"],"summary":"Черновой анализ"
    })
}
pub(crate) fn completion(data: &Value) -> Value {
    json!({"choices":[{"finish_reason":"stop","message":{"content":data.to_string()}}],"usage":{"total_tokens":123}})
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
            2 => value["surfaces"][0]["geometry_parameters"][0]["value"] = json!("40"),
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
            1 => value["surfaces"][0]["general_requirement_ids"][0] = json!("missing"),
            2 => value["surfaces"][0]["evidence"][0]["page"] = json!(2),
            3 => value["surfaces"][0]["evidence"][0]["bbox"] = json!([0.9, 0.1, 0.1, 0.9]),
            _ => value["surfaces"][0]["geometry_parameters"][0]["basis"] = json!("unknown"),
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
    assert_eq!(request["max_completion_tokens"], 16384);
    assert!(!request.to_string().contains("Ø40"));
}

#[test]
fn export_preserves_data_and_rejects_invalid_documents() {
    let value = data();
    let decoded: Value = serde_json::from_slice(&export_bytes(&value).unwrap()).unwrap();
    assert_eq!(decoded, value);
    assert!(export_bytes(&json!({})).is_err());
    let mut invalid = value;
    invalid["surfaces"][0]["general_requirement_ids"][0] = json!("missing");
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
