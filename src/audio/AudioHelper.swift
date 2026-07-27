import AVFoundation
import Foundation

private let pcmFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24_000, channels: 1, interleaved: true)!

func requestMicrophonePermission() -> Bool {
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false
    AVCaptureDevice.requestAccess(for: .audio) { allowed in
        granted = allowed
        semaphore.signal()
    }
    semaphore.wait()
    return granted
}

func capture() throws {
    guard requestMicrophonePermission() else {
        throw NSError(domain: "RailAudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone permission denied; continuing in text mode."])
    }
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let inputFormat = input.outputFormat(forBus: 0)
    guard let converter = AVAudioConverter(from: inputFormat, to: pcmFormat) else {
        throw NSError(domain: "RailAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot create microphone PCM converter."])
    }
    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { buffer, _ in
        let ratio = pcmFormat.sampleRate / inputFormat.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: capacity) else { return }
        var supplied = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, statusPointer in
            if supplied {
                statusPointer.pointee = .noDataNow
                return nil
            }
            supplied = true
            statusPointer.pointee = .haveData
            return buffer
        }
        guard status != .error, output.frameLength > 0, let data = output.audioBufferList.pointee.mBuffers.mData else { return }
        let byteCount = Int(output.frameLength) * MemoryLayout<Int16>.size
        FileHandle.standardOutput.write(Data(bytes: data, count: byteCount))
    }
    try engine.start()
    RunLoop.current.run()
}

func playback() throws {
    let engine = AVAudioEngine()
    let player = AVAudioPlayerNode()
    engine.attach(player)
    engine.connect(player, to: engine.mainMixerNode, format: pcmFormat)
    try engine.start()
    player.play()
    let scheduled = DispatchGroup()

    while let data = try FileHandle.standardInput.read(upToCount: 8192), !data.isEmpty {
        let frames = data.count / MemoryLayout<Int16>.size
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: pcmFormat, frameCapacity: AVAudioFrameCount(frames)) else { continue }
        buffer.frameLength = AVAudioFrameCount(frames)
        data.withUnsafeBytes { bytes in
            if let source = bytes.baseAddress, let destination = buffer.audioBufferList.pointee.mBuffers.mData {
                memcpy(destination, source, frames * MemoryLayout<Int16>.size)
            }
        }
        scheduled.enter()
        player.scheduleBuffer(buffer, completionHandler: { scheduled.leave() })
    }
    scheduled.wait()
    player.stop()
    engine.stop()
}

do {
    switch CommandLine.arguments.dropFirst().first {
    case "capture": try capture()
    case "playback": try playback()
    default: throw NSError(domain: "RailAudio", code: 64, userInfo: [NSLocalizedDescriptionKey: "Usage: rail-audio-helper capture|playback"])
    }
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
