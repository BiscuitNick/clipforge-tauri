use serde::{Deserialize, Serialize};
use std::process::Command;
use std::fs;
use super::ffmpeg_utils::find_ffmpeg;
use tauri::{AppHandle, Emitter};

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
    pub width: u32,
    pub height: u32,
    #[serde(rename = "frameRate")]
    pub frame_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
struct ExportProgress {
    current: usize,
    total: usize,
    message: String,
}

#[tauri::command]
pub async fn export_timeline(
    app: AppHandle,
    clips: Vec<ClipData>,
    output_path: String
) -> Result<(), String> {
    println!("Exporting {} clips to: {}", clips.len(), output_path);

    if clips.is_empty() {
        return Err("No clips to export".to_string());
    }

    // Find ffmpeg executable
    let ffmpeg_path = find_ffmpeg()
        .ok_or_else(|| "ffmpeg not found. Please install FFmpeg.".to_string())?;

    println!("Using ffmpeg at: {:?}", ffmpeg_path);

    // Get first clip's resolution and framerate to use for the output
    let target_width = clips[0].width;
    let target_height = clips[0].height;
    let target_fps = clips[0].frame_rate;

    // Create temp directory for intermediate files
    let temp_dir = std::env::temp_dir().join("clipforge_export");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // Calculate total steps for progress (clips + gaps + concat)
    let mut gaps_needed = 0;
    for i in 0..clips.len() - 1 {
        let current_end = clips[i].start_time + (clips[i].trim_end - clips[i].trim_start);
        let next_start = clips[i + 1].start_time;
        if next_start > current_end {
            gaps_needed += 1;
        }
    }
    let total_steps = clips.len() + gaps_needed + 1; // clips + gaps + final concat
    let mut current_step = 0;

    // Process each clip - trim and normalize to target resolution/fps
    let mut segment_files = Vec::new();
    for (i, clip) in clips.iter().enumerate() {
        current_step += 1;
        let _ = app.emit("export-progress", ExportProgress {
            current: current_step,
            total: total_steps,
            message: format!("Processing clip {} of {}", i + 1, clips.len()),
        });

        let temp_output = temp_dir.join(format!("segment_{:03}.mp4", segment_files.len()));
        let trimmed_duration = clip.trim_end - clip.trim_start;

        println!("Processing clip {}: {} (trim: {}-{}, duration: {}s)",
            i, clip.video_path, clip.trim_start, clip.trim_end, trimmed_duration);

        // Use FFmpeg to trim and normalize the clip
        let output = Command::new(&ffmpeg_path)
            .arg("-i")
            .arg(&clip.video_path)
            .arg("-ss")
            .arg(clip.trim_start.to_string())
            .arg("-t")
            .arg(trimmed_duration.to_string())
            .arg("-vf")
            .arg(format!("scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,fps={}",
                target_width, target_height, target_width, target_height, target_fps))
            .arg("-c:v")
            .arg("libx264")
            .arg("-preset")
            .arg("medium")
            .arg("-c:a")
            .arg("aac")
            .arg("-ar")
            .arg("48000")
            .arg("-y")
            .arg(&temp_output)
            .output()
            .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg failed for clip {}: {}", i, stderr));
        }

        segment_files.push(temp_output);

        // Check if there's a gap before the next clip
        if i < clips.len() - 1 {
            let current_end = clip.start_time + trimmed_duration;
            let next_start = clips[i + 1].start_time;

            if next_start > current_end {
                current_step += 1;
                let gap_duration = next_start - current_end;

                let _ = app.emit("export-progress", ExportProgress {
                    current: current_step,
                    total: total_steps,
                    message: format!("Creating gap ({:.1}s)", gap_duration),
                });

                println!("Creating gap of {:.2}s between clips {} and {}", gap_duration, i, i + 1);

                // Create black video for the gap
                let black_output = temp_dir.join(format!("segment_{:03}.mp4", segment_files.len()));
                let output = Command::new(&ffmpeg_path)
                    .arg("-f")
                    .arg("lavfi")
                    .arg("-i")
                    .arg(format!("color=c=black:s={}x{}:r={}", target_width, target_height, target_fps))
                    .arg("-f")
                    .arg("lavfi")
                    .arg("-i")
                    .arg("anullsrc=r=48000:cl=stereo")
                    .arg("-t")
                    .arg(gap_duration.to_string())
                    .arg("-c:v")
                    .arg("libx264")
                    .arg("-preset")
                    .arg("medium")
                    .arg("-c:a")
                    .arg("aac")
                    .arg("-y")
                    .arg(&black_output)
                    .output()
                    .map_err(|e| format!("Failed to create black frame: {}", e))?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("Failed to create gap: {}", stderr));
                }

                segment_files.push(black_output);
            }
        }
    }

    current_step += 1;
    let _ = app.emit("export-progress", ExportProgress {
        current: current_step,
        total: total_steps,
        message: "Finalizing export...".to_string(),
    });

    // Create concat file for FFmpeg
    let concat_file = temp_dir.join("concat.txt");
    let concat_content = segment_files
        .iter()
        .map(|f| format!("file '{}'", f.display()))
        .collect::<Vec<_>>()
        .join("\n");

    fs::write(&concat_file, concat_content)
        .map_err(|e| format!("Failed to write concat file: {}", e))?;

    println!("Concatenating {} segments...", segment_files.len());

    // Concatenate all segments
    let output = Command::new(&ffmpeg_path)
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(&concat_file)
        .arg("-c")
        .arg("copy")
        .arg("-y")
        .arg(&output_path)
        .output()
        .map_err(|e| format!("Failed to run FFmpeg concat: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg concat failed: {}", stderr));
    }

    // Clean up temp files
    fs::remove_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to clean up temp files: {}", e))?;

    println!("Export completed successfully: {}", output_path);
    Ok(())
}
