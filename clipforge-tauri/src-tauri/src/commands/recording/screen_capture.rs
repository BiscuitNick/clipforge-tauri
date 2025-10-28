// Screen capture implementation using FFmpeg with AVFoundation on macOS

use std::process::{Child, Command, Stdio};
use std::path::PathBuf;
use super::super::ffmpeg_utils;
use super::{RecordingConfig, RecordingError};

/// Platform-specific screen capture implementation
pub struct ScreenCaptureSession {
    /// FFmpeg process handle
    ffmpeg_process: Option<Child>,
    /// Output file path
    output_path: PathBuf,
    /// Recording configuration
    config: RecordingConfig,
    /// Source ID (screen or window)
    source_id: String,
}

impl ScreenCaptureSession {
    /// Create a new screen capture session
    pub fn new(source_id: String, output_path: PathBuf, config: RecordingConfig) -> Self {
        Self {
            ffmpeg_process: None,
            output_path,
            config,
            source_id,
        }
    }

    /// Start the screen capture
    pub fn start(&mut self, include_audio: bool) -> Result<(), RecordingError> {
        if self.ffmpeg_process.is_some() {
            return Err(RecordingError::AlreadyRecording);
        }

        let ffmpeg_path = ffmpeg_utils::find_ffmpeg()
            .ok_or_else(|| RecordingError::DependencyMissing {
                dependency: "FFmpeg".to_string(),
                install_instructions: "Install FFmpeg via Homebrew: brew install ffmpeg".to_string(),
            })?;

        let mut command = self.build_ffmpeg_command(&ffmpeg_path, include_audio)?;

        // Start FFmpeg process
        let child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| RecordingError::CaptureInitFailed(e.to_string()))?;

        self.ffmpeg_process = Some(child);
        Ok(())
    }

    /// Build the FFmpeg command for screen recording
    fn build_ffmpeg_command(&self, ffmpeg_path: &PathBuf, include_audio: bool) -> Result<Command, RecordingError> {
        let mut command = Command::new(ffmpeg_path);

        // macOS-specific: Use AVFoundation for screen capture
        #[cfg(target_os = "macos")]
        {
            self.add_macos_input_args(&mut command, include_audio);
        }

        // Add encoding parameters
        self.add_encoding_args(&mut command);

        // Add output file
        command.arg("-y"); // Overwrite output file if it exists
        command.arg(self.output_path.to_str().unwrap());

        Ok(command)
    }

    /// Add macOS-specific AVFoundation input arguments
    #[cfg(target_os = "macos")]
    fn add_macos_input_args(&self, command: &mut Command, include_audio: bool) {
        // Set input format to avfoundation
        command.arg("-f").arg("avfoundation");

        // Set frame rate
        command.arg("-framerate").arg(self.config.frame_rate.to_string());

        // Parse source ID to determine capture type
        if self.source_id.starts_with("screen_") {
            // Screen capture: use display number
            let display_id = self.source_id.strip_prefix("screen_").unwrap_or("0");

            if include_audio {
                // Format: "<screen>:<audio device>"
                // Use ":0" for default audio device
                command.arg("-i").arg(format!("{}:0", display_id));
            } else {
                // Screen only, no audio
                command.arg("-i").arg(format!("{}:", display_id));
            }
        } else if self.source_id.starts_with("window_") {
            // Window capture is more complex with AVFoundation
            // For now, fall back to full screen capture
            // TODO: Implement window-specific capture using CGWindowListCreateImage
            if include_audio {
                command.arg("-i").arg("0:0"); // Capture screen 0 + audio
            } else {
                command.arg("-i").arg("0:"); // Capture screen 0, no audio
            }
        } else {
            // Default to screen 0
            if include_audio {
                command.arg("-i").arg("0:0");
            } else {
                command.arg("-i").arg("0:");
            }
        }

        // Set pixel format for compatibility
        command.arg("-pix_fmt").arg("yuv420p");
    }

    /// Add encoding arguments based on configuration
    fn add_encoding_args(&self, command: &mut Command) {
        // Video codec
        command.arg("-c:v").arg(&self.config.video_codec);

        // Video bitrate
        command.arg("-b:v").arg(format!("{}k", self.config.video_bitrate));

        // Resolution (scale if needed)
        command.arg("-s").arg(format!("{}x{}", self.config.width, self.config.height));

        // Keyframe interval (every 2 seconds)
        let keyframe_interval = self.config.frame_rate * 2;
        command.arg("-g").arg(keyframe_interval.to_string());

        // H.264 specific settings
        if self.config.video_codec == "h264" || self.config.video_codec == "libx264" {
            command.arg("-preset").arg("medium"); // Balance between speed and quality
            command.arg("-profile:v").arg("high"); // H.264 High Profile
            command.arg("-level").arg("4.2"); // Support up to 4K
        }

        // Audio codec (if configured)
        if !self.config.audio_codec.is_empty() {
            command.arg("-c:a").arg(&self.config.audio_codec);
            command.arg("-b:a").arg(format!("{}k", self.config.audio_bitrate));
            command.arg("-ar").arg(self.config.audio_sample_rate.to_string());
            command.arg("-ac").arg(self.config.audio_channels.to_string());
        }

        // Output format
        command.arg("-f").arg(&self.config.output_format);
    }

    /// Stop the screen capture
    pub fn stop(&mut self) -> Result<PathBuf, RecordingError> {
        if let Some(mut child) = self.ffmpeg_process.take() {
            // Send 'q' to stdin to gracefully stop FFmpeg
            // Since we're using Stdio::null() for stdin, we'll use kill instead
            child.kill()
                .map_err(|e| RecordingError::CaptureStopFailed(e.to_string()))?;

            // Wait for process to finish
            let status = child.wait()
                .map_err(|e| RecordingError::CaptureStopFailed(e.to_string()))?;

            if !status.success() {
                // Check if file was created despite non-zero exit
                if !self.output_path.exists() {
                    return Err(RecordingError::CaptureStopFailed(
                        format!("FFmpeg exited with status: {}", status)
                    ));
                }
            }

            Ok(self.output_path.clone())
        } else {
            Err(RecordingError::NotRecording)
        }
    }

    /// Check if currently recording
    pub fn is_recording(&self) -> bool {
        self.ffmpeg_process.is_some()
    }

    /// Get the output file path
    pub fn output_path(&self) -> &PathBuf {
        &self.output_path
    }
}

impl Drop for ScreenCaptureSession {
    fn drop(&mut self) {
        // Ensure FFmpeg process is stopped when session is dropped
        if let Some(mut child) = self.ffmpeg_process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
