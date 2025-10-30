use super::{ScreenSource, SourceEnumerator, SourceType};
use cocoa::appkit::NSScreen;
use cocoa::base::{id, nil};
use cocoa::foundation::{NSArray, NSString};
use core_foundation::base::TCFType;
use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use core_graphics::display::{CGDisplay, CGPoint, CGRect, CGSize};
use core_graphics::image::CGImage;
use objc::{class, msg_send, sel, sel_impl};
use objc::runtime::Object;
use std::ptr;
use std::ops::Deref;
use std::process::{Command, Stdio};
use image::{ImageBuffer, RgbaImage};
use base64::{Engine as _, engine::general_purpose};

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

                println!("[CameraDetection] Analyzing FFmpeg device list output");

                // Parse FFmpeg output to count video devices
                for line in stderr.lines() {
                    if line.contains("AVFoundation video devices:") {
                        in_video_section = true;
                        println!("[CameraDetection] Found video devices section");
                        continue;
                    } else if line.contains("AVFoundation audio devices:") {
                        // We've reached the audio section, stop counting
                        println!("[CameraDetection] Reached audio section, stopping count");
                        break;
                    } else if in_video_section {
                        // Look for device entries like "[AVFoundation indev @ 0x...] [0] FaceTime HD Camera"
                        if line.contains("[AVFoundation") && line.contains("] [") {
                            // Extract device name to check if it's a screen
                            let lower_line = line.to_lowercase();
                            if lower_line.contains("capture screen") || lower_line.contains("screen") && lower_line.contains("capture") {
                                // This is a screen capture device, stop counting cameras
                                println!("[CameraDetection] Found first screen device, camera count: {}", camera_count);
                                break;
                            } else {
                                // This is a camera device
                                camera_count += 1;
                                println!("[CameraDetection] Found camera device #{}: {}", camera_count, line);
                            }
                        }
                    }
                }

                println!("[CameraDetection] Total camera devices detected: {}", camera_count);
                return camera_count;
            } else {
                println!("[CameraDetection] Failed to run FFmpeg for device detection");
            }
        } else {
            println!("[CameraDetection] FFmpeg not found for device detection");
        }

        // Fallback: return 0 if detection fails
        // This means screens will start at device index 0
        println!("[CameraDetection] Using fallback camera count: 0");
        0
    }

    /// Get window information dictionary
    fn get_window_info() -> Result<Vec<CFDictionary>, String> {
        unsafe {
            use core_foundation::array::{CFArray, CFArrayRef};

            // Get list of all on-screen windows
            let window_list_info = core_graphics::window::CGWindowListCopyWindowInfo(
                core_graphics::window::kCGWindowListOptionOnScreenOnly
                    | core_graphics::window::kCGWindowListExcludeDesktopElements,
                core_graphics::window::kCGNullWindowID,
            );

            if window_list_info.is_null() {
                return Err("Failed to get window list".to_string());
            }

            let array: CFArray<*const std::ffi::c_void> = CFArray::wrap_under_create_rule(window_list_info as CFArrayRef);
            let windows: Vec<CFDictionary> = (0..array.len())
                .filter_map(|i| {
                    let item_ref = array.get(i)?;
                    let dict_ptr = *item_ref.deref() as CFDictionaryRef;
                    Some(CFDictionary::wrap_under_get_rule(dict_ptr))
                })
                .collect();

            Ok(windows)
        }
    }

    /// Get string value from dictionary
    fn get_dict_string(dict: &CFDictionary, key: &str) -> Option<String> {
        unsafe {
            let key_cfstring = CFString::new(key);
            let value_ref = dict.find(key_cfstring.as_CFTypeRef() as *const _)?;
            let value_ptr = *value_ref.deref() as CFStringRef;
            let cf_value = CFString::wrap_under_get_rule(value_ptr);
            Some(cf_value.to_string())
        }
    }

    /// Get number value from dictionary
    fn get_dict_number(dict: &CFDictionary, key: &str) -> Option<i64> {
        unsafe {
            let key_cfstring = CFString::new(key);
            let value_ref = dict.find(key_cfstring.as_CFTypeRef() as *const _)?;
            let value_ptr = *value_ref.deref() as *const _;
            let cf_number = CFNumber::wrap_under_get_rule(value_ptr);
            cf_number.to_i64()
        }
    }

    /// Get bounds dictionary from window dict
    fn get_window_bounds(dict: &CFDictionary) -> Option<(i32, i32, u32, u32)> {
        unsafe {
            let key_cfstring = CFString::new("kCGWindowBounds");
            let bounds_ref = dict.find(key_cfstring.as_CFTypeRef() as *const _)?;
            let bounds_ptr = *bounds_ref.deref() as CFDictionaryRef;
            let bounds_dict = CFDictionary::wrap_under_get_rule(bounds_ptr);

            let x = Self::get_dict_number(&bounds_dict, "X")? as i32;
            let y = Self::get_dict_number(&bounds_dict, "Y")? as i32;
            let width = Self::get_dict_number(&bounds_dict, "Width")? as u32;
            let height = Self::get_dict_number(&bounds_dict, "Height")? as u32;

            Some((x, y, width, height))
        }
    }

    /// Capture thumbnail for a window by window ID
    fn capture_window_thumbnail(window_id: u32) -> Option<String> {
        use std::process::Command;
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        // Create temp file path
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_secs();
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
            println!("[WindowThumbnail] screencapture failed for window {}: {:?}",
                window_id, String::from_utf8_lossy(&output.stderr));
            return None;
        }

        // Check if file was created
        if !std::path::Path::new(&temp_path).exists() {
            println!("[WindowThumbnail] Thumbnail file not created for window {}", window_id);
            return None;
        }

        // Resize the image using sips (built-in macOS image tool)
        let resize_output = Command::new("sips")
            .arg("-Z")
            .arg("200") // Max dimension 200px
            .arg(&temp_path)
            .output()
            .ok()?;

        if !resize_output.status.success() {
            println!("[WindowThumbnail] Failed to resize thumbnail for window {}", window_id);
        }

        // Read PNG file and base64 encode
        let png_data = fs::read(&temp_path).ok()?;
        let base64_string = base64::engine::general_purpose::STANDARD.encode(&png_data);

        // Clean up temp file
        let _ = fs::remove_file(&temp_path);

        Some(base64_string)
    }

    /// Capture thumbnail for a screen by AVFoundation device index
    fn capture_screen_thumbnail(avf_device_index: usize) -> Option<String> {
        use std::process::Command;
        use std::fs;
        use std::time::{SystemTime, UNIX_EPOCH};

        // Find FFmpeg
        let ffmpeg_path = super::super::ffmpeg_utils::find_ffmpeg()?;

        // Create temp file path
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_secs();
        let temp_path = format!("/tmp/screen_thumb_{}_{}.png", avf_device_index, timestamp);

        // Capture single frame using FFmpeg with AVFoundation device index
        let output = Command::new(&ffmpeg_path)
            .arg("-f").arg("avfoundation")
            .arg("-framerate").arg("30") // Use 30fps for screen capture
            .arg("-i").arg(format!("{}:", avf_device_index)) // No audio
            .arg("-frames:v").arg("1") // Single frame
            .arg("-vf").arg("scale=200:-1") // Scale to width 200, maintain aspect ratio
            .arg("-y") // Overwrite
            .arg(&temp_path)
            .output()
            .ok()?;

        if !output.status.success() {
            println!("[ScreenThumbnail] FFmpeg failed for device {}: {:?}",
                avf_device_index, String::from_utf8_lossy(&output.stderr));
            return None;
        }

        // Read PNG file and base64 encode
        let png_data = fs::read(&temp_path).ok()?;
        let base64_string = base64::engine::general_purpose::STANDARD.encode(&png_data);

        // Clean up temp file
        let _ = fs::remove_file(&temp_path);

        Some(base64_string)
    }

    /// Filter window - return true if window should be included
    fn should_include_window(dict: &CFDictionary) -> bool {
        // Check if window is on screen
        let layer = Self::get_dict_number(dict, "kCGWindowLayer").unwrap_or(0);

        // Filter out system UI (dock, menu bar, etc.) which have non-zero layer
        if layer != 0 {
            return false;
        }

        // Check if window has a valid name
        let _window_name = Self::get_dict_string(dict, "kCGWindowName");
        let owner_name = Self::get_dict_string(dict, "kCGWindowOwnerName");

        // Exclude windows without names or from system processes
        if owner_name.is_none() {
            return false;
        }

        // Get window bounds
        if let Some((_, _, width, height)) = Self::get_window_bounds(dict) {
            // Exclude tiny windows (likely UI elements)
            if width < 50 || height < 50 {
                return false;
            }
        } else {
            return false;
        }

        true
    }
}

