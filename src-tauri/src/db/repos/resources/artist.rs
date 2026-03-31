use crate::db::models::ArtistAsset;
use crate::db::DbPool;
use crate::error::AppError;

pub fn insert_asset(pool: &DbPool, asset: &ArtistAsset) -> Result<ArtistAsset, AppError> {
    timed_query!("artist_assets", "artist_assets::insert_asset", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO artist_assets (id, file_name, file_path, asset_type, mime_type, file_size, width, height, thumbnail_path, tags, source, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                asset.id, asset.file_name, asset.file_path, asset.asset_type,
                asset.mime_type, asset.file_size, asset.width, asset.height,
                asset.thumbnail_path, asset.tags, asset.source, asset.created_at,
            ],
        )?;
        get_asset(pool, &asset.id)
    })
}

pub fn list_assets(pool: &DbPool, asset_type: Option<&str>) -> Result<Vec<ArtistAsset>, AppError> {
    timed_query!("artist_assets", "artist_assets::list_assets", {
        let conn = pool.get()?;
        let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = match asset_type {
            Some(t) => (
                "SELECT id, file_name, file_path, asset_type, mime_type, file_size, width, height, thumbnail_path, tags, source, created_at
                 FROM artist_assets WHERE asset_type = ?1 ORDER BY created_at DESC",
                vec![Box::new(t.to_string())],
            ),
            None => (
                "SELECT id, file_name, file_path, asset_type, mime_type, file_size, width, height, thumbnail_path, tags, source, created_at
                 FROM artist_assets ORDER BY created_at DESC",
                vec![],
            ),
        };
        let mut stmt = conn.prepare(sql)?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(ArtistAsset {
                id: row.get(0)?, file_name: row.get(1)?, file_path: row.get(2)?,
                asset_type: row.get(3)?, mime_type: row.get(4)?, file_size: row.get(5)?,
                width: row.get(6)?, height: row.get(7)?, thumbnail_path: row.get(8)?,
                tags: row.get(9)?, source: row.get(10)?, created_at: row.get(11)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
    })
}

pub fn get_asset(pool: &DbPool, id: &str) -> Result<ArtistAsset, AppError> {
    timed_query!("artist_assets", "artist_assets::get_asset", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT id, file_name, file_path, asset_type, mime_type, file_size, width, height, thumbnail_path, tags, source, created_at
             FROM artist_assets WHERE id = ?1",
            [id],
            |row| Ok(ArtistAsset {
                id: row.get(0)?, file_name: row.get(1)?, file_path: row.get(2)?,
                asset_type: row.get(3)?, mime_type: row.get(4)?, file_size: row.get(5)?,
                width: row.get(6)?, height: row.get(7)?, thumbnail_path: row.get(8)?,
                tags: row.get(9)?, source: row.get(10)?, created_at: row.get(11)?,
            }),
        ).map_err(|_| AppError::NotFound(format!("Artist asset {id} not found")))
    })
}

pub fn delete_asset(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("artist_assets", "artist_assets::delete_asset", {
        let conn = pool.get()?;
        // Also delete associated tags
        conn.execute("DELETE FROM artist_tags WHERE asset_id = ?1", [id])?;
        let deleted = conn.execute("DELETE FROM artist_assets WHERE id = ?1", [id])?;
        Ok(deleted > 0)
    })
}

pub fn update_asset_tags(pool: &DbPool, id: &str, tags: &str) -> Result<ArtistAsset, AppError> {
    timed_query!("artist_assets", "artist_assets::update_asset_tags", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE artist_assets SET tags = ?1 WHERE id = ?2",
            rusqlite::params![tags, id],
        )?;
        get_asset(pool, id)
    })
}
