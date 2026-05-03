import Foundation
import Capacitor
import Vision
import UIKit

/// Capacitor plugin that bridges iOS Vision's person-segmentation request to
/// the JS layer. Used by the /photos/compare Silhouette mode to render an
/// outline-only overlay (shape-only comparison without lighting / clothing
/// / background noise).
///
/// JS API (see `src/lib/native/person-segmentation.ts`):
///   PersonSegmentation.segment({ imageBase64 }) → { maskPngBase64, durationMs }
///
/// Output is a single-channel 8-bit PNG sized to the source image's pixel
/// dimensions; white = person, black = background. The JS side then uploads
/// it to Vercel Blob via POST /api/{kind}-photos/{uuid}/mask and caches the
/// resulting URL on the photo row.
///
/// Quality level is `.balanced` — `.fast` produces visibly rough hair/clothing
/// edges; `.accurate` adds latency for diminishing returns at the resolutions
/// progress photos use. Tunable per-call later if needed.
///
/// Requires iOS 15+ (Vision person segmentation API). On older OS the plugin
/// rejects with `UNSUPPORTED_OS`; the JS layer renders the Silhouette mode
/// "iOS app required" empty state.
@objc(PersonSegmentationPlugin)
public class PersonSegmentationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PersonSegmentationPlugin"
    public let jsName = "PersonSegmentation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "segment", returnType: CAPPluginReturnPromise),
    ]

    @objc func segment(_ call: CAPPluginCall) {
        guard let imageBase64 = call.getString("imageBase64") else {
            call.reject("imageBase64 is required")
            return
        }

        guard #available(iOS 15.0, *) else {
            call.reject("UNSUPPORTED_OS", "Person segmentation requires iOS 15+")
            return
        }

        guard let imageData = Data(base64Encoded: imageBase64),
              let uiImage = UIImage(data: imageData),
              let cgImage = uiImage.cgImage else {
            call.reject("INVALID_IMAGE", "Could not decode image from base64")
            return
        }

        let started = Date()

        // Run on a background queue — segmentation is ~30-300ms depending on
        // image size + quality level + device.
        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNGeneratePersonSegmentationRequest()
            request.qualityLevel = .balanced
            request.outputPixelFormat = kCVPixelFormatType_OneComponent8

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

            do {
                try handler.perform([request])
            } catch {
                DispatchQueue.main.async {
                    call.reject("VISION_ERROR", "Vision segmentation failed: \(error.localizedDescription)")
                }
                return
            }

            guard let mask = request.results?.first?.pixelBuffer else {
                DispatchQueue.main.async {
                    call.reject("NO_MASK", "Vision did not return a mask")
                }
                return
            }

            // Convert CVPixelBuffer (single-channel 8-bit) → grayscale PNG.
            // Resize the mask back to the source image dimensions so it
            // overlays 1:1 in the web layer (Vision returns the mask at its
            // own internal resolution, NOT the source dimensions).
            guard let pngData = self.maskToPng(mask: mask, targetSize: CGSize(width: cgImage.width, height: cgImage.height)) else {
                DispatchQueue.main.async {
                    call.reject("ENCODE_ERROR", "Could not encode mask as PNG")
                }
                return
            }

            let durationMs = Int(Date().timeIntervalSince(started) * 1000)

            DispatchQueue.main.async {
                call.resolve([
                    "maskPngBase64": pngData.base64EncodedString(),
                    "durationMs": durationMs,
                ])
            }
        }
    }

    /// Convert a single-channel CVPixelBuffer mask to a grayscale PNG, scaled
    /// to `targetSize`. The web layer renders the mask with the same CSS
    /// transform (offsetTransform + object-fit: cover) as the source image,
    /// so dimensions must match exactly for the silhouette to align.
    private func maskToPng(mask: CVPixelBuffer, targetSize: CGSize) -> Data? {
        let ciImage = CIImage(cvPixelBuffer: mask)
        let context = CIContext(options: nil)

        let maskWidth = CVPixelBufferGetWidth(mask)
        let maskHeight = CVPixelBufferGetHeight(mask)
        let scaleX = targetSize.width / CGFloat(maskWidth)
        let scaleY = targetSize.height / CGFloat(maskHeight)
        let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        guard let cgScaled = context.createCGImage(scaled, from: CGRect(origin: .zero, size: targetSize)) else {
            return nil
        }

        let uiImage = UIImage(cgImage: cgScaled)
        return uiImage.pngData()
    }
}
