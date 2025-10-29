use super::metadata::{extract_metadata, VideoMetadata};
use super::thumbnail::generate_thumbnail;

#[tauri::command]
pub async fn import_video(paths: Vec<String>) -> Result<Vec<VideoMetadata>, String> {
    println!("Importing {} video file(s)", paths.len());

    let mut metadata_list = Vec::new();

    for path in paths {
        println!("Processing file: {}", path);

        // Extract metadata using ffprobe
        match extract_metadata(path.clone()).await {
            Ok(mut metadata) => {
                println!(
                    "Extracted metadata: {}s duration, {}x{}, {}fps",
                    metadata.duration, metadata.width, metadata.height, metadata.frame_rate
                );

                // Generate thumbnail (use 1 second or 10% of duration, whichever is smaller)
                let thumbnail_timestamp = (metadata.duration * 0.1).min(1.0).max(0.1);
                match generate_thumbnail(path.clone(), Some(thumbnail_timestamp)).await {
                    Ok(thumbnail_path) => {
                        println!("Generated thumbnail: {}", thumbnail_path);
                        metadata.thumbnail_path = Some(thumbnail_path);
                    }
                    Err(e) => {
                        eprintln!("Failed to generate thumbnail for {}: {}", path, e);
                        // Continue without thumbnail
                    }
                }

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
