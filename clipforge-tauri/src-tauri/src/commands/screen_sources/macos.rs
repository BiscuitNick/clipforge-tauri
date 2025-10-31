#![allow(dead_code)]

use super::{ScreenSource, SourceEnumerator, SourceType};
use base64::Engine as _;
use crate::capture::ffi;
use std::process::{Command, Stdio};

/// macOS-specific screen source enumerator
pub struct PlatformEnumerator;

impl PlatformEnumerator {
    /// Dynamically detect the number of camera devices using FFmpeg
    fn get_camera_device_count() -> usize {
        // Try to find FFmpeg
        if let Some(ffmpeg_path) = super::super::ffmpeg_utils::find_ffmpeg() {
            // Run ffmpeg to list AVFoundation devices
            if let Ok(output) = Command::new(&ffmpeg_path)
                .arg("-f")
                .arg("avfoundation")
                .arg("-list_devices")
                .arg("true")
                .arg("-i")
                .arg("")
                .stderr(Stdio::piped())
                .output()
            {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let mut camera_count = 0;
                let mut in_video_section = false;
                // Parse FFmpeg output to count video devices
                for line in stderr.lines() {
                    if line.contains("AVFoundation video devices:") {
                        in_video_section = true;
                        continue;
                    } else if line.contains("AVFoundation audio devices:") {
                        // We've reached the audio section, stop counting
                        break;
                    } else if in_video_section {
                        // Look for device entries like "[AVFoundation indev @ 0x...] [0] FaceTime HD Camera"
                        if line.contains("[AVFoundation") && line.contains("] [") {
                            // Extract device name to check if it's a screen
                            let lower_line = line.to_lowercase();
                            if lower_line.contains("capture screen")
                                || lower_line.contains("screen") && lower_line.contains("capture")
                            {
                                // This is a screen capture device, stop counting cameras
                                break;
                            } else {
                                // This is a camera device
                                camera_count += 1;
                            }
                        }
                    }
                }
                return camera_count;
            }
        }

        // Fallback: return 0 if detection fails
        // This means screens will start at device index 0
        0
    }

    /// Filter window using ScreenCaptureKit CWindowInfo
    fn should_include_window_sck(window: &ffi::CWindowInfo) -> bool {
        // Filter out system UI (dock, menu bar, etc.) which have non-zero layer
        if window.layer != 0 {
            return false;
        }

        // Exclude tiny windows (likely UI elements)
        if window.width < 50 || window.height < 50 {
            return false;
        }

        // Check if window is on screen
        if window.is_on_screen == 0 {
            return false;
        }

        true
    }

    /// Capture thumbnail for a window by window ID
    fn capture_window_thumbnail(window_id: u32) -> Option<String> {
        use std::fs;
        use std::process::Command;
        use std::time::{SystemTime, UNIX_EPOCH};

        // Create temp file path
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
        let temp_path = format!("/tmp/window_thumb_{}_{}.png", window_id, timestamp);

        // Use macOS screencapture to capture window
        // -l <windowid> captures a specific window
        // -x disables sound
        let output = Command::new("screencapture")
            .arg("-l")
            .arg(window_id.to_string())
            .arg("-x") // No sound
            .arg(&temp_path)
            .output()
            .ok()?;

        if !output.status.success() {
            println!(
                "[WindowThumbnail] screencapture failed for window {}: {:?}",
                window_id,
                String::from_utf8_lossy(&output.stderr)
            );
            return None;
        }

        // Check if file was created
        if !std::path::Path::new(&temp_path).exists() {            return None;
        }

        // Resize the image using sips (built-in macOS image tool)
        let resize_output = Command::new("sips")
            .arg("-Z")
            .arg("200") // Max dimension 200px
            .arg(&temp_path)
            .output()
            .ok()?;

        if !resize_output.status.success() {        }

        // Read PNG file and base64 encode
        let png_data = fs::read(&temp_path).ok()?;
        let base64_string = base64::engine::general_purpose::STANDARD.encode(&png_data);

        // Clean up temp file
        let _ = fs::remove_file(&temp_path);

        Some(base64_string)
    }

