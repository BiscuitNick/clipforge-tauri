# Auto-Update Setup Guide (Optional)

This guide shows how to set up automatic updates for ClipForge using Tauri's built-in updater. This allows users to receive updates without manually downloading new releases.

## Overview

The Tauri Updater:
- Checks for new versions from GitHub Releases
- Downloads and installs updates in the background
- Shows update notifications to users
- Supports signature verification for security

## Prerequisites

- GitHub repository with releases enabled
- Code signing certificates (optional but recommended for production)

## Step 1: Install Tauri Updater Plugin

```bash
cd clipforge-tauri
npm install @tauri-apps/plugin-updater
```

## Step 2: Update Cargo Dependencies

Edit `clipforge-tauri/src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = ["protocol-asset"] }
tauri-plugin-updater = "2"  # Add this line
# ... other dependencies
```

## Step 3: Configure Tauri Updater

Edit `clipforge-tauri/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "ClipForge",
  "version": "0.1.0",
  "identifier": "com.nickkenkel.clipforge",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    // ... existing app config
  },
  "bundle": {
    // ... existing bundle config
  },
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://github.com/BiscuitNick/clipforge-tauri/releases/latest/download/latest.json"
      ],
      "dialog": true,
      "pubkey": "YOUR_PUBLIC_KEY_HERE"  // We'll generate this
    }
  }
}
```

## Step 4: Generate Signing Keys (Optional but Recommended)

For security, updates should be signed:

```bash
# Install the Tauri CLI globally if not already installed
npm install -g @tauri-apps/cli

# Generate signing keys
cd clipforge-tauri/src-tauri
tauri signer generate -w ~/.tauri/myapp.key

# This generates two files:
# - ~/.tauri/myapp.key (private key - keep this SECRET!)
# - ~/.tauri/myapp.key.pub (public key)
```

**Important:**
- Keep your private key SECRET (never commit it to git)
- Add the public key to `tauri.conf.json` in the `pubkey` field
- Store the private key securely (e.g., GitHub Secrets)

Add to `.gitignore`:
```
*.key
```

Copy the public key content:
```bash
cat ~/.tauri/myapp.key.pub
```

Update `tauri.conf.json` with the public key:
```json
"plugins": {
  "updater": {
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCQ0RFRkdISUo...",
    // ... rest of config
  }
}
```

## Step 5: Add Updater to Rust Code

Edit `clipforge-tauri/src-tauri/src/lib.rs`:

```rust
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())  // Add this
        .setup(|app| {
            // Check for updates on startup
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match tauri_plugin_updater::check_update(&handle).await {
                        Ok(Some(update)) => {
                            println!("Update available: {}", update.version);
                            // Update will be shown via dialog if configured
                        }
                        Ok(None) => println!("No updates available"),
                        Err(e) => eprintln!("Failed to check for updates: {}", e),
                    }
                });
            }
            Ok(())
        })
        // ... rest of builder config
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## Step 6: Add Update Check to Frontend (Optional)

Create a React component to manually check for updates:

```jsx
// src/components/UpdateChecker.jsx
import { check } from '@tauri-apps/plugin-updater';
import { ask } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';

export function UpdateChecker() {
  const checkForUpdates = async () => {
    try {
      const update = await check();

      if (update?.available) {
        const yes = await ask(
          `Update to ${update.version} is available!\n\nRelease notes: ${update.body}`,
          {
            title: 'Update Available',
            kind: 'info',
            okLabel: 'Update',
            cancelLabel: 'Later'
          }
        );

        if (yes) {
          await update.downloadAndInstall();
          await relaunch();
        }
      } else {
        await ask('You are already on the latest version!', {
          title: 'No Updates',
          kind: 'info'
        });
      }
    } catch (error) {
      console.error('Update check failed:', error);
    }
  };

  return (
    <button onClick={checkForUpdates}>
      Check for Updates
    </button>
  );
}
```

Add to your app:
```jsx
// src/App.jsx
import { UpdateChecker } from './components/UpdateChecker';

