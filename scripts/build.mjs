import { build } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist");
const sharedDir = path.join(distRoot, "shared");
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
const requestedTarget = targetArg?.split("=")[1] ?? "all";
const targets = requestedTarget === "all" ? ["chrome", "firefox"] : [requestedTarget];

if (!targets.every((target) => target === "chrome" || target === "firefox")) {
  throw new Error(`Unknown build target: ${requestedTarget}`);
}

const baseBuild = {
  configFile: false,
  root,
  build: {
    target: "es2022",
    sourcemap: true,
    minify: false,
    emptyOutDir: false
  }
};

async function removeIfExists(filePath) {
  await fs.rm(filePath, { recursive: true, force: true });
}

async function buildScript(entry, name, fileName) {
  await build({
    ...baseBuild,
    build: {
      ...baseBuild.build,
      outDir: path.join(sharedDir, "assets"),
      lib: {
        entry: path.join(root, entry),
        name,
        formats: ["iife"],
        fileName: () => fileName
      },
      rollupOptions: {
        output: {
          extend: false,
          inlineDynamicImports: true
        }
      }
    }
  });
}

async function buildPages() {
  const pageRoot = path.join(root, "src");
  await build({
    ...baseBuild,
    root: pageRoot,
    build: {
      ...baseBuild.build,
      outDir: sharedDir,
      rollupOptions: {
        input: {
          options: path.join(pageRoot, "options.html"),
          popup: path.join(pageRoot, "popup.html")
        },
        output: {
          entryFileNames: "assets/[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    }
  });
}

async function copyDirectory(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

function commonManifest(target) {
  return {
    manifest_version: 3,
    name: "Locus",
    version: "0.1.0",
    description: "捕获网页元素 XPath/CSS/文本/正则，支持相似元素查找。插件作者：玛卡巴卡大王，关注微信公众号：大王的琅琊阁",
    action: {
      default_title: "Locus",
      default_popup: "popup.html"
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true
    },
    permissions: ["storage", "clipboardWrite", "activeTab"],
    host_permissions: ["<all_urls>"],
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["assets/content.js"],
        run_at: "document_idle",
        all_frames: true,
        match_about_blank: true
      }
    ],
    commands: {
      "locus-freeze-capture": {
        suggested_key: {
          default: "Alt+Z",
          mac: "Alt+Z"
        },
        description: "切换悬停自动捕获模式"
      },
      "locus-capture-current": {
        suggested_key: {
          default: "Ctrl+Shift+Z",
          mac: "Ctrl+Shift+Z"
        },
        description: "捕获当前鼠标下方或红框元素"
      },
      "locus-validate-current": {
        suggested_key: {
          default: "Alt+X",
          mac: "Alt+X"
        },
        description: "校验当前 Locus 面板中的定位表达式"
      }
    }
  };
}

function manifestFor(target) {
  const manifest = commonManifest(target);
  if (target === "chrome") {
    manifest.background = {
      service_worker: "assets/service-worker.js"
    };
  } else {
    manifest.background = {
      scripts: ["assets/firefox-background.js"]
    };
    manifest.browser_specific_settings = {
      gecko: {
        id: "locus@example.local",
        strict_min_version: "109.0",
        data_collection_permissions: {
          required: ["none"],
          optional: []
        }
      }
    };
  }
  return manifest;
}

await removeIfExists(distRoot);
await fs.mkdir(sharedDir, { recursive: true });
await buildScript("src/content/index.ts", "LocusContent", "content.js");
await buildScript("src/background/service-worker.ts", "LocusServiceWorker", "service-worker.js");
await buildScript("src/background/firefox-background.ts", "LocusFirefoxBackground", "firefox-background.js");
await buildPages();

for (const target of targets) {
  const outDir = path.join(distRoot, target);
  await removeIfExists(outDir);
  await copyDirectory(sharedDir, outDir);
  await fs.writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifestFor(target), null, 2)}\n`,
    "utf8"
  );
}

console.log(`Built Locus extension for ${targets.join(", ")}.`);