    /// Capture thumbnail for a screen by AVFoundation device index
    fn capture_screen_thumbnail(avf_device_index: usize) -> Option<String> {
        use std::fs;
        use std::process::Command;
        use std::time::{SystemTime, UNIX_EPOCH};

        // Find FFmpeg
        let ffmpeg_path = super::super::ffmpeg_utils::find_ffmpeg()?;

        // Create temp file path
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
        let temp_path = format!("/tmp/screen_thumb_{}_{}.png", avf_device_index, timestamp);

        // Capture single frame using FFmpeg with AVFoundation device index
        let output = Command::new(&ffmpeg_path)
            .arg("-f")
            .arg("avfoundation")
            .arg("-framerate")
            .arg("30") // Use 30fps for screen capture
            .arg("-i")
            .arg(format!("{}:", avf_device_index)) // No audio
            .arg("-frames:v")
            .arg("1") // Single frame
            .arg("-vf")
            .arg("scale=200:-1") // Scale to width 200, maintain aspect ratio
            .arg("-y") // Overwrite
            .arg(&temp_path)
            .output()
            .ok()?;

        if !output.status.success() {
            println!(
                "[ScreenThumbnail] FFmpeg failed for device {}: {:?}",
                avf_device_index,
                String::from_utf8_lossy(&output.stderr)
            );
            return None;
        }

        // Read PNG file and base64 encode
        let png_data = fs::read(&temp_path).ok()?;
        let base64_string = base64::engine::general_purpose::STANDARD.encode(&png_data);

        // Clean up temp file
        let _ = fs::remove_file(&temp_path);

        Some(base64_string)
    }
}

impl SourceEnumerator for PlatformEnumerator {
    fn enumerate_screens() -> Result<Vec<ScreenSource>, String> {
        // Use ScreenCaptureKit to enumerate displays
        let displays = ffi::enumerate_displays()?;

        let mut sources = Vec::with_capacity(displays.len());

        for (i, display) in displays.iter().enumerate() {
            let display_id = display.display_id;
            let is_primary = display.is_primary != 0;

            // Use display ID directly as the screen identifier
            let screen_id = format!("display_{}", display_id);
            println!(
                "[ScreenEnumeration SCK] Display {}: {}x{} @ ({}, {}), primary: {}",
                display_id, display.width, display.height, display.x, display.y, is_primary
            );

            // Generate thumbnail using SCScreenshotManager
            let thumbnail = ffi::capture_display_thumbnail(display_id, 200).ok();

            let mut source = ScreenSource::new(
                screen_id,
                format!("Display {}", i + 1),
                SourceType::Screen,
                display.width,
                display.height,
            )
            .with_position(display.x, display.y)
            .with_primary(is_primary)
            .with_scale_factor(1.0); // SCDisplay already provides pixel dimensions

            if let Some(thumb) = thumbnail {
                source = source.with_thumbnail(thumb);
            }

            sources.push(source);
        }

        Ok(sources)
    }

    fn enumerate_windows() -> Result<Vec<ScreenSource>, String> {
        // Use ScreenCaptureKit to enumerate windows
        let windows = ffi::enumerate_windows()?;

        let mut sources = Vec::new();

        for window in windows {
            // Filter out windows we don't want
            if !Self::should_include_window_sck(&window) {
                continue;
            }

            let window_id = window.window_id;

            // Get window metadata (title and owner name)
            let (title, owner) = ffi::get_window_metadata(window_id)
                .unwrap_or_else(|_| (String::new(), String::from("Unknown")));

            // Create display name
            let display_name = if title.is_empty() {
                owner.clone()
            } else {
                format!("{} - {}", owner, title)
            };

            println!(
                "[WindowEnumeration SCK] Window {}: '{}' ({}x{} @ {}, {})",
                window_id, display_name, window.width, window.height, window.x, window.y
            );

            // Generate thumbnail using SCScreenshotManager
            let thumbnail = ffi::capture_window_thumbnail(window_id, 200).ok();

            let mut source = ScreenSource::new(
                format!("window_{}", window_id),
                display_name,
                SourceType::Window,
                window.width,
                window.height,
            )
            .with_position(window.x, window.y)
            .with_app_name(owner);

            if let Some(thumb) = thumbnail {
                source = source.with_thumbnail(thumb);
            }

            sources.push(source);
        }

        Ok(sources)
    }
}
