#!/usr/bin/env node

/**
 * Post-build script to copy libScreenCaptureKitBridge.dylib to the app bundle.
 * This ensures the dylib is available at runtime in the bundled app.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcTauriDir = path.join(projectRoot, 'src-tauri');

// Find the dylib in the build output
function findDylib() {
  const buildBaseDir = path.join(srcTauriDir, 'target/release/build');

  if (!fs.existsSync(buildBaseDir)) {
    console.log('ℹ️  Release build directory not found. Checking debug build...');
    const debugBuildBase = path.join(srcTauriDir, 'target/debug/build');
    if (!fs.existsSync(debugBuildBase)) {
      return null;
    }
    return findDylibInDir(debugBuildBase);
  }

  return findDylibInDir(buildBaseDir);
}

function findDylibInDir(buildBaseDir) {
  try {
    const dirs = fs.readdirSync(buildBaseDir);
    for (const dir of dirs) {
      if (dir.startsWith('clipforge-tauri-')) {
        const dylibPath = path.join(buildBaseDir, dir, 'out/libScreenCaptureKitBridge.dylib');
        if (fs.existsSync(dylibPath)) {
          return dylibPath;
        }
      }
    }
  } catch (error) {
    console.error(`Error searching for dylib: ${error.message}`);
  }

  console.log('ℹ️  No libScreenCaptureKitBridge.dylib found in build output.');
  return null;
}

// Find the app bundle
function findAppBundle() {
  const bundlePattern = path.join(projectRoot, 'src-tauri/target/release/bundle/macos/ClipForge.app');

  if (!fs.existsSync(bundlePattern)) {
    console.log('ℹ️  App bundle not found. This is normal during non-release builds.');
    return null;
  }

  return bundlePattern;
}

// Copy dylib to app bundle
async function copyDylib() {
  const dylib = await findDylib();
  const bundle = findAppBundle();

  if (!dylib || !bundle) {
    console.log('⏭️  Skipping dylib copy - bundle or dylib not found.');
    return;
  }

  // The dylib should go in the MacOS directory or Frameworks directory
  // For simplicity, we'll put it in MacOS since that's where the binary is
  const destDir = path.join(bundle, 'Contents/MacOS');
  const destPath = path.join(destDir, 'libScreenCaptureKitBridge.dylib');

  try {
    // Ensure destination directory exists
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy the dylib
    fs.copyFileSync(dylib, destPath);
    console.log(`✅ Copied libScreenCaptureKitBridge.dylib to ${destPath}`);

  } catch (error) {
    console.error(`❌ Error copying dylib: ${error.message}`);
    process.exit(1);
  }
}

// Run the copy operation
copyDylib().catch(error => {
  console.error(`❌ Script error: ${error.message}`);
  process.exit(1);
});
