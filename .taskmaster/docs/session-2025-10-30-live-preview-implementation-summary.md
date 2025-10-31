# Live Preview Implementation - Session Summary

## Objective
Integrate ScreenCaptureKit-based live preview into ClipForge, replacing the static FFmpeg snapshot with real-time frame streaming at 15fps.

---

## ✅ What Was Successfully Implemented

### 1. Swift FFI Layer (`ScreenCaptureKit.swift`)
**New Functions Added:**
- `screen_capture_bridge_dequeue_frame()` - Retrieves JPEG-compressed frames from Swift queue
- `screen_capture_bridge_get_frame_queue_size()` - Monitors queue depth
- `screen_capture_bridge_clear_frame_queue()` - Queue cleanup
- `screen_capture_bridge_configure_stream()` - Sets resolution, FPS, audio config
- `screen_capture_bridge_configure_display()` - Configures capture source for display
- `screen_capture_bridge_configure_window()` - Configures capture source for window

**Memory Management:**
- Fixed memory allocation to use `malloc()` instead of Swift's `UnsafeMutablePointer.allocate()` to ensure compatibility with Rust's `libc::free()`
- Proper JPEG data copying with `memcpy()`

### 2. Rust FFI Bindings (`ffi.rs`)
**New Structures:**
```rust
pub struct ProcessedJpegFrame {
    pub jpeg_data: Vec<u8>,
    pub width: usize,
    pub height: usize,
    pub timestamp: f64,
    pub frame_number: u64,
}
```

**Safe Wrapper Methods:**
- `dequeue_jpeg_frame()` - Safely retrieves frames from Swift
- `jpeg_frame_count()` - Thread-safe queue size check
- `configure_stream()` - Configure video settings
- `configure_display()` - Set display source
- `configure_window()` - Set window source

### 3. Tauri Commands (`preview.rs`)
**New State Management:**
```rust
pub struct PreviewCaptureSession {
    pub bridge: Option<ScreenCaptureBridge>,
    pub polling_task: Option<JoinHandle<()>>,
    pub should_stop: Arc<AtomicBool>,
}
```

**Commands Implemented:**
- `start_preview_for_source` - Initializes ScreenCaptureKit, configures source, starts background polling
- `stop_preview_for_source` - Cleanup and graceful shutdown

**Background Task:**
- Spawns async task polling Swift JPEG queue at ~200Hz (5ms sleep)
- Throttles emission to 15fps based on `PreviewState` settings
- Converts JPEG to base64 and emits via Tauri events
- Tracks metrics (FPS, dropped frames, queue size)

### 4. Frontend Integration (`App.jsx`)
**Modified `handleRecordingStateChange`:**
```javascript
if (state.type === 'source-selected') {
  invoke('start_preview_for_source', {
    sourceId: state.source.id,  // display_1, display_2, window_X
    width: state.config.width,
    height: state.config.height,
    frameRate: 15
  })
    .then(() => {
      setIsPreviewWindowVisible(true);  // Auto-show preview
    });
}
```

**Cleanup on Recording Complete:**
- Calls `stop_preview_for_source` when recording finishes

### 5. PreviewWindow Component (`PreviewWindow.jsx`)
**Already Implemented (from Tasks 18-21):**
- Double-buffered canvas rendering
- Listens for `preview-frame` events
- FPS counter and metrics display
- Drag/resize functionality
- Base64 JPEG → Image → Canvas pipeline

---

## ⚠️ Current Blocking Issue

### Crash Location
**Symptom:** App crashes immediately after selecting a screen source for preview.

**Console Output:**
```
[ScreenCaptureKit] ✅ SCStream created (without delegate)
[ScreenCaptureKit] ✅ Stream output handler added
[ScreenCaptureKit] ✅ Stream reference stored
[ScreenCaptureKit] 📍 Starting async stream capture...
[ScreenCaptureKit] 📍 Calling stream.startCapture()...
☠️ CRASH - EXC_BAD_ACCESS (SIGSEGV)
```

**Code Location:** `ScreenCaptureKit.swift:495`
```swift
try await stream.startCapture()  // <-- Crashes here
```

### Crash Analysis

**What We Know:**
1. ✅ Bridge creation successful
2. ✅ Stream configuration successful
3. ✅ Content filter configuration successful
4. ✅ `SCStream` object creation successful (with nil delegate)
5. ✅ Stream output handler added successfully
6. ❌ **CRASH when calling `stream.startCapture()`**

**What We've Tried:**
1. ✅ Fixed memory allocation (malloc/free compatibility)
2. ✅ Fixed source ID format (`display_X` not `screen_X`)
3. ✅ Added `[weak self]` capture in async Task
4. ✅ Stored stream reference before async execution
5. ✅ Removed delegate from `SCStream` initialization (delegate = nil)
6. ✅ Added comprehensive logging at every step

