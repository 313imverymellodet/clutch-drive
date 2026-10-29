// PNG frames (+ optional soundtrack) -> H.264 MP4, with AVFoundation (no ffmpeg needed).
//   swift marketing/tools/encode.swift <framesDir> <fps> <out.mp4> [audio.m4a]
// Frames are read in name order (frame_00001.png, ...). Video is H.264 High, ~12 Mbps, yuv420; audio AAC.
import AVFoundation
import AppKit

let args = CommandLine.arguments
guard args.count >= 4 else { print("usage: encode <framesDir> <fps> <out.mp4> [audio.m4a]"); exit(1) }
let dir = URL(fileURLWithPath: args[1])
let fps = Int32(args[2])!
let out = URL(fileURLWithPath: args[3])
let audio = args.count > 4 ? URL(fileURLWithPath: args[4]) : nil

let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".png") || $0.hasSuffix(".jpg") }.sorted()
guard let first = NSImage(contentsOf: dir.appendingPathComponent(files[0])),
      let firstCG = first.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("no frames"); exit(1) }
let width = firstCG.width, height = firstCG.height

let videoOnly = audio == nil ? out : out.deletingLastPathComponent().appendingPathComponent(".video-only.mp4")
try? FileManager.default.removeItem(at: videoOnly)
let writer = try AVAssetWriter(outputURL: videoOnly, fileType: .mp4)
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 12_000_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    AVVideoMaxKeyFrameIntervalKey: Int(fps) * 2,
  ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height,
])
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)

for (i, name) in files.enumerated() {
  autoreleasepool {
    guard let img = NSImage(contentsOf: dir.appendingPathComponent(name)),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
    while !input.isReadyForMoreMediaData { usleep(2000) }
    var pb: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &pb)
    guard let buffer = pb else { return }
    CVPixelBufferLockBaseAddress(buffer, [])
    let ctx = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
                        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
    CVPixelBufferUnlockBaseAddress(buffer, [])
    adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: fps))
  }
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { print("video failed: \(String(describing: writer.error))"); exit(1) }
print("video: \(files.count) frames, \(width)x\(height) @ \(fps)fps")

if let audio = audio {
  // mux: the video track plus the soundtrack, trimmed to the video's length
  let comp = AVMutableComposition()
  let vAsset = AVURLAsset(url: videoOnly)
  let aAsset = AVURLAsset(url: audio)
  let sem = DispatchSemaphore(value: 0)
  Task {
    do {
      let vTrack = try await vAsset.loadTracks(withMediaType: .video)[0]
      let duration = try await vAsset.load(.duration)
      let cv = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
      try cv.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: vTrack, at: .zero)
      if let aTrack = try await aAsset.loadTracks(withMediaType: .audio).first {
        let aDur = try await aAsset.load(.duration)
        let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
        try ca.insertTimeRange(CMTimeRange(start: .zero, duration: CMTimeMinimum(duration, aDur)), of: aTrack, at: .zero)
      }
      try? FileManager.default.removeItem(at: out)
      let export = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough)!
      try await export.export(to: out, as: .mp4)
      print("muxed: \(out.path)")
    } catch { print("mux failed: \(error)") }
    sem.signal()
  }
  sem.wait()
  try? FileManager.default.removeItem(at: videoOnly)
}
