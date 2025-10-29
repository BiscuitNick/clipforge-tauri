use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};
use std::fs;
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinHandle;
use super::permissions::{PermissionHandler, PlatformPermissions};

mod screen_capture;
use screen_capture::ScreenCaptureSession;

// ============================================================================
// Data Structures
// ============================================================================

/// Represents the current status of a recording
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RecordingStatus {
    Idle,
    Recording,
    Paused,
    Stopping,
    Error,
}

/// Represents the type of recording being performed
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RecordingType {
    Screen,
    Webcam,
    ScreenAndWebcam,
}

/// Recording configuration for video and audio settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingConfig {
    /// Video resolution width
    pub width: u32,
    /// Video resolution height
    pub height: u32,
    /// Video frame rate (fps)
    pub frame_rate: u32,
    /// Video bitrate (kbps)
    pub video_bitrate: u32,
    /// Video codec (e.g., "h264", "vp9")
    pub video_codec: String,
    /// Audio sample rate (Hz)
    pub audio_sample_rate: u32,
    /// Audio channels (1 = mono, 2 = stereo)
    pub audio_channels: u32,
    /// Audio bitrate (kbps)
    pub audio_bitrate: u32,
    /// Audio codec (e.g., "aac", "opus")
    pub audio_codec: String,
    /// Output format (e.g., "mp4", "webm")
    pub output_format: String,
}

impl Default for RecordingConfig {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            frame_rate: 30,
            video_bitrate: 5000,
            video_codec: "h264".to_string(),
            audio_sample_rate: 48000,
            audio_channels: 2,
            audio_bitrate: 128,
            audio_codec: "aac".to_string(),
            output_format: "mp4".to_string(),
        }
    }
}

impl RecordingConfig {
    /// Create a new configuration builder
    pub fn builder() -> RecordingConfigBuilder {
        RecordingConfigBuilder::new()
    }

    /// Validate this configuration
    pub fn validate(&self) -> Result<(), String> {
        // Check for valid dimensions
        if self.width == 0 || self.height == 0 {
            return Err("Invalid video dimensions: width and height must be greater than 0".to_string());
        }

        // Check reasonable dimension limits
        if self.width > 7680 || self.height > 4320 {
            return Err("Video dimensions exceed maximum (8K: 7680x4320)".to_string());
        }

        // Check for valid frame rate
        if self.frame_rate == 0 || self.frame_rate > 120 {
            return Err("Frame rate must be between 1 and 120 fps".to_string());
        }

        // Check for valid bitrates
        if self.video_bitrate == 0 || self.video_bitrate > 100000 {
            return Err("Video bitrate must be between 1 and 100000 kbps".to_string());
        }

        if self.audio_bitrate == 0 || self.audio_bitrate > 512 {
            return Err("Audio bitrate must be between 1 and 512 kbps".to_string());
        }

        // Check audio settings
        if self.audio_channels == 0 || self.audio_channels > 8 {
            return Err("Audio channels must be between 1 and 8".to_string());
        }

        if self.audio_sample_rate < 8000 || self.audio_sample_rate > 192000 {
            return Err("Audio sample rate must be between 8000 and 192000 Hz".to_string());
        }

        // Check codec compatibility
        self.validate_codec_compatibility()?;

        Ok(())
    }

    /// Validate codec and container compatibility
    fn validate_codec_compatibility(&self) -> Result<(), String> {
        match self.output_format.as_str() {
            "mp4" => {
                // MP4 supports h264, h265, and various audio codecs
                match self.video_codec.as_str() {
                    "h264" | "h265" | "hevc" => {},
                    _ => return Err(format!("MP4 format does not support '{}' video codec. Use h264 or h265.", self.video_codec)),
                }
                match self.audio_codec.as_str() {
                    "aac" | "mp3" => {},
                    _ => return Err(format!("MP4 format does not support '{}' audio codec. Use aac or mp3.", self.audio_codec)),
                }
            }
            "webm" => {
                // WebM supports VP8, VP9, AV1 for video and Vorbis, Opus for audio
                match self.video_codec.as_str() {
                    "vp8" | "vp9" | "av1" => {},
                    _ => return Err(format!("WebM format does not support '{}' video codec. Use vp8, vp9, or av1.", self.video_codec)),
                }
                match self.audio_codec.as_str() {
                    "vorbis" | "opus" => {},
                    _ => return Err(format!("WebM format does not support '{}' audio codec. Use vorbis or opus.", self.audio_codec)),
                }
            }
            "mkv" => {
                // MKV supports almost everything
                // No strict validation needed
            }
            "mov" => {
                // MOV (QuickTime) is similar to MP4
                match self.video_codec.as_str() {
                    "h264" | "h265" | "hevc" | "prores" => {},
                    _ => return Err(format!("MOV format does not support '{}' video codec. Use h264, h265, or prores.", self.video_codec)),
                }
            }
            _ => return Err(format!("Unsupported output format: '{}'. Use mp4, webm, mkv, or mov.", self.output_format)),
        }

        Ok(())
    }

    /// Apply platform-specific adjustments
    #[cfg(target_os = "macos")]
    pub fn apply_platform_adjustments(&mut self) {
        // macOS works well with h264/aac in MP4
        // No specific adjustments needed for now
    }

    #[cfg(target_os = "windows")]
    pub fn apply_platform_adjustments(&mut self) {
        // Windows may prefer certain codecs
        // Adjust if needed based on platform capabilities
    }

    #[cfg(target_os = "linux")]
    pub fn apply_platform_adjustments(&mut self) {
        // Linux may have different codec availability
        // Adjust based on what's commonly available
    }
}

/// Builder for RecordingConfig
#[derive(Debug, Clone)]
pub struct RecordingConfigBuilder {
    config: RecordingConfig,
}

impl RecordingConfigBuilder {
    pub fn new() -> Self {
        Self {
            config: RecordingConfig::default(),
        }
    }

    pub fn width(mut self, width: u32) -> Self {
        self.config.width = width;
        self
    }

    pub fn height(mut self, height: u32) -> Self {
        self.config.height = height;
        self
    }

    pub fn resolution(mut self, width: u32, height: u32) -> Self {
        self.config.width = width;
        self.config.height = height;
        self
    }

    pub fn frame_rate(mut self, fps: u32) -> Self {
        self.config.frame_rate = fps;
        self
    }

    pub fn video_bitrate(mut self, kbps: u32) -> Self {
        self.config.video_bitrate = kbps;
        self
    }

    pub fn video_codec(mut self, codec: impl Into<String>) -> Self {
        self.config.video_codec = codec.into();
        self
    }

    pub fn audio_sample_rate(mut self, hz: u32) -> Self {
        self.config.audio_sample_rate = hz;
        self
    }