impl SourceEnumerator for PlatformEnumerator {
    fn enumerate_screens() -> Result<Vec<ScreenSource>, String> {
        unsafe {
            let screens: id = msg_send![class!(NSScreen), screens];
            if screens == nil {
                return Err("Failed to get screens".to_string());
            }

            let count: usize = msg_send![screens, count];
            let mut sources = Vec::with_capacity(count);

            let main_screen: id = msg_send![class!(NSScreen), mainScreen];

            for i in 0..count {
                let screen: id = msg_send![screens, objectAtIndex: i];
                if screen == nil {
                    continue;
                }

                // Get screen frame
                let frame: CGRect = msg_send![screen, frame];

                // Get backing scale factor (for Retina displays)
                let scale_factor: f64 = msg_send![screen, backingScaleFactor];

                // Check if this is the main screen
                let is_primary = screen == main_screen;

                // Get device description for display ID
                let device_desc: id = msg_send![screen, deviceDescription];
                let display_id_key = NSString::alloc(nil).init_str("NSScreenNumber");
                let display_id_value: id = msg_send![device_desc, objectForKey: display_id_key];
                let display_id: u32 = msg_send![display_id_value, unsignedIntValue];

                // Dynamically detect the number of camera devices before screens
                // AVFoundation lists all camera devices first, then screen devices
                let camera_count = Self::get_camera_device_count();
                let avf_device_index = i + camera_count;

                println!("[ScreenEnumeration] Camera count: {}, Screen index: {}, AVF device: {}",
                    camera_count, i, avf_device_index);

                // Generate thumbnail using AVFoundation device index
                let thumbnail = Self::capture_screen_thumbnail(avf_device_index);

                let screen_id = format!("screen_{}", avf_device_index);
                println!("[ScreenEnumeration] Screen {} -> ID: {} (display_id: {})", i, screen_id, display_id);

                let mut source = ScreenSource::new(
                    screen_id,
                    format!("Display {}", i + 1),
                    SourceType::Screen,
                    (frame.size.width * scale_factor) as u32,
                    (frame.size.height * scale_factor) as u32,
                )
                .with_position(frame.origin.x as i32, frame.origin.y as i32)
                .with_primary(is_primary)
                .with_scale_factor(scale_factor);

                if let Some(thumb) = thumbnail {
                    source = source.with_thumbnail(thumb);
                }

                sources.push(source);
            }

            Ok(sources)
        }
    }

