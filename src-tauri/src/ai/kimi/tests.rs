use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

fn mock_server(
    status: &str,
    headers: &str,
    body: String,
) -> (KimiClient, thread::JoinHandle<String>) {
    mock_server_with_delay(
        status,
        headers,
        body,
        Duration::ZERO,
        Duration::from_secs(3),
    )
}

fn mock_server_with_delay(
    status: &str,
    headers: &str,
    body: String,
    delay: Duration,
    timeout: Duration,
) -> (KimiClient, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
        body.len()
    );
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut received = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let n = stream.read(&mut buffer).unwrap();
            if n == 0 {
                break;
            }
            received.extend_from_slice(&buffer[..n]);
            let text = String::from_utf8_lossy(&received);
            if let Some(end) = text.find("\r\n\r\n") {
                let length = text[..end]
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|s| s.parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if received.len() >= end + 4 + length {
                    break;
                }
            }
        }
        thread::sleep(delay);
        let _ = stream.write_all(response.as_bytes());
        String::from_utf8(received).unwrap()
    });
    // Loopback is available only in this private test module, never through IPC.
    (
        KimiClient {
            http: build_http_client(timeout).unwrap(),
            base_url: url,
        },
        handle,
    )
}

fn completion(content: &str) -> Value {
    json!({"choices":[{"finish_reason":"stop","message":{"content":content}}],"usage":{"total_tokens":12}})
}

#[tokio::test]
async fn a_slow_response_times_out_and_releases_the_service() {
    let (client, server) = mock_server_with_delay(
        "200 OK",
        "",
        completion("KIMI_READY").to_string(),
        Duration::from_millis(250),
        Duration::from_millis(100),
    );
    let mut service = crate::ai::tests::service();
    service.client = client;
    service.save_key("fake-offline-test-key".into()).unwrap();
    assert_eq!(
        service
            .diagnose(DiagnosticKind::Text, "timeout-1")
            .await
            .unwrap_err()
            .code,
        "timeout"
    );
    service.remove_key().unwrap();
    server.join().unwrap();
}

#[tokio::test]
async fn cancellation_drops_the_request_and_releases_the_service() {
    let (client, server) = mock_server_with_delay(
        "200 OK",
        "",
        completion("KIMI_READY").to_string(),
        Duration::from_millis(250),
        Duration::from_secs(3),
    );
    let mut service = crate::ai::tests::service();
    service.client = client;
    service.save_key("fake-offline-test-key".into()).unwrap();
    let (result, _) = tokio::join!(service.diagnose(DiagnosticKind::Text, "cancel-1"), async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        service.cancel("cancel-1").unwrap();
    });
    assert_eq!(result.unwrap_err().code, "cancelled");
    assert!(service.operations.lock().unwrap().active.is_none());
    service.save_key("another-fake-key".into()).unwrap();
    server.join().unwrap();
}

#[tokio::test]
async fn http_roundtrip_uses_authorization_and_reports_usage() {
    let (client, server) = mock_server(
        "200 OK",
        "Content-Type: application/json\r\n",
        completion("KIMI_READY").to_string(),
    );
    let report = client
        .diagnose(DiagnosticKind::Text, "fake-offline-test-key")
        .await
        .unwrap();
    assert_eq!(report.total_tokens, Some(12));
    let request = server.join().unwrap();
    assert!(request.starts_with("POST /chat/completions "));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer fake-offline-test-key")
    );
    let body: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["model"], MODEL);
    assert_eq!(body["reasoning_effort"], "low");
    assert_eq!(body["max_tokens"], 2048);
    assert!(
        !serde_json::to_string(&report)
            .unwrap()
            .contains("fake-offline")
    );
}

