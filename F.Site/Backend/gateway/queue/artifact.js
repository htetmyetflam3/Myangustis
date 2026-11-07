import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
const safeName = (name, fallback) => {
  const base = path
    .basename(String(name || fallback))
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "");
  return base || fallback;
};
export async function storeAnalysisArtifact({
  bytes,
  filename,
  submitId,
  outputDir,
}) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error("Engine result bytes must be a Buffer");
  }
  if (!submitId) throw new Error("submitId is required");
  const safe = safeName(filename, `${submitId}.txt`);
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const file = path.join(outputDir, `${submitId}_${safe}`);
  const temporary = path.join(
    outputDir,
    `.${submitId}_${safe}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  await fs.writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
  try {
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return {
    file,
    filename: safe,
    bytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}