function App() {
  return (
    <div>
      {/* Your existing UI */}
      <UpdateChecker />
    </div>
  );
}
```

## Step 7: Update GitHub Actions Workflow

Update `.github/workflows/release.yml` to sign releases:

```yaml
- name: Build the app
  uses: tauri-apps/tauri-action@v0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  with:
    projectPath: ./clipforge-tauri
    tagName: ${{ github.ref_name }}
    # ... rest of configuration
```

## Step 8: Add Secrets to GitHub

1. Go to your repository on GitHub
2. Navigate to Settings > Secrets and variables > Actions
3. Add new repository secrets:
   - `TAURI_SIGNING_PRIVATE_KEY`: Content of your private key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password for the key (if you set one)

To get the private key content:
```bash
cat ~/.tauri/myapp.key
```

## Step 9: Test the Updater

### Testing Locally

1. Build a release version:
```bash
npm run tauri build
```

2. Install the built app

3. Create a new version (e.g., bump from v0.1.0 to v0.1.1)

4. Create a GitHub release with the new version

5. Run the installed app - it should detect and offer the update

### Testing Without Code Signing

If you want to test without code signing (development only):

```json
// tauri.conf.json
"plugins": {
  "updater": {
    "active": true,
    "endpoints": [
      "https://github.com/BiscuitNick/clipforge-tauri/releases/latest/download/latest.json"
    ],
    "dialog": true
    // Remove or comment out "pubkey"
  }
}
```

**Warning:** Do not ship production apps without code signing!

## Update Manifest

The Tauri action automatically creates a `latest.json` file with each release. This file contains:

```json
{
  "version": "v0.1.0",
  "notes": "Release notes here",
  "pub_date": "2025-01-15T00:00:00Z",
  "platforms": {
    "darwin-x86_64": {
      "signature": "...",
      "url": "https://github.com/..."
    },
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://github.com/..."
    },
    "linux-x86_64": {
      "signature": "...",
      "url": "https://github.com/..."
    },
    "windows-x86_64": {
      "signature": "...",
      "url": "https://github.com/..."
    }
  }
}
```

## Troubleshooting

### Update Check Fails

Check the console for error messages:
```bash
# In development
npm run tauri dev
# Check the console output
```

### Signature Verification Fails

- Ensure the public key in `tauri.conf.json` matches your private key
- Verify the private key is correctly set in GitHub Secrets
- Make sure the key was not corrupted when copying

### Updates Not Showing

- Verify the GitHub release is published (not draft)
- Check the version number is higher than the installed version
- Ensure `latest.json` was uploaded to the release
- Check network connectivity

## Best Practices

1. **Always sign releases in production**
2. **Test updates before releasing**
3. **Keep private keys secure** (use GitHub Secrets, never commit)
4. **Provide clear release notes** so users know what changed
5. **Test on all platforms** before releasing
6. **Consider a beta channel** for testing updates

## Update Frequency

Recommended update check timing:
- On app startup (current implementation)
- Once per day (for long-running apps)
- Manual check via menu option

Example of daily check:
```rust
// In setup()
tauri::async_runtime::spawn(async move {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(86400)).await; // 24 hours
        if let Ok(Some(update)) = tauri_plugin_updater::check_update(&handle).await {
            // Notify user
        }
    }
});
```

## Disabling Auto-Updates

Users may want to disable auto-updates. Consider adding a settings option:

```json
// User settings file
{
  "autoUpdate": true
}
```

```rust
// Check setting before update check
if settings.auto_update {
    check_update(&handle).await;
}
```

## Resources

- [Tauri Updater Documentation](https://tauri.app/v1/guides/distribution/updater)
- [Tauri Plugin Updater](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater)
- [Code Signing Guide](https://tauri.app/v1/guides/distribution/sign-macos)

---

**Note:** Auto-updates are optional. You can distribute your app through GitHub Releases without implementing the updater, and users can manually download new versions.
