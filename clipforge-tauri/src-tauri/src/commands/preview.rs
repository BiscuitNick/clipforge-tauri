// Preview frame streaming module for Tauri event system
//
// This module handles streaming JPEG-compressed frames from the capture
// pipeline to the frontend via Tauri's event system

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// ============================================================================
// Event Payload Structures
// ============================================================================

/// Preview frame event payload sent to frontend
///
/// Contains JPEG-compressed frame data and metadata for display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrame {
    /// Base64-encoded JPEG image data
    pub image_data: String,

    /// Frame width in pixels
    pub width: usize,

    /// Frame height in pixels
    pub height: usize,

    /// Presentation timestamp in seconds
    pub timestamp: f64,

    /// Frame number for tracking
    pub frame_number: u64,

    /// Size of JPEG data in bytes (before base64 encoding)
    pub jpeg_size: usize,
}

/// Performance metrics for preview streaming
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMetrics {
    /// Current frames per second
    pub current_fps: f32,

    /// Total frames processed
    pub total_frames: u64,

    /// Total frames dropped due to backpressure
    pub dropped_frames: u64,

    /// Current queue size
    pub queue_size: usize,

    /// Average frame size in bytes
    pub avg_frame_size: usize,
}

/// Preview settings that can be adjusted at runtime
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSettings {
    /// JPEG quality (0.3 to 0.8, representing 30% to 80%)
    pub jpeg_quality: f32,

    /// Target preview frame rate (e.g., 15 fps)
    pub target_fps: u32,

    /// Enable/disable backpressure handling
    pub enable_backpressure: bool,
}

impl Default for PreviewSettings {
    fn default() -> Self {
        Self {
            jpeg_quality: 0.5,  // 50% quality
            target_fps: 15,     // 15 fps preview
            enable_backpressure: true,
        }
    }
}

// ============================================================================
// Preview State Management
// ============================================================================

/// Global preview state
pub struct PreviewState {
    /// Whether preview is currently active
    pub is_active: bool,

    /// Current settings
    pub settings: PreviewSettings,

    /// Performance metrics
    pub metrics: PreviewMetrics,

    /// Last frame emission time for FPS calculation
    pub last_emit_time: Option<Instant>,

    /// Frame emission interval based on target FPS
    pub emit_interval: Duration,
}

impl PreviewState {
    pub fn new() -> Self {
        let settings = PreviewSettings::default();
        let emit_interval = Duration::from_millis(1000 / settings.target_fps as u64);

        Self {
            is_active: false,
            settings,
            metrics: PreviewMetrics {
                current_fps: 0.0,
                total_frames: 0,
                dropped_frames: 0,
                queue_size: 0,
                avg_frame_size: 0,
            },
            last_emit_time: None,
            emit_interval,
        }
    }

    /// Updates the target FPS and recalculates emit interval
    pub fn update_target_fps(&mut self, fps: u32) {
        self.settings.target_fps = fps;
        self.emit_interval = Duration::from_millis(1000 / fps as u64);
    }

    /// Checks if enough time has passed to emit the next frame
    pub fn should_emit_frame(&self) -> bool {
        if let Some(last_time) = self.last_emit_time {
            last_time.elapsed() >= self.emit_interval
        } else {
            true // First frame, always emit
        }
    }

    /// Records a frame emission and updates metrics
    pub fn record_frame_emission(&mut self, frame_size: usize) {
        let now = Instant::now();

        // Calculate FPS based on time since last frame
        if let Some(last_time) = self.last_emit_time {
            let elapsed = now.duration_since(last_time).as_secs_f32();
            if elapsed > 0.0 {
                self.metrics.current_fps = 1.0 / elapsed;
            }
        }

        self.last_emit_time = Some(now);
        self.metrics.total_frames += 1;

        // Update average frame size (running average)
        if self.metrics.avg_frame_size == 0 {
            self.metrics.avg_frame_size = frame_size;
        } else {
            self.metrics.avg_frame_size =
                (self.metrics.avg_frame_size * 9 + frame_size) / 10;
        }
    }

    /// Records a dropped frame
    pub fn record_dropped_frame(&mut self) {
        self.metrics.dropped_frames += 1;
    }
}

impl Default for PreviewState {
    fn default() -> Self {
        Self::new()
    }
}

// Type alias for shared preview state
pub type SharedPreviewState = Arc<Mutex<PreviewState>>;

// ============================================================================
// Event Emission Functions
// ============================================================================

