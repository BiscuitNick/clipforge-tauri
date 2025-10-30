// Screen capture module using ScreenCaptureKit on macOS
//
// This module provides a high-level API for screen recording using
// the native ScreenCaptureKit framework via Swift FFI bridge

#[cfg(target_os = "macos")]
pub mod ffi;

#[cfg(target_os = "macos")]
pub use ffi::ScreenCaptureBridge;

// Frame processing module for preview and encoding pipelines
pub mod frame_processor;
pub mod frame_timing;

pub use frame_processor::{
    EncodingFrameProcessor, FrameProcessor, MultiFrameProcessor, PreviewFrameProcessor,
    ProcessedFrame,
};
pub use frame_timing::{FrameTimer, FrameTimingStats};
