// Simple shared state for uploaded and cropped image across pages
export function useUploadedImage() {
  const uploadedImage = useState<string | null>('uploaded-image', () => null)
  const croppedImage = useState<string | null>('cropped-image', () => null)
  return { uploadedImage, croppedImage }
}

