use super::*;

fn event(value: Value) -> String {
    format!("data: {value}\r\n\r\n")
}

#[test]
fn fragmented_utf8_crlf_usage_and_reasoning_are_handled() {
    let mut stream = StreamDecoder::default();
    let wire = format!(
        ": keepalive\r\n\r\n{}{}{}{}data: [DONE]\r\n\r\n",
        event(json!({"choices":[{"index":0,"delta":{"reasoning_content":"private reasoning"}}]})),
        event(json!({"choices":[{"index":0,"delta":{"content":"{\"деталь\":\"Пиноль"}}]})),
        event(json!({"choices":[{"index":0,"delta":{"content":"\"}"},"finish_reason":"stop"}]})),
        event(json!({"choices":[],"usage":{"total_tokens":42}}))
    );
    for byte in wire.as_bytes() {
        stream.push(&[*byte]).unwrap();
    }
    assert_eq!(stream.phase, AnalysisPhase::Receiving);
    let result = stream.finish().unwrap();
    assert_eq!(
        result["choices"][0]["message"]["content"],
        "{\"деталь\":\"Пиноль\"}"
    );
    assert_eq!(result["usage"]["total_tokens"], 42);
    assert!(!result.to_string().contains("private reasoning"));
}

#[test]
fn incomplete_and_provider_error_streams_cannot_be_results() {
    let mut partial = StreamDecoder::default();
    partial
        .push(
            event(json!({"choices":[{"index":0,"delta":{"content":"{}"},"finish_reason":"stop"}]}))
                .as_bytes(),
        )
        .unwrap();
    assert_eq!(partial.finish().unwrap_err().code, "stream_incomplete");
    let mut missing_finish = StreamDecoder::default();
    missing_finish.push(b"data: [DONE]\n\n").unwrap();
    assert!(missing_finish.finish().is_err());
    let mut error = StreamDecoder::default();
    let failure = error
        .push(b"data: {\"error\":{\"message\":\"private-provider-body\"}}\n\n")
        .unwrap_err();
    assert_eq!(failure.code, "stream_error");
    assert!(
        !serde_json::to_string(&failure)
            .unwrap()
            .contains("private-provider-body")
    );
}

#[test]
fn length_finish_survives_for_normal_analysis_validation_and_buffers_are_bounded() {
    let mut truncated = StreamDecoder::default();
    truncated.push(format!("{}data: [DONE]\n\n", event(json!({"choices":[{"index":0,"delta":{"content":"{"},"finish_reason":"length"}]}))).as_bytes()).unwrap();
    let result = truncated.finish().unwrap();
    assert_eq!(
        super::super::analysis::parse_output(&result, &super::super::analysis::tests::input())
            .unwrap_err()
            .code,
        "analysis_limit"
    );
    let mut oversized = StreamDecoder::default();
    assert_eq!(
        oversized
            .push(&vec![b'x'; MAX_EVENT_BYTES + 1])
            .unwrap_err()
            .code,
        "response_too_large"
    );
}
