// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub struct BackendProcess(pub Arc<Mutex<Option<Child>>>);

fn is_backend_alive(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn find_node_binary(app: &tauri::AppHandle) -> Option<PathBuf> {
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };

    // 1. Packaged standalone node binary inside application bundle resources
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("resources").join("bin").join(node_name),
            resource_dir.join("bin").join(node_name),
            resource_dir.join("resources").join("server").join("bin").join(node_name),
        ];
        for c in candidates {
            if c.exists() {
                return Some(c);
            }
        }
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let candidates = [
                exe_dir.join("..").join("Resources").join("resources").join("bin").join(node_name),
                exe_dir.join("..").join("Resources").join("bin").join(node_name),
                exe_dir.join("resources").join("bin").join(node_name),
                exe_dir.join("bin").join(node_name),
            ];
            for c in candidates {
                if c.exists() {
                    return Some(c);
                }
            }
        }
    }

    // 2. Development directory
    if let Ok(cwd) = std::env::current_dir() {
        let candidates = [
            cwd.join("packages").join("desktop").join("src-tauri").join("resources").join("bin").join(node_name),
            cwd.join("resources").join("bin").join(node_name),
            cwd.join("..").join("..").join("packages").join("desktop").join("src-tauri").join("resources").join("bin").join(node_name),
        ];
        for c in candidates {
            if c.exists() {
                return Some(c);
            }
        }
    }

    // 3. Check NVM with strong preference for Node 22 (matching better-sqlite3 ABI)
    if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
        let home_path = PathBuf::from(home);

        let nvm_versions = home_path.join(".nvm").join("versions").join("node");
        if nvm_versions.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
                let mut v22_nodes = Vec::new();
                let mut other_nodes = Vec::new();
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    let node_bin = path.join("bin").join("node");
                    if node_bin.exists() {
                        if name.starts_with("v22.") {
                            v22_nodes.push(node_bin);
                        } else {
                            other_nodes.push(node_bin);
                        }
                    }
                }
                v22_nodes.sort();
                if let Some(n22) = v22_nodes.into_iter().rev().next() {
                    return Some(n22);
                }
                other_nodes.sort();
                if let Some(any_node) = other_nodes.into_iter().rev().next() {
                    return Some(any_node);
                }
            }
        }

        // FNM
        let fnm_paths = [
            home_path.join(".local").join("share").join("fnm").join("current").join("bin").join("node"),
            home_path.join(".fnm").join("current").join("bin").join("node"),
        ];
        for p in fnm_paths {
            if p.exists() {
                return Some(p);
            }
        }

        // Volta
        let volta_node = home_path.join(".volta").join("bin").join("node");
        if volta_node.exists() {
            return Some(volta_node);
        }

        // asdf
        let asdf_node = home_path.join(".asdf").join("shims").join("node");
        if asdf_node.exists() {
            return Some(asdf_node);
        }
    }

    // 4. Fixed system locations
    let fixed_paths = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
        "/snap/bin/node",
        "C:\\Program Files\\nodejs\\node.exe",
        "C:\\Program Files (x86)\\nodejs\\node.exe",
    ];
    for p in fixed_paths {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }

    // 5. System PATH lookup
    #[cfg(not(windows))]
    {
        if let Ok(output) = std::process::Command::new("which").arg("node").output() {
            if output.status.success() {
                let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !s.is_empty() {
                    let p = PathBuf::from(s);
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(output) = std::process::Command::new("where").arg("node").output() {
            if output.status.success() {
                let s = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !s.is_empty() {
                    let p = PathBuf::from(s);
                    if p.exists() {
                        return Some(p);
                    }
                }
            }
        }
    }

    None
}

fn find_server_entry(app: &tauri::AppHandle) -> Option<PathBuf> {
    // 1. Packaged resource directory in installed app bundle
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("resources").join("server").join("index.mjs"),
            resource_dir.join("server").join("index.mjs"),
            resource_dir.join("resources").join("server").join("dist").join("index.js"),
            resource_dir.join("server").join("dist").join("index.js"),
        ];
        for c in candidates {
            if c.exists() {
                return Some(c);
            }
        }
    }

    // 2. Relative to current executable (Contents/Resources on macOS)
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            let candidates = [
                exe_dir.join("..").join("Resources").join("resources").join("server").join("index.mjs"),
                exe_dir.join("..").join("Resources").join("server").join("index.mjs"),
                exe_dir.join("resources").join("server").join("index.mjs"),
            ];
            for c in candidates {
                if c.exists() {
                    return Some(c);
                }
            }
        }
    }

    // 3. Workspace development directories
    if let Ok(cwd) = std::env::current_dir() {
        let candidates = [
            cwd.join("resources").join("server").join("index.mjs"),
            cwd.join("packages").join("desktop").join("src-tauri").join("resources").join("server").join("index.mjs"),
            cwd.join("packages").join("server").join("dist").join("index.js"),
            cwd.join("..").join("server").join("dist").join("index.js"),
            cwd.join("..").join("..").join("packages").join("server").join("dist").join("index.js"),
            cwd.join("..").join("..").join("packages").join("desktop").join("src-tauri").join("resources").join("server").join("index.mjs"),
        ];
        for c in candidates {
            if c.exists() {
                return Some(c);
            }
        }
    }

    None
}

