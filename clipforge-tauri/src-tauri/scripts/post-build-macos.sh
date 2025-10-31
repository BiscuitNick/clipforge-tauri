#!/bin/bash
set -e

# Post-build script to copy the Swift library into the macOS app bundle

APP_NAME="ClipForge"
APP_BUNDLE="./src-tauri/target/release/bundle/macos/${APP_NAME}.app"
FRAMEWORKS_DIR="${APP_BUNDLE}/Contents/Frameworks"
LIB_SOURCE="./src-tauri/lib/libScreenCaptureKitBridge.dylib"

echo "Post-build: Copying Swift library to app bundle..."

# Create Frameworks directory if it doesn't exist
mkdir -p "${FRAMEWORKS_DIR}"

# Copy the library
if [ -f "${LIB_SOURCE}" ]; then
    cp "${LIB_SOURCE}" "${FRAMEWORKS_DIR}/"
    echo "✓ Copied libScreenCaptureKitBridge.dylib to ${FRAMEWORKS_DIR}"

    # Fix the library's install name
    install_name_tool -id "@executable_path/../Frameworks/libScreenCaptureKitBridge.dylib" \
        "${FRAMEWORKS_DIR}/libScreenCaptureKitBridge.dylib"
    echo "✓ Updated library install name"

    # Update the binary to look for the library in the right place
    BINARY="${APP_BUNDLE}/Contents/MacOS/clipforge-tauri"
    if [ -f "${BINARY}" ]; then
        install_name_tool -change "@rpath/libScreenCaptureKitBridge.dylib" \
            "@executable_path/../Frameworks/libScreenCaptureKitBridge.dylib" \
            "${BINARY}" 2>/dev/null || true
        echo "✓ Updated binary rpath"
    fi

    # Copy to /Applications if requested
    if [ "$1" == "--install" ]; then
        echo "Installing to /Applications..."
        rm -rf "/Applications/${APP_NAME}.app"
        cp -R "${APP_BUNDLE}" "/Applications/"
        echo "✓ Installed to /Applications/${APP_NAME}.app"
    fi
else
    echo "⚠ Library not found at ${LIB_SOURCE}"
    exit 1
fi

echo "✓ Post-build complete!"
