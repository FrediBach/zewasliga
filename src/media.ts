export type DirectoryPickerHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};
export type DirectoryPickerWindow = Window & { showDirectoryPicker?: () => Promise<DirectoryPickerHandle> };

type FileIdentity = Pick<File, "name" | "type">;

const IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
const pickedPaths = new WeakMap<File, string>();
const pathOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function isImageFile(file: FileIdentity): boolean {
  return IMAGE_TYPES.has(file.type.toLowerCase()) || /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name);
}

export function isAudioFile(file: FileIdentity): boolean {
  return AUDIO_TYPES.has(file.type.toLowerCase()) || /\.(mp3|wav)$/i.test(file.name);
}

export function isVideoFile(file: FileIdentity): boolean {
  return VIDEO_TYPES.has(file.type.toLowerCase()) || /\.(mp4|mov)$/i.test(file.name);
}

export function mediaPath(file: File): string {
  return pickedPaths.get(file) || file.webkitRelativePath || file.name;
}

export function compareMediaFiles(left: File, right: File): number {
  const leftPath = mediaPath(left);
  const rightPath = mediaPath(right);
  return pathOrder.compare(leftPath, rightPath) || (leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0);
}

export async function collectMediaFiles(handle: DirectoryPickerHandle): Promise<File[]> {
  const files: File[] = [];

  async function collect(directory: DirectoryPickerHandle, parentPath: string) {
    for await (const entry of directory.values()) {
      const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        await collect(entry as DirectoryPickerHandle, path);
      } else {
        const file = await entry.getFile();
        if (isImageFile(file) || isAudioFile(file) || isVideoFile(file)) {
          // Directory-picker Files omit webkitRelativePath. Preserve the path
          // separately so nested tracks retain their ordering and display name.
          pickedPaths.set(file, path);
          files.push(file);
        }
      }
    }
  }

  await collect(handle, "");
  return files.sort(compareMediaFiles);
}