    pub fn audio_channels(mut self, channels: u32) -> Self {
        self.config.audio_channels = channels;
        self
    }

    pub fn audio_bitrate(mut self, kbps: u32) -> Self {
        self.config.audio_bitrate = kbps;
        self
    }

    pub fn audio_codec(mut self, codec: impl Into<String>) -> Self {
        self.config.audio_codec = codec.into();
        self
    }

    pub fn output_format(mut self, format: impl Into<String>) -> Self {
        self.config.output_format = format.into();
        self
    }

    pub fn preset(mut self, preset: QualityPreset) -> Self {
        self.config = preset.to_config();
        self
    }

    pub fn build(self) -> Result<RecordingConfig, String> {
        self.config.validate()?;
        Ok(self.config)
    }

    pub fn build_unchecked(self) -> RecordingConfig {
        self.config
    }
}

impl Default for RecordingConfigBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Quality presets for easy configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QualityPreset {
    Low,
    Medium,
    High,
    Custom,
}

impl QualityPreset {
    /// Convert a quality preset to a RecordingConfig
    pub fn to_config(&self) -> RecordingConfig {
        match self {
            QualityPreset::Low => RecordingConfig {
                width: 1280,
                height: 720,
                frame_rate: 24,
                video_bitrate: 2000,
                ..Default::default()
            },
            QualityPreset::Medium => RecordingConfig {
                width: 1920,
                height: 1080,
                frame_rate: 30,
                video_bitrate: 5000,
                ..Default::default()
            },
            QualityPreset::High => RecordingConfig {
                width: 2560,
                height: 1440,
                frame_rate: 60,
                video_bitrate: 10000,
                ..Default::default()
            },
            QualityPreset::Custom => RecordingConfig::default(),
        }
    }
}

/// Current state of an active recording
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordingState {
    /// Unique identifier for this recording session
    pub id: String,
    /// Type of recording
    pub recording_type: RecordingType,
    /// Current status
    pub status: RecordingStatus,
    /// Start timestamp (milliseconds since epoch)
    pub start_time: Option<u64>,
    /// Total pause time (milliseconds)
    pub pause_time: u64,
    /// Timestamp when paused (milliseconds since epoch)
    pub paused_at: Option<u64>,
    /// Current duration (seconds)
    pub duration: f64,
    /// Output file path
    pub file_path: Option<String>,
    /// Configuration used for this recording
    pub config: RecordingConfig,
}

impl RecordingState {
    pub fn new(id: String, recording_type: RecordingType, config: RecordingConfig) -> Self {
        Self {
            id,
            recording_type,
            status: RecordingStatus::Idle,
            start_time: None,
            pause_time: 0,
            paused_at: None,
            duration: 0.0,
            file_path: None,
            config,
        }
    }

    /// Calculate current duration accounting for pauses
    pub fn calculate_duration(&self) -> f64 {
        if let Some(start) = self.start_time {
            let now = chrono::Utc::now().timestamp_millis() as u64;
            let elapsed = now - start;

            // Account for current pause if paused
            let total_pause = if let Some(paused_at) = self.paused_at {
                self.pause_time + (now - paused_at)
            } else {
                self.pause_time
            };

            let active_time = elapsed - total_pause;
            active_time as f64 / 1000.0 // Convert to seconds
        } else {
            0.0
        }
    }

    /// Update duration field with current calculated duration
    pub fn update_duration(&mut self) {
        self.duration = self.calculate_duration();
    }

    /// Mark as started
    pub fn start(&mut self) {
        self.status = RecordingStatus::Recording;
        self.start_time = Some(chrono::Utc::now().timestamp_millis() as u64);
        self.pause_time = 0;
        self.paused_at = None;
    }

    /// Mark as paused
    pub fn pause(&mut self) {
        if self.status == RecordingStatus::Recording {
            self.status = RecordingStatus::Paused;
            self.paused_at = Some(chrono::Utc::now().timestamp_millis() as u64);
            self.update_duration();
        }
    }

    /// Resume from pause
    pub fn resume(&mut self) {
        if self.status == RecordingStatus::Paused {
            if let Some(paused_at) = self.paused_at {
                let now = chrono::Utc::now().timestamp_millis() as u64;
                self.pause_time += now - paused_at;
                self.paused_at = None;
            }
            self.status = RecordingStatus::Recording;
        }
    }

    /// Mark as stopped
    pub fn stop(&mut self) {
        self.update_duration();
        self.status = RecordingStatus::Idle;
    }
}

/// Global recording state manager
pub struct RecordingManager {
    current_recording: Option<RecordingState>,
    duration_task: Option<JoinHandle<()>>,
    temp_file_manager: Arc<Mutex<TempFileManager>>,
    capture_session: Option<ScreenCaptureSession>,
}

impl RecordingManager {
    pub fn new() -> Self {
        let temp_manager = TempFileManager::new()
            .expect("Failed to initialize temp file manager");

        Self {
            current_recording: None,
            duration_task: None,
            temp_file_manager: Arc::new(Mutex::new(temp_manager)),
            capture_session: None,
        }
    }

    pub fn get_temp_manager(&self) -> Arc<Mutex<TempFileManager>> {
        self.temp_file_manager.clone()
    }

    pub fn get_current_recording(&self) -> Option<RecordingState> {
        self.current_recording.clone()
    }

    pub fn set_current_recording(&mut self, state: Option<RecordingState>) {
        self.current_recording = state;
    }

    /// Start duration tracking task
    pub fn start_duration_tracking(
        &mut self,
        state: Arc<Mutex<RecordingManager>>,
        app_handle: AppHandle,
    ) {
        // Cancel existing task if any
        self.stop_duration_tracking();

        // Spawn a new task to update duration every second
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));

            loop {
                interval.tick().await;

                // Update duration and emit event
                let recording_state = {
                    let mut manager = state.lock().unwrap();
                    if let Some(ref mut recording) = manager.current_recording {
                        // Only update if recording (not paused)
                        if recording.status == RecordingStatus::Recording {
                            recording.update_duration();
                            Some(recording.clone())
                        } else {
                            None
                        }
                    } else {
                        // No recording, stop the task
                        break;
                    }
                };

                // Emit update event if we have a recording
                if let Some(state) = recording_state {
                    let _ = app_handle.emit("recording:duration-update", state);
                }
            }
        });

        self.duration_task = Some(task);
    }

    /// Stop duration tracking task
    pub fn stop_duration_tracking(&mut self) {
        if let Some(task) = self.duration_task.take() {
            task.abort();
        }
    }

    /// Emit state change event
    pub fn emit_state_change(&self, app_handle: &AppHandle, event: &str) {
        if let Some(ref recording) = self.current_recording {
            let _ = app_handle.emit(event, recording.clone());
        }
    }
}

