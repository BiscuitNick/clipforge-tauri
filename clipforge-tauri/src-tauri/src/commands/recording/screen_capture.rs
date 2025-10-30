// Screen capture implementation using FFmpeg with AVFoundation on macOS

use std::process::{Child, ChildStdin, Command, Stdio};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use std::io::{Write, ErrorKind};
use super::super::ffmpeg_utils;
use super::{RecordingConfig, RecordingError};

/// Input mode for FFmpeg
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum InputMode {
    /// Use AVFoundation to capture directly (legacy mode)
    AVFoundation,
    /// Accept raw video frames via stdin
    RawStdin,
}

/// Encoding mode configuration
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EncodingMode {
    /// Constant frame rate (CFR) - default, predictable timing
    ConstantFrameRate,
    /// Variable frame rate (VFR) - more efficient, adapts to content
    VariableFrameRate,
    /// Real-time encoding - prioritize low latency over quality
    RealTime,
}

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
    /// Window bounds for cropping (x, y, width, height)
    window_bounds: Option<(i32, i32, u32, u32)>,
    /// Screen device to record from (for window recording)
    screen_device: Option<String>,
    /// Input mode (AVFoundation or raw stdin)
    input_mode: InputMode,
    /// Encoding mode (CFR, VFR, or real-time)
    encoding_mode: EncodingMode,
}

impl ScreenCaptureSession {
    /// Create a new screen capture session
    pub fn new(source_id: String, output_path: PathBuf, config: RecordingConfig) -> Self {
        Self {
            ffmpeg_process: None,
            output_path,
            config,
            source_id,
            window_bounds: None,
            screen_device: None,
            input_mode: InputMode::AVFoundation, // Default to AVFoundation for backward compatibility
            encoding_mode: EncodingMode::ConstantFrameRate, // Default to CFR
        }
    }

    /// Set the input mode for FFmpeg
    pub fn set_input_mode(&mut self, mode: InputMode) {
        self.input_mode = mode;
    }

    /// Set the encoding mode for FFmpeg
    pub fn set_encoding_mode(&mut self, mode: EncodingMode) {
        self.encoding_mode = mode;
    }

