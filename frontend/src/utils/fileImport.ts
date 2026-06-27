/**
 * fileImport.ts
 *
 * Picks a document file (.txt, .md, .docx, .pdf) and extracts its plain text.
 *
 * Supported formats:
 *   .txt / .md   — read directly via expo-file-system
 *   .docx        — unzip and extract word/document.xml, strip XML tags
 *   .pdf         — extract embedded text streams (works for text-based PDFs,
 *                  not scanned/image-only PDFs)
 *
 * Returns the extracted text string, or throws on failure.
 */

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

export type ImportResult = {
  text: string;
  fileName: string;
  characterCount: number;
};

/** Open the OS file picker and return extracted text. */
export async function pickAndImportManuscript(): Promise<ImportResult | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "text/plain",
      "text/markdown",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/pdf",
      // Android sometimes uses these
      "application/octet-stream",
      "application/msword",
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const uri = asset.uri;
  const name = asset.name ?? "document";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";

  let text = "";

  if (ext === "txt" || ext === "md") {
    text = await readTextFile(uri);
  } else if (ext === "docx") {
    text = await extractDocx(uri);
  } else if (ext === "pdf") {
    text = await extractPdf(uri);
  } else {
    // Fallback — try reading as UTF-8 text
    try {
      text = await readTextFile(uri);
    } catch {
      throw new Error(`Unsupported file type: .${ext}. Please use .txt, .docx, or .pdf.`);
    }
  }

  if (!text.trim()) {
    throw new Error(
      "No readable text found in this file. If it's a scanned PDF or image-based document, please copy-paste the text instead."
    );
  }

  return { text: text.trim(), fileName: name, characterCount: text.length };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function readTextFile(uri: string): Promise<string> {
  return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
}

async function extractDocx(uri: string): Promise<string> {
  /**
   * .docx is a ZIP file. We read it as base64, then manually parse
   * word/document.xml which holds the actual prose.
   *
   * We use a pure-JS ZIP parser (no native module needed) so this works
   * on both iOS and Android without any extra native dependencies.
   */
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    // Lazy-import to keep bundle light when not needed
    const { unzipBase64 } = await import("./zipUtils");
    const xml = await unzipBase64(b64, "word/document.xml");
    return cleanDocxXml(xml);
  } catch (e: any) {
    throw new Error(`Could not read .docx file: ${e?.message || "unknown error"}`);
  }
}

function cleanDocxXml(xml: string): string {
  // Extract text runs: <w:t ...>text</w:t>
  const runs: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m: RegExpExecArray | null;
  let prevParagraph = false;

  // Also detect paragraph breaks <w:p > to insert newlines
  const paragraphRe = /<w:p[\s>]/g;
  const allTags = /<\/?w:[a-zA-Z]+[^>]*>/g;

  // Walk through XML preserving paragraph structure
  let pos = 0;
  let result = "";
  const tagRe = /<(\/?)w:([a-zA-Z]+)[^>]*>/g;
  let tag: RegExpExecArray | null;

  const textBuf: string[] = [];
  let inParagraph = false;

  // Simple streaming parse
  const stripped = xml
    .replace(/<w:p[ >]/g, "\n__PARA__")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/__PARA__/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  return stripped;
}

async function extractPdf(uri: string): Promise<string> {
  /**
   * PDF text extraction — reads the raw PDF bytes and extracts text streams.
   * Works for standard text-based PDFs (most Word-exported PDFs).
   * Scanned image-PDFs will produce empty output (we surface a helpful error).
   */
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const binary = atob(b64);
    return extractPdfText(binary);
  } catch (e: any) {
    throw new Error(`Could not read PDF: ${e?.message || "unknown error"}`);
  }
}

function extractPdfText(binary: string): string {
  /**
   * Extracts text from PDF content streams using basic stream parsing.
   * Handles Tj, TJ, and ' operators (standard PDF text operators).
   * Not a full PDF parser — handles the vast majority of exported manuscripts.
   */
  const texts: string[] = [];

  // Find all content streams
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;

  while ((m = streamRe.exec(binary)) !== null) {
    const stream = m[1];
    // Skip binary/compressed streams (contain many non-printable chars)
    const printable = stream.replace(/[^\x20-\x7E\n\r\t]/g, "");
    if (printable.length < stream.length * 0.5) continue;

    // Extract text from BT...ET blocks
    const btRe = /BT([\s\S]*?)ET/g;
    let bt: RegExpExecArray | null;
    while ((bt = btRe.exec(stream)) !== null) {
      const block = bt[1];
      // Tj: (text)Tj
      const tjRe = /\(([^)]*)\)\s*Tj/g;
      let tj: RegExpExecArray | null;
      while ((tj = tjRe.exec(block)) !== null) {
        texts.push(decodePdfString(tj[1]));
      }
      // TJ: [(text)-200(more)]TJ
      const tjArrRe = /\[([^\]]*)\]\s*TJ/g;
      let tja: RegExpExecArray | null;
      while ((tja = tjArrRe.exec(block)) !== null) {
        const innerRe = /\(([^)]*)\)/g;
        let inner: RegExpExecArray | null;
        while ((inner = innerRe.exec(tja[1])) !== null) {
          texts.push(decodePdfString(inner[1]));
        }
      }
      // Td / T* operators signal new lines
      if (/T[\*d]/.test(block)) texts.push("\n");
    }
  }

  return texts
    .join("")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodePdfString(raw: string): string {
  // Unescape PDF octal sequences and common escapes
  return raw
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}
