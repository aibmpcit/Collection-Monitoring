export interface AttachmentUpload {
  name: string;
  type: string;
  data: string;
}

export async function fileToAttachment(file: File | null): Promise<AttachmentUpload | undefined> {
  if (!file) return undefined;
  if (file.size > 5 * 1024 * 1024) throw new Error("Attachment must be 5 MB or smaller.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Unable to read attachment."));
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type || "application/octet-stream", data: dataUrl.split(",")[1] ?? "" };
}