impl Default for RecordingManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for RecordingManager {
    fn drop(&mut self) {
        self.stop_duration_tracking();
    }
}

/// Thread-safe recording manager type
pub type RecordingManagerState = Arc<Mutex<RecordingManager>>;

// ============================================================================
// Permission Types
// ============================================================================

/// Permission types that need to be checked
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionType {
    Screen,
    Camera,
    Microphone,
}

/// Permission status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionStatus {
    NotDetermined,
    Granted,
    Denied,
    Restricted,
}

/// Result of a permission check
#[derive(Debug, Serialize, Deserialize)]
pub struct PermissionResult {
    pub permission_type: PermissionType,
    pub status: PermissionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub help_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<Vec<String>>,
}

impl PermissionResult {
    /// Create a new permission result with guidance
    pub fn new(permission_type: PermissionType, status: PermissionStatus) -> Self {
        let (error_message, help_url, instructions) = match (&permission_type, &status) {
            (PermissionType::Screen, PermissionStatus::Denied) => (
                Some("Screen recording permission denied".to_string()),
                Some("https://support.apple.com/guide/mac-help/control-access-screen-recording-mchld6aa7d23/mac".to_string()),
                Some(vec![
                    "1. Open System Preferences/Settings".to_string(),
                    "2. Go to Security & Privacy > Privacy > Screen Recording".to_string(),
                    "3. Enable ClipForge in the list".to_string(),
                    "4. Restart ClipForge for changes to take effect".to_string(),
                ]),
            ),
            (PermissionType::Camera, PermissionStatus::Denied) => (
                Some("Camera permission denied".to_string()),
                Some("https://support.apple.com/guide/mac-help/control-access-camera-mchlf6d108da/mac".to_string()),
                Some(vec![
                    "1. Open System Preferences/Settings".to_string(),
                    "2. Go to Security & Privacy > Privacy > Camera".to_string(),
                    "3. Enable ClipForge in the list".to_string(),
                    "4. Click 'Request Permission' to try again".to_string(),
                ]),
            ),
            (PermissionType::Microphone, PermissionStatus::Denied) => (
                Some("Microphone permission denied".to_string()),
                Some("https://support.apple.com/guide/mac-help/control-access-microphone-mchla1b1e1fe/mac".to_string()),
                Some(vec![
                    "1. Open System Preferences/Settings".to_string(),
                    "2. Go to Security & Privacy > Privacy > Microphone".to_string(),
                    "3. Enable ClipForge in the list".to_string(),
                    "4. Click 'Request Permission' to try again".to_string(),
                ]),
            ),
            (_, PermissionStatus::Restricted) => (
                Some("Permission restricted by system policy".to_string()),
                None,
                Some(vec![
                    "This permission is restricted by your system administrator or parental controls.".to_string(),
                    "Contact your administrator for assistance.".to_string(),
                ]),
            ),
            _ => (None, None, None),
        };

        Self {
            permission_type,
            status,
            error_message,
            help_url,
            instructions,
        }
    }
}

// ============================================================================
// Error Types and Recovery
// ============================================================================

/// Comprehensive error type for recording operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "message")]
pub enum RecordingError {
    /// Permission denied for required resource
    PermissionDenied(String),
    /// Insufficient disk space
    DiskSpaceLow { available: u64, required: u64 },
    /// I/O error occurred
    IoError(String),
    /// Invalid configuration
    InvalidConfig(String),
    /// Recording already in progress
    RecordingInProgress,
    /// Recording already in progress (alternative name)
    AlreadyRecording,
    /// No active recording
    NoActiveRecording,
    /// Not currently recording
    NotRecording,
    /// Hardware not available (camera/mic)
    HardwareUnavailable(String),
    /// Codec not supported
    CodecNotSupported(String),
    /// Dependency missing (e.g., FFmpeg)
    DependencyMissing { dependency: String, install_instructions: String },
    /// Failed to initialize capture
    CaptureInitFailed(String),
    /// Failed to stop capture
    CaptureStopFailed(String),
    /// Unknown error
    Unknown(String),
}

impl RecordingError {
    /// Get a user-friendly error message
    pub fn user_message(&self) -> String {
        match self {
            RecordingError::PermissionDenied(resource) => {
                format!("Permission denied for {}. Please grant access in System Preferences.", resource)
            }
            RecordingError::DiskSpaceLow { available, required } => {
                format!("Insufficient disk space. Available: {} MB, Required: {} MB",
                    available / 1_000_000, required / 1_000_000)
            }
            RecordingError::IoError(err) => {
                format!("File error: {}. Please check your storage device.", err)
            }
            RecordingError::InvalidConfig(err) => {
                format!("Invalid configuration: {}", err)
            }
            RecordingError::RecordingInProgress | RecordingError::AlreadyRecording => {
                "A recording is already in progress. Please stop it before starting a new one.".to_string()
            }
            RecordingError::NoActiveRecording | RecordingError::NotRecording => {
                "No recording is currently active.".to_string()
            }
            RecordingError::HardwareUnavailable(device) => {
                format!("{} is not available. Please check your device connections.", device)
            }
            RecordingError::CodecNotSupported(codec) => {
                format!("Codec '{}' is not supported on this system.", codec)
            }
            RecordingError::DependencyMissing { dependency, install_instructions } => {
                format!("{} is not installed. {}", dependency, install_instructions)
            }
            RecordingError::CaptureInitFailed(err) => {
                format!("Failed to start capture: {}", err)
            }
            RecordingError::CaptureStopFailed(err) => {
                format!("Failed to stop capture: {}", err)
            }
            RecordingError::Unknown(err) => {
                format!("An unexpected error occurred: {}", err)
            }
        }
    }

    /// Get recovery suggestions
    pub fn recovery_suggestion(&self) -> Option<String> {
        match self {
            RecordingError::PermissionDenied(_) => {
                Some("Open System Preferences > Security & Privacy and grant the necessary permissions.".to_string())
            }
            RecordingError::DiskSpaceLow { .. } => {
                Some("Free up disk space or choose a different location for recordings.".to_string())
            }
            RecordingError::HardwareUnavailable(_) => {
                Some("Check that your device is connected and not being used by another application.".to_string())
            }
            _ => None,
        }
    }
}

impl std::fmt::Display for RecordingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.user_message())
    }
}

// ============================================================================
// Temporary File Management
// ============================================================================

/// Manages temporary recording files with automatic cleanup
pub struct TempFileManager {
    temp_dir: PathBuf,
    active_files: Vec<PathBuf>,
}

impl TempFileManager {
    /// Create a new temporary file manager
    pub fn new() -> Result<Self, String> {
        let temp_dir = std::env::temp_dir().join("clipforge_recordings");

        // Create temp directory if it doesn't exist
        fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temp directory: {}", e))?;

        Ok(Self {
            temp_dir,
            active_files: Vec::new(),
        })
    }

