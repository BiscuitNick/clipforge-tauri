// Platform-specific screen source enumeration
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

/// Type of screen source
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SourceType {
    Screen,
    Window,
}

/// Screen or window source for recording
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenSource {
    /// Unique identifier for this source
    pub id: String,
    /// Display name
    pub name: String,
    /// Type of source (screen or window)
    pub source_type: SourceType,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// X position in virtual desktop
    pub x: i32,
    /// Y position in virtual desktop
    pub y: i32,
    /// Whether this is the primary display
    pub is_primary: bool,
    /// Display scaling factor (e.g., 2.0 for Retina)
    pub scale_factor: f64,
    /// Optional thumbnail image (base64 encoded PNG)
    pub thumbnail: Option<String>,
    /// Application name (for windows)
    pub app_name: Option<String>,
}

impl ScreenSource {
    /// Create a new screen source
    pub fn new(id: String, name: String, source_type: SourceType, width: u32, height: u32) -> Self {
        Self {
            id,
            name,
            source_type,
            width,
            height,
            x: 0,
            y: 0,
            is_primary: false,
            scale_factor: 1.0,
            thumbnail: None,
            app_name: None,
        }
    }

    /// Builder-style method to set position
    pub fn with_position(mut self, x: i32, y: i32) -> Self {
        self.x = x;
        self.y = y;
        self
    }

    /// Builder-style method to set primary flag
    pub fn with_primary(mut self, is_primary: bool) -> Self {
        self.is_primary = is_primary;
        self
    }

    /// Builder-style method to set scale factor
    pub fn with_scale_factor(mut self, scale_factor: f64) -> Self {
        self.scale_factor = scale_factor;
        self
    }

    /// Builder-style method to set thumbnail
    pub fn with_thumbnail(mut self, thumbnail: String) -> Self {
        self.thumbnail = Some(thumbnail);
        self
    }

    /// Builder-style method to set app name
    pub fn with_app_name(mut self, app_name: String) -> Self {
        self.app_name = Some(app_name);
        self
    }
}

/// Trait for platform-specific screen source enumeration
pub trait SourceEnumerator {
    /// Enumerate all available screens
    fn enumerate_screens() -> Result<Vec<ScreenSource>, String>;

    /// Enumerate all available windows
    fn enumerate_windows() -> Result<Vec<ScreenSource>, String>;

    /// Enumerate both screens and windows
    fn enumerate_all() -> Result<Vec<ScreenSource>, String> {
        let mut sources = Self::enumerate_screens()?;
        sources.extend(Self::enumerate_windows()?);
        Ok(sources)
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Enumerate all available screen sources (screens and windows)
#[tauri::command]
pub async fn enumerate_sources() -> Result<Vec<ScreenSource>, String> {
    PlatformEnumerator::enumerate_all()
}

/// Enumerate only screens/displays
#[tauri::command]
pub async fn enumerate_screens() -> Result<Vec<ScreenSource>, String> {
    PlatformEnumerator::enumerate_screens()
}

/// Enumerate only windows
#[tauri::command]
pub async fn enumerate_windows() -> Result<Vec<ScreenSource>, String> {
    PlatformEnumerator::enumerate_windows()
}