fn resolve_workspace_dir(app: &tauri::AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        let dev_ws = PathBuf::from("./workspace");
        if dev_ws.exists() {
            return dev_ws;
        }
    }

    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("sp-kickstack"));
    let ws = base.join("workspace");
    let _ = std::fs::create_dir_all(&ws);
    ws
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // Keep app and backend process alive in the background:
                // Hide window to system tray instead of destroying it
                let _ = window.hide();
                api.prevent_close();
            }
            _ => {}
        })
        .setup(|app| {
            println!("⚡ SP Kickstack Desktop App Initialized");

            let backend_state = BackendProcess(Arc::new(Mutex::new(None)));

            if is_backend_alive(4100) {
                println!("⚡ Backend server already alive on 127.0.0.1:4100");
            } else {
                let node_bin = find_node_binary(app.handle()).unwrap_or_else(|| PathBuf::from("node"));
                let server_entry = find_server_entry(app.handle());
                let workspace_dir = resolve_workspace_dir(app.handle());

                if let Some(entry) = server_entry {
                    println!("🚀 Spawning backend server with node: {:?}", node_bin);
                    println!("📂 Server script: {:?}", entry);
                    println!("📁 Workspace dir: {:?}", workspace_dir);

                    let mut cmd = std::process::Command::new(&node_bin);
                    cmd.arg(&entry);
                    if let Some(entry_dir) = entry.parent() {
                        cmd.current_dir(entry_dir);
                    }
                    cmd.env("PORT", "4100");
                    cmd.env("HOST", "127.0.0.1");
                    cmd.env("WORKSPACE_DIR", &workspace_dir);

                    let mut full_path = std::env::var("PATH").unwrap_or_default();
                    #[cfg(not(windows))]
                    {
                        let extra = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
                        if full_path.is_empty() {
                            full_path = extra.to_string();
                        } else {
                            full_path = format!("{}:{}", extra, full_path);
                        }
                        if let Ok(home) = std::env::var("HOME") {
                            full_path = format!("{}/.local/bin:{}/bin:{}", home, home, full_path);
                        }
                    }
                    cmd.env("PATH", full_path);

                    match cmd.spawn() {
                        Ok(child) => {
                            let pid = child.id();
                            println!("✅ Spawned backend server process (PID: {})", pid);
                            *backend_state.0.lock().unwrap() = Some(child);

                            // Wait up to 5 seconds for backend to respond on port 4100
                            for _ in 0..25 {
                                if is_backend_alive(4100) {
                                    println!("⚡ Backend server ready and accepting connections on 127.0.0.1:4100");
                                    break;
                                }
                                std::thread::sleep(Duration::from_millis(200));
                            }
                        }
                        Err(e) => {
                            eprintln!("❌ Failed to spawn backend server: {}", e);
                        }
                    }
                } else {
                    eprintln!("⚠️ Warning: Backend server entrypoint not found! Please build the server bundle.");
                }
            }

            app.manage(backend_state);

            let quit_i = MenuItem::with_id(app, "quit", "Quit SP Kickstack", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building SP Kickstack desktop application");

    app.run(|app_handle, event| match event {
        tauri::RunEvent::Reopen { has_visible_windows, .. } => {
            // Restore window when user clicks the app icon in macOS Dock or Launchpad
            if !has_visible_windows {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
        tauri::RunEvent::Exit => {
            if let Some(backend) = app_handle.try_state::<BackendProcess>() {
                if let Ok(mut guard) = backend.0.lock() {
                    if let Some(mut child) = guard.take() {
                        println!("🛑 Terminating backend server process (PID: {})...", child.id());
                        let _ = child.kill();
                        let _ = child.wait();
                        println!("✅ Backend server process terminated cleanly.");
                    }
                }
            }
        }
        _ => {}
    });
}
