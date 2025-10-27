use super::metadata::{extract_metadata, VideoMetadata};

#[tauri::command]
pub async fn import_video(paths: Vec<String>) -> Result<Vec<VideoMetadata>, String> {
    println!("Importing {} video file(s)", paths.len());

    let mut metadata_list = Vec::new();

    for path in paths {
        println!("Processing file: {}", path);

        // Extract metadata using ffprobe
        match extract_metadata(path.clone()).await {
            Ok(metadata) => {
                println!(
                    "Extracted metadata: {}s duration, {}x{}, {}fps",
                    metadata.duration, metadata.width, metadata.height, metadata.frame_rate
                );
                metadata_list.push(metadata);
            }
            Err(e) => {
                eprintln!("Failed to extract metadata for {}: {}", path, e);
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
