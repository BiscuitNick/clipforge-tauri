use super::ffmpeg_utils::find_ffmpeg;
use serde::{Deserialize, Serialize};
use serde_json;
use std::fs;
use std::process::Command;
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
    #[serde(rename = "mediaType")]
    pub media_type: Option<String>,
    #[serde(rename = "pipMetadataPath")]
    pub pip_metadata_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ExportProgress {
    current: usize,
    total: usize,
    message: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct PiPConfiguration {
    position: String,
    size: String,
    #[serde(rename = "cameraId")]
    camera_id: Option<String>,
    #[serde(rename = "includeAudio")]
    include_audio: bool,
    #[serde(rename = "audioDeviceId")]
    audio_device_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ScreenDimensions {
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct PiPMetadata {
    id: String,
    #[serde(rename = "startTime")]
    start_time: u64,
    duration: f64,
    #[serde(rename = "screenFilePath")]
    screen_file_path: String,
    #[serde(rename = "webcamFilePath")]
    webcam_file_path: String,
    #[serde(rename = "pipConfig")]
    pip_config: PiPConfiguration,
    #[serde(rename = "screenDimensions")]
    screen_dimensions: ScreenDimensions,
    #[serde(rename = "webcamDimensions")]
    webcam_dimensions: ScreenDimensions,
}

#[derive(Debug)]
struct PiPCoordinates {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

/// Calculate PiP overlay coordinates based on configuration
fn calculate_pip_coordinates(
    pip_config: &PiPConfiguration,
    screen_width: u32,
    screen_height: u32,
) -> PiPCoordinates {
    // Size percentages matching frontend
    let size_percent = match pip_config.size.as_str() {
        "small" => 0.15,
        "medium" => 0.25,
        "large" => 0.35,
        _ => 0.25,
    };

    const EDGE_PADDING: u32 = 20;

    // Calculate overlay dimensions (16:9 aspect ratio)
    let overlay_width = (screen_width as f64 * size_percent) as u32;
    let overlay_height = (overlay_width as f64 / (16.0 / 9.0)) as u32;

    // Calculate position based on corner
    let (x, y) = match pip_config.position.as_str() {
        "topLeft" => (EDGE_PADDING, EDGE_PADDING),
        "topRight" => (screen_width - overlay_width - EDGE_PADDING, EDGE_PADDING),
        "bottomLeft" => (EDGE_PADDING, screen_height - overlay_height - EDGE_PADDING),
        "bottomRight" => (
            screen_width - overlay_width - EDGE_PADDING,
            screen_height - overlay_height - EDGE_PADDING,
        ),
        _ => (
            screen_width - overlay_width - EDGE_PADDING,
            screen_height - overlay_height - EDGE_PADDING,
        ),
    };

    PiPCoordinates {
        x,
        y,
        width: overlay_width,
        height: overlay_height,
    }
}

/// Load PiP metadata from JSON file
fn load_pip_metadata(metadata_path: &str) -> Result<PiPMetadata, String> {
    let content = fs::read_to_string(metadata_path)
        .map_err(|e| format!("Failed to read PiP metadata file: {}", e))?;

    let metadata: PiPMetadata = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse PiP metadata: {}", e))?;

    Ok(metadata)
}

/// Composite a PiP recording into a single video file
fn composite_pip_recording(
    ffmpeg_path: &std::path::Path,
    metadata: &PiPMetadata,
    output_path: &std::path::Path,
) -> Result<(), String> {
    // Calculate overlay coordinates
    let coordinates = calculate_pip_coordinates(
        &metadata.pip_config,
        metadata.screen_dimensions.width,
        metadata.screen_dimensions.height,
    );

    println!(
        "Overlay position: {}x{} at ({}, {})",
        coordinates.width, coordinates.height, coordinates.x, coordinates.y
    );

    // Build FFmpeg filter_complex for PiP overlay
    let filter_complex = format!(
        "[1:v]scale={}:{}[webcam];[0:v][webcam]overlay={}:{}[outv]",
        coordinates.width, coordinates.height, coordinates.x, coordinates.y
    );

    // Execute FFmpeg compositing
    let output = Command::new(ffmpeg_path)
        .arg("-i")
        .arg(&metadata.screen_file_path)
        .arg("-i")
        .arg(&metadata.webcam_file_path)
        .arg("-filter_complex")
        .arg(&filter_complex)
        .arg("-map")
        .arg("[outv]")
        .arg("-map")
        .arg("0:a?") // Screen audio only (ignore webcam audio)
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg("23")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg("-movflags")
        .arg("+faststart")
        .arg("-y")
        .arg(output_path)
        .output()
        .map_err(|e| format!("Failed to execute FFmpeg for PiP compositing: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg PiP compositing failed: {}", stderr));
    }

    println!("PiP compositing completed: {}", output_path.display());
    Ok(())
}

#[tauri::command]
pub async fn export_timeline(
    app: AppHandle,
    clips: Vec<ClipData>,
    output_path: String,
) -> Result<(), String> {
    println!("Exporting {} clips to: {}", clips.len(), output_path);

    if clips.is_empty() {
        return Err("No clips to export".to_string());
    }

    // Find ffmpeg executable
    let ffmpeg_path =
        find_ffmpeg().ok_or_else(|| "ffmpeg not found. Please install FFmpeg.".to_string())?;
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
        let _ = app.emit(
            "export-progress",
            ExportProgress {
                current: current_step,
                total: total_steps,
                message: format!("Processing clip {} of {}", i + 1, clips.len()),
            },
        );

        // Determine the actual video path - composite PiP if needed
        let actual_video_path: String;

        if clip.media_type.as_deref() == Some("pip") && clip.pip_metadata_path.is_some() {
            // This is a PiP recording - composite it first
            let metadata_path = clip.pip_metadata_path.as_ref().unwrap();
            let _ = app.emit(
                "export-progress",
                ExportProgress {
                    current: current_step,
                    total: total_steps,
                    message: format!("Compositing PiP clip {} of {}", i + 1, clips.len()),
                },
            );

            let pip_metadata = load_pip_metadata(metadata_path)?;
            let composite_output = temp_dir.join(format!("pip_composite_{:03}.mp4", i));

            composite_pip_recording(&ffmpeg_path, &pip_metadata, &composite_output)?;

            actual_video_path = composite_output
                .to_str()
                .ok_or_else(|| "Failed to convert composite path to string".to_string())?
                .to_string();
        } else {
            // Regular video clip
            actual_video_path = clip.video_path.clone();
        }

        let temp_output = temp_dir.join(format!("segment_{:03}.mp4", segment_files.len()));
        let trimmed_duration = clip.trim_end - clip.trim_start;

        println!(
            "Processing clip {}: {} (trim: {}-{}, duration: {}s)",
            i, actual_video_path, clip.trim_start, clip.trim_end, trimmed_duration
        );

        // Use FFmpeg to trim and normalize the clip
        let output = Command::new(&ffmpeg_path)
            .arg("-i")
            .arg(&actual_video_path)
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

                let _ = app.emit(
                    "export-progress",
                    ExportProgress {
                        current: current_step,
                        total: total_steps,
                        message: format!("Creating gap ({:.1}s)", gap_duration),
                    },
                );
                // Create black video for the gap
                let black_output = temp_dir.join(format!("segment_{:03}.mp4", segment_files.len()));
                let output = Command::new(&ffmpeg_path)
                    .arg("-f")
                    .arg("lavfi")
                    .arg("-i")
                    .arg(format!(
                        "color=c=black:s={}x{}:r={}",
                        target_width, target_height, target_fps
                    ))
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
    let _ = app.emit(
        "export-progress",
        ExportProgress {
            current: current_step,
            total: total_steps,
            message: "Finalizing export...".to_string(),
        },
    );

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
    fs::remove_dir_all(&temp_dir).map_err(|e| format!("Failed to clean up temp files: {}", e))?;    Ok(())
}
