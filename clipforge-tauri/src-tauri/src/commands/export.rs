use serde::{Deserialize, Serialize};
use std::process::Command;
use std::fs;
use super::ffmpeg_utils::find_ffmpeg;

#[derive(Debug, Serialize, Deserialize)]
pub struct ClipData {
    #[serde(rename = "videoPath")]
    pub video_path: String,
    #[serde(rename = "startTime")]
    pub start_time: f64,
    #[serde(rename = "trimStart")]
    pub trim_start: f64,
    #[serde(rename = "trimEnd")]
    pub trim_end: f64,
    pub duration: f64,
}

#[tauri::command]
pub async fn export_timeline(clips: Vec<ClipData>, output_path: String) -> Result<(), String> {
    println!("Exporting {} clips to: {}", clips.len(), output_path);

    if clips.is_empty() {
        return Err("No clips to export".to_string());
    }

    // Find ffmpeg executable
    let ffmpeg_path = find_ffmpeg()
        .ok_or_else(|| "ffmpeg not found. Please install FFmpeg.".to_string())?;

    println!("Using ffmpeg at: {:?}", ffmpeg_path);

    // Create temp directory for intermediate files
    let temp_dir = std::env::temp_dir().join("clipforge_export");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // Process each clip - trim and save to temp file
    let mut trimmed_files = Vec::new();
    for (i, clip) in clips.iter().enumerate() {
        let temp_output = temp_dir.join(format!("clip_{}.mp4", i));

        println!("Processing clip {}: {} (trim: {}-{})",
            i, clip.video_path, clip.trim_start, clip.trim_end);

        // Calculate the trimmed duration
        let trimmed_duration = clip.trim_end - clip.trim_start;

        // Use FFmpeg to trim the clip
        // -ss after -i for accurate seeking (frame-accurate)
        // -c:v libx264 -preset ultrafast for fast re-encoding with accurate cuts
        // -c:a aac for audio re-encoding
        let output = Command::new(&ffmpeg_path)
            .arg("-i")
            .arg(&clip.video_path)
            .arg("-ss")
            .arg(clip.trim_start.to_string())
            .arg("-t")
            .arg(trimmed_duration.to_string())
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("ultrafast")
            .arg("-c:a")
            .arg("aac")
            .arg("-y") // Overwrite output file
            .arg(&temp_output)
            .output()
            .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg failed for clip {}: {}", i, stderr));
        }

        trimmed_files.push(temp_output);
    }

    // If there's only one clip, just copy it to the output
    if trimmed_files.len() == 1 {
        fs::copy(&trimmed_files[0], &output_path)
            .map_err(|e| format!("Failed to copy output file: {}", e))?;
    } else {
        // Create concat file for FFmpeg
        let concat_file = temp_dir.join("concat.txt");
        let concat_content = trimmed_files
            .iter()
            .map(|f| format!("file '{}'", f.display()))
            .collect::<Vec<_>>()
            .join("\n");

        fs::write(&concat_file, concat_content)
            .map_err(|e| format!("Failed to write concat file: {}", e))?;

        println!("Concatenating {} clips...", trimmed_files.len());

        // Concatenate all clips with re-encoding for compatibility
        let output = Command::new(&ffmpeg_path)
            .arg("-f")
            .arg("concat")
            .arg("-safe")
            .arg("0")
            .arg("-i")
            .arg(&concat_file)
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("medium")
            .arg("-c:a")
            .arg("aac")
            .arg("-y")
            .arg(&output_path)
            .output()
            .map_err(|e| format!("Failed to run FFmpeg concat: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg concat failed: {}", stderr));
        }
    }

    // Clean up temp files
    fs::remove_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to clean up temp files: {}", e))?;

    println!("Export completed successfully: {}", output_path);
    Ok(())
}
