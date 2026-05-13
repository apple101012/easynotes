use rusqlite::Connection;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize, Clone)]
pub struct Note {
    pub id: i64,
    pub content: String,
    pub position: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        fs::create_dir_all(&app_data_dir)?;

        let db_path = app_data_dir.join("notes.db");
        let conn = Connection::open(&db_path)?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")?;

        // Check if old single-note schema exists (no position column)
        let has_position: bool = conn.prepare("SELECT position FROM notes LIMIT 0").is_ok();

        if !has_position {
            // Old schema or fresh — migrate/create
            let table_exists: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='notes'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                > 0;

            if table_exists {
                // Migrate old single-note table: add position column, backfill
                conn.execute_batch(
                    "ALTER TABLE notes ADD COLUMN position INTEGER NOT NULL DEFAULT 0;",
                )?;
                // Backfill positions based on id order
                conn.execute_batch("UPDATE notes SET position = id - 1;")?;
            } else {
                // Fresh database
                conn.execute_batch(
                    "CREATE TABLE IF NOT EXISTS notes (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        content TEXT NOT NULL DEFAULT '',
                        position INTEGER NOT NULL DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );",
                )?;
            }
        }

        // Ensure at least one note exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap_or(0);

        if count == 0 {
            conn.execute("INSERT INTO notes (content, position) VALUES ('', 0)", [])?;
        }

        println!("Database initialized at: {:?}", db_path);

        Ok(Database {
            conn: Mutex::new(conn),
        })
    }

    pub fn get_note(&self, id: i64) -> Result<Note, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, content, position, created_at, updated_at FROM notes WHERE id = ?1",
            [id],
            |row| {
                Ok(Note {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    position: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    pub fn list_notes(&self) -> Result<Vec<Note>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, content, position, created_at, updated_at FROM notes ORDER BY position ASC")
            .map_err(|e| e.to_string())?;

        let notes = stmt
            .query_map([], |row| {
                Ok(Note {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    position: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(notes)
    }

    pub fn create_note(&self) -> Result<Note, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Get max position
        let max_pos: i64 = conn
            .query_row("SELECT COALESCE(MAX(position), -1) FROM notes", [], |row| {
                row.get(0)
            })
            .unwrap_or(-1);

        let new_pos = max_pos + 1;

        conn.execute(
            "INSERT INTO notes (content, position) VALUES ('', ?1)",
            rusqlite::params![new_pos],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();

        drop(conn); // release lock before calling get_note
        self.get_note(id)
    }

    pub fn save_note(&self, id: i64, content: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE notes SET content = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            rusqlite::params![content, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // Get the position of the note being deleted
        let deleted_pos: i64 = conn
            .query_row("SELECT position FROM notes WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;

        conn.execute("DELETE FROM notes WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;

        // Shift positions down for notes after the deleted one
        conn.execute(
            "UPDATE notes SET position = position - 1 WHERE position > ?1",
            [deleted_pos],
        )
        .map_err(|e| e.to_string())?;

        // Ensure at least one note always exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap_or(0);

        if count == 0 {
            conn.execute("INSERT INTO notes (content, position) VALUES ('', 0)", [])
                .map_err(|e| e.to_string())?;
        }

        Ok(())
    }
}
