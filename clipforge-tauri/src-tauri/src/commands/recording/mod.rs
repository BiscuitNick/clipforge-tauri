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