    /// Create a new temporary file for recording
    pub fn create_temp_file(&mut self, prefix: &str) -> Result<PathBuf, String> {
        let timestamp = chrono::Utc::now().timestamp_millis();
        let filename = format!("{}_{}.mp4", prefix, timestamp);
        let filepath = self.temp_dir.join(filename);

        // Track this file for cleanup
        self.active_files.push(filepath.clone());

        Ok(filepath)
    }

    /// Mark a file as completed (move it from temp to final location)
    pub fn finalize_file(&mut self, temp_path: &Path, final_path: &Path) -> Result<(), String> {
        // Move the file to final location
        fs::rename(temp_path, final_path)
            .map_err(|e| format!("Failed to finalize recording: {}", e))?;

        // Remove from active files list
        self.active_files.retain(|p| p != temp_path);

        Ok(())
    }

    /// Clean up a specific temporary file
    pub fn cleanup_file(&mut self, path: &Path) -> Result<(), String> {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|e| format!("Failed to remove temp file: {}", e))?;
        }

        self.active_files.retain(|p| p != path);
        Ok(())
    }

    /// Clean up all active temporary files
    pub fn cleanup_all(&mut self) -> Result<(), String> {
        let mut errors = Vec::new();

        for file in &self.active_files {
            if file.exists() {
                if let Err(e) = fs::remove_file(file) {
                    errors.push(format!("Failed to remove {}: {}", file.display(), e));
                }
            }
        }

        self.active_files.clear();

        if !errors.is_empty() {
            return Err(format!("Cleanup errors: {}", errors.join(", ")));
        }

        Ok(())
    }

    /// Clean up orphaned temporary files from previous sessions
    pub fn cleanup_orphaned_files() -> Result<usize, String> {
        let temp_dir = std::env::temp_dir().join("clipforge_recordings");

        if !temp_dir.exists() {
            return Ok(0);
        }

        let mut cleaned = 0;
        let entries = fs::read_dir(&temp_dir)
            .map_err(|e| format!("Failed to read temp directory: {}", e))?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                // Check if file is older than 1 hour (likely orphaned)
                if let Ok(metadata) = fs::metadata(&path) {
                    if let Ok(modified) = metadata.modified() {
                        let age = std::time::SystemTime::now()
                            .duration_since(modified)
                            .unwrap_or_default();

                        if age.as_secs() > 3600 {
                            // File is older than 1 hour, remove it
                            if fs::remove_file(&path).is_ok() {
                                cleaned += 1;
                            }
                        }
                    }
                }
            }
        }

        Ok(cleaned)
    }

    /// Check available disk space
    pub fn check_disk_space(&self, required_mb: u64) -> Result<(), RecordingError> {
        // This is a simplified check - in production you'd use platform-specific APIs
        // For now, we'll just check if temp dir is writable
        let test_file = self.temp_dir.join(".diskcheck");
        match fs::write(&test_file, b"test") {
            Ok(_) => {
                let _ = fs::remove_file(test_file);
                // TODO: Implement actual disk space check using platform APIs
                Ok(())
            }
            Err(e) => {
                Err(RecordingError::IoError(format!("Cannot write to temp directory: {}", e)))
            }
        }
    }
}

impl Default for TempFileManager {
    fn default() -> Self {
        Self::new().expect("Failed to create temp file manager")
    }
}

impl Drop for TempFileManager {
    fn drop(&mut self) {
        // Clean up all temporary files when dropped
        let _ = self.cleanup_all();
    }
}

/// Wrapper for recording resources that need cleanup
pub struct RecordingResources {
    temp_file: Option<PathBuf>,
    temp_manager: Arc<Mutex<TempFileManager>>,
}

impl RecordingResources {
    pub fn new(temp_manager: Arc<Mutex<TempFileManager>>) -> Self {
        Self {
            temp_file: None,
            temp_manager,
        }
    }

    pub fn set_temp_file(&mut self, path: PathBuf) {
        self.temp_file = Some(path);
    }

    pub fn take_temp_file(&mut self) -> Option<PathBuf> {
        self.temp_file.take()
    }
}

impl Drop for RecordingResources {
    fn drop(&mut self) {
        // Clean up temp file if it still exists
        if let Some(ref path) = self.temp_file {
            if let Ok(mut manager) = self.temp_manager.lock() {
                let _ = manager.cleanup_file(path);
            }
        }
    }
}

// ============================================================================
// Device Availability and Validation
// ============================================================================

/// Device availability status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceAvailability {
    pub device_type: String,
    pub device_id: Option<String>,
    pub is_available: bool,
    pub error_message: Option<String>,
    pub fallback_available: bool,
    pub fallback_device_id: Option<String>,
}