    fn enumerate_windows() -> Result<Vec<ScreenSource>, String> {
        let window_infos = Self::get_window_info()?;
        let mut sources = Vec::new();

        for dict in window_infos {
            // Filter out windows we don't want
            if !Self::should_include_window(&dict) {
                continue;
            }

            // Get window ID
            let window_id = Self::get_dict_number(&dict, "kCGWindowNumber")
                .ok_or_else(|| "Failed to get window ID".to_string())?;

            // Get window name and owner
            let window_name = Self::get_dict_string(&dict, "kCGWindowName");
            let owner_name = Self::get_dict_string(&dict, "kCGWindowOwnerName")
                .unwrap_or_else(|| "Unknown".to_string());

            // Get window bounds
            let (x, y, width, height) = Self::get_window_bounds(&dict)
                .ok_or_else(|| "Failed to get window bounds".to_string())?;

            // Create display name
            let display_name = if let Some(name) = window_name {
                if name.is_empty() {
                    owner_name.clone()
                } else {
                    format!("{} - {}", owner_name, name)
                }
            } else {
                owner_name.clone()
            };

            // Generate thumbnail for the window
            let thumbnail = Self::capture_window_thumbnail(window_id as u32);

            let mut source = ScreenSource::new(
                format!("window_{}", window_id),
                display_name,
                SourceType::Window,
                width,
                height,
            )
            .with_position(x, y)
            .with_app_name(owner_name);

            if let Some(thumb) = thumbnail {
                source = source.with_thumbnail(thumb);
            }

            sources.push(source);
        }

        Ok(sources)
    }
}
