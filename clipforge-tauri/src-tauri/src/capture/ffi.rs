// FFI bridge to Swift ScreenCaptureKit implementation
//
// This module provides safe Rust wrappers around the Swift ScreenCaptureKit
// bridge, handling FFI safety, memory management, and type conversions

use std::collections::VecDeque;
use std::ffi::c_void;
use std::sync::{Arc, Mutex};

// ============================================================================
// FFI Type Definitions
// ============================================================================

/// Opaque pointer to Swift bridge instance
#[repr(transparent)]
#[derive(Debug)]
pub struct SwiftBridgePtr(*mut c_void);

unsafe impl Send for SwiftBridgePtr {}
unsafe impl Sync for SwiftBridgePtr {}

/// Frame data structure for passing between Swift and Rust
#[derive(Debug, Clone)]
pub struct Frame {
    /// Frame width in pixels
    pub width: usize,
    /// Frame height in pixels
    pub height: usize,
    /// Pixel data (BGRA format)
    pub data: Vec<u8>,
    /// Presentation timestamp in seconds
    pub timestamp: f64,
    /// Pixel format FourCC code
    pub pixel_format: u32,
}

/// Thread-safe frame queue for buffering captured frames
pub type FrameQueue = Arc<Mutex<VecDeque<Frame>>>;

// ============================================================================
// External C Function Declarations (from Swift)
// ============================================================================

extern "C" {
    /// Creates a new ScreenCaptureKit bridge instance
    /// Returns null pointer on failure
    fn screen_capture_bridge_create() -> *mut c_void;

    /// Destroys a ScreenCaptureKit bridge instance
    /// Handles null pointers gracefully
    fn screen_capture_bridge_destroy(bridge: *mut c_void);

    /// Starts capture on a bridge instance
    /// Returns 1 on success, 0 on failure
    fn screen_capture_bridge_start(bridge: *mut c_void) -> i32;

    /// Stops capture on a bridge instance
    fn screen_capture_bridge_stop(bridge: *mut c_void);

    /// Pauses capture on a bridge instance
    fn screen_capture_bridge_pause(bridge: *mut c_void);

    /// Checks if ScreenCaptureKit is available on this system
    /// Returns 1 if available, 0 otherwise
    fn screen_capture_is_available() -> i32;
}

// ============================================================================
// Safe Rust API
// ============================================================================

/// High-level Rust wrapper for ScreenCaptureKit bridge
///
/// Provides a safe, ergonomic API for screen capture while managing
/// the underlying Swift bridge lifecycle and FFI complexity
pub struct ScreenCaptureBridge {
    /// Pointer to the Swift bridge instance
    bridge_ptr: SwiftBridgePtr,
    /// Thread-safe queue for captured frames
    frame_queue: FrameQueue,
}

impl ScreenCaptureBridge {
    /// Creates a new ScreenCaptureKit bridge instance
    ///
    /// # Returns
    /// - `Some(ScreenCaptureBridge)` on success
    /// - `None` if ScreenCaptureKit is unavailable or initialization fails
    ///
    /// # Platform Support
    /// - macOS 12.3+: Fully supported
    /// - Earlier versions: Returns None
    pub fn new() -> Option<Self> {
        // Check if ScreenCaptureKit is available
        if !Self::is_available() {
            eprintln!("[ScreenCapture FFI] ScreenCaptureKit is not available on this system");
            return None;
        }

        // Create Swift bridge instance
        let bridge_ptr = unsafe { screen_capture_bridge_create() };

        if bridge_ptr.is_null() {
            eprintln!("[ScreenCapture FFI] Failed to create Swift bridge instance");
            return None;
        }

        println!("[ScreenCapture FFI] Bridge created successfully");

        Some(Self {
            bridge_ptr: SwiftBridgePtr(bridge_ptr),
            frame_queue: Arc::new(Mutex::new(VecDeque::with_capacity(60))), // 2 seconds at 30fps
        })
    }

    /// Checks if ScreenCaptureKit is available on the current system
    ///
    /// # Returns
    /// `true` if ScreenCaptureKit is available (macOS 12.3+), `false` otherwise
    pub fn is_available() -> bool {
        unsafe { screen_capture_is_available() == 1 }
    }

    /// Starts screen capture
    ///
    /// # Returns
    /// - `Ok(())` if capture started successfully
    /// - `Err(String)` with error message if start failed
    ///
    /// # Notes
    /// - Requires stream configuration and content filter to be set first
    /// - Will stop existing capture if already running
    pub fn start_capture(&self) -> Result<(), String> {
        let result = unsafe { screen_capture_bridge_start(self.bridge_ptr.0) };

        if result == 1 {
            println!("[ScreenCapture FFI] Capture started successfully");
            Ok(())
        } else {
            let error_msg = "Failed to start capture - check configuration and permissions".to_string();
            eprintln!("[ScreenCapture FFI] {}", error_msg);
            Err(error_msg)
        }
    }

    /// Stops screen capture
    ///
    /// Safe to call even if capture is not running
    pub fn stop_capture(&self) {
        unsafe { screen_capture_bridge_stop(self.bridge_ptr.0) };
        println!("[ScreenCapture FFI] Capture stopped");
    }

    /// Pauses screen capture
    ///
    /// Note: Current implementation stops the stream. True pause/resume
    /// will be implemented in a future task.
    pub fn pause_capture(&self) {
        unsafe { screen_capture_bridge_pause(self.bridge_ptr.0) };
        println!("[ScreenCapture FFI] Capture paused");
    }

    /// Gets reference to the frame queue
    ///
    /// Allows consumers to read captured frames from the queue
    ///
    /// # Returns
    /// Arc reference to the thread-safe frame queue
    pub fn frame_queue(&self) -> &FrameQueue {
        &self.frame_queue
    }

