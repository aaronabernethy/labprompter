// LabPrompter's voice-follow helper.
//
// A tiny CLI companion to the Electron app: Electron/Node can't call Apple's
// Speech framework directly, so this process does the listening and reports
// recognized text back over stdout as line-delimited JSON. It never leaves
// the device — `requiresOnDeviceRecognition` is hard-set below, matching
// LabPrompter's local-only design.
//
// Protocol:
//   stdout, one JSON object per line:
//     {"type":"ready"}                          engine started, mic is live
//     {"type":"partial","text":"..."}           live (not-yet-final) transcript
//     {"type":"final","text":"..."}             a completed utterance segment
//     {"type":"permission-denied","stage":"speech"|"microphone"}
//     {"type":"error","message":"..."}
//   stdin: a line containing exactly "stop" shuts the helper down cleanly.

import Foundation
import Speech
import AVFoundation

final class SpeechBridge {
    // All mutable state below is only ever touched on `queue`, so the
    // recognition callback (Speech's own queue), the rollover timer (main
    // run loop) and the stdin reader (a background queue) can't race.
    private let queue = DispatchQueue(label: "com.labprompter.speech-helper.state")

    private let audioEngine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var restartTimer: Timer?
    private var stopped = false
    private var tapInstalled = false

    // On-device recognition tasks are capped at roughly a minute of audio;
    // rolling over just before that keeps a long take listening continuously
    // instead of silently going quiet partway through.
    private let segmentSeconds: TimeInterval = 50

    func emit(_ dict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: dict),
            let str = String(data: data, encoding: .utf8)
        else { return }
        print(str)
        fflush(stdout)
    }

    func run() {
        setbuf(stdout, nil)

        let locale = ProcessInfo.processInfo.environment["LABPROMPTER_LOCALE"].map { Locale(identifier: $0) }
        recognizer = locale.flatMap { SFSpeechRecognizer(locale: $0) } ?? SFSpeechRecognizer()

        SFSpeechRecognizer.requestAuthorization { [weak self] authStatus in
            guard let self = self else { return }
            guard authStatus == .authorized else {
                self.emit(["type": "permission-denied", "stage": "speech"])
                exit(1)
            }
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                guard granted else {
                    self.emit(["type": "permission-denied", "stage": "microphone"])
                    exit(1)
                }
                self.queue.async { self.start() }
            }
        }

        readStdin()
        RunLoop.main.run()
    }

    private func readStdin() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine(strippingNewline: true) {
                if line.trimmingCharacters(in: .whitespacesAndNewlines) == "stop" {
                    self?.queue.async { self?.shutdown() }
                    exit(0)
                }
            }
        }
    }

    private func start() {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            emit(["type": "error", "message": "Speech recognizer isn't available right now."])
            return
        }
        guard recognizer.supportsOnDeviceRecognition else {
            // LabPrompter never sends audio off-device, so if on-device
            // recognition isn't available for this language, voice-follow
            // simply can't run here rather than silently using the cloud.
            emit([
                "type": "error",
                "message": "On-device speech recognition isn't available for this language on this Mac.",
            ])
            return
        }
        startSegment()
        installTapIfNeeded()
    }

    private func startSegment() {
        guard let recognizer = recognizer, !stopped else { return }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = true
        request = req

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            self.queue.async {
                if let result = result {
                    self.emit([
                        "type": result.isFinal ? "final" : "partial",
                        "text": result.bestTranscription.formattedString,
                    ])
                }
                if let error = error, !self.stopped {
                    // Rolling over to a fresh segment cancels the previous
                    // task, which reports itself here too — that's expected,
                    // not a real failure, so it's not surfaced as an error.
                    self.emit(["type": "error", "message": error.localizedDescription])
                }
            }
        }

        restartTimer?.invalidate()
        let timer = Timer(timeInterval: segmentSeconds, repeats: false) { [weak self] _ in
            self?.queue.async { self?.rollover() }
        }
        RunLoop.main.add(timer, forMode: .common)
        restartTimer = timer
    }

    private func rollover() {
        guard !stopped else { return }
        request?.endAudio()
        startSegment()
    }

    private func installTapIfNeeded() {
        guard !tapInstalled else { return }
        tapInstalled = true

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.queue.async { self?.request?.append(buffer) }
        }
        audioEngine.prepare()
        do {
            try audioEngine.start()
            emit(["type": "ready"])
        } catch {
            emit(["type": "error", "message": "Couldn't start the audio engine: \(error.localizedDescription)"])
        }
    }

    private func shutdown() {
        guard !stopped else { return }
        stopped = true
        restartTimer?.invalidate()
        restartTimer = nil
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        audioEngine.stop()
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
    }
}

let bridge = SpeechBridge()
bridge.run()