/// Validate device availability before starting recording
#[tauri::command]
pub async fn validate_device_availability(
    device_type: String,
    device_id: Option<String>,
) -> Result<DeviceAvailability, String> {
    use crate::commands::camera_sources::{CameraEnumerator, PlatformEnumerator as CameraEnum};
    use crate::commands::screen_sources::{SourceEnumerator, PlatformEnumerator as ScreenEnum};

    match device_type.as_str() {
        "camera" => {
            let cameras = CameraEnum::enumerate_cameras()
                .map_err(|e| format!("Failed to enumerate cameras: {}", e))?;

            if cameras.is_empty() {
                return Ok(DeviceAvailability {
                    device_type: "camera".to_string(),
                    device_id: None,
                    is_available: false,
                    error_message: Some("No camera devices found".to_string()),
                    fallback_available: false,
                    fallback_device_id: None,
                });
            }

            if let Some(ref id) = device_id {
                let found = cameras.iter().find(|c| &c.id == id);
                if let Some(camera) = found {
                    Ok(DeviceAvailability {
                        device_type: "camera".to_string(),
                        device_id: Some(camera.id.clone()),
                        is_available: true,
                        error_message: None,
                        fallback_available: cameras.len() > 1,
                        fallback_device_id: cameras.iter()
                            .find(|c| c.id != *id)
                            .map(|c| c.id.clone()),
                    })
                } else {
                    // Device not found, offer fallback
                    let default_camera = cameras.iter().find(|c| c.is_default)
                        .or_else(|| cameras.first());

                    Ok(DeviceAvailability {
                        device_type: "camera".to_string(),
                        device_id: device_id.clone(),
                        is_available: false,
                        error_message: Some(format!("Camera '{}' not found or disconnected", id)),
                        fallback_available: default_camera.is_some(),
                        fallback_device_id: default_camera.map(|c| c.id.clone()),
                    })
                }
            } else {
                // No specific device requested, use default
                let default_camera = cameras.iter().find(|c| c.is_default)
                    .or_else(|| cameras.first());

                Ok(DeviceAvailability {
                    device_type: "camera".to_string(),
                    device_id: default_camera.as_ref().map(|c| c.id.clone()),
                    is_available: default_camera.is_some(),
                    error_message: if default_camera.is_none() {
                        Some("No default camera available".to_string())
                    } else {
                        None
                    },
                    fallback_available: cameras.len() > 1,
                    fallback_device_id: cameras.get(1).map(|c| c.id.clone()),
                })
            }
        }
        "screen" => {
            let screens = ScreenEnum::enumerate_screens()
                .map_err(|e| format!("Failed to enumerate screens: {}", e))?;

            if screens.is_empty() {
                return Ok(DeviceAvailability {
                    device_type: "screen".to_string(),
                    device_id: None,
                    is_available: false,
                    error_message: Some("No screen devices found".to_string()),
                    fallback_available: false,
                    fallback_device_id: None,
                });
            }

            if let Some(ref id) = device_id {
                let found = screens.iter().find(|s| &s.id == id);
                if let Some(screen) = found {
                    Ok(DeviceAvailability {
                        device_type: "screen".to_string(),
                        device_id: Some(screen.id.clone()),
                        is_available: true,
                        error_message: None,
                        fallback_available: screens.len() > 1,
                        fallback_device_id: screens.iter()
                            .find(|s| s.id != *id)
                            .map(|s| s.id.clone()),
                    })
                } else {
                    // Screen not found, offer fallback
                    let primary_screen = screens.iter().find(|s| s.is_primary)
                        .or_else(|| screens.first());

                    Ok(DeviceAvailability {
                        device_type: "screen".to_string(),
                        device_id: device_id.clone(),
                        is_available: false,
                        error_message: Some(format!("Screen '{}' not found", id)),
                        fallback_available: primary_screen.is_some(),
                        fallback_device_id: primary_screen.map(|s| s.id.clone()),
                    })
                }
            } else {
                // No specific screen requested, use primary
                let primary_screen = screens.iter().find(|s| s.is_primary)
                    .or_else(|| screens.first());

                Ok(DeviceAvailability {
                    device_type: "screen".to_string(),
                    device_id: primary_screen.as_ref().map(|s| s.id.clone()),
                    is_available: primary_screen.is_some(),
                    error_message: if primary_screen.is_none() {
                        Some("No primary screen available".to_string())
                    } else {
                        None
                    },
                    fallback_available: screens.len() > 1,
                    fallback_device_id: screens.get(1).map(|s| s.id.clone()),
                })
            }
        }
        _ => Err(format!("Unknown device type: {}", device_type)),
    }
}

// ============================================================================
// Cleanup Registry for Resource Tracking
// ============================================================================

/// Registry entry for tracking resources that need cleanup
#[derive(Debug, Clone)]
struct CleanupEntry {
    resource_type: String,
    resource_path: PathBuf,
    created_at: std::time::SystemTime,
    recording_id: Option<String>,
}

/// Comprehensive cleanup registry for tracking all recording resources
pub struct CleanupRegistry {
    entries: Vec<CleanupEntry>,
    max_age_hours: u64,
}

impl CleanupRegistry {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            max_age_hours: 24, // Default: cleanup files older than 24 hours
        }
    }

    /// Register a resource for cleanup
    pub fn register(&mut self, resource_type: String, path: PathBuf, recording_id: Option<String>) {
        self.entries.push(CleanupEntry {
            resource_type,
            resource_path: path,
            created_at: std::time::SystemTime::now(),
            recording_id,
        });
    }

    /// Remove a resource from the registry (when successfully moved/processed)
    pub fn unregister(&mut self, path: &PathBuf) {
        self.entries.retain(|e| &e.resource_path != path);
    }

    /// Clean up all registered resources
    pub fn cleanup_all(&mut self) -> Result<usize, String> {
        let mut cleaned = 0;
        let mut errors = Vec::new();

        self.entries.retain(|entry| {
            if entry.resource_path.exists() {
                match fs::remove_file(&entry.resource_path) {
                    Ok(_) => {
                        println!("[CleanupRegistry] Removed: {:?}", entry.resource_path);
                        cleaned += 1;
                        false // Remove from registry
                    }
                    Err(e) => {
                        errors.push(format!("Failed to remove {:?}: {}", entry.resource_path, e));
                        true // Keep in registry for retry
                    }
                }
            } else {
                // File doesn't exist, remove from registry
                false
            }
        });

        if !errors.is_empty() {
            eprintln!("[CleanupRegistry] Errors during cleanup: {:?}", errors);
        }

        Ok(cleaned)
    }

    /// Clean up old resources based on age
    pub fn cleanup_old(&mut self) -> Result<usize, String> {
        let now = std::time::SystemTime::now();
        let max_age = std::time::Duration::from_secs(self.max_age_hours * 3600);
        let mut cleaned = 0;

        self.entries.retain(|entry| {
            if let Ok(age) = now.duration_since(entry.created_at) {
                if age > max_age && entry.resource_path.exists() {
                    match fs::remove_file(&entry.resource_path) {
                        Ok(_) => {
                            println!("[CleanupRegistry] Removed old file: {:?}", entry.resource_path);
                            cleaned += 1;
                            return false;
                        }
                        Err(e) => {
                            eprintln!("[CleanupRegistry] Failed to remove old file {:?}: {}", entry.resource_path, e);
                        }
                    }
                }
            }
            true
        });

        Ok(cleaned)
    }

    /// Get count of tracked resources
    pub fn count(&self) -> usize {
        self.entries.len()
    }
}

impl Default for CleanupRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Long Recording Memory Management
// ============================================================================

/// Configuration for long recording sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LongRecordingConfig {
    /// Maximum recording duration in seconds before automatic stop (0 = unlimited)
    pub max_duration_seconds: u64,
    /// Enable automatic file chunking for long recordings
    pub enable_chunking: bool,
    /// Chunk duration in seconds (default: 1800 = 30 minutes)
    pub chunk_duration_seconds: u64,
    /// Maximum file size in MB before creating new chunk
    pub max_chunk_size_mb: u64,
    /// Enable memory monitoring
    pub enable_memory_monitoring: bool,
}

impl Default for LongRecordingConfig {
    fn default() -> Self {
        Self {
            max_duration_seconds: 0, // Unlimited by default
            enable_chunking: true,
            chunk_duration_seconds: 1800, // 30 minutes
            max_chunk_size_mb: 2048, // 2 GB
            enable_memory_monitoring: true,
        }
    }
}

/// Get default long recording configuration
#[tauri::command]
pub async fn get_long_recording_config() -> Result<LongRecordingConfig, String> {
    Ok(LongRecordingConfig::default())
}

