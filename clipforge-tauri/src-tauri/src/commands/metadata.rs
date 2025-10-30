use super::ffmpeg_utils::find_ffprobe;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoMetadata {
    pub path: String,
    pub filename: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub thumbnail_path: Option<String>,
    pub file_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct FFprobeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FFprobeStream {
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    codec_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FFprobeOutput {
    format: Option<FFprobeFormat>,
    streams: Option<Vec<FFprobeStream>>,
}

#[tauri::command]
pub async fn extract_metadata(file_path: String) -> Result<VideoMetadata, String> {
    println!("Extracting metadata for: {}", file_path);

    // Find ffprobe executable
    let ffprobe_path =
        find_ffprobe().ok_or_else(|| "ffprobe not found. Please install FFmpeg.".to_string())?;

    println!("Using ffprobe at: {:?}", ffprobe_path);

    // Execute ffprobe with JSON output
    let output = Command::new(ffprobe_path)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &file_path,
        ])
        .output()
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let probe_data: FFprobeOutput = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse ffprobe output: {}", e))?;

    // Extract duration from format
    let duration = probe_data
        .format
        .and_then(|f| f.duration)
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    // Find video stream and extract metadata
    let video_stream = probe_data
        .streams
        .unwrap_or_default()
        .into_iter()
        .find(|s| s.codec_type.as_deref() == Some("video"));

    let (width, height, frame_rate) = if let Some(stream) = video_stream {
        let width = stream.width.unwrap_or(0);
        let height = stream.height.unwrap_or(0);

        // Parse frame rate (format: "30000/1001" or "30/1")
        let frame_rate = stream
            .r_frame_rate
            .and_then(|fr| {
                let parts: Vec<&str> = fr.split('/').collect();
                if parts.len() == 2 {
                    let num = parts[0].parse::<f64>().ok()?;
                    let den = parts[1].parse::<f64>().ok()?;
                    Some(num / den)
                } else {
                    None
                }
            })
            .unwrap_or(0.0);

        (width, height, frame_rate)
    } else {
        (0, 0, 0.0)
    };

    // Extract filename
    let filename = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    // Get file size
    let file_size = std::fs::metadata(&file_path).ok().map(|m| m.len());

    Ok(VideoMetadata {
        path: file_path,
        filename,
        duration,
        width,
        height,
        frame_rate,
        thumbnail_path: None, // Will be populated by import_video
        file_size,
    })
}
