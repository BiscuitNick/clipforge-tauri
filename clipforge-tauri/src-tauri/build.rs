use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Run Tauri build
    tauri_build::build();

    // Only compile Swift code on macOS
    if cfg!(target_os = "macos") {
        compile_swift_bridge();
        setup_macos_rpath();
    }
}

fn setup_macos_rpath() {
    // Add rpath for macOS app bundle
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    println!("cargo:rustc-link-arg=-Wl,-rpath,@loader_path/../Frameworks");
}

fn compile_swift_bridge() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let swift_src = PathBuf::from(&manifest_dir).join("src/swift/ScreenCaptureKit.swift");
    let out_dir = env::var("OUT_DIR").unwrap();
    let swift_lib = PathBuf::from(&out_dir).join("libScreenCaptureKitBridge.dylib");

    println!("cargo:rerun-if-changed={}", swift_src.display());

    // Check if Swift file exists
    if !swift_src.exists() {
        println!(
            "cargo:warning=Swift source file not found: {}",
            swift_src.display()
        );
        return;
    }

    println!("cargo:warning=Compiling Swift bridge module...");

    // Compile Swift code into a dynamic library with proper install name
    let output = Command::new("swiftc")
        .arg("-emit-library")
        .arg("-o")
        .arg(&swift_lib)
        .arg("-module-name")
        .arg("ScreenCaptureKitBridge")
        .arg("-Xlinker")
        .arg("-install_name")
        .arg("-Xlinker")
        .arg("@executable_path/../Frameworks/libScreenCaptureKitBridge.dylib")
        .arg("-framework")
        .arg("ScreenCaptureKit")
        .arg("-framework")
        .arg("AVFoundation")
        .arg("-framework")
        .arg("CoreMedia")
        .arg("-framework")
        .arg("Foundation")
        .arg(&swift_src)
        .output()
        .expect("Failed to execute swiftc");

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        panic!("Swift compilation failed:\n{}", stderr);
    }

    println!(
        "cargo:warning=Swift compilation successful: {}",
        swift_lib.display()
    );

    // Copy the library to the lib directory for Tauri bundling
    let lib_dir = PathBuf::from(&manifest_dir).join("lib");
    std::fs::create_dir_all(&lib_dir).expect("Failed to create lib directory");
    let dest_lib = lib_dir.join("libScreenCaptureKitBridge.dylib");
    std::fs::copy(&swift_lib, &dest_lib).expect("Failed to copy Swift library to lib directory");

    println!(
        "cargo:warning=Copied library to: {}",
        dest_lib.display()
    );

    // Tell cargo to link the Swift library
    println!("cargo:rustc-link-search=native={}", out_dir);
    println!("cargo:rustc-link-lib=dylib=ScreenCaptureKitBridge");

    // Link required frameworks
    println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=CoreMedia");
    println!("cargo:rustc-link-lib=framework=Foundation");
}
