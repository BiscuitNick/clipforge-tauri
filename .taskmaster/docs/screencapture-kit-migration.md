# ScreenCaptureKit + FFmpeg Hybrid Architecture Migration

## Overview
Migrate ClipForge-Tauri from FFmpeg-only screen capture to a hybrid architecture using native ScreenCaptureKit for frame capture and FFmpeg for encoding. This enables real-time preview functionality while maintaining encoding flexibility.

## Target Platform
macOS 12.3+ (ScreenCaptureKit availability)
Current system: macOS 15 (Darwin 25.0.0)

## Goals
1. Enable real-time preview of screen/window recording in the UI
2. Improve capture performance using native ScreenCaptureKit APIs
3. Maintain FFmpeg encoding for format flexibility and quality
4. Preserve all existing recording features (audio, window cropping, multi-display)
5. Keep current API surface for minimal frontend changes

## Architecture

### Current State
```
User → Tauri Command → FFmpeg AVFoundation → Encoded File
                         (No frame access)
```

### Target State
```
User → Tauri Command → ScreenCaptureKit → Frame Buffer
                            ↓
                    ┌───────┴──────┐
                    ↓              ↓
              FFmpeg stdin    Tauri Events
              (Encoding)      (Preview Frames)
                    ↓              ↓
              Encoded File    UI Preview
```

## Technical Requirements

### Phase 1: Swift Bridge & Basic Frame Capture

#### 1.1 Create Swift ScreenCaptureKit Module
- Create Swift source file for ScreenCaptureKit wrapper
- Implement `SCStream` configuration and initialization
- Implement `SCStreamOutput` delegate for frame callbacks
- Add display and window filtering capabilities
- Handle lifecycle (start, stop, pause)
- Configure build system to compile Swift code with Rust

#### 1.2 Build Rust FFI Bridge
- Create Rust module for Swift interop using `objc` crate
- Define C-compatible function signatures for frame callbacks
- Implement thread-safe frame buffer queue
- Add Swift object lifecycle management (retain/release)
- Create error handling bridge between Swift and Rust
- Add unit tests for FFI boundary

#### 1.3 Display & Window Enumeration
- Replace NSScreen with `SCShareableContent` API
- Migrate screen detection to use `SCDisplay`
- Migrate window detection to use `SCWindow`
- Update thumbnail generation for new API
- Maintain compatibility with existing `ScreenSource` data structure
- Test multi-display scenarios

### Phase 2: Preview Implementation

#### 2.1 Frame Processing Pipeline
- Extract pixel data from `CMSampleBuffer`
- Implement format conversion (YUV to RGB if needed)
- Add JPEG compression for preview frames
- Implement frame throttling (capture at 60fps, preview at 15fps)
- Create frame queue with size limits to prevent memory bloat
- Add frame timestamp tracking

#### 2.2 Tauri Event System Integration
- Define preview frame event payload structure
- Implement event emission from frame callback
- Add preview enable/disable control
- Implement preview quality settings (JPEG compression level)
- Handle backpressure when frontend can't keep up
- Add metrics for dropped frames

#### 2.3 Frontend Preview Component
- Create React component for preview display
- Implement event listener for preview frames
- Add canvas or img element for frame rendering
- Style preview window (overlay, draggable, resizable)
- Add preview controls (show/hide, size adjustment)
- Handle base64 image decoding and display
- Add frame rate indicator
- Implement preview during recording only

### Phase 3: FFmpeg Integration

#### 3.1 Raw Frame Pipeline to FFmpeg
- Configure FFmpeg to accept raw frames via stdin (rawvideo format)
- Modify FFmpeg command builder for stdin input mode
- Implement pixel format conversion to match FFmpeg expectations
- Add proper frame size and stride handling
- Test with different resolutions and pixel formats
- Implement frame synchronization and timing

#### 3.2 Audio Integration
- Capture system audio via ScreenCaptureKit `SCStreamConfiguration.capturesAudio`
- Extract audio samples from `SCStreamOutput` audio buffers
- Pipe audio data to FFmpeg alongside video frames
- Maintain audio/video synchronization
- Support microphone input integration
- Test audio-only, video-only, and combined modes

