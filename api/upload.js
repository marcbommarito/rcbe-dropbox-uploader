// api/upload.js
// Runtime: Node 20 (set in vercel.json). No external packages.

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.DROPBOX_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "Missing DROPBOX_ACCESS_TOKEN env var" });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Invalid JSON" });
  }

  const { filename, url, content, folder } = body;
  if (!filename || (!url && !content)) {
    return res.status(400).json({
      error: "Provide 'filename' and either 'url' (public file URL) or 'content' (base64)."
    });
  }

  try {
    let fileBuffer;

    if (url) {
      const r = await fetch(url);
      if (!r.ok) {
        return res.status(400).json({ error: `Failed to fetch URL (${r.status})` });
      }
      const arrayBuf = await r.arrayBuffer();
      fileBuffer = Buffer.from(arrayBuf);
    } else {
      // base64
      // supports data URL prefix (e.g., "data:...;base64,xxxxx")
      const base64 = content.includes(",") ? content.split(",").pop() : content;
      fileBuffer = Buffer.from(base64, "base64");
    }

    const dropboxPath =
      `${folder || process.env.DROPBOX_FOLDER || ""}/${filename}`
        .replace(/\/+/g, "/")
        .replace(/^\//, "/"); // ensure leading slash

    const resp = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({
          path: dropboxPath,
          mode: "add",
          autorename: true,
          mute: false,
          strict_conflict: false
        })
      },
      body: fileBuffer
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(400).json({ error: "Dropbox upload failed", details: text });
    }

    const json = await resp.json();
    return res.status(200).json({ ok: true, file: json });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unexpected error" });
  }
}
