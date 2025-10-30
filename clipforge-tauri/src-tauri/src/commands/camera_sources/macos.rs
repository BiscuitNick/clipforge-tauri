// macOS camera device enumeration using AVFoundation

use super::{CameraDevice, CameraEnumerator};
use cocoa::base::{id, nil};
use cocoa::foundation::NSString;
use objc::{class, msg_send, sel, sel_impl};

/// macOS platform enumerator
pub struct PlatformEnumerator;

impl CameraEnumerator for PlatformEnumerator {
    fn enumerate_cameras() -> Result<Vec<CameraDevice>, String> {
        unsafe { enumerate_camera_devices() }
    }
}

/// Enumerate camera devices using AVFoundation
unsafe fn enumerate_camera_devices() -> Result<Vec<CameraDevice>, String> {
    // Get AVCaptureDevice class
    let av_capture_device_class = class!(AVCaptureDevice);

    // Get media type for video
    let media_type = NSString::alloc(nil).init_str("vide");

    // Get all video devices
    let devices: id = msg_send![av_capture_device_class, devicesWithMediaType: media_type];

    if devices == nil {
        return Ok(Vec::new());
    }

    // Get device count
    let count: usize = msg_send![devices, count];

    // Get default device
    let default_device: id =
        msg_send![av_capture_device_class, defaultDeviceWithMediaType: media_type];
    let default_id: id = if default_device != nil {
        msg_send![default_device, uniqueID]
    } else {
        nil
    };

    let mut cameras = Vec::new();

    for i in 0..count {
        let device: id = msg_send![devices, objectAtIndex: i];

        if device == nil {
            continue;
        }

        // Get device unique ID
        let device_id: id = msg_send![device, uniqueID];
        let device_id_str: *const i8 = msg_send![device_id, UTF8String];
        let device_id_string = std::ffi::CStr::from_ptr(device_id_str)
            .to_string_lossy()
            .into_owned();

        // Get device localized name
        let device_name: id = msg_send![device, localizedName];
        let device_name_str: *const i8 = msg_send![device_name, UTF8String];
        let device_name_string = std::ffi::CStr::from_ptr(device_name_str)
            .to_string_lossy()
            .into_owned();

        // Check if this is the default device
        let is_default = if default_id != nil {
            let default_id_str: *const i8 = msg_send![default_id, UTF8String];
            let default_id_string = std::ffi::CStr::from_ptr(default_id_str)
                .to_string_lossy()
                .into_owned();
            device_id_string == default_id_string
        } else {
            false
        };

        // Get supported formats to determine resolutions
        let formats: id = msg_send![device, formats];
        let format_count: usize = msg_send![formats, count];

        let mut resolutions = Vec::new();
        for j in 0..format_count {
            let format: id = msg_send![formats, objectAtIndex: j];
            let description: id = msg_send![format, formatDescription];

            // Get dimensions from format description
            let dimensions = CMVideoFormatDescriptionGetDimensions(description);
            let width = dimensions.width as u32;
            let height = dimensions.height as u32;

            // Only add unique resolutions
            if !resolutions.contains(&(width, height)) {
                resolutions.push((width, height));
            }
        }

        // Sort resolutions by total pixels (largest first)
        resolutions.sort_by(|a, b| (b.0 * b.1).cmp(&(a.0 * a.1)));

        // Create camera device
        let camera = CameraDevice::new(device_id_string, device_name_string)
            .with_default(is_default)
            .with_resolutions(resolutions)
            .with_audio(false); // Cameras don't directly provide audio

        cameras.push(camera);
    }

    Ok(cameras)
}

// FFI for Core Media Framework
#[repr(C)]
struct CMVideoDimensions {
    width: i32,
    height: i32,
}

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMVideoFormatDescriptionGetDimensions(videoDesc: id) -> CMVideoDimensions;
}