    /// Detect the number of camera devices before screens in AVFoundation
    #[cfg(target_os = "macos")]
    fn detect_camera_count() -> usize {
        if let Some(ffmpeg_path) = ffmpeg_utils::find_ffmpeg() {
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

                for line in stderr.lines() {
                    if line.contains("AVFoundation video devices:") {
                        in_video_section = true;
                        continue;
                    } else if line.contains("AVFoundation audio devices:") {
                        break;
                    } else if in_video_section && line.contains("[AVFoundation") && line.contains("] [") {
                        let lower_line = line.to_lowercase();
                        if lower_line.contains("capture screen") || (lower_line.contains("screen") && lower_line.contains("capture")) {
                            println!("[ScreenCapture] Detected {} camera devices before screens", camera_count);
                            return camera_count;
                        }
                        camera_count += 1;
                    }
                }
            }
        }
        // Fallback to 0 if detection fails
        println!("[ScreenCapture] Camera detection failed, using fallback: 0");
        0
    }

    /// Set window bounds for cropping (used for window recording)
    pub fn set_window_bounds(&mut self, x: i32, y: i32, width: u32, height: u32) {
        self.window_bounds = Some((x, y, width, height));
    }

    /// Set the screen device to record from (used for window recording)
    pub fn set_screen_device(&mut self, device: String) {
        self.screen_device = Some(device);
    }

    /// Start the screen capture
    pub fn start(&mut self, include_audio: bool) -> Result<(), RecordingError> {
        if self.ffmpeg_process.is_some() {
            return Err(RecordingError::AlreadyRecording);
        }

        println!("[ScreenCapture] Starting screen capture session");
        println!("[ScreenCapture]   Source: {}", self.source_id);
        println!("[ScreenCapture]   Config: {}x{} @ {}fps",
            self.config.width, self.config.height, self.config.frame_rate);

        let ffmpeg_path = ffmpeg_utils::find_ffmpeg()
            .ok_or_else(|| RecordingError::DependencyMissing {
                dependency: "FFmpeg".to_string(),
                install_instructions: "Install FFmpeg via Homebrew: brew install ffmpeg".to_string(),
            })?;

        println!("[ScreenCapture] FFmpeg found at: {}", ffmpeg_path.display());

        let mut command = self.build_ffmpeg_command(&ffmpeg_path, include_audio)?;

        // Start FFmpeg process with stdin piped so we can send commands
        let child = command
            .stdin(Stdio::piped())  // Changed from null to piped to allow sending 'q' command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| RecordingError::CaptureInitFailed(e.to_string()))?;

        println!("[ScreenCapture] FFmpeg started with PID: {}", child.id());

        self.ffmpeg_process = Some(child);
        Ok(())
    }

    /// Build the FFmpeg command for screen recording
    fn build_ffmpeg_command(&self, ffmpeg_path: &PathBuf, include_audio: bool) -> Result<Command, RecordingError> {
        let mut command = Command::new(ffmpeg_path);

        println!("[ScreenCapture] Building FFmpeg command:");
        println!("[ScreenCapture]   FFmpeg path: {}", ffmpeg_path.display());
        println!("[ScreenCapture]   Input mode: {:?}", self.input_mode);
        println!("[ScreenCapture]   Source ID: {}", self.source_id);
        println!("[ScreenCapture]   Include audio: {}", include_audio);
        println!("[ScreenCapture]   Output path: {}", self.output_path.display());

        // Add input arguments based on mode
        match self.input_mode {
            InputMode::AVFoundation => {
                #[cfg(target_os = "macos")]
                {
                    self.add_macos_input_args(&mut command, include_audio);
                }
            }
            InputMode::RawStdin => {
                self.add_raw_stdin_input_args(&mut command);
            }
        }

        // Add encoding parameters
        self.add_encoding_args(&mut command);

        // Add output file
        command.arg("-y"); // Overwrite output file if it exists
        command.arg(self.output_path.to_str().unwrap());

        // Log the complete command for debugging
        println!("[ScreenCapture] Complete FFmpeg command: {:?}", command);

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
        println!("[ScreenCapture] Source ID: {}", self.source_id);

        if self.source_id.starts_with("screen_") {
            // Screen capture: use display number
            let display_id = self.source_id.strip_prefix("screen_").unwrap_or("0");
            println!("[ScreenCapture] Extracted display_id: {}", display_id);

            let input_device = if include_audio {
                // Format: "<screen>:<audio device>"
                // Use ":0" for default audio device
                format!("{}:0", display_id)
            } else {
                // Screen only, no audio
                format!("{}:", display_id)
            };

            println!("[ScreenCapture] FFmpeg input device: {}", input_device);
            command.arg("-i").arg(input_device);
        } else if self.source_id.starts_with("window_") {
            // Window capture: record the screen containing the window, then crop
            println!("[ScreenCapture] Window capture - using screen device with crop filter");

            let screen_device = self.screen_device.as_ref()
                .map(|s| s.as_str())
                .unwrap_or_else(|| {
                    // Default to first screen if not set (camera_count + 0)
                    let camera_count = Self::detect_camera_count();
                    Box::leak(camera_count.to_string().into_boxed_str())
                });

            let input_device = if include_audio {
                format!("{}:0", screen_device)
            } else {
                format!("{}:", screen_device)
            };

            println!("[ScreenCapture] Recording from device {} for window", screen_device);
            command.arg("-i").arg(input_device);
        } else {
            // Default to first available screen
            println!("[ScreenCapture] Unknown source type, defaulting to first available screen");

            // Detect camera count to find first screen device
            let camera_count = Self::detect_camera_count();
            let first_screen_device = camera_count.to_string();

            let input_device = if include_audio {
                format!("{}:0", first_screen_device)
            } else {
                format!("{}:", first_screen_device)
            };

            println!("[ScreenCapture] Using default device: {} (camera_count: {})", input_device, camera_count);
            command.arg("-i").arg(input_device);
        }

        // Set pixel format for compatibility
        command.arg("-pix_fmt").arg("yuv420p");
    }

    /// Add raw stdin input arguments
    fn add_raw_stdin_input_args(&self, command: &mut Command) {
        println!("[ScreenCapture] Configuring raw stdin input");

        // Set input format to raw video
        command.arg("-f").arg("rawvideo");

        // Set pixel format (RGB24 for compatibility with Swift frame processing)
        // Note: RGB24 uses 3 bytes per pixel (R, G, B)
        command.arg("-pix_fmt").arg("rgb24");

        // Set video size (resolution)
        let video_size = format!("{}x{}", self.config.width, self.config.height);
        println!("[ScreenCapture]   Video size: {}", video_size);
        command.arg("-video_size").arg(&video_size);

        // Set frame rate
        println!("[ScreenCapture]   Frame rate: {}", self.config.frame_rate);
        command.arg("-framerate").arg(self.config.frame_rate.to_string());

        // Set input to stdin (pipe:0)
        println!("[ScreenCapture]   Input: pipe:0 (stdin)");
        command.arg("-i").arg("pipe:0");

        // Convert RGB24 to YUV420p for encoding (required by most codecs)
        // This will be added as part of encoding args, but we note it here for clarity
    }

    /// Add encoding arguments based on configuration
    fn add_encoding_args(&self, command: &mut Command) {
        // Apply crop filter if window bounds are set
        if let Some((x, y, width, height)) = self.window_bounds {
            println!("[ScreenCapture] Applying crop filter: {}:{}:{}:{}", width, height, x, y);
            // Crop filter format: crop=width:height:x:y
            let crop_filter = format!("crop={}:{}:{}:{}", width, height, x, y);
            command.arg("-vf").arg(crop_filter);
        }

        // Video codec
        command.arg("-c:v").arg(&self.config.video_codec);

        // Video bitrate
        command.arg("-b:v").arg(format!("{}k", self.config.video_bitrate));

        // Resolution (scale if needed) - only if not using crop
        if self.window_bounds.is_none() {
            command.arg("-s").arg(format!("{}x{}", self.config.width, self.config.height));
        }

        // Keyframe interval (every 2 seconds)
        let keyframe_interval = self.config.frame_rate * 2;
        command.arg("-g").arg(keyframe_interval.to_string());

        // Force first frame as keyframe to prevent gray/blurry start
        command.arg("-force_key_frames").arg("expr:eq(n,0)");

        // H.264 specific settings
        if self.config.video_codec == "h264" || self.config.video_codec == "libx264" {
            // Adjust preset based on encoding mode
            match self.encoding_mode {
                EncodingMode::RealTime => {
                    command.arg("-preset").arg("ultrafast"); // Prioritize speed for real-time
                    command.arg("-tune").arg("zerolatency"); // Minimize latency
                }
                EncodingMode::VariableFrameRate | EncodingMode::ConstantFrameRate => {
                    command.arg("-preset").arg("medium"); // Balance between speed and quality
                }
            }

            command.arg("-profile:v").arg("high"); // H.264 High Profile
            command.arg("-level").arg("4.2"); // Support up to 4K

            // Use CRF for consistent quality instead of pure CBR
            // Adjust CRF based on encoding mode
            let crf_value = match self.encoding_mode {
                EncodingMode::RealTime => "23", // Slightly lower quality for speed
                _ => "18", // Visually lossless
            };
            command.arg("-crf").arg(crf_value);
        }

        // Variable frame rate support
        if self.encoding_mode == EncodingMode::VariableFrameRate {
            // Enable variable frame rate (VFR) mode
            // This allows FFmpeg to encode frames at their actual timestamps
            command.arg("-vsync").arg("vfr");
            println!("[ScreenCapture] Enabled variable frame rate mode");
        } else {
            // Constant frame rate (CFR) mode - default
            command.arg("-vsync").arg("cfr");
        }

        // Real-time encoding optimizations
        if self.encoding_mode == EncodingMode::RealTime {
            // Add real-time flag to prioritize encoding speed
            command.arg("-re");
            // Reduce buffer size for lower latency
            command.arg("-bufsize").arg(format!("{}k", self.config.video_bitrate / 2));
            println!("[ScreenCapture] Enabled real-time encoding mode");
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
            println!("[ScreenCapture] Stopping FFmpeg process (PID: {})", child.id());

            // Try multiple methods to stop FFmpeg gracefully
            #[cfg(unix)]
            {
                use std::io::Write;

                // Method 1: Try sending 'q' to stdin (FFmpeg's quit command)
                if let Some(mut stdin) = child.stdin.take() {
                    println!("[ScreenCapture] Sending 'q' command to FFmpeg");
                    let _ = stdin.write_all(b"q");
                    let _ = stdin.flush();
                    drop(stdin);  // Close stdin

                    // Give FFmpeg 500ms to respond to 'q' command
                    thread::sleep(Duration::from_millis(500));
                }

                // Check if process exited after 'q' command
                match child.try_wait() {
                    Ok(Some(status)) => {
                        println!("[ScreenCapture] FFmpeg exited gracefully with status: {:?}", status);
                    }
                    Ok(None) => {
                        // Still running, try SIGINT
                        println!("[ScreenCapture] FFmpeg still running, sending SIGINT");
                        let pid = child.id() as i32;
                        unsafe {
                            libc::kill(pid, libc::SIGINT);
                        }

                        // Wait up to 5 seconds for graceful shutdown
                        for i in 0..50 {
                            thread::sleep(Duration::from_millis(100));
                            match child.try_wait() {
                                Ok(Some(status)) => {
                                    println!("[ScreenCapture] FFmpeg exited after SIGINT with status: {:?}", status);
                                    break;
                                }
                                Ok(None) if i == 49 => {
                                    // Last iteration, force kill
                                    println!("[ScreenCapture] FFmpeg not responding, force killing");
                                    let _ = child.kill();
                                    let _ = child.wait();

                                    // Also try to clean up any orphaned ffmpeg processes
                                    println!("[ScreenCapture] Cleaning up orphaned FFmpeg processes");
                                    let _ = Command::new("pkill")
                                        .arg("-9")
                                        .arg("-f")
                                        .arg(&format!("ffmpeg.*{}", self.output_path.to_string_lossy()))
                                        .output();
                                }
                                _ => continue,
                            }
                        }
                    }
                    Err(e) => {
                        println!("[ScreenCapture] Error checking process status: {}", e);
                        return Err(RecordingError::CaptureStopFailed(e.to_string()));
                    }
                }
            }

            #[cfg(not(unix))]
            {
                // On non-Unix systems, try to kill directly
                println!("[ScreenCapture] Stopping FFmpeg on non-Unix system");
                child.kill()
                    .map_err(|e| RecordingError::CaptureStopFailed(e.to_string()))?;
                child.wait()
                    .map_err(|e| RecordingError::CaptureStopFailed(e.to_string()))?;
            }

            // Verify the file exists and has content
            if !self.output_path.exists() {
                return Err(RecordingError::CaptureStopFailed(
                    "Output file was not created".to_string()
                ));
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

    /// Get mutable access to the FFmpeg stdin (for writing raw frames)
    /// Returns None if not recording or stdin not available
    pub fn stdin_mut(&mut self) -> Option<&mut ChildStdin> {
        self.ffmpeg_process.as_mut()?.stdin.as_mut()
    }

    /// Write a raw frame to FFmpeg stdin
    ///
    /// # Arguments
    /// * `frame_data` - Raw RGB24 pixel data (width * height * 3 bytes)
    ///
    /// # Returns
    /// * `Ok(())` - Frame written successfully
    /// * `Err(RecordingError)` - Error writing frame (EPIPE = FFmpeg terminated)
    pub fn write_frame(&mut self, frame_data: &[u8]) -> Result<(), RecordingError> {
        if self.input_mode != InputMode::RawStdin {
            return Err(RecordingError::CaptureStopFailed(
                "Cannot write frames in AVFoundation mode".to_string()
            ));
        }

        let stdin = self.stdin_mut()
            .ok_or_else(|| RecordingError::CaptureStopFailed(
                "FFmpeg stdin not available".to_string()
            ))?;

        // Calculate expected frame size (width * height * 3 bytes for RGB24)
        let expected_size = (self.config.width * self.config.height * 3) as usize;
        if frame_data.len() != expected_size {
            return Err(RecordingError::CaptureStopFailed(
                format!("Invalid frame size: expected {} bytes, got {} bytes",
                    expected_size, frame_data.len())
            ));
        }

        // Write frame data to stdin
        match stdin.write_all(frame_data) {
            Ok(()) => {
                // Flush to ensure frame is sent to FFmpeg
                stdin.flush().map_err(|e| {
                    if e.kind() == ErrorKind::BrokenPipe {
                        RecordingError::CaptureStopFailed(
                            "FFmpeg process terminated (EPIPE)".to_string()
                        )
                    } else {
                        RecordingError::CaptureStopFailed(
                            format!("Failed to flush frame to FFmpeg: {}", e)
                        )
                    }
                })?;
                Ok(())
            }
            Err(e) => {
                if e.kind() == ErrorKind::BrokenPipe {
                    Err(RecordingError::CaptureStopFailed(
                        "FFmpeg process terminated (EPIPE)".to_string()
                    ))
                } else {
                    Err(RecordingError::CaptureStopFailed(
                        format!("Failed to write frame to FFmpeg: {}", e)
                    ))
                }
            }
        }
    }

    /// Check if the FFmpeg process is still running
    /// Returns false if process has terminated
    pub fn is_process_alive(&mut self) -> bool {
        if let Some(child) = &mut self.ffmpeg_process {
            match child.try_wait() {
                Ok(Some(_)) => false, // Process exited
                Ok(None) => true,     // Process still running
                Err(_) => false,      // Error checking status, assume dead
            }
        } else {
            false
        }
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