/// Emits a preview frame event to the frontend
///
/// # Parameters
/// - `app_handle`: Tauri application handle
/// - `frame`: Preview frame to emit
///
/// # Returns
/// - `Ok(())` if emission succeeded
/// - `Err(String)` if emission failed
pub fn emit_preview_frame(
    app_handle: &AppHandle,
    frame: PreviewFrame,
) -> Result<(), String> {
    app_handle
        .emit("preview-frame", frame)
        .map_err(|e| format!("Failed to emit preview frame: {}", e))
}

/// Emits preview metrics to the frontend
///
/// # Parameters
/// - `app_handle`: Tauri application handle
/// - `metrics`: Performance metrics to emit
///
/// # Returns
/// - `Ok(())` if emission succeeded
/// - `Err(String)` if emission failed
pub fn emit_preview_metrics(
    app_handle: &AppHandle,
    metrics: PreviewMetrics,
) -> Result<(), String> {
    app_handle
        .emit("preview-metrics", metrics)
        .map_err(|e| format!("Failed to emit preview metrics: {}", e))
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Starts preview frame streaming
#[tauri::command]
pub async fn start_preview(
    app_handle: AppHandle,
    state: tauri::State<'_, SharedPreviewState>,
) -> Result<(), String> {
    let mut preview_state = state.lock()
        .map_err(|e| format!("Failed to lock preview state: {}", e))?;

    if preview_state.is_active {
        return Err("Preview is already active".to_string());
    }

    preview_state.is_active = true;
    preview_state.last_emit_time = None;
    preview_state.metrics = PreviewMetrics {
        current_fps: 0.0,
        total_frames: 0,
        dropped_frames: 0,
        queue_size: 0,
        avg_frame_size: 0,
    };

    println!("[Preview] Started preview streaming");

    // Emit initial status
    app_handle.emit("preview-started", ())
        .map_err(|e| format!("Failed to emit preview-started event: {}", e))?;

    Ok(())
}

/// Stops preview frame streaming
#[tauri::command]
pub async fn stop_preview(
    app_handle: AppHandle,
    state: tauri::State<'_, SharedPreviewState>,
) -> Result<(), String> {
    let mut preview_state = state.lock()
        .map_err(|e| format!("Failed to lock preview state: {}", e))?;

    if !preview_state.is_active {
        return Err("Preview is not active".to_string());
    }

    preview_state.is_active = false;

    println!("[Preview] Stopped preview streaming - Total frames: {}, Dropped: {}",
        preview_state.metrics.total_frames,
        preview_state.metrics.dropped_frames
    );

    // Emit final metrics
    let final_metrics = preview_state.metrics.clone();
    app_handle.emit("preview-stopped", final_metrics)
        .map_err(|e| format!("Failed to emit preview-stopped event: {}", e))?;

    Ok(())
}

/// Updates preview settings
#[tauri::command]
pub async fn update_preview_settings(
    state: tauri::State<'_, SharedPreviewState>,
    settings: PreviewSettings,
) -> Result<(), String> {
    let mut preview_state = state.lock()
        .map_err(|e| format!("Failed to lock preview state: {}", e))?;

    // Update FPS and recalculate interval
    preview_state.update_target_fps(settings.target_fps);
    preview_state.settings.jpeg_quality = settings.jpeg_quality;
    preview_state.settings.enable_backpressure = settings.enable_backpressure;

    println!("[Preview] Updated settings - FPS: {}, Quality: {}, Backpressure: {}",
        settings.target_fps,
        settings.jpeg_quality,
        settings.enable_backpressure
    );

    Ok(())
}

/// Gets current preview metrics
#[tauri::command]
pub async fn get_preview_metrics(
    state: tauri::State<'_, SharedPreviewState>,
) -> Result<PreviewMetrics, String> {
    let preview_state = state.lock()
        .map_err(|e| format!("Failed to lock preview state: {}", e))?;

    Ok(preview_state.metrics.clone())
}

/// Gets current preview settings
#[tauri::command]
pub async fn get_preview_settings(
    state: tauri::State<'_, SharedPreviewState>,
) -> Result<PreviewSettings, String> {
    let preview_state = state.lock()
        .map_err(|e| format!("Failed to lock preview state: {}", e))?;

    Ok(preview_state.settings.clone())
}

// ============================================================================
// Preview Capture Integration
// ============================================================================

use crate::capture::ffi::ScreenCaptureBridge;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::task::JoinHandle;

/// Preview capture session state
pub struct PreviewCaptureSession {
    /// ScreenCaptureKit bridge instance
    pub bridge: Option<ScreenCaptureBridge>,
    /// Background frame polling task handle
    pub polling_task: Option<JoinHandle<()>>,
    /// Flag to signal task shutdown
    pub should_stop: Arc<AtomicBool>,
}

impl PreviewCaptureSession {
    pub fn new() -> Self {
        Self {
            bridge: None,
            polling_task: None,
            should_stop: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn stop(&mut self) {
        // Signal the task to stop
        self.should_stop.store(true, Ordering::SeqCst);

        // Stop capture if bridge exists
        if let Some(bridge) = &self.bridge {
            bridge.stop_capture();
            bridge.clear_jpeg_frames();
        }

        // Abort the polling task
        if let Some(task) = self.polling_task.take() {
            task.abort();
        }

        self.bridge = None;
    }
}

impl Drop for PreviewCaptureSession {
    fn drop(&mut self) {
        self.stop();
    }
}

pub type SharedPreviewCaptureSession = Arc<Mutex<PreviewCaptureSession>>;

/// Starts preview for a selected source
#[tauri::command]
pub async fn start_preview_for_source(
    source_id: String,
    width: u32,
    height: u32,
    frame_rate: u32,
    app_handle: AppHandle,
    preview_state: tauri::State<'_, SharedPreviewState>,
    capture_session: tauri::State<'_, SharedPreviewCaptureSession>,
) -> Result<(), String> {
    println!("[PreviewCapture] Starting preview for source: {} ({}x{} @ {}fps)",
        source_id, width, height, frame_rate);

    // Stop any existing preview session
    {
        let mut session = capture_session.lock()
            .map_err(|e| format!("Failed to lock capture session: {}", e))?;
        session.stop();
    }

    // Create new ScreenCaptureBridge
    let bridge = ScreenCaptureBridge::new()
        .ok_or_else(|| "Failed to create ScreenCaptureBridge (not available on this system)".to_string())?;

    // Configure stream settings (15fps for preview, full resolution)
    bridge.configure_stream(width, height, frame_rate, false);

    // Configure source filter (display or window)
    if source_id.starts_with("display_") {
        // Extract display ID from "display_X" format
        let display_id = source_id.strip_prefix("display_")
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| format!("Invalid display ID format: {}", source_id))?;

        bridge.configure_display(display_id)?;
    } else if source_id.starts_with("window_") {
        // Extract window ID from "window_X" format
        let window_id = source_id.strip_prefix("window_")
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| format!("Invalid window ID format: {}", source_id))?;

        bridge.configure_window(window_id)?;
    } else {
        return Err(format!("Invalid source ID format: {}", source_id));
    }

    // Start capture
    bridge.start_capture()?;

    println!("[PreviewCapture] Capture started successfully");

    // Update preview state
    {
        let mut state = preview_state.lock()
            .map_err(|e| format!("Failed to lock preview state: {}", e))?;
        state.is_active = true;
        state.last_emit_time = None;
        state.metrics = PreviewMetrics {
            current_fps: 0.0,
            total_frames: 0,
            dropped_frames: 0,
            queue_size: 0,
            avg_frame_size: 0,
        };
    }

    // Emit preview-started event
    app_handle.emit("preview-started", ())
        .map_err(|e| format!("Failed to emit preview-started event: {}", e))?;

    // Create shutdown flag
    let should_stop = Arc::new(AtomicBool::new(false));
    let should_stop_clone = Arc::clone(&should_stop);

    // Store the bridge in session state first
    {
        let mut session = capture_session.lock()
            .map_err(|e| format!("Failed to lock capture session: {}", e))?;
        session.bridge = Some(bridge);
        session.should_stop = should_stop;
    }

    // Clone app_handle and state for the background task
    let app_handle_clone = app_handle.clone();
    let preview_state_clone = preview_state.inner().clone();
    let capture_session_clone = capture_session.inner().clone();

    // Spawn background task to poll frames from Swift queue
    let polling_task = tokio::spawn(async move {
        println!("[PreviewCapture] Frame polling task started");

        let mut frame_count = 0u64;
        let mut last_metrics_emit = std::time::Instant::now();

        while !should_stop_clone.load(Ordering::SeqCst) {
            // Access bridge through the session mutex
            let frame_opt = {
                let session = capture_session_clone.lock().unwrap();
                if let Some(bridge) = &session.bridge {
                    bridge.dequeue_jpeg_frame()
                } else {
                    None
                }
            };

            // Process frame if available
            if let Some(frame) = frame_opt {
                // Convert JPEG data to base64
                let base64_data = base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    &frame.jpeg_data
                );

                // Create preview frame event
                let preview_frame = PreviewFrame {
                    image_data: base64_data,
                    width: frame.width,
                    height: frame.height,
                    timestamp: frame.timestamp,
                    frame_number: frame.frame_number,
                    jpeg_size: frame.jpeg_data.len(),
                };

                // Check if we should emit this frame (throttle to target FPS)
                let (should_emit, queue_size) = {
                    let session = capture_session_clone.lock().unwrap();
                    let queue_size = if let Some(bridge) = &session.bridge {
                        bridge.jpeg_frame_count()
                    } else {
                        0
                    };

                    let mut state = preview_state_clone.lock().unwrap();
                    state.metrics.queue_size = queue_size;
                    (state.should_emit_frame(), queue_size)
                };

                if should_emit {
                    // Emit frame to frontend
                    if let Err(e) = emit_preview_frame(&app_handle_clone, preview_frame.clone()) {
                        eprintln!("[PreviewCapture] Failed to emit frame: {}", e);
                    }

                    // Update metrics
                    let mut state = preview_state_clone.lock().unwrap();
                    state.record_frame_emission(frame.jpeg_data.len());
                    frame_count += 1;

                    // Emit metrics every second
                    if last_metrics_emit.elapsed().as_secs() >= 1 {
                        let metrics = state.metrics.clone();
                        if let Err(e) = emit_preview_metrics(&app_handle_clone, metrics) {
                            eprintln!("[PreviewCapture] Failed to emit metrics: {}", e);
                        }
                        last_metrics_emit = std::time::Instant::now();
                    }
                } else {
                    // Frame was throttled
                    let mut state = preview_state_clone.lock().unwrap();
                    state.record_dropped_frame();
                }
            } else {
                // No frame available, sleep briefly
                tokio::time::sleep(tokio::time::Duration::from_millis(5)).await;
            }
        }

        println!("[PreviewCapture] Frame polling task stopped (emitted {} frames)", frame_count);
    });

    // Store the polling task in session state
    {
        let mut session = capture_session.lock()
            .map_err(|e| format!("Failed to lock capture session: {}", e))?;
        session.polling_task = Some(polling_task);
    }

    println!("[PreviewCapture] Preview session initialized successfully");
    Ok(())
}

