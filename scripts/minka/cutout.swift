// Lifts the kitten out of its studio background with macOS Vision (the same as "Copy Subject" in Photos).
// swift scripts/minka/cutout.swift <in.png> <out.png>
import Foundation
import Vision
import CoreImage
import CoreImage.CIFilterBuiltins

let args = CommandLine.arguments
let input = CIImage(contentsOf: URL(fileURLWithPath: args[1]))!
let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: input)
try handler.perform([request])
guard let result = request.results?.first else { print("no subject found"); exit(1) }
let mask = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
let maskImage = CIImage(cvPixelBuffer: mask)
let blend = CIFilter.blendWithMask()
blend.inputImage = input
blend.maskImage = maskImage
blend.backgroundImage = CIImage.empty()
let out = blend.outputImage!.cropped(to: input.extent)
let ctx = CIContext()
try ctx.writePNGRepresentation(of: out, to: URL(fileURLWithPath: args[2]), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
print("wrote", args[2])
