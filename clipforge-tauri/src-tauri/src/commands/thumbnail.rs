use super::ffmpeg_utils::find_ffmpeg;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Generate a thumbnail image from a video file at a specific timestamp
/// Returns the path to the generated thumbnail
#[tauri::command]
pub async fn generate_thumbnail(
    video_path: String,
    timestamp: Option<f64>, // Timestamp in seconds, defaults to 1.0
) -> Result<String, String> {
    println!("[Thumbnail] Generating thumbnail for: {}", video_path);

    // Find ffmpeg executable
    let ffmpeg_path =
        find_ffmpeg().ok_or_else(|| "FFmpeg not found. Please install FFmpeg.".to_string())?;

    // Use provided timestamp or default to 1 second
    let ts = timestamp.unwrap_or(1.0);

    // Create thumbnails directory in temp
    let temp_dir = std::env::temp_dir().join("clipforge_thumbnails");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create thumbnails directory: {}", e))?;

    // Generate unique filename based on video path hash
    let video_path_obj = Path::new(&video_path);
    let filename = video_path_obj
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("video");

    let timestamp_str = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let thumbnail_filename = format!("{}_{}.jpg", filename, timestamp_str);
    let thumbnail_path = temp_dir.join(thumbnail_filename);

    println!("[Thumbnail] Output path: {}", thumbnail_path.display());

    // Run ffmpeg to extract thumbnail
    let output = Command::new(&ffmpeg_path)
        .args([
            "-ss",
            &ts.to_string(), // Seek to timestamp
            "-i",
            &video_path, // Input file
            "-vframes",
            "1", // Extract 1 frame
            "-vf",
            "scale=320:-1", // Scale to 320px width, maintain aspect ratio
            "-q:v",
            "2",  // High quality (1-31, lower is better)
            "-y", // Overwrite output file
            thumbnail_path.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg thumbnail generation failed: {}", stderr));
    }

    // Verify thumbnail was created
    if !thumbnail_path.exists() {
        return Err("Thumbnail file was not created".to_string());
    }

    println!("[Thumbnail] Successfully generated thumbnail");

    // Return absolute path
    thumbnail_path
        .to_str()
        .ok_or_else(|| "Failed to convert path to string".to_string())
        .map(|s| s.to_string())
}

/// Clean up old thumbnails from temp directory
/// Removes thumbnails older than the specified age in hours
#[tauri::command]
pub async fn cleanup_old_thumbnails(max_age_hours: Option<u64>) -> Result<usize, String> {
    let temp_dir = std::env::temp_dir().join("clipforge_thumbnails");

    if !temp_dir.exists() {
        return Ok(0);
    }

    let max_age = max_age_hours.unwrap_or(24); // Default to 24 hours
    let mut cleaned = 0;

    let entries = std::fs::read_dir(&temp_dir)
        .map_err(|e| format!("Failed to read thumbnails directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("jpg") {
            // Check file age
            if let Ok(metadata) = std::fs::metadata(&path) {
                if let Ok(modified) = metadata.modified() {
                    let age = std::time::SystemTime::now()
                        .duration_since(modified)
                        .unwrap_or_default();

                    if age.as_secs() > max_age * 3600 {
                        // File is older than max age, remove it
                        if std::fs::remove_file(&path).is_ok() {
                            cleaned += 1;
                        }
                    }
                }
            }
        }
    }

    println!("[Thumbnail] Cleaned up {} old thumbnails", cleaned);
    Ok(cleaned)
}
