// Platform-specific camera device enumeration
#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

// Re-export the platform-specific implementation
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
pub use stub::*;

use serde::{Deserialize, Serialize};

/// Camera device for recording
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraDevice {
    /// Unique identifier for this camera device
    pub id: String,
    /// Display name
    pub name: String,
    /// Whether this is the default camera
    pub is_default: bool,
    /// Supported resolutions (width x height)
    pub resolutions: Vec<(u32, u32)>,
    /// Whether this device supports audio
    pub has_audio: bool,
}

impl CameraDevice {
    /// Create a new camera device
    pub fn new(id: String, name: String) -> Self {
        Self {
            id,
            name,
            is_default: false,
            resolutions: vec![
                (1920, 1080),
                (1280, 720),
                (640, 480),
            ],
            has_audio: false,
        }
    }

    /// Builder-style method to set default flag
    pub fn with_default(mut self, is_default: bool) -> Self {
        self.is_default = is_default;
        self
    }

    /// Builder-style method to set resolutions
    pub fn with_resolutions(mut self, resolutions: Vec<(u32, u32)>) -> Self {
        self.resolutions = resolutions;
        self
    }

    /// Builder-style method to set audio support
    pub fn with_audio(mut self, has_audio: bool) -> Self {
        self.has_audio = has_audio;
        self
    }
}

/// Trait for platform-specific camera device enumeration
pub trait CameraEnumerator {
    /// Enumerate all available camera devices
    fn enumerate_cameras() -> Result<Vec<CameraDevice>, String>;

    /// Get the default camera device
    fn get_default_camera() -> Result<Option<CameraDevice>, String> {
        let cameras = Self::enumerate_cameras()?;
        Ok(cameras.into_iter().find(|c| c.is_default))
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Enumerate all available camera devices
#[tauri::command]
pub async fn enumerate_cameras() -> Result<Vec<CameraDevice>, String> {
    PlatformEnumerator::enumerate_cameras()
}

/// Get the default camera device
#[tauri::command]
pub async fn get_default_camera() -> Result<Option<CameraDevice>, String> {
    PlatformEnumerator::get_default_camera()
}
