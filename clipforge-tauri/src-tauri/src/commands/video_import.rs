use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoMetadata {
    pub path: String,
    pub filename: String,
    pub size: u64,
}

#[tauri::command]
pub async fn import_video(paths: Vec<String>) -> Result<Vec<VideoMetadata>, String> {
    println!("Importing {} video file(s)", paths.len());

    let mut metadata_list = Vec::new();

    for path in paths {
        println!("Processing file: {}", path);

        // Extract filename from path
        let filename = std::path::Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Get file size
        let size = match std::fs::metadata(&path) {
            Ok(metadata) => metadata.len(),
            Err(e) => {
                eprintln!("Failed to get file metadata for {}: {}", path, e);
                0
            }
        };

        metadata_list.push(VideoMetadata {
            path: path.clone(),
            filename,
            size,
        });
    }

    println!("Successfully imported {} files", metadata_list.len());
    Ok(metadata_list)
}
