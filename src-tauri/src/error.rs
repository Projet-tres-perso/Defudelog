#![allow(dead_code)]
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Collection error: {0}")]
    Collection(String),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("Detection error: {0}")]
    Detection(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Kafka error: {0}")]
    #[cfg(feature = "kafka")]
    Kafka(#[from] rdkafka::error::KafkaError),

    #[error("Not found: {0}")]
    NotFound(String),
}

pub type AppResult<T> = Result<T, AppError>;