/// Validate long recording configuration
#[tauri::command]
pub async fn validate_long_recording_config(
    config: LongRecordingConfig,
) -> Result<bool, String> {
    if config.chunk_duration_seconds < 60 {
        return Err("Chunk duration must be at least 60 seconds".to_string());
    }
    if config.max_chunk_size_mb < 100 {
        return Err("Max chunk size must be at least 100 MB".to_string());
    }
    if config.max_duration_seconds > 0 && config.max_duration_seconds < 60 {
        return Err("Max duration must be at least 60 seconds if set".to_string());
    }
    Ok(true)
}

// ============================================================================
// Tauri Commands (Placeholders)
// ============================================================================

/// Check the status of a specific permission
#[tauri::command]
pub async fn check_permission(
    permission_type: PermissionType,
) -> Result<PermissionResult, String> {
    // Use platform-specific implementation
    Ok(PlatformPermissions::check_permission(&permission_type))
}

/// Request a specific permission from the user
#[tauri::command]
pub async fn request_permission(
    permission_type: PermissionType,
) -> Result<PermissionResult, String> {
    // Use platform-specific implementation
    Ok(PlatformPermissions::request_permission(&permission_type))
}

/// Get the current recording state
#[tauri::command]
pub async fn get_recording_state(
    state: State<'_, RecordingManagerState>,
) -> Result<Option<RecordingState>, String> {
    let manager = state.lock().map_err(|e| e.to_string())?;
    Ok(manager.get_current_recording())
}

/// Start a new recording session
#[tauri::command]
pub async fn start_recording(
    recording_type: RecordingType,
    source_id: String,
    config: Option<RecordingConfig>,
    include_audio: bool,
    state: State<'_, RecordingManagerState>,
    app_handle: AppHandle,
) -> Result<RecordingState, String> {
    // Check if there's already an active recording
    {
        let manager = state.lock().map_err(|e| e.to_string())?;
        if let Some(current) = manager.get_current_recording() {
            if current.status == RecordingStatus::Recording {
                return Err("A recording is already in progress".to_string());
            }
        }
    }

    // Use provided config or default
    let config = config.unwrap_or_default();

    // Generate a unique ID for this recording
    let id = format!("rec_{}", chrono::Utc::now().timestamp_millis());

    // Create new recording state and start it
    let mut recording_state = RecordingState::new(id.clone(), recording_type, config.clone());
    recording_state.start();

    // Create temporary file for recording
    let temp_path = {
        let mut manager = state.lock().map_err(|e| e.to_string())?;
        let temp_manager = manager.get_temp_manager();
        let mut temp = temp_manager.lock().map_err(|e| e.to_string())?;
        temp.create_temp_file(&id)
            .map_err(|e| format!("Failed to create temp file: {}", e))?
    };

    // Create and start screen capture session
    let mut capture_session = ScreenCaptureSession::new(source_id.clone(), temp_path.clone(), config);

    // If recording a window, get window bounds and determine which screen it's on
    if source_id.starts_with("window_") {
        if let Some(window_id) = source_id.strip_prefix("window_").and_then(|s| s.parse::<u32>().ok()) {
            // Get window bounds and screens from the system
            use super::screen_sources::{SourceEnumerator, PlatformEnumerator};
            if let Ok(windows) = PlatformEnumerator::enumerate_windows() {
                if let Some(window) = windows.iter().find(|w| w.id == source_id) {
                    println!("[RecordingManager] Window position: x={}, y={}, w={}, h={}",
                        window.x, window.y, window.width, window.height);

                    // Get all screens to find which one contains the window
                    if let Ok(screens) = PlatformEnumerator::enumerate_screens() {
                        // Find which screen contains the window center point
                        let window_center_x = window.x + (window.width as i32 / 2);
                        let window_center_y = window.y + (window.height as i32 / 2);

                        println!("[RecordingManager] Window center: ({}, {})", window_center_x, window_center_y);

                        // Find the screen that contains this point
                        let mut found_screen = None;
                        for screen in &screens {
                            let screen_right = screen.x + screen.width as i32;
                            let screen_bottom = screen.y + screen.height as i32;

                            println!("[RecordingManager] Checking screen {}: x={}, y={}, w={}, h={} (bounds: {}-{}, {}-{})",
                                screen.id, screen.x, screen.y, screen.width, screen.height,
                                screen.x, screen_right, screen.y, screen_bottom);

                            if window_center_x >= screen.x && window_center_x < screen_right &&
                               window_center_y >= screen.y && window_center_y < screen_bottom {
                                println!("[RecordingManager] Window is on screen: {}", screen.id);
                                found_screen = Some(screen);
                                break;
                            }
                        }

                        if let Some(screen) = found_screen {
                            // Extract device number from screen ID (e.g., "screen_4" -> "4")
                            if let Some(device_num) = screen.id.strip_prefix("screen_") {
                                println!("[RecordingManager] Using screen device: {}", device_num);
                                capture_session.set_screen_device(device_num.to_string());

                                // Adjust crop coordinates to be relative to screen origin
                                let relative_x = window.x - screen.x;
                                let relative_y = window.y - screen.y;

                                println!("[RecordingManager] Relative crop coordinates: x={}, y={}, w={}, h={}",
                                    relative_x, relative_y, window.width, window.height);

                                capture_session.set_window_bounds(relative_x, relative_y, window.width, window.height);
                            }
                        } else {
                            println!("[RecordingManager] Warning: Could not determine which screen contains the window, using absolute coordinates");
                            capture_session.set_window_bounds(window.x, window.y, window.width, window.height);
                        }
                    }
                }
            }
        }
    }

    capture_session.start(include_audio)
        .map_err(|e| format!("Failed to start capture: {}", e))?;

    // Update recording state with file path
    recording_state.file_path = Some(temp_path.to_string_lossy().to_string());

    // Update manager state and start duration tracking
    {
        let mut manager = state.lock().map_err(|e| e.to_string())?;
        manager.capture_session = Some(capture_session);
        manager.set_current_recording(Some(recording_state.clone()));
        manager.emit_state_change(&app_handle, "recording:started");

        // Start duration tracking task
        let state_clone = state.inner().clone();
        manager.start_duration_tracking(state_clone, app_handle);
    }

    Ok(recording_state)
}

/// Stop the current recording
#[tauri::command]
pub async fn stop_recording(
    state: State<'_, RecordingManagerState>,
    app_handle: AppHandle,
) -> Result<RecordingState, String> {
    let recording_state = {
        let mut manager = state.lock().map_err(|e| e.to_string())?;

        let mut recording_state = manager
            .get_current_recording()
            .ok_or_else(|| "No active recording".to_string())?;

        // Stop the capture session
        if let Some(mut capture_session) = manager.capture_session.take() {
            let output_path = capture_session.stop()
                .map_err(|e| format!("Failed to stop capture: {}", e))?;
            recording_state.file_path = Some(output_path.to_string_lossy().to_string());
        }

        recording_state.stop();

        // Stop duration tracking
        manager.stop_duration_tracking();
        manager.set_current_recording(None);
        manager.emit_state_change(&app_handle, "recording:stopped");

        recording_state
    };

    Ok(recording_state)
}

