// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "speech-helper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "speech-helper",
            path: "Sources/speech-helper"
        )
    ]
)
