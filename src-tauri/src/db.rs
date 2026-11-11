use rusqlite::{params, Connection, Result};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub done: bool,
}

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0
        );",
    )?;
    Ok(conn)
}

pub fn list(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare("SELECT id, title, done FROM tasks ORDER BY id DESC")?;
    let rows = stmt.query_map([], |r| {
        Ok(Task {
            id: r.get(0)?,
            title: r.get(1)?,
            done: r.get::<_, i64>(2)? != 0,
        })
    })?;
    rows.collect()
}

pub fn add(conn: &Connection, title: &str) -> Result<Task> {
    conn.execute("INSERT INTO tasks (title) VALUES (?1)", params![title])?;
    Ok(Task {
        id: conn.last_insert_rowid(),
        title: title.to_string(),
        done: false,
    })
}

pub fn toggle(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE tasks SET done = 1 - done WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}