/// Pause the current recording
#[tauri::command]
pub async fn pause_recording(
    state: State<'_, RecordingManagerState>,
    app_handle: AppHandle,
) -> Result<RecordingState, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;

    let mut recording_state = manager
        .get_current_recording()
        .ok_or_else(|| "No active recording".to_string())?;

    if recording_state.status != RecordingStatus::Recording {
        return Err("Recording is not active".to_string());
    }

    // TODO: Actually pause the recording process

    recording_state.pause();
    manager.set_current_recording(Some(recording_state.clone()));
    manager.emit_state_change(&app_handle, "recording:paused");

    Ok(recording_state)
}

/// Resume a paused recording
#[tauri::command]
pub async fn resume_recording(
    state: State<'_, RecordingManagerState>,
    app_handle: AppHandle,
) -> Result<RecordingState, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;

    let mut recording_state = manager
        .get_current_recording()
        .ok_or_else(|| "No active recording".to_string())?;

    if recording_state.status != RecordingStatus::Paused {
        return Err("Recording is not paused".to_string());
    }

    // TODO: Actually resume the recording process

    recording_state.resume();
    manager.set_current_recording(Some(recording_state.clone()));
    manager.emit_state_change(&app_handle, "recording:resumed");

    Ok(recording_state)
}

/// Validate a recording configuration
#[tauri::command]
pub async fn validate_config(config: RecordingConfig) -> Result<bool, String> {
    config.validate()?;
    Ok(true)
}

/// Get a configuration from a quality preset
#[tauri::command]
pub async fn get_preset_config(preset: QualityPreset) -> Result<RecordingConfig, String> {
    Ok(preset.to_config())
}

/// List all available quality presets
#[tauri::command]
pub async fn list_quality_presets() -> Result<Vec<String>, String> {
    Ok(vec![
        "low".to_string(),
        "medium".to_string(),
        "high".to_string(),
        "custom".to_string(),
    ])
}

/// Get supported codecs for a given output format
#[tauri::command]
pub async fn get_supported_codecs(format: String) -> Result<SupportedCodecs, String> {
    let (video_codecs, audio_codecs) = match format.as_str() {
        "mp4" => (
            vec!["h264".to_string(), "h265".to_string(), "hevc".to_string()],
            vec!["aac".to_string(), "mp3".to_string()],
        ),
        "webm" => (
            vec!["vp8".to_string(), "vp9".to_string(), "av1".to_string()],
            vec!["vorbis".to_string(), "opus".to_string()],
        ),
        "mkv" => (
            vec!["h264".to_string(), "h265".to_string(), "vp8".to_string(), "vp9".to_string()],
            vec!["aac".to_string(), "opus".to_string(), "vorbis".to_string(), "mp3".to_string()],
        ),
        "mov" => (
            vec!["h264".to_string(), "h265".to_string(), "hevc".to_string(), "prores".to_string()],
            vec!["aac".to_string()],
        ),
        _ => return Err(format!("Unsupported format: {}", format)),
    };

    Ok(SupportedCodecs {
        video_codecs,
        audio_codecs,
    })
}

/// Supported codecs for a format
#[derive(Debug, Serialize, Deserialize)]
pub struct SupportedCodecs {
    pub video_codecs: Vec<String>,
    pub audio_codecs: Vec<String>,
}

// ============================================================================
// Cleanup and Recovery Commands
// ============================================================================

/// Clean up orphaned temporary files from previous sessions
#[tauri::command]
pub async fn cleanup_orphaned_files() -> Result<usize, String> {
    TempFileManager::cleanup_orphaned_files()
}

/// Clean up all temporary files for current session
#[tauri::command]
pub async fn cleanup_temp_files(state: State<'_, RecordingManagerState>) -> Result<(), String> {
    let manager = state.lock().map_err(|e| e.to_string())?;
    let temp_manager = manager.get_temp_manager();
    let mut temp_mgr = temp_manager.lock().map_err(|e| e.to_string())?;
    temp_mgr.cleanup_all()
}