    /// Gets a clone of the frame queue Arc
    ///
    /// Useful for passing to other threads or async tasks
    pub fn frame_queue_clone(&self) -> FrameQueue {
        Arc::clone(&self.frame_queue)
    }

    /// Pops the next available frame from the queue
    ///
    /// # Returns
    /// - `Some(Frame)` if a frame is available
    /// - `None` if the queue is empty
    pub fn pop_frame(&self) -> Option<Frame> {
        self.frame_queue.lock().ok()?.pop_front()
    }

    /// Gets the current number of frames in the queue
    pub fn frame_count(&self) -> usize {
        self.frame_queue.lock().map(|q| q.len()).unwrap_or(0)
    }

    /// Clears all frames from the queue
    pub fn clear_frames(&self) {
        if let Ok(mut queue) = self.frame_queue.lock() {
            queue.clear();
            println!("[ScreenCapture FFI] Frame queue cleared");
        }
    }
}

impl Drop for ScreenCaptureBridge {
    fn drop(&mut self) {
        println!("[ScreenCapture FFI] Dropping bridge instance");

        // Stop capture if still running
        self.stop_capture();

        // Destroy Swift bridge instance
        unsafe {
            screen_capture_bridge_destroy(self.bridge_ptr.0);
        }

        println!("[ScreenCapture FFI] Bridge destroyed");
    }
}

// ============================================================================
// Frame Callback Functions (called from Swift)
// ============================================================================

/// Pushes a frame into the Rust frame queue
/// This function is called from Swift when a new frame is captured
///
/// # Safety
/// This is an unsafe FFI function. The caller (Swift) must ensure:
/// - `bridge_ptr` is a valid pointer returned from `screen_capture_bridge_create`
/// - `pixel_data` points to valid memory of size `data_len`
/// - Memory remains valid for the duration of this call
///
/// # Parameters
/// - `bridge_ptr`: Pointer to the ScreenCaptureBridge instance
/// - `width`, `height`: Frame dimensions
/// - `pixel_data`: Pointer to pixel data (BGRA format)
/// - `data_len`: Length of pixel data in bytes
/// - `timestamp`: Presentation timestamp in seconds
/// - `pixel_format`: FourCC pixel format code
#[no_mangle]
pub unsafe extern "C" fn screen_capture_push_frame(
    bridge_ptr: *mut c_void,
    width: usize,
    height: usize,
    pixel_data: *const u8,
    data_len: usize,
    timestamp: f64,
    pixel_format: u32,
) -> i32 {
    // Validate inputs
    if bridge_ptr.is_null() {
        eprintln!("[ScreenCapture FFI] push_frame: null bridge pointer");
        return 0;
    }

    if pixel_data.is_null() {
        eprintln!("[ScreenCapture FFI] push_frame: null pixel data");
        return 0;
    }

    if data_len == 0 {
        eprintln!("[ScreenCapture FFI] push_frame: empty pixel data");
        return 0;
    }

    // Copy pixel data into Rust Vec
    let data = std::slice::from_raw_parts(pixel_data, data_len).to_vec();

    // Create frame
    let frame = Frame {
        width,
        height,
        data,
        timestamp,
        pixel_format,
    };

    // Get bridge instance from pointer
    // Note: We use ManuallyDrop to prevent double-free since Swift owns the bridge
    let bridge = std::mem::ManuallyDrop::new(Box::from_raw(bridge_ptr as *mut ScreenCaptureBridge));

    // Push frame to queue
    if let Ok(mut queue) = bridge.frame_queue.lock() {
        // Limit queue size to prevent memory bloat
        const MAX_QUEUE_SIZE: usize = 120; // 4 seconds at 30fps

        if queue.len() >= MAX_QUEUE_SIZE {
            // Drop oldest frame
            queue.pop_front();
        }

        queue.push_back(frame);
        return 1; // Success
    }

    eprintln!("[ScreenCapture FFI] push_frame: failed to lock frame queue");
    0 // Failure
}

/// Gets the current frame queue size
///
/// # Safety
/// The caller must ensure `bridge_ptr` is valid
#[no_mangle]
pub unsafe extern "C" fn screen_capture_get_queue_size(bridge_ptr: *mut c_void) -> usize {
    if bridge_ptr.is_null() {
        return 0;
    }

    let bridge = std::mem::ManuallyDrop::new(Box::from_raw(bridge_ptr as *mut ScreenCaptureBridge));
    bridge.frame_count()
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_availability_check() {
        // This should work on macOS 12.3+
        let is_available = ScreenCaptureBridge::is_available();
        println!("ScreenCaptureKit available: {}", is_available);

        // On macOS 15, this should be true
        #[cfg(target_os = "macos")]
        assert!(is_available, "ScreenCaptureKit should be available on macOS 12.3+");
    }

    #[test]
    fn test_bridge_creation() {
        if let Some(bridge) = ScreenCaptureBridge::new() {
            assert_eq!(bridge.frame_count(), 0);
            println!("Bridge created successfully");
        } else {
            // On non-macOS or old macOS versions, this is expected
            println!("Bridge creation skipped (ScreenCaptureKit not available)");
        }
    }

    #[test]
    fn test_frame_queue() {
        if let Some(bridge) = ScreenCaptureBridge::new() {
            // Queue should start empty
            assert_eq!(bridge.frame_count(), 0);
            assert!(bridge.pop_frame().is_none());

            // Test queue cloning
            let queue_clone = bridge.frame_queue_clone();
            assert!(Arc::ptr_eq(&bridge.frame_queue, &queue_clone));
        }
    }
}
