use super::*;

#[derive(Default)]
struct MemoryVault(Mutex<Option<String>>);
impl SecretVault for MemoryVault {
    fn read(&self) -> AiResult<Option<Zeroizing<String>>> {
        Ok(self.0.lock().unwrap().clone().map(Zeroizing::new))
    }
    fn write(&self, secret: &str) -> AiResult<()> {
        *self.0.lock().unwrap() = Some(secret.into());
        Ok(())
    }
    fn delete(&self) -> AiResult<()> {
        *self.0.lock().unwrap() = None;
        Ok(())
    }
}
pub(super) fn service() -> AiService {
    AiService {
        vault: Box::<MemoryVault>::default(),
        client: KimiClient::new().unwrap(),
        operations: Mutex::default(),
    }
}

#[test]
fn credential_lifecycle_never_returns_the_key_to_the_ui() {
    let service = service();
    assert!(!service.status().unwrap().key_stored);
    let saved = service
        .save_key("fake-key-for-offline-tests".into())
        .unwrap();
    assert!(saved.key_stored);
    assert!(!serde_json::to_string(&saved).unwrap().contains("fake-key"));
    assert!(service.status().unwrap().key_stored);
    service.remove_key().unwrap();
    service.remove_key().unwrap();
    assert!(!service.status().unwrap().key_stored);
    assert_eq!(service.begin("no-key").err().unwrap().code, "missing_key");
}

#[test]
fn invalid_key_does_not_replace_existing_credential() {
    let service = service();
    service
        .save_key("fake-key-for-offline-tests".into())
        .unwrap();
    for key in [
        "",
        "short",
        "key\nwith-break",
        "bad key containing spaces",
        "ключключ",
    ] {
        assert!(service.save_key(key.into()).is_err());
    }
    assert_eq!(
        service.vault.read().unwrap().unwrap().as_str(),
        "fake-key-for-offline-tests"
    );
}

#[test]
fn concurrent_checks_and_key_changes_are_blocked_and_cancellation_is_scoped() {
    let service = service();
    service
        .save_key("fake-key-for-offline-tests".into())
        .unwrap();
    let (_, receiver) = service.begin("request-1").unwrap();
    assert_eq!(service.begin("request-2").err().unwrap().code, "busy");
    assert_eq!(service.remove_key().err().unwrap().code, "busy");
    assert_eq!(
        service.save_key("new-fake-key".into()).err().unwrap().code,
        "busy"
    );
    service.cancel("request-2").unwrap();
    assert!(!*receiver.borrow());
    service.cancel("request-1").unwrap();
    assert!(*receiver.borrow());
}

#[test]
fn cancel_before_start_prevents_the_request() {
    let service = service();
    service
        .save_key("fake-key-for-offline-tests".into())
        .unwrap();
    service.cancel("request-1").unwrap();
    assert_eq!(service.begin("request-1").err().unwrap().code, "cancelled");
    assert!(service.begin("request-2").is_ok());
}

#[test]
fn vault_failure_is_not_reported_as_missing_or_saved() {
    struct BrokenVault;
    impl SecretVault for BrokenVault {
        fn read(&self) -> AiResult<Option<Zeroizing<String>>> {
            Err(AiError::storage())
        }
        fn write(&self, _: &str) -> AiResult<()> {
            Err(AiError::storage())
        }
        fn delete(&self) -> AiResult<()> {
            Err(AiError::storage())
        }
    }
    let mut service = service();
    service.vault = Box::new(BrokenVault);
    assert_eq!(service.status().err().unwrap().code, "storage");
    assert_eq!(
        service
            .save_key("fake-key-for-tests".into())
            .err()
            .unwrap()
            .code,
        "storage"
    );
    assert_eq!(service.remove_key().err().unwrap().code, "storage");
}

#[test]
#[ignore = "Uses a separate temporary Windows Credential Manager entry; no API calls"]
fn windows_credential_store_roundtrip() {
    let name = format!("io.github.dl4477.ai-skaner.test-{}", std::process::id());
    let entry = keyring::Entry::new(&name, "test-only").unwrap();
    entry.set_password("synthetic-offline-test-value").unwrap();
    let read = entry.get_password();
    let deleted = entry.delete_credential();
    assert_eq!(read.unwrap(), "synthetic-offline-test-value");
    deleted.unwrap();
    assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
}