#### 3.3 Dual Output Management
- Implement concurrent writing to FFmpeg stdin and preview events
- Add buffer management to prevent blocking
- Handle FFmpeg stdin backpressure
- Implement graceful degradation if FFmpeg can't keep up
- Add performance monitoring (frame timing, buffer sizes)
- Test with high frame rates (60fps) and high resolutions (4K)

### Phase 4: Feature Parity & Polish

#### 4.1 Window Capture with Content Filtering
- Implement window-specific capture using `SCContentFilter`
- Add window bounds and cropping via ScreenCaptureKit (no FFmpeg crop filter needed)
- Support excluding windows from capture (`excludingWindows`)
- Test window capture across different apps
- Handle window movement during recording
- Add cursor capture options

#### 4.2 Recording Controls
- Implement pause/resume at ScreenCaptureKit level (`stream.stopCapture`/`startCapture`)
- Maintain duration tracking with pause support
- Update recording state management
- Add real pause/resume to FFmpeg encoding pipeline
- Test state transitions thoroughly
- Handle errors during state changes

#### 4.3 Configuration & Presets
- Map existing quality presets to ScreenCaptureKit settings
- Update `RecordingConfig` validation for new architecture
- Add ScreenCaptureKit-specific options (content filtering, cursor modes)
- Maintain backward compatibility with existing configs
- Test all quality presets (low, medium, high)
- Document new configuration options

#### 4.4 Error Handling & Recovery
- Implement comprehensive error handling in Swift layer
- Bridge error codes to Rust error types
- Add user-friendly error messages
- Implement automatic recovery for common failures
- Add fallback mechanisms (restart stream, etc.)
- Test error scenarios (permissions denied, display disconnected, etc.)

#### 4.5 Resource Management & Cleanup
- Implement proper cleanup of ScreenCaptureKit resources
- Add memory leak detection and testing
- Handle process termination gracefully
- Clean up temporary buffers and frame queues
- Test long-duration recordings (>1 hour)
- Add resource usage monitoring

#### 4.6 Testing & Validation
- Create integration tests for end-to-end recording flow
- Add performance benchmarks vs current FFmpeg-only approach
- Test on multiple macOS versions (12.3, 13, 14, 15)
- Test with multiple displays and resolutions
- Validate encoded video quality and file sizes
- Test preview functionality under various conditions
- Create automated test suite

#### 4.7 Documentation & Migration
- Document new architecture in code comments
- Update README with ScreenCaptureKit requirements
- Create migration guide for developers
- Document performance characteristics
- Add troubleshooting guide
- Update API documentation

## Success Criteria
- ✅ Real-time preview works at 15+ fps with <100ms latency
- ✅ Encoded video quality matches or exceeds current implementation
- ✅ CPU usage lower than or equal to current FFmpeg-only approach
- ✅ All existing features work (audio, window capture, multi-display)
- ✅ Preview has minimal impact on recording performance (<5% overhead)
- ✅ Recording can run for 1+ hour without memory leaks
- ✅ System resources properly cleaned up on stop/crash

## Non-Goals
- Windows/Linux support (remains FFmpeg-only)
- macOS 11 or earlier support
- Real-time streaming to network destinations (RTMP, etc.)
- Built-in video editing capabilities

## Technical Dependencies
- ScreenCaptureKit framework (macOS 12.3+)
- AVFoundation for media types
- Core Media for sample buffer handling
- Existing: objc crate, core-foundation crate
- Consider: swift-bridge crate for easier FFI

## Risks & Mitigations
1. **Swift/Rust FFI complexity**: Start with simple bridge, iterate
2. **Frame synchronization issues**: Use CMTime for accurate timing
3. **Memory usage from frame buffers**: Implement strict queue size limits
4. **Performance regression**: Benchmark early and often
5. **ScreenCaptureKit API changes**: Pin to specific macOS SDK version

## Open Questions
- Should we keep FFmpeg-only as fallback code path?
- What preview frame rate provides best UX without performance hit?
- Should preview be enabled by default or opt-in?
- Do we need preview recording (save preview stream separately)?
