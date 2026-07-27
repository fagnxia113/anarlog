use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;

#[derive(Clone)]
pub struct Db(pub Arc<SqlitePool>);

impl Db {
    pub fn pool(&self) -> &SqlitePool {
        &self.0
    }
}

pub async fn open_db(app_data_dir: PathBuf) -> anyhow::Result<Db> {
    std::fs::create_dir_all(&app_data_dir)?;

    let db_path = app_data_dir.join("zhnote.db");
    let db_url = format!("sqlite://{}?mode=rwc", db_path.display());

    let options = SqliteConnectOptions::from_str(&db_url)?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(Db(Arc::new(pool)))
}
