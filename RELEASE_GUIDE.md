# Release Guide for ClipForge

This guide explains how to create and publish releases for ClipForge using GitHub Releases.

## Prerequisites

1. Push access to the GitHub repository
2. All changes committed and pushed to main branch
3. Version number decided (e.g., `v0.1.0`, `v1.0.0`)

## Automated Release Process (Recommended)

The project is configured with GitHub Actions to automatically build releases for macOS, Windows, and Linux.

### Step 1: Update Version Numbers

Update the version in both configuration files:

**1. Update `clipforge-tauri/package.json`:**
```json
{
  "name": "clipforge-tauri",
  "version": "0.1.0",  // <-- Update this
  ...
}
```

**2. Update `clipforge-tauri/src-tauri/tauri.conf.json`:**
```json
{
  "productName": "ClipForge",
  "version": "0.1.0",  // <-- Update this
  ...
}
```

**3. Update `clipforge-tauri/src-tauri/Cargo.toml`:**
```toml
[package]
name = "clipforge-tauri"
version = "0.1.0"  # <-- Update this
```

### Step 2: Commit Version Changes

```bash
git add .
git commit -m "chore: bump version to v0.1.0"
git push origin main
```

### Step 3: Create and Push Git Tag

```bash
# Create an annotated tag
git tag -a v0.1.0 -m "Release v0.1.0"

# Push the tag to GitHub
git push origin v0.1.0
```

### Step 4: Monitor GitHub Actions

1. Go to your repository on GitHub
2. Click on the "Actions" tab
3. You should see a "Release" workflow running
4. The workflow will:
   - Build the app for macOS (Universal binary)
   - Build the app for Windows (x64)
   - Build the app for Linux (x64)
   - Create a draft release with all binaries attached

This process typically takes 15-30 minutes depending on GitHub's runners.

### Step 5: Finalize the Release

1. Go to the [Releases page](https://github.com/BiscuitNick/clipforge-tauri/releases)
2. Find your draft release
3. Review the release notes (auto-generated from the workflow)
4. Edit the release notes to add:
   - New features
   - Bug fixes
   - Breaking changes
   - Known issues
5. Click "Publish release"

## Manual Release Process

If you need to create a release manually (e.g., GitHub Actions is not available):

### Step 1: Build for Your Platform

```bash
cd clipforge-tauri
npm install
npm run tauri build
```

Find the built artifacts in:
- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Windows**: `src-tauri/target/release/bundle/msi/`
- **Linux**: `src-tauri/target/release/bundle/deb/` and `appimage/`

### Step 2: Create GitHub Release Manually

1. Go to [Releases page](https://github.com/BiscuitNick/clipforge-tauri/releases)
2. Click "Draft a new release"
3. Click "Choose a tag" and create a new tag (e.g., `v0.1.0`)
4. Set release title: `ClipForge v0.1.0`
5. Write release notes
6. Upload build artifacts by dragging them into the release
7. Click "Publish release"

## Release Notes Template

```markdown
## What's New in ClipForge v0.1.0

### Features
- Timeline-based video editing with drag-and-drop
- Real-time preview and playback
- Professional export with FFmpeg
- Keyboard shortcuts for efficient editing
- Undo/Redo support (50 states)

### Bug Fixes
- (List any bug fixes)

### Known Issues
- (List any known issues)

### Installation

**Requirements**: FFmpeg must be installed on your system
- macOS: `brew install ffmpeg`
- Windows: Download from https://ffmpeg.org/download.html
- Linux: `sudo apt install ffmpeg` or `sudo dnf install ffmpeg`

**Downloads**:
- **macOS**: Download the `.dmg` file
- **Windows**: Download the `.msi` installer
- **Linux**: Download the `.deb` package or `.AppImage`

See the [README](https://github.com/BiscuitNick/clipforge-tauri/blob/main/README.md) for full build instructions.

### System Requirements

**Minimum**:
- macOS 10.15+ / Windows 10+ / Ubuntu 20.04+
- 4GB RAM
- 2GB free disk space
- FFmpeg 4.0 or higher

**Recommended**:
- 8GB RAM
- SSD storage
- FFmpeg 5.0 or higher
```

## Troubleshooting

### Build Fails in GitHub Actions

**Check the Actions log:**
1. Go to Actions tab
2. Click on the failed workflow run
3. Review the logs for each platform

**Common issues:**
- Missing dependencies (check the install steps)
- Rust compilation errors (update Rust version in workflow)
- Node.js issues (update Node.js version in workflow)

### Tag Already Exists

If you need to recreate a tag:

```bash
# Delete local tag
git tag -d v0.1.0

# Delete remote tag
git push origin :refs/tags/v0.1.0

# Create new tag
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

### Build Artifacts Missing

Ensure the GitHub Actions workflow has the correct permissions:
- Go to repository Settings > Actions > General
- Under "Workflow permissions", ensure "Read and write permissions" is selected

## Alternative Distribution Methods

### Google Drive

1. Build the app locally for all platforms (or use the artifacts from GitHub Actions)
2. Upload to a Google Drive folder
3. Set sharing permissions to "Anyone with the link can view"
4. Share the link with users

**Folder structure:**
```
ClipForge/
├── v0.1.0/
│   ├── macOS/
│   │   └── ClipForge_0.1.0_universal.dmg
│   ├── Windows/
│   │   └── ClipForge_0.1.0_x64.msi
│   └── Linux/
│       ├── ClipForge_0.1.0_amd64.deb
│       └── ClipForge_0.1.0_amd64.AppImage
└── README.txt (installation instructions)
```

### Dropbox

Similar to Google Drive:
1. Upload build artifacts to a Dropbox folder
2. Generate sharing links for each file
3. Update README with download links

## Versioning Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR.MINOR.PATCH** (e.g., 1.2.3)
  - **MAJOR**: Breaking changes
  - **MINOR**: New features (backward compatible)
  - **PATCH**: Bug fixes (backward compatible)

**Examples:**
- `v0.1.0` - Initial beta release
- `v0.2.0` - Added new feature (clip splitting)
- `v0.2.1` - Fixed export bug
- `v1.0.0` - First stable release

## Pre-release Versions

For beta or release candidate versions:

```bash
# Beta release
git tag -a v0.1.0-beta.1 -m "Beta release 0.1.0-beta.1"

# Release candidate
git tag -a v1.0.0-rc.1 -m "Release candidate 1.0.0-rc.1"
```

When creating the GitHub release, check the "This is a pre-release" checkbox.

## Checklist Before Release

- [ ] All tests pass
- [ ] Version numbers updated in all files
- [ ] CHANGELOG.md updated (if you maintain one)
- [ ] README.md reflects current features
- [ ] All new features documented
- [ ] Known issues documented
- [ ] Build tested on target platforms
- [ ] FFmpeg dependency documented
- [ ] Release notes prepared

## Next Steps

After your first successful release:

1. Consider setting up auto-updates with Tauri Updater
2. Add download badges to README
3. Create a changelog file
4. Set up automated testing in CI/CD
5. Consider code signing for macOS and Windows

---

**Need help?** Open an issue on the [GitHub repository](https://github.com/BiscuitNick/clipforge-tauri/issues).
