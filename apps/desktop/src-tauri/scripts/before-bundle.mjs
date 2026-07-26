import { copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [path.join(scriptDir, scriptName)], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptName} exited with code ${code ?? "unknown"}`));
    });
  });
}

if (process.platform === "win32") {
  console.log("[before-bundle] Windows detected, copying VC runtime DLLs.");
  const sys32 = process.env.windir
    ? path.join(process.env.windir, "System32")
    : "C:\\Windows\\System32";
  const vcrtDir = path.join(scriptDir, "..", "resources", "vcrt");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(vcrtDir, { recursive: true });
  const dlls = ["msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"];
  for (const dll of dlls) {
    const src = path.join(sys32, dll);
    const dest = path.join(vcrtDir, dll);
    try {
      await copyFile(src, dest);
      console.log(`[before-bundle] Copied: ${dll}`);
    } catch (err) {
      console.warn(`[before-bundle] Could not copy ${dll}: ${err.message}`);
    }
  }
  process.exit(0);
}

if (process.platform === "darwin") {
  await runScript("compile-icons.sh");
}

await runScript("fix-dylib.sh");
