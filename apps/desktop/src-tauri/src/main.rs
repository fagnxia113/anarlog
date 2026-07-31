// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let msg = if let Some(s) = payload.downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else {
            "panic of unknown type".to_string()
        };

        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".to_string());

        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>");

        let full_msg = format!(
            "PANIC in thread '{}' at {}\n  message: {}\n  backtrace:\n{}",
            thread_name,
            location,
            msg,
            std::backtrace::Backtrace::capture()
        );

        eprintln!("{full_msg}");

        if let Some(dir) = dirs::data_dir() {
            let log_dir = dir.join("com.zhnote.dev").join("logs");
            let _ = std::fs::create_dir_all(&log_dir);
            let log_path = log_dir.join("panic.log");
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
            {
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                let _ = writeln!(f, "[{timestamp}] {full_msg}\n");
            }
        }

        default_hook(info);
    }));
}

fn main() {
    install_panic_hook();
    hyprnote_desktop_lib::main()
}
