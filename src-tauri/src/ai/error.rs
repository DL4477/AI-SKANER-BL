use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AiError {
    pub code: &'static str,
    pub message: &'static str,
}

impl AiError {
    pub const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
    pub const fn storage() -> Self {
        Self::new(
            "storage",
            "Не удалось обратиться к защищённому хранилищу Windows. Попробуйте ещё раз.",
        )
    }
    pub const fn busy() -> Self {
        Self::new(
            "busy",
            "Дождитесь завершения текущей проверки или остановите её.",
        )
    }
    pub const fn cancelled() -> Self {
        Self::new(
            "cancelled",
            "Ожидание остановлено. Если запрос уже принят Kimi, сервис может учесть его стоимость.",
        )
    }
    pub const fn invalid_response() -> Self {
        Self::new(
            "invalid_response",
            "Kimi вернул неожиданный ответ. Повторите проверку позже.",
        )
    }
}

pub type AiResult<T> = Result<T, AiError>;