/// Stops the preview capture session
#[tauri::command]
pub async fn stop_preview_for_source(
    app_handle: AppHandle,
    preview_state: tauri::State<'_, SharedPreviewState>,
    capture_session: tauri::State<'_, SharedPreviewCaptureSession>,
) -> Result<(), String> {
    println!("[PreviewCapture] Stopping preview");

    // Stop the capture session
    {
        let mut session = capture_session.lock()
            .map_err(|e| format!("Failed to lock capture session: {}", e))?;
        session.stop();
    }

    // Update preview state
    {
        let mut state = preview_state.lock()
            .map_err(|e| format!("Failed to lock preview state: {}", e))?;

        if !state.is_active {
            return Err("Preview is not active".to_string());
        }

        state.is_active = false;

        println!("[PreviewCapture] Preview stopped - Total frames: {}, Dropped: {}",
            state.metrics.total_frames,
            state.metrics.dropped_frames
        );

        // Emit final metrics
        let final_metrics = state.metrics.clone();
        app_handle.emit("preview-stopped", final_metrics)
            .map_err(|e| format!("Failed to emit preview-stopped event: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preview_state_creation() {
        let state = PreviewState::new();
        assert!(!state.is_active);
        assert_eq!(state.settings.target_fps, 15);
        assert_eq!(state.metrics.total_frames, 0);
    }

    #[test]
    fn test_fps_update() {
        let mut state = PreviewState::new();
        state.update_target_fps(30);
        assert_eq!(state.settings.target_fps, 30);
        assert_eq!(state.emit_interval, Duration::from_millis(33));
    }

    #[test]
    fn test_should_emit_frame() {
        let mut state = PreviewState::new();

        // First frame should always emit
        assert!(state.should_emit_frame());

        // After recording emission, should not emit immediately
        state.record_frame_emission(1000);
        assert!(!state.should_emit_frame());

        // After waiting for interval, should emit
        std::thread::sleep(state.emit_interval + Duration::from_millis(10));
        assert!(state.should_emit_frame());
    }

    #[test]
    fn test_metrics_tracking() {
        let mut state = PreviewState::new();

        state.record_frame_emission(1000);
        assert_eq!(state.metrics.total_frames, 1);
        assert_eq!(state.metrics.avg_frame_size, 1000);

        state.record_dropped_frame();
        assert_eq!(state.metrics.dropped_frames, 1);
    }
}
