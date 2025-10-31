use super::metadata::{extract_metadata, VideoMetadata};
use super::thumbnail::generate_thumbnail;

#[tauri::command]
pub async fn import_video(paths: Vec<String>) -> Result<Vec<VideoMetadata>, String> {
    println!("Importing {} video file(s)", paths.len());

    let mut metadata_list = Vec::new();

    for path in paths {
        // Extract metadata using ffprobe
        match extract_metadata(path.clone()).await {
            Ok(mut metadata) => {
                // Generate thumbnail (use 1 second or 10% of duration, whichever is smaller)
                let thumbnail_timestamp = (metadata.duration * 0.1).min(1.0).max(0.1);
                match generate_thumbnail(path.clone(), Some(thumbnail_timestamp)).await {
                    Ok(thumbnail_path) => {
                        metadata.thumbnail_path = Some(thumbnail_path);
                    }
                    Err(_e) => {
                        // Continue without thumbnail
                    }
                }

                metadata_list.push(metadata);
            }
            Err(_e) => {
                // Continue with next file rather than failing completely
            }
        }
    }

    if metadata_list.is_empty() {
        return Err("Failed to import any videos".to_string());
    }

    println!("Successfully imported {} files", metadata_list.len());
    Ok(metadata_list)
}
