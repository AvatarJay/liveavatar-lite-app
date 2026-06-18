import OpenAI from "openai";
import fs from "fs";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const knowledgeDir = path.join(process.cwd(), "knowledge");

const files = fs
  .readdirSync(knowledgeDir)
  .filter((file) => file.endsWith(".txt") || file.endsWith(".pdf"))
  .map((file) => path.join(knowledgeDir, file));

console.log("Uploading files:", files);

const vectorStore = await openai.vectorStores.create({
  name: "Chef-it Knowledge Base",
});

console.log("Vector store created:", vectorStore.id);

const uploadedFiles = await Promise.all(
  files.map((filePath) =>
    openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "assistants",
    })
  )
);

console.log(
  "Uploaded files:",
  uploadedFiles.map((file) => file.id)
);

await openai.vectorStores.fileBatches.create(vectorStore.id, {
  file_ids: uploadedFiles.map((file) => file.id),
});

console.log("Done.");
console.log("Add this to .env.local:");
console.log(`OPENAI_VECTOR_STORE_ID=${vectorStore.id}`);