/// Check available disk space before recording
#[tauri::command]
pub async fn check_disk_space(
    required_mb: u64,
    state: State<'_, RecordingManagerState>,
) -> Result<bool, String> {
    let manager = state.lock().map_err(|e| e.to_string())?;
    let temp_manager = manager.get_temp_manager();
    let temp_mgr = temp_manager.lock().map_err(|e| e.to_string())?;

    match temp_mgr.check_disk_space(required_mb) {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

/// Get error details with recovery suggestions
#[tauri::command]
pub async fn get_error_details(error_type: String) -> Result<ErrorDetails, String> {
    // This is a helper command for the frontend to get error details
    let error = match error_type.as_str() {
        "permission_denied" => RecordingError::PermissionDenied("resource".to_string()),
        "disk_space_low" => RecordingError::DiskSpaceLow {
            available: 100_000_000,
            required: 500_000_000,
        },
        "hardware_unavailable" => RecordingError::HardwareUnavailable("device".to_string()),
        _ => RecordingError::Unknown("Unknown error".to_string()),
    };

    Ok(ErrorDetails {
        message: error.user_message(),
        suggestion: error.recovery_suggestion(),
    })
}

/// Error details with recovery suggestions
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorDetails {
    pub message: String,
    pub suggestion: Option<String>,
}

/// Disk space information
#[derive(Debug, Serialize, Deserialize)]
pub struct DiskSpaceInfo {
    pub available_bytes: u64,
    pub total_bytes: u64,
    pub available_mb: u64,
    pub total_mb: u64,
    pub percent_free: f64,
    pub has_sufficient_space: bool,
    pub estimated_recording_minutes: f64,
    pub warning_level: String, // "ok", "low", "critical"
}

impl DiskSpaceInfo {
    /// Estimate recording time based on bitrate and available space
    pub fn estimate_recording_time(available_mb: u64, video_bitrate_kbps: u32, audio_bitrate_kbps: u32) -> f64 {
        let total_bitrate_kbps = video_bitrate_kbps + audio_bitrate_kbps;
        let total_bitrate_mbps = total_bitrate_kbps as f64 / 8.0 / 1024.0; // Convert to MB/s
        if total_bitrate_mbps == 0.0 {
            return 0.0;
        }
        (available_mb as f64 / total_bitrate_mbps) / 60.0 // Return minutes
    }

    /// Determine warning level based on available space
    pub fn get_warning_level(available_mb: u64) -> String {
        if available_mb < 500 {
            "critical".to_string()
        } else if available_mb < 2000 {
            "low".to_string()
        } else {
            "ok".to_string()
        }
    }
}

/// Get detailed disk space information
#[tauri::command]
pub async fn get_disk_space_info(
    video_bitrate_kbps: Option<u32>,
    audio_bitrate_kbps: Option<u32>,
) -> Result<DiskSpaceInfo, String> {
    // Get the temp directory path
    let temp_dir = std::env::temp_dir();

    // Use platform-specific disk space check
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        use std::mem;
        use std::os::raw::{c_char, c_int};

        #[repr(C)]
        struct StatFs {
            f_bsize: u32,
            f_iosize: i32,
            f_blocks: u64,
            f_bfree: u64,
            f_bavail: u64,
            f_files: u64,
            f_ffree: u64,
            f_fsid: [i32; 2],
            f_owner: u32,
            f_type: u32,
            f_flags: u32,
            f_fssubtype: u32,
            f_fstypename: [c_char; 16],
            f_mntonname: [c_char; 1024],
            f_mntfromname: [c_char; 1024],
            f_reserved: [u32; 8],
        }

        extern "C" {
            fn statfs(path: *const c_char, buf: *mut StatFs) -> c_int;
        }

        let path_str = temp_dir.to_str().ok_or("Invalid path")?;
        let c_path = CString::new(path_str).map_err(|e| e.to_string())?;

        unsafe {
            let mut stat: StatFs = mem::zeroed();
            if statfs(c_path.as_ptr(), &mut stat) == 0 {
                let available_bytes = stat.f_bavail * stat.f_bsize as u64;
                let total_bytes = stat.f_blocks * stat.f_bsize as u64;
                let available_mb = available_bytes / 1_048_576;
                let total_mb = total_bytes / 1_048_576;
                let percent_free = (available_bytes as f64 / total_bytes as f64) * 100.0;

                let video_br = video_bitrate_kbps.unwrap_or(5000);
                let audio_br = audio_bitrate_kbps.unwrap_or(128);
                let estimated_minutes = DiskSpaceInfo::estimate_recording_time(available_mb, video_br, audio_br);
                let warning_level = DiskSpaceInfo::get_warning_level(available_mb);

                Ok(DiskSpaceInfo {
                    available_bytes,
                    total_bytes,
                    available_mb,
                    total_mb,
                    percent_free,
                    has_sufficient_space: available_mb > 1000, // At least 1GB
                    estimated_recording_minutes: estimated_minutes,
                    warning_level,
                })
            } else {
                Err("Failed to get disk space information".to_string())
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Fallback for other platforms - return placeholder data
        // TODO: Implement Windows and Linux disk space checks
        Ok(DiskSpaceInfo {
            available_bytes: 10_000_000_000,
            total_bytes: 100_000_000_000,
            available_mb: 10_000,
            total_mb: 100_000,
            percent_free: 10.0,
            has_sufficient_space: true,
            estimated_recording_minutes: 300.0,
            warning_level: "ok".to_string(),
        })
    }
}

/// Save PiP recording metadata to JSON file
#[tauri::command]
pub async fn save_pip_metadata(
    metadata: String,
    state: State<'_, RecordingManagerState>,
) -> Result<String, String> {
    use std::fs;
    use std::io::Write;

    let manager = state.lock().map_err(|e| e.to_string())?;
    let temp_manager = manager.get_temp_manager();
    let temp_mgr = temp_manager.lock().map_err(|e| e.to_string())?;

    // Create unique filename with timestamp
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let filename = format!("pip_metadata_{}.json", timestamp);

    // Get temp directory path
    let file_path = temp_mgr.temp_dir.join(&filename);

    // Write metadata to file
    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create metadata file: {}", e))?;

    file.write_all(metadata.as_bytes())
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    file.flush()
        .map_err(|e| format!("Failed to flush metadata file: {}", e))?;

    println!("[RecordingManager] Saved PiP metadata to: {}", file_path.display());

    // Return absolute file path
    file_path
        .to_str()
        .ok_or_else(|| "Failed to convert path to string".to_string())
        .map(|s| s.to_string())
}

/// Save webcam recording from blob data
#[tauri::command]
pub async fn save_webcam_recording(
    data: Vec<u8>,
    mime_type: String,
    duration: f64,
    state: State<'_, RecordingManagerState>,
) -> Result<String, String> {
    use std::fs;
    use std::io::Write;
    use std::process::Command;

    let manager = state.lock().map_err(|e| e.to_string())?;
    let temp_manager = manager.get_temp_manager();
    let mut temp_mgr = temp_manager.lock().map_err(|e| e.to_string())?;

    // Determine file extension from MIME type
    let extension = if mime_type.contains("webm") {
        "webm"
    } else if mime_type.contains("mp4") {
        "mp4"
    } else {
        "webm" // Default to webm
    };

    // Create unique filename with timestamp
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let temp_filename = format!("webcam_recording_{}_temp.{}", timestamp, extension);
    let final_filename = format!("webcam_recording_{}.{}", timestamp, extension);

    // Get temp directory path (direct field access)
    let temp_file_path = temp_mgr.temp_dir.join(&temp_filename);
    let final_file_path = temp_mgr.temp_dir.join(&final_filename);

    // Write blob data to temporary file
    let mut file = fs::File::create(&temp_file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    file.write_all(&data)
        .map_err(|e| format!("Failed to write data: {}", e))?;

    file.flush()
        .map_err(|e| format!("Failed to flush file: {}", e))?;

    drop(file); // Close file before ffmpeg processes it

    // Remux with FFmpeg to embed duration metadata
    // This ensures the file has proper duration information
    let ffmpeg_path = super::ffmpeg_utils::find_ffmpeg()
        .ok_or_else(|| "FFmpeg not found".to_string())?;

    let ffmpeg_output = Command::new(&ffmpeg_path)
        .arg("-i")
        .arg(&temp_file_path)
        .arg("-c")
        .arg("copy") // Copy streams without re-encoding
        .arg("-t")
        .arg(duration.to_string()) // Set duration
        .arg("-y") // Overwrite output file
        .arg(&final_file_path)
        .output()
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    if !ffmpeg_output.status.success() {
        let stderr = String::from_utf8_lossy(&ffmpeg_output.stderr);
        println!("FFmpeg stderr: {}", stderr);
        // If FFmpeg fails, use the original file anyway
        fs::rename(&temp_file_path, &final_file_path)
            .map_err(|e| format!("Failed to rename temp file: {}", e))?;
    } else {
        // Remove temporary file
        let _ = fs::remove_file(&temp_file_path);
    }

    // Track final file in the temp manager
    temp_mgr.active_files.push(final_file_path.clone());

    // Return absolute file path
    final_file_path
        .to_str()
        .ok_or_else(|| "Failed to convert path to string".to_string())
        .map(|s| s.to_string())
}
