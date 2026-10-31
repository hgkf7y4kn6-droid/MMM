import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";

/**
 * Pick a receipt photo or a statement to upload. Photos are re-encoded as JPEG at
 * 0.7 quality, which keeps them well under the server's 5 MB photo limit and turns
 * iPhone HEIC photos into a format the server reads. Returns null when the user cancels.
 */
export async function pickPhoto(source: "camera" | "library"): Promise<PickedFile | null> {
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error("Allow camera access in Settings to photograph a receipt.");
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, exif: false };
  const result =
    source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  const mimeType = a.mimeType ?? "image/jpeg";
  const ext = mimeType.split("/")[1] ?? "jpg";
  return { uri: a.uri, name: a.fileName ?? `receipt.${ext}`, mimeType, file: Platform.OS === "web" ? a.file : undefined };
}

/** A statement: PDF, CSV export, or an image file. */
export async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "image/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  return { uri: a.uri, name: a.name, mimeType: a.mimeType ?? "application/octet-stream", file: a.file };
}