#[tokio::test]
async fn http_errors_are_typed_and_never_echo_the_provider_body() {
    for (status, code) in [
        ("401 Unauthorized", "authentication"),
        ("403 Forbidden", "access_denied"),
        ("429 Too Many Requests", "rate_limit"),
        ("503 Unavailable", "provider_unavailable"),
    ] {
        let (client, server) = mock_server(status, "", "fake-secret-in-error-body".into());
        let error = client
            .diagnose(DiagnosticKind::Access, "fake-offline-test-key")
            .await
            .unwrap_err();
        assert_eq!(error.code, code);
        assert!(
            !serde_json::to_string(&error)
                .unwrap()
                .contains("fake-secret")
        );
        server.join().unwrap();
    }
}

#[tokio::test]
async fn redirects_are_not_followed() {
    let (client, server) = mock_server(
        "302 Found",
        "Location: http://127.0.0.1:9/collect-key\r\n",
        String::new(),
    );
    assert_eq!(
        client
            .diagnose(DiagnosticKind::Access, "fake-test-key")
            .await
            .unwrap_err()
            .code,
        "redirect_rejected"
    );
    server.join().unwrap();
}

#[tokio::test]
async fn malformed_and_oversized_bodies_are_rejected() {
    for (body, code) in [
        ("not-json".into(), "invalid_response"),
        ("x".repeat(MAX_RESPONSE_BYTES + 1), "response_too_large"),
    ] {
        let (client, server) = mock_server("200 OK", "", body);
        assert_eq!(
            client
                .diagnose(DiagnosticKind::Text, "fake-test-key")
                .await
                .unwrap_err()
                .code,
            code
        );
        server.join().unwrap();
    }
}

#[test]
fn access_check_requires_the_selected_model_but_does_not_claim_generation() {
    assert!(
        validate_response(DiagnosticKind::Access, &json!({"data":[{"id": MODEL}]}))
            .unwrap()
            .contains("отдельно")
    );
    assert_eq!(
        validate_response(DiagnosticKind::Access, &json!({"data":[{"id":"other"}]}))
            .unwrap_err()
            .code,
        "model_unavailable"
    );
    assert!(validate_response(DiagnosticKind::Access, &json!({"data":null})).is_err());
}

#[test]
fn structured_output_is_validated_locally_and_reasoning_is_never_used_as_result() {
    assert!(validate_response(DiagnosticKind::Json, &completion(r#"{"status":"ready"}"#)).is_ok());
    for output in [
        r#"{"status":"ready","extra":true}"#,
        r#"{"status":"other"}"#,
        r#"{"status":null}"#,
    ] {
        assert_eq!(
            validate_response(DiagnosticKind::Json, &completion(output))
                .unwrap_err()
                .code,
            "schema_mismatch"
        );
    }
    assert_eq!(
        validate_response(DiagnosticKind::Json, &completion("```json\n{}\n``` "))
            .unwrap_err()
            .code,
        "invalid_json"
    );
    assert!(
        validate_response(
            DiagnosticKind::Text,
            &json!({"choices":[{"message":{"reasoning_content":"KIMI_READY"}}]})
        )
        .is_err()
    );
    let mut truncated = completion("KIMI_READY");
    truncated["choices"][0]["finish_reason"] = json!("length");
    assert_eq!(
        validate_response(DiagnosticKind::Text, &truncated)
            .unwrap_err()
            .code,
        "output_limit"
    );
}

#[test]
fn vision_request_contains_only_the_bundled_fixture_and_checks_the_answer() {
    let request = probe_body(DiagnosticKind::Vision);
    let image = request["messages"][0]["content"][1]["image_url"]["url"]
        .as_str()
        .unwrap();
    let png = STANDARD
        .decode(image.strip_prefix("data:image/png;base64,").unwrap())
        .unwrap();
    assert_eq!(png, include_bytes!("../../../assets/vision-probe.png"));
    assert!(validate_response(DiagnosticKind::Vision, &completion("3")).is_ok());
    assert!(validate_response(DiagnosticKind::Vision, &completion("2")).is_err());
}