**Current Theory:**
The crash occurs in Apple's ScreenCaptureKit framework during `stream.startCapture()`. Possible causes:
- **Permissions issue**: Screen Recording permission might not be properly granted
- **Delegate requirement**: `SCStream` might require a valid delegate despite accepting nil
- **FFI lifecycle issue**: The bridge object might be getting deallocated during the async operation
- **ScreenCaptureKit bug**: Possible framework issue with certain configurations

---

## 🔍 Debugging Recommendations for Next Session

### 1. Verify Permissions
```swift
// Check screen recording permission status
if #available(macOS 10.15, *) {
    let hasPermission = CGPreflightScreenCaptureAccess()
    print("Screen Recording Permission: \(hasPermission)")
}
```

### 2. Test with Delegate
Create a proper delegate class instead of passing bridge as delegate:
```swift
class StreamDelegate: NSObject, SCStreamDelegate {
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("Delegate: Stream stopped with error: \(error)")
    }
}
```

### 3. Test Simple Configuration
Try minimal config to isolate the issue:
```swift
let config = SCStreamConfiguration()
config.width = 1280
config.height = 720
config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
```

### 4. Try Synchronous Approach
Wrap the async call differently:
```swift
let semaphore = DispatchSemaphore(value: 0)
Task {
    do {
        try await stream.startCapture()
        semaphore.signal()
    } catch {
        print("Error: \(error)")
        semaphore.signal()
    }
}
semaphore.wait()
```

### 5. Check macOS Version
ScreenCaptureKit has known issues on certain macOS versions. Verify:
- macOS 12.3+ (minimum requirement)
- macOS 13+ recommended for stability

---

## 📁 Files Modified

### Backend (Rust/Swift)
- `clipforge-tauri/src-tauri/src/swift/ScreenCaptureKit.swift` - Added 6 new FFI functions, fixed memory allocation
- `clipforge-tauri/src-tauri/src/capture/ffi.rs` - Added `ProcessedJpegFrame` struct, 5 new methods
- `clipforge-tauri/src-tauri/src/commands/preview.rs` - Added `PreviewCaptureSession`, 2 new commands, background polling task
- `clipforge-tauri/src-tauri/src/lib.rs` - Registered new commands and state

### Frontend (React)
- `clipforge-tauri/src/App.jsx` - Wired `start_preview_for_source` to source selection, added cleanup

---

## 🎯 Expected Behavior (Once Fixed)

1. User clicks "Screen Recording" button
2. Modal shows available screens/windows with thumbnails
3. **User selects a source** → `source-selected` event fires
4. **Backend:** `start_preview_for_source` command:
   - Creates ScreenCaptureBridge
   - Configures for selected display/window
   - Starts ScreenCaptureKit capture @ 60fps (Swift)
   - Spawns Rust task polling JPEG queue @ 15fps
5. **Frontend:** PreviewWindow appears (floating overlay)
6. **Frames flow:** Swift (JPEG compress) → Rust (base64) → Tauri event → React → Canvas
7. **User sees:** Live updating video preview at 15fps
8. **User clicks "Start Recording"** → Preview continues during recording
9. **Recording completes** → Preview stops, video imported

---

## 🔧 Technical Stack

- **Swift:** ScreenCaptureKit API, CoreMedia, JPEG compression
- **Rust:** FFI bridge, async task management, base64 encoding
- **Tauri:** Event emission, command handling
- **React:** Canvas rendering, double buffering, UI controls

---

## 📊 Performance Characteristics

- **Capture rate:** 60fps (configurable)
- **Processing rate:** Every 4th frame (15fps preview)
- **Frame queue:** Max 60 frames (2 seconds @ 30fps)
- **Throttling:** Frontend-side via `PreviewState.should_emit_frame()`
- **Compression:** JPEG quality 80%, RGB → JPEG in Swift
- **Transmission:** Base64-encoded JPEG via Tauri events

---

## 💡 Alternative Approaches to Consider

1. **Use AVFoundation instead of ScreenCaptureKit** (more stable but less features)
2. **Use separate process for capture** (avoid FFI lifecycle issues)
3. **Use existing FFmpeg integration** for preview too (simpler but less efficient)
4. **WebRTC-based approach** (more complex but better for streaming)

---

## 📝 Next Steps

1. Get second opinion on ScreenCaptureKit crash
2. Test with minimal SCStream configuration
3. Verify permissions are properly granted
4. Consider fallback to AVFoundation if ScreenCaptureKit proves unstable
5. Add more defensive error handling throughout the pipeline

---

**Session Duration:** ~3 hours
**Lines of Code Added:** ~800
**Files Modified:** 5
**Status:** 95% complete - blocked by ScreenCaptureKit crash
