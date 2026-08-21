const { existsSync } = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");
const runtimeAssets = require("./runtime-assets.cjs");

const requiredResources = [...runtimeAssets.onnxAssets, ...runtimeAssets.packagedResources];
const requiredAsarFiles = runtimeAssets.asarFiles;

function resourcesRoot(context) {
  return path.join(context.appOutDir, "resources");
}

exports.default = async function verifyPackagedRuntimeAssets(context) {
  const root = resourcesRoot(context);
  const missing = requiredResources.filter(
    (relativePath) => !existsSync(path.join(root, relativePath)),
  );

  if (missing.length > 0) {
    throw new Error(`Packaged build is missing runtime resource file(s): ${missing.join(", ")}`);
  }

  const appAsarPath = path.join(root, "app.asar");
  if (!existsSync(appAsarPath)) {
    throw new Error("Packaged build is missing app.asar");
  }

  const packagedFiles = new Set(
    asar.listPackage(appAsarPath).map((entry) => entry.replace(/^[/\\]+/, "").replace(/\\/g, "/")),
  );
  const missingAsarFiles = requiredAsarFiles.filter(
    (relativePath) => !packagedFiles.has(relativePath),
  );

  if (missingAsarFiles.length > 0) {
    throw new Error(`Packaged app.asar is missing runtime file(s): ${missingAsarFiles.join(", ")}`);
  }
};
