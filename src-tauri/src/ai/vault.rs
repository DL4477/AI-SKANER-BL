use super::error::{AiError, AiResult};
use zeroize::Zeroizing;

pub trait SecretVault: Send + Sync {
    fn read(&self) -> AiResult<Option<Zeroizing<String>>>;
    fn write(&self, secret: &str) -> AiResult<()>;
    fn delete(&self) -> AiResult<()>;
}

pub struct WindowsVault;

impl WindowsVault {
    fn entry(&self) -> AiResult<keyring::Entry> {
        keyring::Entry::new("io.github.dl4477.ai-skaner", "kimi-api-key")
            .map_err(|_| AiError::storage())
    }
}

impl SecretVault for WindowsVault {
    fn read(&self) -> AiResult<Option<Zeroizing<String>>> {
        match self.entry()?.get_password() {
            Ok(secret) => Ok(Some(Zeroizing::new(secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AiError::storage()),
        }
    }
    fn write(&self, secret: &str) -> AiResult<()> {
        self.entry()?
            .set_password(secret)
            .map_err(|_| AiError::storage())
    }
    fn delete(&self) -> AiResult<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AiError::storage()),
        }
    }
}

pub fn validate_secret(secret: &str) -> AiResult<()> {
    if !(8..=1024).contains(&secret.len()) || !secret.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(AiError::new(
            "invalid_key",
            "Вставьте API-ключ целиком, без пробелов и переносов строк.",
        ));
    }
    Ok(())
}
